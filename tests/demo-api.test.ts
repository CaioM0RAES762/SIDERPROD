import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { handleDemoRequest } from "@/lib/demo/api"
import { isDemoCredential } from "@/lib/demo/auth"
import { CENTROS } from "@/lib/demo/catalog"
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo/config"
import { resetStore } from "@/lib/demo/store"
import { __setDemoClock } from "@/lib/demo/time"

const AGORA = Date.UTC(2026, 4, 14, 17, 30, 0)

beforeAll(() => __setDemoClock(() => AGORA))
afterAll(() => __setDemoClock(null))
afterEach(() => resetStore())

function get(path: string, query = "", authenticated = true) {
  return handleDemoRequest({
    method: "GET",
    path,
    searchParams: new URLSearchParams(query),
    authenticated,
  })
}

function post(path: string, body: unknown, authenticated = true) {
  return handleDemoRequest({
    method: "POST",
    path,
    searchParams: new URLSearchParams(),
    body,
    authenticated,
  })
}

describe("autenticação da demonstração", () => {
  it("aceita apenas a credencial pública", () => {
    expect(isDemoCredential(DEMO_EMAIL, DEMO_PASSWORD)).toBe(true)
    expect(isDemoCredential(DEMO_EMAIL.toUpperCase(), DEMO_PASSWORD)).toBe(true)
    expect(isDemoCredential(DEMO_EMAIL, "outra-senha")).toBe(false)
    expect(isDemoCredential("alguem@exemplo.com", DEMO_PASSWORD)).toBe(false)
  })

  it("faz login e devolve o usuário fictício", async () => {
    const res = await post("auth/login", { email: DEMO_EMAIL, senha: DEMO_PASSWORD }, false)
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; user: { email: string } }
    expect(body.ok).toBe(true)
    expect(body.user.email).toBe(DEMO_EMAIL)
  })

  it("recusa credencial inválida com 401", async () => {
    const res = await post("auth/login", { email: DEMO_EMAIL, senha: "errada" }, false)
    expect(res.status).toBe(401)
  })

  it("responde 401 em /auth/me sem sessão", async () => {
    expect((await get("auth/me", "", false)).status).toBe(401)
    expect((await get("auth/me", "", true)).status).toBe(200)
  })

  it("não expõe cadastro nem recuperação de senha", async () => {
    expect((await post("auth/register", { email: "visitante@exemplo.com" })).status).toBe(503)
    expect((await post("auth/forgot-password", { email: "visitante@exemplo.com" })).status).toBe(503)
  })
})

describe("endpoints de leitura", () => {
  it("devolve um card por centro de trabalho", async () => {
    const res = await get("db/dashboard/cards")
    const cards = res.body as { centro_trabalho_id: string; status_ct: string }[]
    expect(cards).toHaveLength(CENTROS.length)
    for (const c of cards) expect(["RUNNING", "STOPPED"]).toContain(c.status_ct)
  })

  it("mantém o card coerente com o OEE do turno", async () => {
    const cards = (await get("db/dashboard/cards")).body as Record<string, number | null>[]
    for (const c of cards) {
      if (c.oee == null) continue
      const esperado = (c.availability as number) * (c.performance as number) * (c.quality as number)
      expect(c.oee as number).toBeCloseTo(esperado, 10)
    }
  })

  it("entrega catálogos completos", async () => {
    for (const [rota, minimo] of [
      ["db/centros-trabalho", 12],
      ["db/produtos", 8],
      ["db/turnos", 3],
      ["db/motivos-parada", 10],
      ["db/grupos", 4],
    ] as const) {
      const rows = (await get(rota)).body as unknown[]
      expect(rows.length).toBeGreaterThanOrEqual(minimo)
    }
  })

  it("agrega paradas do turno por motivo", async () => {
    const res = await get("db/dashboard/paradas-agregadas-turno-atual")
    const body = res.body as { turno: { inicio_utc: string }; paradas: { tempo_total_seg: number }[] }
    expect(body.turno.inicio_utc).toBeTruthy()
    for (const p of body.paradas) expect(p.tempo_total_seg).toBeGreaterThan(0)
  })

  it("responde ao relatório consolidado com todas as seções", async () => {
    const res = await handleDemoRequest({
      method: "POST",
      path: "db/relatorio",
      searchParams: new URLSearchParams(),
      body: {
        op: "consolidado",
        filters: {
          startUtc: new Date(AGORA - 86_400_000).toISOString(),
          endUtc: new Date(AGORA).toISOString(),
        },
      },
      authenticated: true,
    })
    const body = res.body as { ok: boolean; data: Record<string, unknown> }
    expect(body.ok).toBe(true)
    for (const secao of [
      "producao_hora",
      "producao_dia",
      "oee",
      "grafico_perdas",
      "paradas",
      "paradas_pareto",
      "producao_ordens",
    ]) {
      expect(body.data[secao]).toBeDefined()
    }
  })

  it("devolve séries do histórico alinhadas aos rótulos", async () => {
    const res = await get(
      "db/historico",
      `tab=oee&granularity=op_day&startUtc=${new Date(AGORA - 5 * 86_400_000).toISOString()}&endUtc=${new Date(AGORA).toISOString()}`,
    )
    const body = res.body as { labels: string[]; seriesList: { name: string; data: number[] }[] }
    expect(body.labels.length).toBeGreaterThan(0)
    for (const s of body.seriesList) expect(s.data).toHaveLength(body.labels.length)
  })

  it("devolve o Kanban de logística com as mesmas ordens do dashboard", async () => {
    const res = await get("db/logistica-ordem", "action=kanban")
    const body = res.body as { success: boolean; data: { ordem_codigo: string }[] }
    expect(body.success).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    for (const o of body.data) expect(o.ordem_codigo).toMatch(/^OP-[A-Z]{3}-\d{5}$/)
  })

  it("nega rota inexistente sem quebrar", async () => {
    const res = await get("nao/existe")
    expect(res.status).toBe(404)
  })
})

describe("operações de escrita simuladas", () => {
  const ct = CENTROS[0].centro_trabalho_id

  it("soma o apontamento manual à produção do turno", async () => {
    const antes = ((await get("db/dashboard/cards")).body as { centro_trabalho_id: string; turno_good: number }[])
      .find((c) => c.centro_trabalho_id === ct)!.turno_good

    const res = await post("db/posto", { action: "apontar-producao", centro_trabalho_id: ct, quantidade: 9 })
    expect((res.body as { ok: boolean }).ok).toBe(true)

    const depois = ((await get("db/dashboard/cards")).body as { centro_trabalho_id: string; turno_good: number }[])
      .find((c) => c.centro_trabalho_id === ct)!.turno_good
    expect(depois).toBe(antes + 9)
  })

  it("recusa quantidade inválida", async () => {
    const res = await post("db/posto", { action: "apontar-producao", centro_trabalho_id: ct, quantidade: 0 })
    expect(res.status).toBe(400)
  })

  it("para e retoma o posto", async () => {
    const motivos = (await get("db/posto", "op=motivos-parada")).body as {
      data: { motivo_id: string; codigo: string }[]
    }
    const quebra = motivos.data.find((m) => m.codigo === "QUEBRA")!

    await post("db/posto", { action: "iniciar-parada", centro_trabalho_id: ct, motivo_id: quebra.motivo_id })
    const parado = (await get("db/posto", `op=header&centro_trabalho_id=${ct}`)).body as {
      data: { status_ct: string; motivo_codigo: string }
    }
    expect(parado.data.status_ct).toBe("STOPPED")
    expect(parado.data.motivo_codigo).toBe("QUEBRA")

    await post("db/posto", { action: "retomar-producao", centro_trabalho_id: ct })
    const rodando = (await get("db/posto", `op=header&centro_trabalho_id=${ct}`)).body as {
      data: { status_ct: string }
    }
    expect(rodando.data.status_ct).toBe("RUNNING")
  })

  it("cria e remove uma anotação", async () => {
    const criada = await post("db/anotacoes", { texto: "Teste automatizado", centro_trabalho_id: ct })
    const body = criada.body as { success: boolean; data: { id: string } }
    expect(body.success).toBe(true)

    const lista = (await get("db/anotacoes")).body as { id: string }[]
    expect(lista.some((a) => a.id === body.data.id)).toBe(true)

    await handleDemoRequest({
      method: "DELETE",
      path: "db/anotacoes",
      searchParams: new URLSearchParams(`id=${body.data.id}`),
      authenticated: true,
    })
    const depois = (await get("db/anotacoes")).body as { id: string }[]
    expect(depois.some((a) => a.id === body.data.id)).toBe(false)
  })

  it("recusa anotação sem texto", async () => {
    const res = await post("db/anotacoes", { texto: "   " })
    expect(res.status).toBe(400)
  })

  it("volta ao estado gerado depois de resetar", async () => {
    await post("db/posto", { action: "apontar-producao", centro_trabalho_id: ct, quantidade: 50 })
    const comEscrita = ((await get("db/dashboard/cards")).body as { centro_trabalho_id: string; turno_good: number }[])
      .find((c) => c.centro_trabalho_id === ct)!.turno_good
    resetStore()
    const limpo = ((await get("db/dashboard/cards")).body as { centro_trabalho_id: string; turno_good: number }[])
      .find((c) => c.centro_trabalho_id === ct)!.turno_good
    expect(comEscrita - limpo).toBe(50)
  })
})

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CENTROS, MOTIVOS_BY_ID, PRODUTOS_BY_ID } from "@/lib/demo/catalog"
import {
  aggregate,
  bucketsDoDia,
  getDayPlan,
  paradasDoDia,
  progressoProduto,
} from "@/lib/demo/factory"
import {
  __setDemoClock,
  operationalDayIndex,
  operationalDayStart,
  shiftsOfDay,
} from "@/lib/demo/time"

// Relógio congelado: sem isto o dataset muda a cada milissegundo e as
// asserções ficariam dependentes do instante da execução.
const AGORA = Date.UTC(2026, 4, 14, 17, 30, 0)

beforeAll(() => __setDemoClock(() => AGORA))
afterAll(() => __setDemoClock(null))

const DIA = operationalDayIndex(AGORA)

describe("dataset determinístico", () => {
  it("gera o mesmo plano para a mesma chave", () => {
    const a = getDayPlan(CENTROS[0].centro_trabalho_id, DIA)
    const b = getDayPlan(CENTROS[0].centro_trabalho_id, DIA)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("gera planos diferentes para postos diferentes", () => {
    const a = getDayPlan(CENTROS[0].centro_trabalho_id, DIA)
    const b = getDayPlan(CENTROS[1].centro_trabalho_id, DIA)
    expect(JSON.stringify(a.paradas)).not.toBe(JSON.stringify(b.paradas))
  })

  it("cobre o dia operacional inteiro com ordens de produção", () => {
    for (const ct of CENTROS) {
      const plan = getDayPlan(ct.centro_trabalho_id, DIA)
      expect(plan.corridas.length).toBeGreaterThan(0)
      expect(plan.corridas[0].inicio).toBe(plan.inicio)
      expect(plan.corridas[plan.corridas.length - 1].fim).toBe(plan.fim)

      // As ordens são contíguas: o fim de uma é o início da seguinte.
      for (let i = 1; i < plan.corridas.length; i++) {
        expect(plan.corridas[i].inicio).toBe(plan.corridas[i - 1].fim)
      }
    }
  })

  it("não sobrepõe paradas no mesmo posto", () => {
    for (const ct of CENTROS) {
      const paradas = getDayPlan(ct.centro_trabalho_id, DIA).paradas
      for (let i = 1; i < paradas.length; i++) {
        expect(paradas[i].inicio).toBeGreaterThanOrEqual(paradas[i - 1].fim)
      }
    }
  })

  it("usa apenas produtos e motivos do catálogo fictício", () => {
    for (const ct of CENTROS) {
      const plan = getDayPlan(ct.centro_trabalho_id, DIA)
      for (const c of plan.corridas) expect(PRODUTOS_BY_ID.has(c.produto_id)).toBe(true)
      for (const p of plan.paradas) expect(MOTIVOS_BY_ID.has(p.motivo_id)).toBe(true)
    }
  })
})

describe("coerência dos indicadores", () => {
  it("mantém total = boas + refugo + retrabalho em cada hora", () => {
    for (const ct of CENTROS) {
      for (const b of bucketsDoDia(ct.centro_trabalho_id, DIA)) {
        expect(b.good + b.scrap + b.rework).toBe(b.total)
        expect(b.good).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("respeita tempo operante ≤ tempo planejado ≤ tempo decorrido", () => {
    for (const ct of CENTROS) {
      for (const b of bucketsDoDia(ct.centro_trabalho_id, DIA)) {
        expect(b.run_time_seg).toBeLessThanOrEqual(b.planned_time_seg)
        expect(b.planned_time_seg).toBeLessThanOrEqual(b.elapsed_seg)
        expect(b.elapsed_seg).toBeLessThanOrEqual(3600)
      }
    }
  })

  it("calcula OEE como disponibilidade × performance × qualidade", () => {
    for (const ct of CENTROS) {
      const agg = aggregate(bucketsDoDia(ct.centro_trabalho_id, DIA))
      if (agg.oee == null) continue
      const esperado = (agg.availability ?? 0) * (agg.performance ?? 0) * (agg.quality ?? 0)
      expect(agg.oee).toBeCloseTo(esperado, 10)
      expect(agg.oee).toBeGreaterThan(0)
      expect(agg.oee).toBeLessThanOrEqual(1)
    }
  })

  it("mantém cada componente do OEE dentro de 0..1", () => {
    for (const ct of CENTROS) {
      const agg = aggregate(bucketsDoDia(ct.centro_trabalho_id, DIA))
      for (const v of [agg.availability, agg.performance, agg.quality]) {
        if (v == null) continue
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it("faz a soma dos turnos bater com o total do dia", () => {
    const ct = CENTROS[0].centro_trabalho_id
    const diaTodo = aggregate(bucketsDoDia(ct, DIA))
    const porTurno = shiftsOfDay(DIA)
      .map((t) =>
        aggregate(
          bucketsDoDia(ct, DIA).filter((b) => b.inicio >= t.inicio && b.inicio < t.fim),
        ),
      )
      .reduce((acc, a) => acc + a.good, 0)
    expect(porTurno).toBe(diaTodo.good)
  })

  it("desconta as paradas do tempo operante", () => {
    const ct = CENTROS.find((c) => c.perfil === "gargalo")!.centro_trabalho_id
    const agg = aggregate(bucketsDoDia(ct, DIA))
    const paradas = paradasDoDia(ct, DIA)
    expect(paradas.length).toBeGreaterThan(0)
    expect(agg.planned_stop_seg + agg.unplanned_stop_seg).toBeGreaterThan(0)
    expect(agg.run_time_seg).toBeLessThan(agg.elapsed_seg)
  })

  it("não gera produção futura", () => {
    for (const ct of CENTROS) {
      const buckets = bucketsDoDia(ct.centro_trabalho_id, DIA)
      for (const b of buckets) expect(b.inicio).toBeLessThan(AGORA)
    }
  })

  it("acumula o progresso da peça sem ultrapassar o programa", () => {
    for (const produto of PRODUTOS_BY_ID.values()) {
      const p = progressoProduto(produto.produto_id)
      expect(p.total_good).toBeGreaterThan(0)
      expect(p.pct).toBeGreaterThan(0)
      expect(p.pct).toBeLessThanOrEqual(1)
    }
  })
})

describe("recortes de tempo", () => {
  it("divide o dia operacional em três turnos de oito horas", () => {
    const turnos = shiftsOfDay(DIA)
    expect(turnos).toHaveLength(3)
    expect(turnos[0].inicio).toBe(operationalDayStart(DIA))
    for (const t of turnos) expect(t.fim - t.inicio).toBe(8 * 3_600_000)
    expect(turnos[2].fim - turnos[0].inicio).toBe(24 * 3_600_000)
  })
})

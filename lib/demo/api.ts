// lib/demo/api.ts
//
// Roteador da API de demonstração.
//
// É o substituto direto das rotas `/api/**` do sistema original: recebe método,
// caminho e parâmetros e devolve exatamente os mesmos formatos de resposta que a
// interface já consumia — só que servidos a partir da fábrica gerada em memória,
// sem banco de dados, SMTP ou qualquer serviço externo.
//
// O mesmo roteador é usado nos dois lados:
//   • no navegador, pelo interceptador de `fetch` (lib/demo/client.tsx);
//   • no servidor, pela rota coringa `app/api/[...path]/route.ts`.

import {
  CENTROS,
  CENTROS_BY_ID,
  EMPRESA_ID,
  GRUPOS_PERDA,
  MOTIVOS_BY_ID,
  PRODUTOS,
  PRODUTOS_BY_ID,
  SETORES,
  TURNOS,
  USUARIOS,
} from "./catalog"
import { DEMO_EMAIL, DEMO_PASSWORD } from "./config"
import { demoUserPayload, isDemoCredential } from "./auth"
import {
  aggregate,
  bucketsNaJanela,
  corridaEm,
  getDayPlan,
  pecasRetrabalho,
} from "./factory"
import {
  analiticoLookups,
  analiticoPareto,
  analiticoRows,
  centrosFiltrados,
  historicoLista,
  historicoSeries,
  paradasFiltradas,
  rebarbadoresRanking,
  relatorioAnotacoes,
  relatorioConsolidado,
  relatorioGraficoPerdas,
  relatorioOee,
  relatorioParadas,
  relatorioParadasPareto,
  relatorioPlanosAcao,
  relatorioProducaoDia,
  relatorioProducaoHora,
  relatorioProducaoOrdens,
  type ReportFilters,
} from "./reports"
import { handleLogistica } from "./logistics"
import {
  addContagem,
  getFuncionario,
  getStore,
  novoId,
  type DemoAnotacao,
  type DemoPlanoAcao,
} from "./store"
import {
  DAY_MS,
  dayIndexFromISO,
  demoNow,
  HOUR_MS,
  iso,
  operationalDayIndex,
  operationalDayStart,
  shiftAt,
  shiftsOfDay,
} from "./time"
import {
  buildCard,
  cicloInstantaneo,
  historicoDia,
  listCards,
  oeeConsolidadoTurnos,
  oeePorPeriodo,
  paradaRow,
  paradasAgregadasPorMotivo,
  paradasView,
  perdasPorMinuto,
  perdasPorPeriodo,
  producaoDiaOperacional,
  producaoPorHora,
  statusAtual,
} from "./views"

// ─── Contrato ────────────────────────────────────────────────────────────────

export type DemoHttpRequest = {
  method: string
  /** Caminho sem o prefixo `/api/`. Ex.: "db/dashboard/cards". */
  path: string
  searchParams: URLSearchParams
  body?: unknown
  /** Se a sessão de demonstração está ativa. */
  authenticated?: boolean
}

export type DemoHttpResponse = {
  status: number
  body: unknown
  /** Preenchido apenas em rotas que respondem com redirecionamento. */
  redirect?: string
}

const ok = (body: unknown): DemoHttpResponse => ({ status: 200, body })
const envelope = (data: unknown): DemoHttpResponse => ({ status: 200, body: { ok: true, data } })
const fail = (error: string, status = 400): DemoHttpResponse => ({ status, body: { ok: false, error } })

// ─── Parsing de parâmetros ───────────────────────────────────────────────────

function csv(sp: URLSearchParams, key: string): string[] | undefined {
  const raw = sp.get(key)
  if (!raw) return undefined
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean)
  return list.length ? list : undefined
}

function all(sp: URLSearchParams, key: string): string[] | undefined {
  const list = sp.getAll(key).flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean)
  return list.length ? list : undefined
}

function isoParam(sp: URLSearchParams, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = sp.get(k)
    if (!v) continue
    const t = new Date(v).getTime()
    if (Number.isFinite(t)) return t
  }
  return null
}

/** Converte `dataInicio`/`dataFim` (YYYY-MM-DD) na janela do dia operacional. */
function janelaDeDatas(sp: URLSearchParams, nowMs: number): { from: number; to: number } {
  const di = sp.get("dataInicio")
  const df = sp.get("dataFim")
  if (di && df) {
    const from = operationalDayStart(dayIndexFromISO(di))
    const to = operationalDayStart(dayIndexFromISO(df)) + DAY_MS
    return { from, to }
  }
  const inicio = isoParam(sp, "inicioUtc", "startUtc", "from_utc")
  const fim = isoParam(sp, "fimUtc", "endUtc", "to_utc")
  if (inicio != null && fim != null) return { from: inicio, to: fim }
  const dia = operationalDayIndex(nowMs)
  return { from: operationalDayStart(dia), to: operationalDayStart(dia) + DAY_MS }
}

function filtrosDeQuery(sp: URLSearchParams, nowMs: number): ReportFilters {
  const { from, to } = janelaDeDatas(sp, nowMs)
  return {
    startUtc: from,
    endUtc: to,
    centroTrabalhoId: sp.get("centroTrabalhoId") ?? sp.get("centro_trabalho_id"),
    centrosTrabalhoIds: all(sp, "centrosTrabalhoIds") ?? csv(sp, "centrosIds"),
    setorId: sp.get("setorId"),
    setorIds: all(sp, "setorIds"),
    turnoId: sp.get("turnoId"),
    turnoIds: all(sp, "turnoIds"),
    produtoId: sp.get("produtoId"),
    ordemId: sp.get("ordemId"),
    motivoId: sp.get("motivoId"),
    motivoGrupoPerda: sp.get("motivoGrupoPerda"),
  }
}

function asRecord(body: unknown): Record<string, any> {
  return body && typeof body === "object" ? (body as Record<string, any>) : {}
}

// ─── Catálogos ───────────────────────────────────────────────────────────────

function catalogo(nome: string, nowMs: number): unknown {
  const store = getStore()

  switch (nome) {
    case "grupos":
      return SETORES.map((s) => ({ id: s.setor_id, nome: s.nome, descricao: s.nome, public_id: s.nome, ativo: true }))

    case "centros-trabalho":
      return CENTROS.map((c) => ({
        id: c.centro_trabalho_id,
        centro_trabalho_id: c.centro_trabalho_id,
        public_id: c.codigo,
        codigo: c.codigo,
        nome: c.nome,
        ativo: true,
        setor_id: c.setor_id,
        empresa_id: EMPRESA_ID,
      }))

    case "turnos":
      return TURNOS.map((t, i) => ({
        id: `turno-${i}`,
        turno_id: `turno-${i}`,
        public_id: `T${i + 1}`,
        nome: t.nome,
        hora_inicio: t.hora_inicio,
        hora_fim: t.hora_fim,
        ordem_exibicao: t.ordem_exibicao,
        ativo: true,
      }))

    case "produtos":
      return PRODUTOS.map((p) => ({
        id: p.produto_id,
        produto_id: p.produto_id,
        public_id: p.codigo,
        codigo: p.codigo,
        nome: p.descricao,
        descricao: p.descricao,
        familia: p.familia,
        unidade: p.unidade,
        unidade_medida: p.unidade,
        ciclo_ideal_seg: p.ciclo_ideal_seg,
        tempo_ciclo_padrao: p.ciclo_ideal_seg,
        meta_turno: p.meta_turno,
        ativo: true,
      }))

    case "usuarios":
      return USUARIOS.map((u) => ({
        id: u.usuario_id,
        usuario_id: u.usuario_id,
        nome: u.nome,
        email: u.email,
        cargo: u.cargo,
        perfil: u.perfil,
        ativo: u.is_active,
      }))

    case "motivos-parada":
      return store.motivos.map((m) => ({
        id: m.motivo_id,
        motivo_id: m.motivo_id,
        public_id: m.codigo,
        codigo: m.codigo,
        nome: m.descricao,
        descricao: m.descricao,
        categoria: m.grupo_perda,
        grupo_perda: m.grupo_perda,
        is_planejada: m.is_planejada,
        exige_justificativa: m.exige_justificativa,
        sla_minutos: m.sla_minutos,
        tipo: m.is_planejada ? "Planejada" : "Não planejada",
        ativo: true,
        is_ativo: true,
      }))

    case "ordens": {
      const dia = operationalDayIndex(nowMs)
      const out: Record<string, unknown>[] = []
      for (let d = dia - 3; d <= dia; d++) {
        for (const ct of CENTROS) {
          for (const c of getDayPlan(ct.centro_trabalho_id, d).corridas) {
            if (c.inicio > nowMs) continue
            const produto = PRODUTOS_BY_ID.get(c.produto_id)
            const agg = aggregate(bucketsNaJanela(ct.centro_trabalho_id, c.inicio, Math.min(c.fim, nowMs), nowMs))
            out.push({
              id: c.ordem_id,
              ordem_id: c.ordem_id,
              codigo: c.ordem_codigo,
              public_id: c.ordem_codigo,
              quantidade_planejada: c.meta,
              quantidade_produzida: agg.good,
              quantidade_rejeitada: agg.scrap,
              estado: c.fim <= nowMs ? "Concluída" : "Em execução",
              status_ordem: c.fim <= nowMs ? "CONCLUIDA" : "EM_EXECUCAO",
              data_inicio_planejado: iso(c.inicio),
              data_fim_planejado: iso(c.fim),
              data_inicio_real: iso(c.inicio),
              data_fim_real: c.fim <= nowMs ? iso(c.fim) : null,
              prioridade: 1,
              produto_id: c.produto_id,
              produto_codigo: produto?.codigo ?? null,
              produto_nome: produto?.descricao ?? null,
              centro_trabalho_id: ct.centro_trabalho_id,
              centro_trabalho_nome: ct.nome,
            })
          }
        }
      }
      return out.sort((a, b) => String(b.data_inicio_real).localeCompare(String(a.data_inicio_real)))
    }

    case "planos-melhoria":
      return store.planosMelhoria.map((p) => ({
        id: p.id,
        public_id: p.public_id,
        titulo: p.titulo,
        descricao: p.descricao,
        problema: p.problema,
        meta: p.meta,
        resultado: p.resultado,
        estado: p.estado,
        grupo_perda: p.grupo_perda,
        categoria: p.grupo_perda,
        data_inicio: p.data_inicio,
        data_conclusao: p.data_conclusao,
        criado_em: p.criado_em,
        created_at: p.criado_em,
        centro_trabalho_id: p.centro_trabalho_id,
        centro_trabalho_nome: p.centro_trabalho_nome,
        responsavel_id: p.responsavel_id,
        responsavel_nome: p.responsavel_nome,
        resultado_esperado: p.meta,
        resultado_obtido: p.resultado,
      }))

    case "grupos-perda":
      return GRUPOS_PERDA.map((g) => ({ id: g, nome: g }))

    default:
      return []
  }
}

// ─── Paradas (listagens genéricas) ───────────────────────────────────────────

function todasParadas(nowMs: number, dias = 2) {
  const diaAtual = operationalDayIndex(nowMs)
  const out = []
  for (const ct of CENTROS) {
    for (let d = diaAtual - dias; d <= diaAtual; d++) {
      const inicio = operationalDayStart(d)
      out.push(...paradasView(ct.centro_trabalho_id, inicio, inicio + DAY_MS, nowMs).map(paradaRow))
    }
  }
  return out.sort((a, b) => b.inicio_utc.localeCompare(a.inicio_utc))
}

// ─── Handlers: /api/db/posto ─────────────────────────────────────────────────

function postoGet(sp: URLSearchParams, nowMs: number): DemoHttpResponse {
  const op = (sp.get("op") ?? "").toLowerCase()
  const ctId = sp.get("centro_trabalho_id") ?? sp.get("centroTrabalhoId") ?? ""
  const ct = CENTROS_BY_ID.get(ctId)
  const store = getStore()

  switch (op) {
    case "header": {
      if (!ct) return envelope(null)
      return envelope(buildCard(ct, nowMs))
    }

    case "producao-por-hora": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return envelope(ct ? producaoPorHora(ct.centro_trabalho_id, from, to, nowMs) : [])
    }

    case "oee-por-periodo": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return envelope(ct ? oeePorPeriodo(ct.centro_trabalho_id, from, to, nowMs) : [])
    }

    case "perdas-por-periodo": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return envelope(ct ? perdasPorPeriodo(ct.centro_trabalho_id, from, to, nowMs) : [])
    }

    case "paradas-turno": {
      const ini = isoParam(sp, "turnoInicio") ?? shiftAt(nowMs).inicio
      const fim = isoParam(sp, "turnoFim") ?? shiftAt(nowMs).fim
      return envelope(ct ? paradasView(ct.centro_trabalho_id, ini, fim, nowMs).map(paradaRow) : [])
    }

    case "paradas-pendentes": {
      const turno = shiftAt(nowMs)
      if (!ct) return envelope([])
      return envelope(
        paradasView(ct.centro_trabalho_id, turno.inicio, nowMs, nowMs)
          .filter((p) => !p.is_justificada)
          .map(paradaRow),
      )
    }

    case "motivos-parada":
      return envelope(
        store.motivos.map((m) => ({
          motivo_id: m.motivo_id,
          empresa_id: EMPRESA_ID,
          public_id: m.codigo,
          codigo: m.codigo,
          descricao: m.descricao,
          grupo_perda: m.grupo_perda,
          is_planejada: m.is_planejada,
          exige_justificativa: m.exige_justificativa,
          sla_minutos: m.sla_minutos,
          is_ativo: true,
        })),
      )

    case "funcionarios": {
      const q = (sp.get("q") ?? "").toLowerCase()
      const cargo = sp.get("cargo")
      const excluir = sp.get("excluir_cargo")
      return envelope(
        store.funcionarios
          .filter((f) => (!q || f.nome.toLowerCase().includes(q) || (f.registro ?? "").toLowerCase().includes(q)))
          .filter((f) => (!cargo || f.cargo === cargo))
          .filter((f) => (!excluir || f.cargo !== excluir))
          .map((f) => ({ ...f, empresa_id: EMPRESA_ID, public_id: f.registro })),
      )
    }

    case "turnos":
      return envelope(
        TURNOS.map((t, i) => ({
          turno_id: `turno-${i}`,
          public_id: `T${i + 1}`,
          nome: t.nome,
          hora_inicio: t.hora_inicio,
          hora_fim: t.hora_fim,
          ordem_exibicao: t.ordem_exibicao,
        })),
      )

    case "apontadores-padrao":
      return envelope(
        TURNOS.map((t, i) => {
          const funcId = store.apontadorPadrao.get(`${ctId}|turno-${i}`) ?? null
          const func = getFuncionario(funcId)
          return {
            turno_id: `turno-${i}`,
            turno_nome: t.nome,
            ordem_exibicao: t.ordem_exibicao,
            funcionario_id: func?.funcionario_id ?? null,
            nome: func?.nome ?? null,
            registro: func?.registro ?? null,
          }
        }),
      )

    case "apontador-historico": {
      const from = isoParam(sp, "from_utc") ?? shiftAt(nowMs).inicio
      const to = isoParam(sp, "to_utc") ?? nowMs
      const func = getFuncionario(store.apontadorPorCt.get(ctId))
      return envelope([
        {
          funcionario_id: func?.funcionario_id ?? null,
          nome: func?.nome ?? null,
          inicio_utc: iso(from),
          fim_utc: to < nowMs ? iso(to) : null,
        },
      ])
    }

    case "retrabalho-pecas":
      return envelope({
        centro_trabalho_id: ctId,
        modo_contagem: store.modoContagem.get(ctId) ?? ct?.modo_contagem ?? "GOOD",
        pecas: store.retrabalhoPecas.get(ctId) ?? pecasRetrabalho(ctId),
      })

    case "produtos": {
      const q = (sp.get("q") ?? "").toLowerCase()
      return envelope(
        PRODUTOS.filter((p) => !q || p.descricao.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)).map(
          (p) => ({
            produto_id: p.produto_id,
            public_id: p.codigo,
            codigo: p.codigo,
            descricao: p.descricao,
            ciclo_ideal_seg: p.ciclo_ideal_seg,
          }),
        ),
      )
    }

    case "available-orders": {
      const q = (sp.get("q") ?? "").toLowerCase()
      const fila = store.filas.get(ctId) ?? []
      const naFila = new Set(fila.map((f) => f.ordem_id))
      const dia = operationalDayIndex(nowMs)
      const out: Record<string, unknown>[] = []
      for (let d = dia; d <= dia + 2; d++) {
        for (const c of getDayPlan(ctId, d).corridas) {
          if (naFila.has(c.ordem_id)) continue
          const produto = PRODUTOS_BY_ID.get(c.produto_id)
          if (q && !c.ordem_codigo.toLowerCase().includes(q) && !(produto?.descricao ?? "").toLowerCase().includes(q)) continue
          out.push({
            ordem_id: c.ordem_id,
            ordem_public_id: c.ordem_codigo,
            ordem_codigo: c.ordem_codigo,
            produto_descricao: produto?.descricao ?? null,
            produto_public_id: produto?.codigo ?? null,
            prioridade: 1,
            saldo: c.meta,
          })
        }
      }
      return envelope(out)
    }

    case "queue": {
      const fila = store.filas.get(ctId) ?? []
      const atual = fila.find((f) => f.is_current) ?? null
      const status = ct ? statusAtual(ct.centro_trabalho_id, nowMs) : null
      const card = ct ? buildCard(ct, nowMs) : null
      return envelope({
        current: atual
          ? {
              ordem_atual_id: atual.ordem_id,
              ordem_codigo: atual.ordem_codigo,
              produto_descricao: atual.produto_descricao,
              status_ct: status?.status_ct ?? null,
              total_good: card?.total_good ?? 0,
              condicao_fim_tipo: atual.finish_rule.tipo,
              condicao_fim_qtd: atual.finish_rule.qtd,
              condicao_fim_fim_utc: atual.finish_rule.fim_utc,
            }
          : null,
        queue: fila,
      })
    }

    case "list-cts":
      return envelope(
        CENTROS.map((c) => ({
          centro_trabalho_id: c.centro_trabalho_id,
          codigo: c.codigo,
          nome: c.nome,
          public_id: c.codigo,
        })),
      )

    case "list-cts-fila":
      return envelope(
        CENTROS.map((c) => ({
          centro_trabalho_id: c.centro_trabalho_id,
          codigo: c.codigo,
          nome: c.nome,
          public_id: c.codigo,
          itens: (store.filas.get(c.centro_trabalho_id) ?? []).length,
        })),
      )

    default:
      return envelope([])
  }
}

function postoPost(body: unknown, nowMs: number): DemoHttpResponse {
  const b = asRecord(body)
  const action = String(b.action ?? "").toLowerCase()
  const ctId = String(b.centro_trabalho_id ?? b.centroTrabalhoId ?? "")
  const store = getStore()

  switch (action) {
    case "apontar-producao": {
      const qtd = Number(b.quantidade ?? 1)
      if (!Number.isFinite(qtd) || qtd === 0) return fail("Quantidade inválida.")
      addContagem(ctId, { good: qtd })
      return envelope({ centro_trabalho_id: ctId, aplicado: qtd })
    }

    case "apontar-refugo-retrabalho": {
      const qtd = Number(b.quantidade ?? 1)
      const tipo = String(b.tipo ?? "SCRAP").toUpperCase()
      if (!Number.isFinite(qtd) || qtd === 0) return fail("Quantidade inválida.")
      if (tipo !== "SCRAP" && tipo !== "REWORK") return fail("Tipo inválido.")
      addContagem(ctId, tipo === "SCRAP" ? { scrap: qtd } : { rework: qtd })
      return envelope({ centro_trabalho_id: ctId, tipo, aplicado: qtd })
    }

    case "adicionar-peca-hack": {
      const qtd = Number(b.quantidade ?? 1)
      addContagem(ctId, { good: Number.isFinite(qtd) ? qtd : 1 })
      return envelope({ centro_trabalho_id: ctId })
    }

    case "iniciar-parada":
    case "apontar-parada":
    case "iniciar-nova-parada": {
      const motivoId = String(b.motivo_id ?? b.motivoId ?? "")
      if (!store.motivos.some((m) => m.motivo_id === motivoId)) return fail("Motivo de parada inválido.")
      store.statusOverride.set(ctId, { tipo: "STOPPED", motivo_id: motivoId, inicio: nowMs })
      return envelope({ centro_trabalho_id: ctId, status_ct: "STOPPED", motivo_id: motivoId })
    }

    case "retomar-producao": {
      const atual = store.statusOverride.get(ctId)
      if (atual?.tipo === "STOPPED") {
        const lista = store.paradasManuais.get(ctId) ?? []
        lista.push({
          parada_id: novoId("parada-manual"),
          centro_trabalho_id: ctId,
          motivo_id: atual.motivo_id,
          inicio: atual.inicio,
          fim: nowMs,
          is_justificada: true,
          justificativa_texto: "Registrada no ambiente de demonstração",
        })
        store.paradasManuais.set(ctId, lista)
      }
      store.statusOverride.set(ctId, { tipo: "RUNNING", desde: nowMs })
      return envelope({ centro_trabalho_id: ctId, status_ct: "RUNNING" })
    }

    case "justificar-parada": {
      const paradaId = String(b.parada_id ?? "")
      store.paradaOverride.set(paradaId, {
        motivo_id: b.motivo_id ? String(b.motivo_id) : undefined,
        is_justificada: true,
        justificativa_texto: b.justificativa_texto ? String(b.justificativa_texto) : null,
        justificativa_time_utc: iso(nowMs),
      })
      return envelope({ parada_id: paradaId, is_justificada: true })
    }

    case "editar-parada-motivo": {
      const paradaId = String(b.parada_id ?? "")
      const anterior = store.paradaOverride.get(paradaId) ?? {}
      store.paradaOverride.set(paradaId, { ...anterior, motivo_id: String(b.motivo_id ?? ""), is_justificada: true })
      return envelope({ parada_id: paradaId })
    }

    case "justificar-paradas-em-massa": {
      const ids: string[] = Array.isArray(b.parada_ids) ? b.parada_ids.map(String) : []
      for (const id of ids) {
        store.paradaOverride.set(id, {
          motivo_id: b.motivo_id ? String(b.motivo_id) : undefined,
          is_justificada: true,
          justificativa_texto: b.justificativa_texto ? String(b.justificativa_texto) : null,
          justificativa_time_utc: iso(nowMs),
        })
      }
      return envelope({ afetadas: ids.length })
    }

    case "criar-motivo-parada": {
      const motivo = {
        motivo_id: novoId("motivo"),
        codigo: String(b.codigo ?? "NOVO"),
        descricao: String(b.descricao ?? "Novo motivo"),
        grupo_perda: String(b.grupo_perda ?? "Ajustes de Processo"),
        is_planejada: Boolean(b.is_planejada),
        exige_justificativa: b.exige_justificativa !== false,
        sla_minutos: b.sla_minutos != null ? Number(b.sla_minutos) : null,
      }
      store.motivos.push(motivo)
      return envelope(motivo)
    }

    case "editar-motivo-parada": {
      const alvo = store.motivos.find((m) => m.motivo_id === String(b.motivo_id ?? ""))
      if (!alvo) return fail("Motivo não encontrado.", 404)
      Object.assign(alvo, {
        codigo: b.codigo != null ? String(b.codigo) : alvo.codigo,
        descricao: b.descricao != null ? String(b.descricao) : alvo.descricao,
        grupo_perda: b.grupo_perda != null ? String(b.grupo_perda) : alvo.grupo_perda,
        is_planejada: b.is_planejada != null ? Boolean(b.is_planejada) : alvo.is_planejada,
      })
      return envelope(alvo)
    }

    case "excluir-motivo-parada": {
      const idx = store.motivos.findIndex((m) => m.motivo_id === String(b.motivo_id ?? ""))
      if (idx >= 0) store.motivos.splice(idx, 1)
      return envelope({ removido: idx >= 0 })
    }

    case "criar-funcionario": {
      const func = {
        funcionario_id: novoId("funcionario"),
        nome: String(b.nome ?? "Novo colaborador"),
        registro: b.registro != null ? String(b.registro) : null,
        cargo: b.cargo != null ? String(b.cargo) : "Rebarbador",
        is_active: true,
      }
      store.funcionarios.push(func)
      return envelope(func)
    }

    case "editar-funcionario": {
      const alvo = store.funcionarios.find((f) => f.funcionario_id === String(b.funcionario_id ?? ""))
      if (!alvo) return fail("Funcionário não encontrado.", 404)
      Object.assign(alvo, {
        nome: b.nome != null ? String(b.nome) : alvo.nome,
        registro: b.registro !== undefined ? (b.registro == null ? null : String(b.registro)) : alvo.registro,
        cargo: b.cargo !== undefined ? (b.cargo == null ? null : String(b.cargo)) : alvo.cargo,
        is_active: b.is_active != null ? Boolean(b.is_active) : alvo.is_active,
      })
      return envelope(alvo)
    }

    case "excluir-funcionario": {
      const idx = store.funcionarios.findIndex((f) => f.funcionario_id === String(b.funcionario_id ?? ""))
      if (idx >= 0) store.funcionarios.splice(idx, 1)
      return envelope({ removido: idx >= 0 })
    }

    case "atribuir-rebarbador":
      store.rebarbadorPorCt.set(ctId, b.funcionario_id ? String(b.funcionario_id) : null)
      return envelope({ centro_trabalho_id: ctId })

    case "atribuir-apontador":
      store.apontadorPorCt.set(ctId, b.funcionario_id ? String(b.funcionario_id) : null)
      return envelope({ centro_trabalho_id: ctId })

    case "definir-apontador-padrao":
      store.apontadorPadrao.set(`${ctId}|${String(b.turno_id ?? "")}`, b.funcionario_id ? String(b.funcionario_id) : null)
      return envelope({ centro_trabalho_id: ctId })

    case "set-modo-contagem": {
      const modo = String(b.modo_contagem ?? b.modo ?? "GOOD").toUpperCase()
      store.modoContagem.set(ctId, modo === "REWORK" ? "REWORK" : "GOOD")
      return envelope({ centro_trabalho_id: ctId, modo_contagem: modo })
    }

    case "set-retrabalho-pecas": {
      const pecas: string[] = Array.isArray(b.pecas) ? b.pecas.map(String) : []
      store.retrabalhoPecas.set(ctId, pecas)
      return envelope({ centro_trabalho_id: ctId, pecas })
    }

    // ── Fila de ordens ───────────────────────────────────────────────────────
    case "add-to-queue": {
      const fila = store.filas.get(ctId) ?? []
      const ordemId = String(b.ordem_id ?? "")
      const corrida = CENTROS.flatMap((c) =>
        getDayPlan(c.centro_trabalho_id, operationalDayIndex(nowMs)).corridas,
      ).find((c) => c.ordem_id === ordemId)
      fila.push({
        fila_item_id: novoId("fila"),
        ordem_id: ordemId,
        ordem_codigo: corrida?.ordem_codigo ?? String(b.ordem_codigo ?? "OP-DEMO"),
        ordem_public_id: corrida?.ordem_codigo ?? String(b.ordem_codigo ?? "OP-DEMO"),
        produto_descricao: corrida ? PRODUTOS_BY_ID.get(corrida.produto_id)?.descricao ?? "" : "",
        posicao: fila.length + 1,
        is_current: fila.length === 0,
        finish_rule: { tipo: "SEM", qtd: null, fim_utc: null },
      })
      store.filas.set(ctId, fila)
      return envelope({ centro_trabalho_id: ctId, total: fila.length })
    }

    case "reorder-queue": {
      const ordem: string[] = Array.isArray(b.fila_item_ids) ? b.fila_item_ids.map(String) : []
      const fila = store.filas.get(ctId) ?? []
      fila.sort((a, c) => ordem.indexOf(a.fila_item_id) - ordem.indexOf(c.fila_item_id))
      fila.forEach((item, i) => { item.posicao = i + 1 })
      store.filas.set(ctId, fila)
      return envelope({ centro_trabalho_id: ctId })
    }

    case "update-finish-rule": {
      const fila = store.filas.get(ctId) ?? []
      const item = fila.find((f) => f.fila_item_id === String(b.fila_item_id ?? "")) ?? fila.find((f) => f.is_current)
      if (item) {
        item.finish_rule = {
          tipo: (String(b.tipo ?? "SEM").toUpperCase() as "SEM" | "QTD" | "HORARIO"),
          qtd: b.qtd != null ? Number(b.qtd) : null,
          fim_utc: b.fim_utc != null ? String(b.fim_utc) : null,
        }
      }
      return envelope({ centro_trabalho_id: ctId })
    }

    case "remove-from-queue": {
      const fila = (store.filas.get(ctId) ?? []).filter((f) => f.fila_item_id !== String(b.fila_item_id ?? ""))
      fila.forEach((item, i) => { item.posicao = i + 1 })
      store.filas.set(ctId, fila)
      return envelope({ centro_trabalho_id: ctId, total: fila.length })
    }

    case "clear-queue":
      store.filas.set(ctId, [])
      return envelope({ centro_trabalho_id: ctId, total: 0 })

    case "set-current-order": {
      const fila = store.filas.get(ctId) ?? []
      fila.forEach((f) => { f.is_current = f.ordem_id === String(b.ordem_id ?? "") })
      return envelope({ centro_trabalho_id: ctId })
    }

    case "advance-queue": {
      const fila = store.filas.get(ctId) ?? []
      const idx = fila.findIndex((f) => f.is_current)
      if (idx >= 0 && idx + 1 < fila.length) {
        fila[idx].is_current = false
        fila[idx + 1].is_current = true
      }
      return envelope({ centro_trabalho_id: ctId })
    }

    case "broadcast-queue": {
      const alvos: string[] = Array.isArray(b.target_ct_ids) ? b.target_ct_ids.map(String) : []
      const origem = store.filas.get(String(b.source_ct_id ?? "")) ?? []
      for (const alvo of alvos) {
        store.filas.set(
          alvo,
          origem.map((item, i) => ({ ...item, fila_item_id: novoId("fila"), posicao: i + 1 })),
        )
      }
      return envelope({ alvos: alvos.length })
    }

    case "execute-orders":
      return envelope({
        results: (Array.isArray(b.ordem_ids) ? b.ordem_ids : []).map((id: unknown) => ({
          ordem_id: String(id),
          ok: true,
        })),
      })

    default:
      return envelope({ acao: action, aplicado: true })
  }
}

// ─── Handlers: /api/db/<recurso> ─────────────────────────────────────────────

function dbGet(path: string, sp: URLSearchParams, nowMs: number): DemoHttpResponse {
  const centrosIds = csv(sp, "centrosIds")
  const ctId = sp.get("centroTrabalhoId") ?? sp.get("centro_trabalho_id") ?? ""

  switch (path) {
    case "health":
      return ok({ mode: "demo", ok: true, empresa_id: EMPRESA_ID, generated_at: iso(nowMs) })

    case "grupos":
    case "centros-trabalho":
    case "turnos":
    case "produtos":
    case "usuarios":
    case "motivos-parada":
    case "ordens":
    case "planos-melhoria":
      return ok(catalogo(path, nowMs))

    case "paradas": {
      const justificada = sp.get("justificada")
      let rows = todasParadas(nowMs)
      if (ctId) rows = rows.filter((p) => p.centro_trabalho_id === ctId)
      if (justificada === "true") rows = rows.filter((p) => p.is_justificada)
      if (justificada === "false") rows = rows.filter((p) => !p.is_justificada)
      return ok(rows)
    }

    case "paradas/ativas":
      return ok(
        CENTROS.map((ct) => {
          const status = statusAtual(ct.centro_trabalho_id, nowMs)
          if (status.status_ct !== "STOPPED" || !status.parada) return null
          const motivo = MOTIVOS_BY_ID.get(status.parada.motivo_id)
          return {
            id: status.parada.parada_id,
            inicio: iso(status.parada.inicio),
            observacao: status.parada.justificativa_texto,
            centro_trabalho_id: ct.centro_trabalho_id,
            centro_trabalho_nome: ct.nome,
            motivo_id: status.parada.motivo_id,
            motivo_nome: motivo?.descricao ?? null,
            motivo_tipo: motivo?.is_planejada ? "Planejada" : "Não planejada",
            equipamento_id: null,
            equipamento_nome: ct.nome,
            duracao_minutos: Math.round(status.parada.duracao_seg / 60),
          }
        }).filter(Boolean),
      )

    case "paradas/nao-justificadas":
      return ok(
        todasParadas(nowMs)
          .filter((p) => !p.is_justificada)
          .map((p) => ({
            id: p.parada_id,
            inicio: p.inicio_utc,
            fim: p.fim_utc,
            observacao: p.justificativa_texto,
            centro_trabalho_id: p.centro_trabalho_id,
            centro_trabalho_nome: CENTROS_BY_ID.get(p.centro_trabalho_id)?.nome ?? null,
            duracao_minutos: Math.round((p.duracao_seg ?? 0) / 60),
          })),
      )

    case "anotacoes": {
      const store = getStore()
      const anotacaoId = sp.get("anotacao_id")
      if (anotacaoId) {
        const a = store.anotacoes.find((x) => x.id === anotacaoId)
        return ok(a ? anotacaoDto(a) : null)
      }
      const filtroCt = sp.get("centroTrabalhoId") ?? sp.get("centro_trabalho_id")
      return ok(
        store.anotacoes
          .filter((a) => !filtroCt || a.centro_trabalho_id === filtroCt)
          .map(anotacaoDto)
          .sort((a, b) => String(b.data_hora).localeCompare(String(a.data_hora))),
      )
    }

    case "planos-acao": {
      const store = getStore()
      const planoId = sp.get("plano_acao_id")
      if (planoId) {
        const p = store.planosAcao.find((x) => x.id === planoId)
        return ok(p ? planoDto(p) : null)
      }
      return ok(store.planosAcao.map(planoDto))
    }

    case "anexos":
      return ok({ ok: true, anexo: null })

    case "pecas":
      return ok(
        PRODUTOS.map((p) => ({
          produto_id: p.produto_id,
          public_id: p.codigo,
          codigo: p.codigo,
          descricao: p.descricao,
          ciclo_ideal_seg: p.ciclo_ideal_seg,
        })),
      )

    // ── Dashboard ────────────────────────────────────────────────────────────
    case "dashboard/cards":
    case "dashboard/postos":
      return ok(listCards(centrosIds, nowMs))

    case "dashboard/stats": {
      const cards = listCards(centrosIds, nowMs)
      const abertas = cards.filter((c) => c.status_ct === "STOPPED")
      return ok({
        empresa_id: EMPRESA_ID,
        postos: { total: cards.length, ativos: cards.length },
        paradas: {
          abertas: abertas.length,
          nao_justificadas: abertas.filter((c) => !c.motivo_codigo).length,
        },
        status_postos: [
          { status_ct: "RUNNING", descricao: "Produzindo", total: cards.length - abertas.length },
          { status_ct: "STOPPED", descricao: "Parado", total: abertas.length },
        ],
        generated_at: iso(nowMs),
      })
    }

    case "dashboard/header":
      return ok(ctId && CENTROS_BY_ID.has(ctId) ? buildCard(CENTROS_BY_ID.get(ctId)!, nowMs) : null)

    case "dashboard/ciclo-instantaneo":
      return ok(ctId ? cicloInstantaneo(ctId, nowMs) : null)

    case "dashboard/historico-dia":
      return ok(ctId ? historicoDia(ctId, nowMs) : null)

    case "dashboard/producao-por-hora":
    case "posto/producao-por-hora": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return ok(ctId ? producaoPorHora(ctId, from, to, nowMs) : [])
    }

    case "dashboard/oee-por-periodo":
    case "posto/oee-por-periodo": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return ok(ctId ? oeePorPeriodo(ctId, from, to, nowMs) : [])
    }

    case "dashboard/perdas-por-periodo":
    case "posto/perdas-por-periodo": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return ok(ctId ? perdasPorPeriodo(ctId, from, to, nowMs) : [])
    }

    case "dashboard/perdas-por-minuto-paradas": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      return ok(ctId ? perdasPorMinuto(ctId, from, to, nowMs) : [])
    }

    case "dashboard/paradas-turno":
    case "posto/paradas-turno": {
      const ini = isoParam(sp, "turnoInicio") ?? shiftAt(nowMs).inicio
      const fim = isoParam(sp, "turnoFim") ?? shiftAt(nowMs).fim
      return ok(ctId ? paradasView(ctId, ini, fim, nowMs).map(paradaRow) : [])
    }

    case "dashboard/paradas-agregadas-por-motivo": {
      const ini = isoParam(sp, "inicioUtc") ?? shiftAt(nowMs).inicio
      const fim = isoParam(sp, "fimUtc") ?? nowMs
      return ok(paradasAgregadasPorMotivo(centrosIds, ini, fim, nowMs))
    }

    case "dashboard/paradas-agregadas-turno-atual": {
      const turno = shiftAt(nowMs)
      return ok({
        turno: {
          turno_id: `turno-${turno.index}`,
          turno_nome: turno.nome,
          inicio_utc: iso(turno.inicio),
          fim_utc: iso(turno.fim),
        },
        paradas: paradasAgregadasPorMotivo(centrosIds, turno.inicio, nowMs, nowMs),
      })
    }

    case "dashboard/producao-dia-operacional": {
      const ini = isoParam(sp, "inicioUtc") ?? operationalDayStart(operationalDayIndex(nowMs))
      const fim = isoParam(sp, "fimUtc") ?? nowMs
      return ok(producaoDiaOperacional(centrosIds, ini, fim, nowMs))
    }

    case "dashboard/oee-consolidado-turnos":
      return ok(oeeConsolidadoTurnos(nowMs))

    case "dashboard/total-paradas-turno":
    case "dashboard/nao-justificadas-turno": {
      const turno = shiftAt(nowMs)
      const rows = ctId ? paradasView(ctId, turno.inicio, nowMs, nowMs) : []
      return ok({
        turno_inicio_utc: iso(turno.inicio),
        turno_fim_utc: iso(turno.fim),
        total_paradas_turno: rows.length,
        nao_justificadas_turno: rows.filter((p) => !p.is_justificada).length,
        tempo_parado_turno_seg: rows.reduce((a, p) => a + p.duracao_seg, 0),
      })
    }

    case "dashboard/detalhe": {
      const { from, to } = janelaDeDatas(sp, nowMs)
      if (!ctId) return ok(null)
      return ok({
        header: CENTROS_BY_ID.has(ctId) ? buildCard(CENTROS_BY_ID.get(ctId)!, nowMs) : null,
        producao_por_hora: producaoPorHora(ctId, from, to, nowMs),
        oee_por_periodo: oeePorPeriodo(ctId, from, to, nowMs),
        perdas_por_periodo: perdasPorPeriodo(ctId, from, to, nowMs),
      })
    }

    // ── Relatórios "simples" (legado) ────────────────────────────────────────
    case "relatorios/producao-hora": {
      const f = filtrosDeQuery(sp, nowMs)
      return ok(
        relatorioProducaoHora(f, nowMs).map((r) => ({
          hora: r.hora_utc,
          producao: r.value,
          capacidade: r.target,
        })),
      )
    }

    case "relatorios/producao-dia": {
      const f = filtrosDeQuery(sp, nowMs)
      return ok(
        relatorioProducaoDia(f, nowMs).map((r) => ({
          data: r.label,
          producao: r.value,
          capacidade: r.capacidade,
        })),
      )
    }

    case "relatorios/oee-consolidado": {
      const oee = relatorioOee(filtrosDeQuery(sp, nowMs), nowMs)
      return ok({
        disponibilidade: oee.disponibilidade_pct,
        performance: oee.performance_pct,
        qualidade: oee.qualidade_pct,
        oee: oee.oee_pct,
      })
    }

    case "relatorios/oee-hora":
    case "relatorios/oee-dia": {
      const f = filtrosDeQuery(sp, nowMs)
      const centros = centrosFiltrados(f)
      const rows = centros.flatMap((ct) => oeePorPeriodo(ct.centro_trabalho_id, f.startUtc, f.endUtc, nowMs))
      return ok(rows)
    }

    case "relatorios/perdas": {
      const f = filtrosDeQuery(sp, nowMs)
      return ok(
        relatorioParadasPareto(f, nowMs).map((r) => ({
          motivo: r.motivo_descricao,
          tipo: r.is_planejada ? "Planejada" : "Não planejada",
          quantidade: r.ocorrencias,
          duracao_minutos: Math.round(r.duracao_total_seg / 60),
        })),
      )
    }

    case "relatorios/paradas-reportadas":
      return ok(relatorioParadas(filtrosDeQuery(sp, nowMs), nowMs))

    case "relatorios/producao-por-ordem":
      return ok(
        relatorioProducaoOrdens(filtrosDeQuery(sp, nowMs), nowMs).map((r) => ({
          produto_codigo: r.produto_codigo ?? "",
          produto_nome: r.produto_descricao ?? "",
          ordem_codigo: r.ordem_codigo ?? "",
          producao_ordem: r.por_ordem,
          producao_produto: r.por_produto,
        })),
      )

    default:
      return ok([])
  }
}

// ─── Anotações e planos de ação ──────────────────────────────────────────────

function anotacaoDto(a: DemoAnotacao) {
  const ct = a.centro_trabalho_id ? CENTROS_BY_ID.get(a.centro_trabalho_id) : null
  return {
    id: a.id,
    anotacao_id: a.id,
    texto: a.texto,
    data_hora: a.data_hora,
    anotacao_time_utc: a.data_hora,
    centro_trabalho_id: a.centro_trabalho_id,
    centro_trabalho_nome: ct?.nome ?? null,
    usuario_id: null,
    usuario_nome: a.usuario_nome,
    created_at: a.created_at,
    anexos: a.anexos,
  }
}

function planoDto(p: DemoPlanoAcao) {
  return {
    id: p.id,
    plano_acao_id: p.id,
    item_id: p.item_id,
    o_que: p.o_que,
    como: p.como,
    por_que: p.por_que,
    quando: p.quando,
    estado: p.estado,
    onde_id: p.centro_trabalho_id,
    onde_nome: p.onde_nome,
    centro_trabalho_id: p.centro_trabalho_id,
    quem_id: p.quem_id,
    quem_nome: p.quem_nome,
    observacoes: p.observacoes,
    anotacoes: p.observacoes,
    created_at: p.created_at,
    updated_at: p.updated_at,
    anexos: p.anexos,
  }
}

function anexosDe(input: unknown): DemoAnotacao["anexos"] {
  if (!Array.isArray(input)) return []
  return input.map((a) => {
    const r = asRecord(a)
    return {
      id: novoId("anexo"),
      public_id: novoId("anexo-public"),
      file_name: String(r.file_name ?? "arquivo"),
      content_type: r.content_type != null ? String(r.content_type) : null,
      file_size_bytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
      // O conteúdo enviado não é armazenado: a demo guarda apenas os metadados.
      file_url: r.file_url != null ? String(r.file_url) : null,
      storage_provider: "demo",
      created_at: iso(demoNow()),
    }
  })
}

function notesWrite(recurso: string, method: string, sp: URLSearchParams, body: unknown, nowMs: number): DemoHttpResponse {
  const store = getStore()
  const b = asRecord(body)

  if (recurso === "anotacoes") {
    if (method === "POST") {
      const nova: DemoAnotacao = {
        id: novoId("anotacao"),
        texto: String(b.texto ?? ""),
        data_hora: b.data_hora ? String(b.data_hora) : iso(nowMs),
        centro_trabalho_id: b.centro_trabalho_id ? String(b.centro_trabalho_id) : null,
        usuario_nome: "Usuário Demonstração",
        created_at: iso(nowMs),
        anexos: anexosDe(b.anexos),
      }
      if (!nova.texto.trim()) return { status: 400, body: { success: false, error: "Texto é obrigatório." } }
      store.anotacoes.unshift(nova)
      return ok({ success: true, data: anotacaoDto(nova) })
    }

    if (method === "PATCH" || method === "PUT") {
      const alvo = store.anotacoes.find((a) => a.id === String(b.anotacao_id ?? sp.get("anotacao_id") ?? ""))
      if (!alvo) return { status: 404, body: { success: false, error: "Anotação não encontrada." } }
      if (b.texto != null) alvo.texto = String(b.texto)
      if (b.data_hora != null) alvo.data_hora = String(b.data_hora)
      if (b.centro_trabalho_id !== undefined) {
        alvo.centro_trabalho_id = b.centro_trabalho_id ? String(b.centro_trabalho_id) : null
      }
      const remover = new Set((Array.isArray(b.anexos_remove) ? b.anexos_remove : []).map(String))
      alvo.anexos = alvo.anexos.filter((x) => !remover.has(x.id)).concat(anexosDe(b.anexos_add))
      return ok({ success: true, data: anotacaoDto(alvo) })
    }

    if (method === "DELETE") {
      const id = String(sp.get("id") ?? sp.get("anotacao_id") ?? b.anotacao_id ?? "")
      const idx = store.anotacoes.findIndex((a) => a.id === id)
      if (idx >= 0) store.anotacoes.splice(idx, 1)
      return ok({ success: true, data: { removido: idx >= 0 } })
    }
  }

  if (recurso === "planos-acao") {
    if (method === "POST") {
      const ct = b.centro_trabalho_id ? CENTROS_BY_ID.get(String(b.centro_trabalho_id)) : null
      const responsavel = USUARIOS.find((u) => u.usuario_id === String(b.responsavel_id ?? "")) ?? null
      const novo: DemoPlanoAcao = {
        id: novoId("plano-acao"),
        item_id: novoId("plano-acao-item"),
        o_que: String(b.o_que ?? ""),
        como: b.como != null ? String(b.como) : null,
        por_que: b.por_que != null ? String(b.por_que) : null,
        quando: b.quando != null ? String(b.quando) : null,
        estado: String(b.estado ?? "Pendente"),
        centro_trabalho_id: ct?.centro_trabalho_id ?? null,
        onde_nome: ct?.nome ?? null,
        quem_id: responsavel?.usuario_id ?? null,
        quem_nome: responsavel?.nome ?? null,
        observacoes: b.observacoes != null ? String(b.observacoes) : null,
        created_at: iso(nowMs),
        updated_at: null,
        anexos: anexosDe(b.anexos),
      }
      if (!novo.o_que.trim()) return { status: 400, body: { success: false, error: "O campo 'O quê' é obrigatório." } }
      store.planosAcao.unshift(novo)
      return ok({ success: true, data: planoDto(novo) })
    }

    if (method === "PATCH" || method === "PUT") {
      const alvo = store.planosAcao.find((p) => p.id === String(b.plano_acao_id ?? sp.get("plano_acao_id") ?? ""))
      if (!alvo) return { status: 404, body: { success: false, error: "Plano não encontrado." } }
      for (const campo of ["o_que", "como", "por_que", "quando", "estado", "observacoes"] as const) {
        if (b[campo] !== undefined) (alvo as Record<string, any>)[campo] = b[campo] == null ? null : String(b[campo])
      }
      alvo.updated_at = iso(nowMs)
      const remover = new Set((Array.isArray(b.anexos_remove) ? b.anexos_remove : []).map(String))
      alvo.anexos = alvo.anexos.filter((x) => !remover.has(x.id)).concat(anexosDe(b.anexos_add))
      return ok({ success: true, data: planoDto(alvo) })
    }

    if (method === "DELETE") {
      const id = String(sp.get("id") ?? sp.get("plano_acao_id") ?? b.plano_acao_id ?? "")
      const idx = store.planosAcao.findIndex((p) => p.id === id)
      if (idx >= 0) store.planosAcao.splice(idx, 1)
      return ok({ success: true, data: { removido: idx >= 0 } })
    }
  }

  if (recurso === "planos-melhoria") {
    if (method === "POST") {
      const novo = {
        id: novoId("plano-melhoria"),
        public_id: `PM-DEMO-${Math.floor(Math.random() * 900 + 100)}`,
        titulo: String(b.titulo ?? "Novo plano"),
        descricao: String(b.problema ?? b.descricao ?? ""),
        problema: String(b.problema ?? b.descricao ?? ""),
        meta: String(b.meta ?? ""),
        resultado: null,
        estado: String(b.estado ?? "Planejado"),
        grupo_perda: b.grupo_perda != null ? String(b.grupo_perda) : null,
        data_inicio: b.data_inicio != null ? String(b.data_inicio) : iso(nowMs),
        data_conclusao: null,
        criado_em: iso(nowMs),
        centro_trabalho_id: b.centro_trabalho_id != null ? String(b.centro_trabalho_id) : null,
        centro_trabalho_nome: b.centro_trabalho_id
          ? CENTROS_BY_ID.get(String(b.centro_trabalho_id))?.nome ?? null
          : null,
        responsavel_id: b.responsavel_id != null ? String(b.responsavel_id) : null,
        responsavel_nome: USUARIOS.find((u) => u.usuario_id === String(b.responsavel_id ?? ""))?.nome ?? null,
      }
      getStore().planosMelhoria.unshift(novo)
      return ok({ success: true, data: novo })
    }
    if (method === "DELETE") {
      const id = String(sp.get("id") ?? b.id ?? "")
      const lista = getStore().planosMelhoria
      const idx = lista.findIndex((p) => p.id === id)
      if (idx >= 0) lista.splice(idx, 1)
      return ok({ success: true, data: { removido: idx >= 0 } })
    }
  }

  return ok({ success: true, data: null })
}

// ─── Roteador principal ──────────────────────────────────────────────────────

export async function handleDemoRequest(req: DemoHttpRequest): Promise<DemoHttpResponse> {
  const nowMs = demoNow()
  const method = req.method.toUpperCase()
  const path = req.path.replace(/^\/+|\/+$/g, "")
  const sp = req.searchParams

  // ── Autenticação ─────────────────────────────────────────────────────────
  if (path.startsWith("auth/")) {
    const action = path.slice("auth/".length).toLowerCase()

    if (method === "GET" && action === "me") {
      if (!req.authenticated) return { status: 401, body: { ok: false, error: "Não autenticado." } }
      return ok({ ok: true, user: demoUserPayload() })
    }

    if (method === "GET" && action === "clear-session") {
      return { status: 302, body: null, redirect: "/login" }
    }

    if (method === "POST" && action === "login") {
      const b = asRecord(req.body)
      const email = String(b.email ?? "")
      const senha = String(b.senha ?? b.password ?? "")
      if (!email || !senha) return fail("E-mail e senha são obrigatórios.")
      if (!isDemoCredential(email, senha)) {
        return { status: 401, body: { ok: false, error: "Credenciais inválidas. Use a conta de demonstração indicada na tela." } }
      }
      return ok({ ok: true, user: demoUserPayload() })
    }

    if (method === "POST" && action === "logout") return ok({ ok: true })

    if (method === "POST" && (action === "send-code" || action === "forgot-password")) {
      return fail(
        `Envio de e-mail está desativado nesta demonstração. Entre com ${DEMO_EMAIL} / ${DEMO_PASSWORD}.`,
        503,
      )
    }

    if (method === "POST" && (action === "register" || action === "reset-password" || action === "verify-code")) {
      return fail(
        `Cadastro e recuperação de senha ficam disponíveis apenas no ambiente de produção. Use a conta de demonstração ${DEMO_EMAIL}.`,
        503,
      )
    }

    return fail("Rota não encontrada.", 404)
  }

  // ── Administração de usuários ────────────────────────────────────────────
  if (path === "admin/users") {
    const store = getStore()
    if (method === "GET") {
      return ok({
        ok: true,
        users: USUARIOS.map((u) => ({
          usuario_id: u.usuario_id,
          nome: u.nome,
          email: u.email,
          cargo: u.cargo,
          perfil: u.perfil,
          is_active: u.is_active,
          created_at: iso(nowMs - 90 * DAY_MS),
        })),
      })
    }
    void store
    return ok({
      ok: false,
      error: "A administração de usuários é somente leitura no ambiente de demonstração.",
    })
  }

  // ── /api/db/... ──────────────────────────────────────────────────────────
  if (path.startsWith("db/")) {
    const recurso = path.slice("db/".length)

    if (recurso === "posto") {
      return method === "GET" ? postoGet(sp, nowMs) : postoPost(req.body, nowMs)
    }

    if (recurso === "analitico") {
      const mode = (sp.get("mode") ?? "bundle").toLowerCase()
      const tab = sp.get("tab") ?? "oee"
      const f = filtrosDeQuery(sp, nowMs)
      const filtrosEco = { startUtc: iso(f.startUtc), endUtc: iso(f.endUtc) }

      if (mode === "lookups") return ok({ ok: true, mode: "lookups", data: analiticoLookups(f, nowMs) })
      if (mode === "summary") {
        return ok({ ok: true, mode: "summary", filters: filtrosEco, summary: analiticoRows(tab, f, nowMs).summary })
      }
      if (mode === "pareto") {
        const topN = Number(sp.get("topN") ?? 10)
        return ok({ ok: true, mode: "pareto", filters: filtrosEco, topN, rows: analiticoPareto(f, topN, nowMs) })
      }
      if (mode === "rebarbadores") {
        return ok({ ok: true, mode: "rebarbadores", filters: filtrosEco, result: rebarbadoresRanking(f, nowMs) })
      }
      if (mode === "dados") {
        return ok({ ok: true, mode: "dados", tab, filters: filtrosEco, result: analiticoRows(tab, f, nowMs) })
      }

      const result = analiticoRows(tab, f, nowMs)
      const topN = Number(sp.get("topN") ?? 10)
      return ok({
        ok: true,
        mode: "bundle",
        tab,
        filters: filtrosEco,
        lookups: analiticoLookups(f, nowMs),
        summary: result.summary,
        result,
        pareto: { topN, rows: analiticoPareto(f, topN, nowMs) },
      })
    }

    if (recurso === "historico") {
      const f = filtrosDeQuery(sp, nowMs)
      const mode = sp.get("mode")
      if (mode) {
        if (mode === "rebarbadores") {
          return ok({ empresaId: EMPRESA_ID, mode, data: rebarbadoresRanking(f, nowMs).rows })
        }
        return ok({
          empresaId: EMPRESA_ID,
          mode,
          data: historicoLista(mode, f, nowMs),
          startUtc: iso(f.startUtc),
          endUtc: iso(f.endUtc),
        })
      }
      const body = method === "POST" ? asRecord(req.body) : {}
      return ok(
        historicoSeries(
          String(body.tab ?? sp.get("tab") ?? "oee"),
          String(body.granularity ?? sp.get("granularity") ?? "op_day"),
          f,
          {
            producaoMetric: sp.get("producaoMetric") ?? undefined,
            paradasMetric: sp.get("paradasMetric") ?? undefined,
            cicloMetric: sp.get("cicloMetric") ?? undefined,
            perdasMetric: sp.get("perdasMetric") ?? undefined,
          },
          nowMs,
        ),
      )
    }

    if (recurso === "relatorio") {
      const b = asRecord(req.body)
      const op = String(sp.get("op") ?? b.op ?? "").toLowerCase()
      const filtrosBody = asRecord(b.filters)

      const f: ReportFilters = {
        startUtc: new Date(String(filtrosBody.startUtc ?? sp.get("startUtc") ?? iso(nowMs - DAY_MS))).getTime(),
        endUtc: new Date(String(filtrosBody.endUtc ?? sp.get("endUtc") ?? iso(nowMs))).getTime(),
        centrosTrabalhoIds:
          (Array.isArray(filtrosBody.centrosTrabalhoIds) ? filtrosBody.centrosTrabalhoIds.map(String) : null) ??
          all(sp, "centrosTrabalhoIds") ?? null,
        setorIds:
          (Array.isArray(filtrosBody.setorIds) ? filtrosBody.setorIds.map(String) : null) ?? all(sp, "setorIds") ?? null,
        turnoIds:
          (Array.isArray(filtrosBody.turnoIds) ? filtrosBody.turnoIds.map(String) : null) ?? all(sp, "turnoIds") ?? null,
      }

      switch (op) {
        case "consolidado":
          return envelope(relatorioConsolidado(f, nowMs))
        case "producao-hora":
          return envelope(relatorioProducaoHora(f, nowMs))
        case "producao-dia":
          return envelope(relatorioProducaoDia(f, nowMs))
        case "oee":
          return envelope(relatorioOee(f, nowMs))
        case "grafico-perdas":
          return envelope(relatorioGraficoPerdas(f, nowMs))
        case "paradas":
          return envelope(relatorioParadas(f, nowMs))
        case "paradas-pareto":
          return envelope(relatorioParadasPareto(f, nowMs))
        case "producao-ordens":
          return envelope(relatorioProducaoOrdens(f, nowMs))
        case "plano-acao":
          return envelope(relatorioPlanosAcao())
        case "anotacoes":
          return envelope(relatorioAnotacoes(f))
        case "lookup-grupos":
          return envelope(SETORES.map((s) => ({ setor_id: s.setor_id, nome: s.nome, public_id: s.nome })))
        case "lookup-turnos":
          return envelope(
            TURNOS.map((t, i) => ({
              turno_id: `turno-${i}`,
              nome: t.nome,
              public_id: `T${i + 1}`,
              hora_inicio: t.hora_inicio,
              hora_fim: t.hora_fim,
              ordem_exibicao: t.ordem_exibicao,
            })),
          )
        case "lookup-centros":
          return envelope(
            centrosFiltrados({ ...f, setorIds: all(sp, "setorIds") ?? f.setorIds }).map((c) => ({
              centro_trabalho_id: c.centro_trabalho_id,
              codigo: c.codigo,
              nome: c.nome,
              public_id: c.codigo,
              setor_id: c.setor_id,
            })),
          )
        case "lookup-motivos":
          return envelope(
            getStore().motivos.map((m) => ({
              motivo_id: m.motivo_id,
              codigo: m.codigo,
              descricao: m.descricao,
              grupo_perda: m.grupo_perda,
              is_planejada: m.is_planejada,
              public_id: m.codigo,
            })),
          )
        default:
          return envelope(null)
      }
    }

    if (recurso === "logistica-ordem") {
      const action = (sp.get("action") ?? asRecord(req.body).action ?? "").toString()
      if (method === "GET") return ok(handleLogistica(action, sp, nowMs))
      // Mutações da fila alteram o estado em memória através do mesmo caminho
      // usado pela tela do posto.
      const b = asRecord(req.body)
      const mapa: Record<string, string> = {
        reordenar: "reorder-queue",
        "adicionar-ordem": "add-to-queue",
        "remover-item": "remove-from-queue",
        "limpar-fila": "clear-queue",
        "avancar-fila": "advance-queue",
      }
      if (mapa[action]) {
        postoPost({ ...b, action: mapa[action], centro_trabalho_id: b.centro_trabalho_id }, nowMs)
      }
      return ok({ success: true, data: { aplicado: true } })
    }

    if (recurso === "anotacoes" || recurso === "planos-acao" || recurso === "planos-melhoria") {
      if (method === "GET") return dbGet(recurso, sp, nowMs)
      return notesWrite(recurso, method, sp, req.body, nowMs)
    }

    if (recurso === "anexos") {
      if (method === "GET") return ok({ ok: true, anexo: null })
      return ok({ success: true, data: { ok: true } })
    }

    // Comandos operacionais do dashboard (POST).
    if (method === "POST" && recurso.startsWith("dashboard/")) {
      const acao = recurso.slice("dashboard/".length)
      const b = asRecord(req.body)
      return postoPost(
        {
          ...b,
          action:
            acao === "apontar-producao"
              ? "apontar-producao"
              : acao === "apontar-refugo-retrabalho"
                ? "apontar-refugo-retrabalho"
                : acao === "retomar-producao"
                  ? "retomar-producao"
                  : "iniciar-parada",
          centro_trabalho_id: b.centroTrabalhoId ?? b.centro_trabalho_id,
          motivo_id: b.motivoId ?? b.motivo_id,
        },
        nowMs,
      )
    }

    if (method === "GET") return dbGet(recurso, sp, nowMs)
    return ok({ ok: true, demo: true })
  }

  // ── Rotas antigas fora de /api/db ────────────────────────────────────────
  const legado: Record<string, string> = {
    "centros-trabalho": "centros-trabalho",
    grupos: "grupos",
    turnos: "turnos",
    produtos: "produtos",
    "motivos-parada": "motivos-parada",
    usuarios: "usuarios",
    ordens: "ordens",
    "planos-melhoria": "planos-melhoria",
    "planos-acao": "planos-acao",
    anotacoes: "anotacoes",
    "dashboard/stats": "dashboard/stats",
    "dashboard/states": "dashboard/stats",
    "paradas/ativas": "paradas/ativas",
    "paradas/nao-justificadas": "paradas/nao-justificadas",
  }

  if (legado[path]) {
    if (method === "GET") return dbGet(legado[path], sp, nowMs)
    return notesWrite(legado[path], method, sp, req.body, nowMs)
  }

  if (path.startsWith("relatorios/")) return dbGet(path, sp, nowMs)

  if (path.startsWith("centros-trabalho/")) {
    const [, id, sub] = path.split("/")
    const ct = CENTROS_BY_ID.get(id)
    if (!ct) return { status: 404, body: { error: "Centro de trabalho não encontrado." } }
    if (sub === "ordens") {
      const dia = operationalDayIndex(nowMs)
      return ok(
        getDayPlan(ct.centro_trabalho_id, dia).corridas.map((c) => ({
          id: c.ordem_id,
          codigo: c.ordem_codigo,
          produto_nome: PRODUTOS_BY_ID.get(c.produto_id)?.descricao ?? null,
          quantidade_planejada: c.meta,
        })),
      )
    }
    return ok(buildCard(ct, nowMs))
  }

  if (path.startsWith("carbono-equivalente")) {
    return {
      status: 503,
      body: {
        error:
          "O módulo de Carbono Equivalente depende de integração corporativa e não faz parte desta demonstração.",
      },
    }
  }

  return { status: 404, body: { error: "Endpoint não disponível no ambiente de demonstração." } }
}

// Mantém referências usadas apenas em ramos específicos do roteador.
void corridaEm
void shiftsOfDay
void HOUR_MS
void paradasFiltradas

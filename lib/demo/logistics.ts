// lib/demo/logistics.ts
//
// Logística de ordens (Kanban, fila por posto, carga e ordens executadas).
//
// As ordens não são inventadas à parte: são as MESMAS corridas geradas em
// factory.ts que alimentam o dashboard. Assim, uma ordem que aparece como
// "Em Execução" no Kanban é exatamente a que o card do posto está mostrando,
// com a mesma produção acumulada.

import { CENTROS, CENTROS_BY_ID, EMPRESA_ID, PRODUTOS, PRODUTOS_BY_ID, TURNOS } from "./catalog"
import { aggregate, bucketsNaJanela, corridaEm, getDayPlan, type DemoCorrida } from "./factory"
import { getStore } from "./store"
import {
  DAY_MS,
  demoNow,
  iso,
  operationalDayIndex,
  shiftsOfDay,
} from "./time"
import { buildCard, statusAtual } from "./views"

type StatusUi = "Liberada" | "Em Execução" | "Interrompida" | "Encerrada" | "Planejada"

function statusDaCorrida(corrida: DemoCorrida, nowMs: number): { ordem: string; ui: StatusUi } {
  if (corrida.inicio > nowMs) return { ordem: "PLANNED", ui: "Planejada" }
  if (corrida.fim <= nowMs) return { ordem: "FINISHED", ui: "Encerrada" }
  const status = statusAtual(corrida.centro_trabalho_id, nowMs)
  return status.status_ct === "STOPPED"
    ? { ordem: "PAUSED", ui: "Interrompida" }
    : { ordem: "RUNNING", ui: "Em Execução" }
}

function resumoCT(centroId: string) {
  const ct = CENTROS_BY_ID.get(centroId)
  return { public_id: ct?.codigo ?? centroId, nome: ct?.nome ?? "—" }
}

function ordemResumo(corrida: DemoCorrida, nowMs: number) {
  const produto = PRODUTOS_BY_ID.get(corrida.produto_id)
  const agg = aggregate(
    bucketsNaJanela(corrida.centro_trabalho_id, corrida.inicio, Math.min(corrida.fim, nowMs), nowMs),
  )
  const { ordem, ui } = statusDaCorrida(corrida, nowMs)
  const executando = ui === "Em Execução" ? [resumoCT(corrida.centro_trabalho_id)] : []
  const interrompidos = ui === "Interrompida" ? [resumoCT(corrida.centro_trabalho_id)] : []

  return {
    empresa_id: EMPRESA_ID,
    ordem_id: corrida.ordem_id,
    ordem_public_id: corrida.ordem_codigo,
    ordem_codigo: corrida.ordem_codigo,
    status_ordem: ordem,
    status_ui: ui,
    produto_public_id: produto?.codigo ?? "",
    produto_codigo: produto?.codigo ?? "",
    produto_descricao: produto?.descricao ?? "",
    meta_planejada: corrida.meta,
    total_good: agg.good,
    total_scrap: agg.scrap,
    total_rework: agg.rework,
    diferenca: agg.good - corrida.meta,
    pct_completa: corrida.meta > 0 ? Math.round((agg.good / corrida.meta) * 1000) / 10 : null,
    inicio_planejado_utc: iso(corrida.inicio),
    fim_planejado_utc: iso(corrida.fim),
    inicio_real_utc: corrida.inicio <= nowMs ? iso(corrida.inicio) : null,
    fim_real_utc: corrida.fim <= nowMs ? iso(corrida.fim) : null,
    cts_executando: executando,
    cts_interrompidos: interrompidos,
    ct_executando_agora: executando[0] ?? null,
    centros_executados: executando,
    centros_planejados: [],
  }
}

/** Corridas da janela considerada pelo módulo: ontem, hoje e amanhã. */
function corridasDaJanela(nowMs: number): DemoCorrida[] {
  const dia = operationalDayIndex(nowMs)
  const out: DemoCorrida[] = []
  for (const ct of CENTROS) {
    for (let d = dia - 1; d <= dia + 1; d++) {
      out.push(...getDayPlan(ct.centro_trabalho_id, d).corridas)
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio)
}

function parseLista(valor: string | null): string[] | null {
  if (!valor) return null
  try {
    const parsed = JSON.parse(valor)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    return valor.split(",").map((s) => s.trim()).filter(Boolean)
  }
  return null
}

export function handleLogistica(
  action: string,
  sp: URLSearchParams,
  nowMs = demoNow(),
): { success: true; data: unknown } {
  const store = getStore()
  const filtroCts = parseLista(sp.get("centro_trabalho_ids"))
  const filtroProdutos = parseLista(sp.get("produto_ids"))
  const filtroStatus = parseLista(sp.get("status"))
  const busca = (sp.get("search") ?? "").trim().toLowerCase()

  const aplicaFiltros = (corrida: DemoCorrida) => {
    if (filtroCts?.length && !filtroCts.includes(corrida.centro_trabalho_id)) return false
    if (filtroProdutos?.length && !filtroProdutos.includes(corrida.produto_id)) return false
    if (busca) {
      const produto = PRODUTOS_BY_ID.get(corrida.produto_id)
      const alvo = `${corrida.ordem_codigo} ${produto?.descricao ?? ""} ${produto?.codigo ?? ""}`.toLowerCase()
      if (!alvo.includes(busca)) return false
    }
    return true
  }

  switch (action) {
    case "kanban": {
      const rows = corridasDaJanela(nowMs)
        .filter(aplicaFiltros)
        .map((c) => ordemResumo(c, nowMs))
        .filter((o) => !filtroStatus?.length || filtroStatus.includes(o.status_ui))
      return { success: true, data: rows }
    }

    case "kanban-stats": {
      const rows = corridasDaJanela(nowMs).map((c) => ordemResumo(c, nowMs))
      const porStatus = new Map<StatusUi, { total_ordens: number; total_meta: number; total_good: number }>()
      for (const r of rows) {
        const cur = porStatus.get(r.status_ui as StatusUi) ?? { total_ordens: 0, total_meta: 0, total_good: 0 }
        cur.total_ordens += 1
        cur.total_meta += r.meta_planejada
        cur.total_good += r.total_good
        porStatus.set(r.status_ui as StatusUi, cur)
      }
      return {
        success: true,
        data: Array.from(porStatus.entries()).map(([status_ui, v]) => ({
          status_ui,
          ...v,
          pct_completa: v.total_meta > 0 ? Math.round((v.total_good / v.total_meta) * 1000) / 10 : null,
        })),
      }
    }

    case "fila": {
      const grupos = CENTROS.filter((ct) => !filtroCts?.length || filtroCts.includes(ct.centro_trabalho_id)).map(
        (ct) => {
          const fila = store.filas.get(ct.centro_trabalho_id) ?? []
          const corridaAtual = corridaEm(ct.centro_trabalho_id, nowMs)
          const card = buildCard(ct, nowMs)

          const itens = fila.map((item, i) => ({
            empresa_id: EMPRESA_ID,
            centro_trabalho_id: ct.centro_trabalho_id,
            ct_nome: ct.nome,
            ct_public_id: ct.codigo,
            fila_item_id: item.fila_item_id,
            posicao: item.posicao,
            condicao_fim_tipo: item.finish_rule.tipo,
            condicao_fim_qtd: item.finish_rule.qtd,
            condicao_fim_inicio_utc: null,
            condicao_fim_fim_utc: item.finish_rule.fim_utc,
            ordem_id: item.ordem_id,
            ordem_codigo: item.ordem_codigo,
            produto_descricao: item.produto_descricao,
            status_ui: (item.is_current ? "Em Execução" : "Liberada") as StatusUi,
            meta_planejada: corridaAtual?.meta ?? 500,
            total_good: item.is_current ? card.total_good : 0,
            pct_completa:
              item.is_current && corridaAtual?.meta
                ? Math.round((card.total_good / corridaAtual.meta) * 1000) / 10
                : null,
            inicio_real_utc: item.is_current ? card.corrida_inicio_utc : null,
            inicio_planejado_utc: iso(nowMs + i * 4 * 3_600_000),
            fim_real_utc: null,
            fim_planejado_utc: iso(nowMs + (i + 1) * 4 * 3_600_000),
            is_executando_agora: item.is_current && card.status_ct === "RUNNING",
          }))

          return {
            centro_trabalho_id: ct.centro_trabalho_id,
            ct_nome: ct.nome,
            ct_public_id: ct.codigo,
            itens,
          }
        },
      )
      return { success: true, data: grupos }
    }

    case "carga": {
      const rows = CENTROS.filter((ct) => !filtroCts?.length || filtroCts.includes(ct.centro_trabalho_id)).map((ct) => {
        const corridas = corridasDaJanela(nowMs).filter((c) => c.centro_trabalho_id === ct.centro_trabalho_id)
        const ordens = corridas.map((c) => ordemResumo(c, nowMs))
        const total_meta = ordens.reduce((a, o) => a + o.meta_planejada, 0)
        const total_good = ordens.reduce((a, o) => a + o.total_good, 0)
        return {
          centro_trabalho_id: ct.centro_trabalho_id,
          ct_nome: ct.nome,
          ct_public_id: ct.codigo,
          total_ordens: ordens.length,
          total_meta,
          total_good,
          pct_completa: total_meta > 0 ? Math.round((total_good / total_meta) * 1000) / 10 : null,
          ordens,
        }
      })
      return { success: true, data: rows }
    }

    case "executadas": {
      const rows = corridasDaJanela(nowMs)
        .filter((c) => c.fim <= nowMs)
        .filter(aplicaFiltros)
        .map((c) => {
          const produto = PRODUTOS_BY_ID.get(c.produto_id)
          const ct = CENTROS_BY_ID.get(c.centro_trabalho_id)
          const agg = aggregate(bucketsNaJanela(c.centro_trabalho_id, c.inicio, c.fim, nowMs))
          const turno = shiftsOfDay(operationalDayIndex(c.inicio)).find(
            (t) => c.inicio >= t.inicio && c.inicio < t.fim,
          )
          return {
            empresa_id: EMPRESA_ID,
            execucao_item_id: c.corrida_id,
            status_item: "FINISHED",
            ordem_id: c.ordem_id,
            ordem_public_id: c.ordem_codigo,
            ordem_codigo: c.ordem_codigo,
            centro_trabalho_id: c.centro_trabalho_id,
            ct_public_id: ct?.codigo ?? "",
            ct_codigo: ct?.codigo ?? "",
            turno_id: `turno-${turno?.index ?? 0}`,
            turno_public_id: `T${(turno?.index ?? 0) + 1}`,
            turno_nome: turno?.nome ?? TURNOS[0].nome,
            inicio_planejado_utc: iso(c.inicio),
            fim_planejado_utc: iso(c.fim),
            meta_planejada: c.meta,
            inicio_real_utc: iso(c.inicio),
            fim_real_utc: iso(c.fim),
            planejado: c.meta,
            realizado: agg.good,
            diferenca: agg.good - c.meta,
            pct_completa: c.meta > 0 ? Math.round((agg.good / c.meta) * 1000) / 10 : null,
            total_scrap: agg.scrap,
            total_rework: agg.rework,
            produto_descricao: produto?.descricao ?? "",
          }
        })
        .sort((a, b) => String(b.fim_real_utc).localeCompare(String(a.fim_real_utc)))
      return { success: true, data: rows }
    }

    case "detalhe": {
      const publicId = sp.get("ordem_public_id")
      const corrida = corridasDaJanela(nowMs).find((c) => c.ordem_codigo === publicId)
      return { success: true, data: corrida ? ordemResumo(corrida, nowMs) : null }
    }

    case "status-cts": {
      const rows = CENTROS.map((ct) => {
        const card = buildCard(ct, nowMs)
        const fila = store.filas.get(ct.centro_trabalho_id) ?? []
        const atual = fila.find((f) => f.is_current)
        return {
          centro_trabalho_id: ct.centro_trabalho_id,
          ct_nome: ct.nome,
          ct_public_id: ct.codigo,
          status_ct: card.status_ct,
          ordem_atual_id: card.ordem_atual_id,
          ordem_codigo: card.ordem_codigo,
          produto_descricao: card.produto_descricao,
          meta_corrida: card.meta_corrida,
          total_good: card.total_good,
          total_scrap: card.total_scrap,
          total_rework: card.total_rework,
          last_event_time_utc: card.last_event_time_utc,
          condicao_fim_tipo: atual?.finish_rule.tipo ?? "SEM",
          condicao_fim_qtd: atual?.finish_rule.qtd ?? null,
          condicao_fim_fim_utc: atual?.finish_rule.fim_utc ?? null,
        }
      })
      return { success: true, data: rows }
    }

    case "cts-executando-ordem": {
      const ordemId = sp.get("ordem_id")
      const rows = CENTROS.filter((ct) => corridaEm(ct.centro_trabalho_id, nowMs)?.ordem_id === ordemId).map((ct) => ({
        public_id: ct.codigo,
        nome: ct.nome,
      }))
      return { success: true, data: rows }
    }

    case "filtros-produtos":
      return {
        success: true,
        data: PRODUTOS.map((p) => ({
          produto_id: p.produto_id,
          public_id: p.codigo,
          codigo: p.codigo,
          descricao: p.descricao,
        })),
      }

    case "filtros-cts":
      return {
        success: true,
        data: CENTROS.map((c) => ({
          centro_trabalho_id: c.centro_trabalho_id,
          public_id: c.codigo,
          codigo: c.codigo,
          nome: c.nome,
        })),
      }

    case "filtros-turnos":
      return {
        success: true,
        data: TURNOS.map((t, i) => ({
          turno_id: `turno-${i}`,
          public_id: `T${i + 1}`,
          nome: t.nome,
          hora_inicio: t.hora_inicio,
          hora_fim: t.hora_fim,
        })),
      }

    // Planejamento semanal e templates dependem do ERP corporativo: a demo
    // devolve a estrutura vazia esperada, sem simular uma integração que não existe.
    case "plano-semanal":
      return {
        success: true,
        data: {
          semana_inicio_utc: iso(nowMs),
          semana_fim_utc: iso(nowMs + 7 * DAY_MS),
          dias: [],
          itens: [],
        },
      }

    case "templates":
    case "itens-planejados":
    case "execucoes":
      return { success: true, data: [] }

    case "execucao-detalhe":
      return { success: true, data: null }

    default:
      return { success: true, data: [] }
  }
}

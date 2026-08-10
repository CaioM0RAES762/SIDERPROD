// lib/demo/reports.ts
//
// Relatórios agregados: alimentam as telas de Analítico, Histórico e Relatório
// Consolidado. Todas as séries saem dos mesmos buckets horários usados pelo
// dashboard, então um filtro aplicado aqui produz exatamente os mesmos totais
// que a tela do posto mostraria para o mesmo intervalo.

import {
  CENTROS,
  CENTROS_BY_ID,
  EMPRESA_ID,
  MOTIVOS_BY_ID,
  PRODUTOS,
  PRODUTOS_BY_ID,
  SETORES,
  TURNOS,
  type DemoCentro,
} from "./catalog"
import {
  aggregate,
  bucketsNaJanela,
  corridaEm,
  getDayPlan,
  type Aggregate,
  type HourBucket,
} from "./factory"
import { getStore } from "./store"
import {
  DAY_MS,
  HOUR_MS,
  demoNow,
  iso,
  operationalDayIndex,
  operationalDayStart,
  shiftsOfDay,
} from "./time"
import { paradasView } from "./views"

// ─── Filtros comuns ──────────────────────────────────────────────────────────

export type ReportFilters = {
  startUtc: number
  endUtc: number
  centroTrabalhoId?: string | null
  centrosTrabalhoIds?: string[] | null
  setorId?: string | null
  setorIds?: string[] | null
  turnoId?: string | null
  turnoIds?: string[] | null
  produtoId?: string | null
  ordemId?: string | null
  motivoId?: string | null
  motivoGrupoPerda?: string | null
}

export function centrosFiltrados(f: ReportFilters): DemoCentro[] {
  let list = CENTROS
  const ids = [
    ...(f.centrosTrabalhoIds ?? []),
    ...(f.centroTrabalhoId ? [f.centroTrabalhoId] : []),
  ].filter(Boolean)
  if (ids.length) list = list.filter((c) => ids.includes(c.centro_trabalho_id))

  const setores = [...(f.setorIds ?? []), ...(f.setorId ? [f.setorId] : [])].filter(Boolean)
  if (setores.length) list = list.filter((c) => setores.includes(c.setor_id))

  return list
}

function turnosPermitidos(f: ReportFilters): Set<number> | null {
  const ids = [...(f.turnoIds ?? []), ...(f.turnoId ? [f.turnoId] : [])].filter(Boolean)
  if (!ids.length) return null
  const set = new Set<number>()
  for (const id of ids) {
    const byIndex = /^turno-(\d)$/.exec(id)
    if (byIndex) {
      set.add(Number(byIndex[1]))
      continue
    }
    const idx = TURNOS.findIndex((t) => t.turno_id === id)
    if (idx >= 0) set.add(idx)
  }
  return set.size ? set : null
}

/** Buckets do período respeitando todos os filtros. */
export function bucketsFiltrados(f: ReportFilters, nowMs = demoNow()): HourBucket[] {
  const centros = centrosFiltrados(f)
  const turnos = turnosPermitidos(f)
  const out: HourBucket[] = []

  for (const ct of centros) {
    for (const b of bucketsNaJanela(ct.centro_trabalho_id, f.startUtc, f.endUtc, nowMs)) {
      if (f.produtoId && b.produto_id !== f.produtoId) continue
      if (f.ordemId) {
        const corrida = corridaEm(ct.centro_trabalho_id, b.inicio + HOUR_MS / 2)
        if (corrida?.ordem_id !== f.ordemId) continue
      }
      if (turnos) {
        const dia = operationalDayIndex(b.inicio)
        const slot = shiftsOfDay(dia).find((s) => b.inicio >= s.inicio && b.inicio < s.fim)
        if (!slot || !turnos.has(slot.index)) continue
      }
      out.push(b)
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio)
}

export function paradasFiltradas(f: ReportFilters, nowMs = demoNow()) {
  const centros = centrosFiltrados(f)
  const out = centros.flatMap((ct) => paradasView(ct.centro_trabalho_id, f.startUtc, f.endUtc, nowMs))
  return out.filter((p) => {
    if (f.motivoId && p.motivo_id !== f.motivoId) return false
    if (f.motivoGrupoPerda) {
      const grupo = MOTIVOS_BY_ID.get(p.motivo_id)?.grupo_perda ?? ""
      if (grupo.toUpperCase() !== f.motivoGrupoPerda.toUpperCase()) return false
    }
    return true
  })
}

// ─── Helpers de formatação ───────────────────────────────────────────────────

function fmtHMS(seg: number): string {
  const s = Math.max(0, Math.floor(seg))
  const hh = String(Math.floor(s / 3600)).padStart(2, "0")
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${hh}h${mm}m${ss}s`
}

function pct(v: number | null): string {
  if (v == null) return "—"
  return `${(v * 100).toFixed(1).replace(".", ",")}%`
}

function round(v: number, casas = 2): number {
  const f = 10 ** casas
  return Math.round(v * f) / f
}

// ─── ANALÍTICO ───────────────────────────────────────────────────────────────

const TAB_ORDER = ["Turno A · Manhã", "Turno B · Tarde", "Turno C · Noite"]

type GrupoTurno = { nome: string; buckets: HourBucket[]; paradas: ReturnType<typeof paradasFiltradas> }

function agruparPorTurno(f: ReportFilters, nowMs: number): GrupoTurno[] {
  const buckets = bucketsFiltrados(f, nowMs)
  const paradas = paradasFiltradas(f, nowMs)

  const grupos = new Map<string, GrupoTurno>()
  for (const nome of TAB_ORDER) grupos.set(nome, { nome, buckets: [], paradas: [] })

  const nomeDoInstante = (ms: number) => {
    const dia = operationalDayIndex(ms)
    const slot = shiftsOfDay(dia).find((s) => ms >= s.inicio && ms < s.fim)
    return slot?.nome ?? TAB_ORDER[0]
  }

  for (const b of buckets) grupos.get(nomeDoInstante(b.inicio))?.buckets.push(b)
  for (const p of paradas) grupos.get(nomeDoInstante(p.inicio))?.paradas.push(p)

  return TAB_ORDER.map((n) => grupos.get(n)!).filter((g) => g.buckets.length || g.paradas.length)
}

function summaryDe(buckets: HourBucket[], paradas: ReturnType<typeof paradasFiltradas>) {
  const agg = aggregate(buckets)
  return {
    oee_geral: agg.oee,
    disponibilidade_geral: agg.availability,
    performance_geral: agg.performance,
    qualidade_geral: agg.quality,
    total_good: agg.good,
    total_scrap: agg.scrap,
    total_rework: agg.rework,
    total_produzido: agg.total,
    total_paradas_seg: paradas.reduce((a, p) => a + p.duracao_seg, 0),
    total_ocorrencias: paradas.length,
  }
}

function cicloIdealMedio(buckets: HourBucket[]): number | null {
  const comProducao = buckets.filter((b) => b.total > 0)
  if (!comProducao.length) return null
  const soma = comProducao.reduce((a, b) => a + b.ciclo_ideal_seg * b.total, 0)
  const total = comProducao.reduce((a, b) => a + b.total, 0)
  return total > 0 ? round(soma / total, 1) : null
}

export function analiticoRows(tab: string, f: ReportFilters, nowMs = demoNow()) {
  const grupos = agruparPorTurno(f, nowMs)

  const rows = grupos.map((g) => {
    const agg = aggregate(g.buckets)
    const planejadas = g.paradas.filter((p) => MOTIVOS_BY_ID.get(p.motivo_id)?.is_planejada)
    const naoPlanejadas = g.paradas.filter((p) => !MOTIVOS_BY_ID.get(p.motivo_id)?.is_planejada)
    const durPlan = planejadas.reduce((a, p) => a + p.duracao_seg, 0)
    const durNaoPlan = naoPlanejadas.reduce((a, p) => a + p.duracao_seg, 0)
    const cicloMedio = agg.total > 0 ? round(agg.run_time_seg / agg.total, 1) : null
    const capacidade = cicloIdealMedio(g.buckets)
      ? Math.floor(agg.planned_time_seg / (cicloIdealMedio(g.buckets) as number))
      : 0

    switch (tab) {
      case "producao":
        return {
          turno: g.nome,
          good: agg.good,
          scrap: agg.scrap,
          rework: agg.rework,
          total_produzido: agg.total,
          capacidade,
          meta: Math.floor(capacidade * 0.8),
          fpy: agg.total > 0 ? round(agg.good / agg.total, 4) : null,
          fpy_pct: pct(agg.total > 0 ? agg.good / agg.total : null),
          taxa_refugo: agg.total > 0 ? round(agg.scrap / agg.total, 4) : null,
          taxa_retrabalho: agg.total > 0 ? round(agg.rework / agg.total, 4) : null,
          ciclo_medio_seg: cicloMedio,
          ciclo_ideal_seg: cicloIdealMedio(g.buckets),
        }
      case "paradas": {
        const mttr = naoPlanejadas.length ? round(durNaoPlan / naoPlanejadas.length) : null
        const mtbf = naoPlanejadas.length ? round(agg.run_time_seg / naoPlanejadas.length) : null
        return {
          turno: g.nome,
          duracao_seg: durPlan + durNaoPlan,
          duracao_fmt: fmtHMS(durPlan + durNaoPlan),
          ocorrencias: g.paradas.length,
          dur_planejada_seg: durPlan,
          dur_nao_planejada_seg: durNaoPlan,
          qtd_planejada: planejadas.length,
          qtd_nao_planejada: naoPlanejadas.length,
          mttr_seg: mttr,
          mttr_fmt: mttr != null ? fmtHMS(mttr) : "—",
          mtbf_seg: mtbf,
          mtbf_fmt: mtbf != null ? fmtHMS(mtbf) : "—",
        }
      }
      case "refugo":
        return {
          turno: g.nome,
          refugo: agg.scrap,
          total_produzido: agg.total,
          taxa_refugo: agg.total > 0 ? round(agg.scrap / agg.total, 4) : null,
          taxa_pct: pct(agg.total > 0 ? agg.scrap / agg.total : null),
        }
      case "retrabalho":
        return {
          turno: g.nome,
          retrabalho: agg.rework,
          total_produzido: agg.total,
          taxa_retrabalho: agg.total > 0 ? round(agg.rework / agg.total, 4) : null,
          taxa_pct: pct(agg.total > 0 ? agg.rework / agg.total : null),
        }
      case "ciclo": {
        const ideal = cicloIdealMedio(g.buckets)
        return {
          turno: g.nome,
          ciclo_medio_seg: cicloMedio,
          ciclo_ideal_seg: ideal,
          desvio_seg: cicloMedio != null && ideal != null ? round(cicloMedio - ideal, 1) : null,
          ciclo_medio_fmt: cicloMedio != null ? `${cicloMedio}s` : "—",
          ciclo_ideal_fmt: ideal != null ? `${ideal}s` : "—",
          total_ciclos: agg.total,
        }
      }
      case "perdas":
        return {
          turno: g.nome,
          tempo_perdido_seg: durPlan + durNaoPlan,
          tempo_perdido_fmt: fmtHMS(durPlan + durNaoPlan),
          qtd_perdida: agg.scrap + agg.rework,
          scrap: agg.scrap,
          rework: agg.rework,
          dur_planejada_seg: durPlan,
          dur_nao_planejada_seg: durNaoPlan,
        }
      case "pessoas": {
        const centros = centrosFiltrados(f)
        const pessoas = Math.max(1, Math.round(centros.length * 0.85))
        return {
          turno: g.nome,
          pessoas_ativas: pessoas,
          total_interacoes: g.paradas.length + Math.round(agg.total / 50),
          producao_por_pessoa: pessoas > 0 ? round(agg.good / pessoas) : null,
        }
      }
      case "oee":
      default:
        return {
          turno: g.nome,
          oee: agg.oee ?? 0,
          disponibilidade: agg.availability ?? 0,
          performance: agg.performance ?? 0,
          qualidade: agg.quality ?? 0,
          oee_pct: pct(agg.oee),
          disp_pct: pct(agg.availability),
          perf_pct: pct(agg.performance),
          qual_pct: pct(agg.quality),
          total_good: agg.good,
          total_produzido: agg.total,
          tempo_calendario_seg: agg.elapsed_seg,
          tempo_planejado_seg: agg.planned_time_seg,
          tempo_operacao_seg: agg.run_time_seg,
        }
    }
  })

  const chart = rows.map((r) => {
    const anyRow = r as Record<string, unknown>
    const value =
      tab === "oee"
        ? Number(anyRow.oee ?? 0) * 100
        : tab === "producao"
          ? Number(anyRow.good ?? 0)
          : tab === "paradas"
            ? Number(anyRow.duracao_seg ?? 0) / 60
            : tab === "refugo"
              ? Number(anyRow.refugo ?? 0)
              : tab === "retrabalho"
                ? Number(anyRow.retrabalho ?? 0)
                : tab === "ciclo"
                  ? Number(anyRow.ciclo_medio_seg ?? 0)
                  : tab === "perdas"
                    ? Number(anyRow.tempo_perdido_seg ?? 0) / 60
                    : Number(anyRow.pessoas_ativas ?? 0)
    return { label: String(anyRow.turno ?? ""), value: round(value, 2) }
  })

  const buckets = bucketsFiltrados(f, nowMs)
  const paradas = paradasFiltradas(f, nowMs)

  return {
    rows,
    chart,
    summary: summaryDe(buckets, paradas),
    meta: {
      empresaId: EMPRESA_ID,
      startUtc: iso(f.startUtc),
      endUtc: iso(f.endUtc),
      tab,
      total: rows.length,
    },
  }
}

export function analiticoPareto(f: ReportFilters, topN = 10, nowMs = demoNow()) {
  const paradas = paradasFiltradas(f, nowMs)
  const porMotivo = new Map<string, { seg: number; qtd: number }>()
  for (const p of paradas) {
    const cur = porMotivo.get(p.motivo_id) ?? { seg: 0, qtd: 0 }
    cur.seg += p.duracao_seg
    cur.qtd += 1
    porMotivo.set(p.motivo_id, cur)
  }

  const total = Array.from(porMotivo.values()).reduce((a, v) => a + v.seg, 0) || 1
  const ordenado = Array.from(porMotivo.entries()).sort((a, b) => b[1].seg - a[1].seg).slice(0, topN)

  let acumulado = 0
  return ordenado.map(([motivoId, v]) => {
    const motivo = MOTIVOS_BY_ID.get(motivoId)
    const percentual = (v.seg / total) * 100
    acumulado += percentual
    return {
      motivo_id: motivoId,
      motivo_codigo: motivo?.codigo ?? null,
      motivo_descricao: motivo?.descricao ?? null,
      motivo_grupo_perda: motivo?.grupo_perda ?? null,
      is_planejada: motivo?.is_planejada ?? null,
      duracao_total_seg: Math.round(v.seg),
      quantidade: v.qtd,
      percentual_duracao: round(percentual, 2),
      percentual_acumulado: round(Math.min(100, acumulado), 2),
    }
  })
}

export function analiticoLookups(f?: ReportFilters, nowMs = demoNow()) {
  const dia = operationalDayIndex(nowMs)
  const ordens: { ordem_id: string; ordem_codigo: string; produto_descricao: string; inicio_utc: string; fim_utc: string }[] = []
  for (let d = dia - 6; d <= dia; d++) {
    for (const ct of CENTROS) {
      for (const c of getDayPlan(ct.centro_trabalho_id, d).corridas) {
        if (c.inicio > nowMs) continue
        ordens.push({
          ordem_id: c.ordem_id,
          ordem_codigo: c.ordem_codigo,
          produto_descricao: PRODUTOS_BY_ID.get(c.produto_id)?.descricao ?? "",
          inicio_utc: iso(c.inicio),
          fim_utc: iso(Math.min(c.fim, nowMs)),
        })
      }
    }
  }

  return {
    empresaId: EMPRESA_ID,
    centros_trabalho: CENTROS.map((c) => ({
      centro_trabalho_id: c.centro_trabalho_id,
      codigo: c.codigo,
      nome: c.nome,
      public_id: c.codigo,
      setor_id: c.setor_id,
    })),
    turnos: TURNOS.map((t, i) => ({
      turno_id: `turno-${i}`,
      nome: t.nome,
      public_id: `T${i + 1}`,
      hora_inicio: t.hora_inicio,
      hora_fim: t.hora_fim,
      ordem_exibicao: t.ordem_exibicao,
    })),
    produtos: PRODUTOS.map((p) => ({
      produto_id: p.produto_id,
      codigo: p.codigo,
      descricao: p.descricao,
      public_id: p.codigo,
      ciclo_ideal_seg: p.ciclo_ideal_seg,
    })),
    motivos_parada: getStore().motivos.map((m) => ({
      motivo_id: m.motivo_id,
      codigo: m.codigo,
      descricao: m.descricao,
      grupo_perda: m.grupo_perda,
      is_planejada: m.is_planejada,
      public_id: m.codigo,
    })),
    ordens: ordens.slice(0, 120),
    setores: SETORES.map((s) => ({ setor_id: s.setor_id, nome: s.nome, public_id: s.nome })),
  }
}

// ─── Ranking de rebarbadores ─────────────────────────────────────────────────

export function rebarbadoresRanking(f: ReportFilters, nowMs = demoNow()) {
  const store = getStore()
  const centrosRebarba = centrosFiltrados(f).filter((c) => c.rebarbador || c.modo_contagem === "REWORK")

  const porFuncionario = new Map<string, { agg: Aggregate; paradas: number; paradaSeg: number; planSeg: number; nplanSeg: number; atuacoes: number; ciclo: number | null }>()

  for (const ct of centrosRebarba) {
    const funcionarioId = store.rebarbadorPorCt.get(ct.centro_trabalho_id)
    if (!funcionarioId) continue
    const buckets = bucketsNaJanela(ct.centro_trabalho_id, f.startUtc, f.endUtc, nowMs)
    if (!buckets.length) continue
    const agg = aggregate(buckets)
    const paradas = paradasView(ct.centro_trabalho_id, f.startUtc, f.endUtc, nowMs)

    const atual = porFuncionario.get(funcionarioId)
    const planSeg = paradas.filter((p) => MOTIVOS_BY_ID.get(p.motivo_id)?.is_planejada).reduce((a, p) => a + p.duracao_seg, 0)
    const nplanSeg = paradas.filter((p) => !MOTIVOS_BY_ID.get(p.motivo_id)?.is_planejada).reduce((a, p) => a + p.duracao_seg, 0)

    if (!atual) {
      porFuncionario.set(funcionarioId, {
        agg,
        paradas: paradas.length,
        paradaSeg: planSeg + nplanSeg,
        planSeg,
        nplanSeg,
        atuacoes: 1,
        ciclo: cicloIdealMedio(buckets),
      })
    } else {
      atual.agg = aggregate([...buckets])
      atual.paradas += paradas.length
      atual.paradaSeg += planSeg + nplanSeg
      atual.planSeg += planSeg
      atual.nplanSeg += nplanSeg
      atual.atuacoes += 1
    }
  }

  const rows = Array.from(porFuncionario.entries()).map(([id, v]) => {
    const func = store.funcionarios.find((x) => x.funcionario_id === id)
    const horas = v.agg.run_time_seg / 3600
    const pcsH = horas > 0 ? round(v.agg.good / horas, 1) : null
    const metaPcsH = v.ciclo ? round((3600 / v.ciclo) * 0.8, 1) : null
    return {
      rebarbador_id: id,
      rebarbador_nome: func?.nome ?? "—",
      registro: func?.registro ?? null,
      cargo: func?.cargo ?? null,
      atuacoes: v.atuacoes,
      dur_total_seg: v.agg.elapsed_seg,
      tempo_produzindo_seg: v.agg.run_time_seg,
      good: v.agg.good,
      scrap: v.agg.scrap,
      rework: v.agg.rework,
      total: v.agg.total,
      parada_seg: Math.round(v.paradaSeg),
      parada_plan_seg: Math.round(v.planSeg),
      parada_nplan_seg: Math.round(v.nplanSeg),
      qtd_paradas: v.paradas,
      pcs_h: pcsH,
      meta_pcs_h: metaPcsH,
      aderencia: pcsH != null && metaPcsH ? round(pcsH / metaPcsH, 3) : null,
      qualidade: v.agg.quality,
    }
  })

  return {
    disponivel: true,
    motivoIndisponivel: null,
    rows: rows.sort((a, b) => (b.pcs_h ?? 0) - (a.pcs_h ?? 0)),
  }
}

// ─── HISTÓRICO ───────────────────────────────────────────────────────────────

type Slot = { label: string; inicio: number; fim: number }

function slotsDaGranularidade(granularity: string, from: number, to: number, nowMs: number): Slot[] {
  const limite = Math.min(to, nowMs)
  const slots: Slot[] = []
  const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { ...opts, timeZone: "UTC" }).format(new Date(ms))

  if (granularity === "hour") {
    const passo = HOUR_MS
    const inicio = Math.floor(from / passo) * passo
    for (let t = inicio; t < limite && slots.length < 240; t += passo) {
      slots.push({ label: `${fmt(t, { day: "2-digit", month: "2-digit" })} ${fmt(t, { hour: "2-digit" })}h`, inicio: t, fim: t + passo })
    }
    return slots
  }

  if (granularity === "turno") {
    const primeiro = operationalDayIndex(from)
    const ultimo = operationalDayIndex(limite)
    for (let d = primeiro; d <= ultimo; d++) {
      for (const s of shiftsOfDay(d)) {
        if (s.fim <= from || s.inicio >= limite) continue
        slots.push({
          label: `${fmt(s.inicio, { day: "2-digit", month: "2-digit" })} · ${s.nome.split("·")[0].trim()}`,
          inicio: s.inicio,
          fim: s.fim,
        })
      }
    }
    return slots
  }

  if (granularity === "Semana") {
    const primeiro = operationalDayIndex(from)
    const ultimo = operationalDayIndex(limite)
    for (let d = primeiro; d <= ultimo; d += 7) {
      const ini = operationalDayStart(d)
      slots.push({ label: `Sem. ${fmt(ini, { day: "2-digit", month: "2-digit" })}`, inicio: ini, fim: ini + 7 * DAY_MS })
    }
    return slots
  }

  if (granularity === "Mês") {
    const primeiro = new Date(from)
    const cursor = Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth(), 1)
    for (let t = cursor; t < limite; ) {
      const d = new Date(t)
      const prox = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      slots.push({ label: fmt(t, { month: "short", year: "2-digit" }), inicio: t, fim: prox })
      t = prox
    }
    return slots
  }

  // op_day / Dia
  const primeiro = operationalDayIndex(from)
  const ultimo = operationalDayIndex(limite)
  for (let d = primeiro; d <= ultimo; d++) {
    const ini = operationalDayStart(d)
    slots.push({ label: fmt(ini, { day: "2-digit", month: "2-digit" }), inicio: ini, fim: ini + DAY_MS })
  }
  return slots
}

export function historicoSeries(
  tab: string,
  granularity: string,
  f: ReportFilters,
  metrics: { producaoMetric?: string; paradasMetric?: string; cicloMetric?: string; perdasMetric?: string },
  nowMs = demoNow(),
) {
  const slots = slotsDaGranularidade(granularity, f.startUtc, f.endUtc, nowMs)
  const centros = centrosFiltrados(f)

  const dados = slots.map((slot) => {
    const janela: ReportFilters = { ...f, startUtc: slot.inicio, endUtc: slot.fim }
    const buckets = bucketsFiltrados(janela, nowMs)
    const paradas = paradasFiltradas(janela, nowMs)
    return { slot, agg: aggregate(buckets), buckets, paradas }
  })

  const series: { name: string; data: number[]; unit?: string }[] = []
  const push = (name: string, pick: (d: (typeof dados)[number]) => number, unit?: string) =>
    series.push({ name, data: dados.map((d) => round(pick(d), 2)), unit })

  switch (tab) {
    case "producao": {
      const metric = metrics.producaoMetric ?? "Qtd. Produzida e Capacidade"
      if (metric !== "Capacidade") push("Qtd. Produzida", (d) => d.agg.good, "UN")
      if (metric !== "Qtd. Produzida") {
        push(
          "Capacidade",
          (d) => {
            const ciclo = cicloIdealMedio(d.buckets)
            return ciclo ? Math.floor(d.agg.planned_time_seg / ciclo) : 0
          },
          "UN",
        )
      }
      break
    }
    case "paradas": {
      const metric = metrics.paradasMetric ?? "Duração"
      if (metric === "Quantidade") push("Ocorrências", (d) => d.paradas.length)
      else push("Duração", (d) => d.paradas.reduce((a, p) => a + p.duracao_seg, 0) / 60, "min")
      break
    }
    case "refugo":
      push("Refugo", (d) => d.agg.scrap, "UN")
      push("Taxa de refugo", (d) => (d.agg.total > 0 ? (d.agg.scrap / d.agg.total) * 100 : 0), "%")
      break
    case "retrabalho":
      push("Retrabalho", (d) => d.agg.rework, "UN")
      push("Taxa de retrabalho", (d) => (d.agg.total > 0 ? (d.agg.rework / d.agg.total) * 100 : 0), "%")
      break
    case "ciclo": {
      const metric = metrics.cicloMetric ?? "Tempo de Ciclo"
      push(metric === "Ciclo Médio" ? "Ciclo Médio" : "Tempo de Ciclo", (d) => (d.agg.total > 0 ? d.agg.run_time_seg / d.agg.total : 0), "s")
      push("Ciclo ideal", (d) => cicloIdealMedio(d.buckets) ?? 0, "s")
      break
    }
    case "perdas": {
      const metric = metrics.perdasMetric ?? "Tempo perdido"
      if (metric === "Quantidade perdida") push("Quantidade perdida", (d) => d.agg.scrap + d.agg.rework, "UN")
      else push("Tempo perdido", (d) => d.paradas.reduce((a, p) => a + p.duracao_seg, 0) / 60, "min")
      break
    }
    case "pessoas":
      push("Pessoas ativas", () => Math.max(1, Math.round(centros.length * 0.85)))
      push("Produção por pessoa", (d) => d.agg.good / Math.max(1, Math.round(centros.length * 0.85)), "UN")
      break
    case "eventos":
      push("Paradas registradas", (d) => d.paradas.length)
      push("Ordens iniciadas", (d) => new Set(d.buckets.map((b) => b.corrida_id)).size)
      break
    case "oee":
    default:
      push("OEE", (d) => (d.agg.oee ?? 0) * 100, "%")
      push("Disponibilidade", (d) => (d.agg.availability ?? 0) * 100, "%")
      push("Performance", (d) => (d.agg.performance ?? 0) * 100, "%")
      push("Qualidade", (d) => (d.agg.quality ?? 0) * 100, "%")
      break
  }

  const labels = slots.map((s) => s.label)
  const table = labels.map((label, i) => {
    const row: Record<string, string | number> = { dia: label }
    for (const s of series) row[s.name] = s.data[i] ?? 0
    return row
  })

  return {
    empresaId: EMPRESA_ID,
    query: { tab, granularity, startUtc: iso(f.startUtc), endUtc: iso(f.endUtc) },
    labels,
    seriesList: series,
    series: series[0]?.data ?? [],
    table,
    points: [],
  }
}

export function historicoLista(mode: string, f: ReportFilters, nowMs = demoNow()) {
  switch (mode) {
    case "setores":
      return SETORES.map((s) => ({ setor_id: s.setor_id, nome: s.nome, public_id: s.nome }))
    case "turnos":
      return TURNOS.map((t, i) => ({
        turno_id: `turno-${i}`,
        nome: t.nome,
        public_id: `T${i + 1}`,
        hora_inicio: t.hora_inicio,
        hora_fim: t.hora_fim,
      }))
    case "centros":
      return centrosFiltrados(f).map((c) => ({
        centro_trabalho_id: c.centro_trabalho_id,
        codigo: c.codigo,
        nome: c.nome,
        public_id: c.codigo,
      }))
    case "produtos":
      return PRODUTOS.map((p) => ({
        produto_id: p.produto_id,
        codigo: p.codigo,
        descricao: p.descricao,
        public_id: p.codigo,
      }))
    case "ordens": {
      const primeiro = operationalDayIndex(f.startUtc)
      const ultimo = operationalDayIndex(Math.min(f.endUtc, nowMs))
      const out: { ordem_id: string; ordem_codigo: string; ordem_public_id: string; produto_descricao: string }[] = []
      for (let d = primeiro; d <= ultimo; d++) {
        for (const ct of centrosFiltrados(f)) {
          for (const c of getDayPlan(ct.centro_trabalho_id, d).corridas) {
            if (c.inicio > nowMs) continue
            out.push({
              ordem_id: c.ordem_id,
              ordem_codigo: c.ordem_codigo,
              ordem_public_id: c.ordem_codigo,
              produto_descricao: PRODUTOS_BY_ID.get(c.produto_id)?.descricao ?? "",
            })
          }
        }
      }
      return out.slice(0, 200)
    }
    default:
      return []
  }
}

// ─── RELATÓRIO CONSOLIDADO ───────────────────────────────────────────────────

export function relatorioProducaoHora(f: ReportFilters, nowMs = demoNow()) {
  const buckets = bucketsFiltrados(f, nowMs)
  const porHora = new Map<number, HourBucket[]>()
  for (const b of buckets) {
    const hora = new Date(b.inicio).getUTCHours()
    if (!porHora.has(hora)) porHora.set(hora, [])
    porHora.get(hora)!.push(b)
  }

  return Array.from(porHora.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hora, list]) => {
      const agg = aggregate(list)
      const ciclo = cicloIdealMedio(list)
      return {
        label: `${String(hora).padStart(2, "0")}h`,
        hora_utc: hora,
        value: agg.good,
        target: ciclo ? Math.floor((agg.planned_time_seg / ciclo) * 0.8) : 0,
        ciclo_medio_seg: agg.total > 0 ? round(agg.run_time_seg / agg.total, 1) : null,
      }
    })
}

export function relatorioProducaoDia(f: ReportFilters, nowMs = demoNow()) {
  const primeiro = operationalDayIndex(f.startUtc)
  const ultimo = operationalDayIndex(Math.min(f.endUtc, nowMs))
  const centros = centrosFiltrados(f)
  const out = []

  for (let d = primeiro; d <= ultimo; d++) {
    const ini = operationalDayStart(d)
    const fim = ini + DAY_MS
    const janela: ReportFilters = { ...f, startUtc: Math.max(ini, f.startUtc), endUtc: Math.min(fim, f.endUtc) }
    const buckets = bucketsFiltrados(janela, nowMs)
    if (!buckets.length) continue
    const agg = aggregate(buckets)
    const ciclo = cicloIdealMedio(buckets)

    const breakdown = centros
      .map((ct) => {
        const b = buckets.filter((x) => x.centro_trabalho_id === ct.centro_trabalho_id)
        return {
          centro_trabalho_id: ct.centro_trabalho_id,
          ct_codigo: ct.codigo,
          ct_nome: ct.nome,
          good: aggregate(b).good,
        }
      })
      .filter((x) => x.good > 0)
      .sort((a, b) => b.good - a.good)

    out.push({
      label: iso(ini).slice(0, 10),
      dia_utc: iso(ini),
      value: agg.good,
      capacidade: ciclo ? Math.floor(agg.planned_time_seg / ciclo) : 0,
      ciclo_medio_seg: agg.total > 0 ? round(agg.run_time_seg / agg.total, 1) : null,
      breakdown,
    })
  }
  return out
}

export function relatorioOee(f: ReportFilters, nowMs = demoNow()) {
  const buckets = bucketsFiltrados(f, nowMs)
  const agg = aggregate(buckets)
  const centros = centrosFiltrados(f)
  const pessoas = Math.max(1, Math.round(centros.length * 0.85))
  const horas = agg.run_time_seg / 3600

  // A tela do relatório multiplica estes campos por 100 na exibição, então eles
  // trafegam como razão (0..1) — igual às demais métricas de OEE da aplicação.
  return {
    oee_pct: round(agg.oee ?? 0, 4),
    disponibilidade_pct: round(agg.availability ?? 0, 4),
    performance_pct: round(agg.performance ?? 0, 4),
    qualidade_pct: round(agg.quality ?? 0, 4),
    oee_fmt: pct(agg.oee),
    disp_fmt: pct(agg.availability),
    perf_fmt: pct(agg.performance),
    qual_fmt: pct(agg.quality),
    meta_pct: 0.75,
    tempo_calendario_seg: agg.elapsed_seg,
    tempo_planejado_seg: agg.planned_time_seg,
    tempo_operacao_seg: agg.run_time_seg,
    planned_stop_seg: agg.planned_stop_seg,
    unplanned_stop_seg: agg.unplanned_stop_seg,
    run_time_seg: agg.run_time_seg,
    ideal_time_seg: agg.ideal_time_seg,
    total_good: agg.good,
    total_scrap: agg.scrap,
    total_rework: agg.rework,
    total_produzido: agg.total,
    media_pessoas_turno: pessoas,
    producao_boa_por_pessoa_hora: horas > 0 ? round(agg.good / pessoas / horas, 2) : null,
    taxa_producao_hora: horas > 0 ? round(agg.good / horas, 1) : null,
    ciclo_ideal_medio_seg: cicloIdealMedio(buckets),
  }
}

export function relatorioGraficoPerdas(f: ReportFilters, nowMs = demoNow()) {
  const buckets = bucketsFiltrados(f, nowMs)
  const agg = aggregate(buckets)
  const paradas = paradasFiltradas(f, nowMs)
  const ciclo = cicloIdealMedio(buckets) ?? 60

  const planejadoUn = Math.floor(agg.elapsed_seg / ciclo)
  const items: {
    name: string
    disponibilidade: number
    performance: number
    qualidade: number
    hours: number
    motivo_id: string | null
    is_planejada: boolean | null
    grupo_perda: string | null
    color_hint: "planejado" | "disponibilidade" | "performance" | "qualidade" | "efetivo"
  }[] = []

  items.push({
    name: "Capacidade teórica",
    disponibilidade: 0,
    performance: 0,
    qualidade: 0,
    hours: round(agg.elapsed_seg / 3600, 2),
    motivo_id: null,
    is_planejada: null,
    grupo_perda: null,
    color_hint: "planejado",
  })

  const porMotivo = new Map<string, number>()
  for (const p of paradas) porMotivo.set(p.motivo_id, (porMotivo.get(p.motivo_id) ?? 0) + p.duracao_seg)

  for (const [motivoId, seg] of Array.from(porMotivo.entries()).sort((a, b) => b[1] - a[1])) {
    const motivo = MOTIVOS_BY_ID.get(motivoId)
    items.push({
      name: motivo?.descricao ?? "Parada",
      disponibilidade: Math.floor(seg / ciclo),
      performance: 0,
      qualidade: 0,
      hours: round(seg / 3600, 2),
      motivo_id: motivoId,
      is_planejada: motivo?.is_planejada ?? null,
      grupo_perda: motivo?.grupo_perda ?? null,
      color_hint: "disponibilidade",
    })
  }

  const perdaPerformance = Math.max(0, Math.floor(agg.run_time_seg / ciclo) - agg.total)
  items.push({
    name: "Perda de performance",
    disponibilidade: 0,
    performance: perdaPerformance,
    qualidade: 0,
    hours: round((perdaPerformance * ciclo) / 3600, 2),
    motivo_id: null,
    is_planejada: null,
    grupo_perda: "Performance",
    color_hint: "performance",
  })

  items.push({
    name: "Perda de qualidade",
    disponibilidade: 0,
    performance: 0,
    qualidade: agg.scrap + agg.rework,
    hours: round(((agg.scrap + agg.rework) * ciclo) / 3600, 2),
    motivo_id: null,
    is_planejada: null,
    grupo_perda: "Qualidade",
    color_hint: "qualidade",
  })

  items.push({
    name: "Produção efetiva",
    disponibilidade: 0,
    performance: 0,
    qualidade: 0,
    hours: round((agg.good * ciclo) / 3600, 2),
    motivo_id: null,
    is_planejada: null,
    grupo_perda: null,
    color_hint: "efetivo",
  })

  const totalDisp = items.reduce((a, i) => a + i.disponibilidade, 0)

  return {
    items,
    tabela: items
      .filter((i) => i.color_hint !== "planejado" && i.color_hint !== "efetivo")
      .map((i) => ({
        motivo_id: i.motivo_id,
        name: i.name,
        disponibilidade: i.disponibilidade || null,
        performance: i.performance || null,
        qualidade: i.qualidade || null,
        hours: i.hours,
        grupo_perda: i.grupo_perda,
        is_planejada: i.is_planejada,
        color_hint: i.color_hint,
      })),
    planejado_un: planejadoUn,
    efetivo_un: agg.good,
    total_disp: totalDisp,
    total_perf: perdaPerformance,
    total_qual: agg.scrap + agg.rework,
  }
}

export function relatorioParadas(f: ReportFilters, nowMs = demoNow()) {
  return paradasFiltradas(f, nowMs)
    .map((p) => {
      const motivo = MOTIVOS_BY_ID.get(p.motivo_id)
      const ct = CENTROS_BY_ID.get(p.centro_trabalho_id)
      return {
        parada_id: p.parada_id,
        motivo_id: p.motivo_id,
        motivo_descricao: motivo?.descricao ?? "Parada",
        motivo_codigo: motivo?.codigo ?? null,
        is_planejada: motivo?.is_planejada ?? null,
        grupo_perda: motivo?.grupo_perda ?? null,
        centro_trabalho_id: p.centro_trabalho_id,
        ct_codigo: ct?.codigo ?? null,
        ct_nome: ct?.nome ?? null,
        equipamento: ct?.nome ?? null,
        inicio_utc: iso(p.inicio),
        fim_utc: p.fim_efetivo ? iso(p.fim_efetivo) : null,
        duracao_seg: p.duracao_seg,
        duracao_fmt: fmtHMS(p.duracao_seg),
      }
    })
    .sort((a, b) => b.duracao_seg - a.duracao_seg)
}

export function relatorioParadasPareto(f: ReportFilters, nowMs = demoNow()) {
  const paradas = paradasFiltradas(f, nowMs)
  const porMotivo = new Map<string, { seg: number; qtd: number; porCt: Map<string, { seg: number; qtd: number }> }>()

  for (const p of paradas) {
    const cur = porMotivo.get(p.motivo_id) ?? { seg: 0, qtd: 0, porCt: new Map() }
    cur.seg += p.duracao_seg
    cur.qtd += 1
    const ctCur = cur.porCt.get(p.centro_trabalho_id) ?? { seg: 0, qtd: 0 }
    ctCur.seg += p.duracao_seg
    ctCur.qtd += 1
    cur.porCt.set(p.centro_trabalho_id, ctCur)
    porMotivo.set(p.motivo_id, cur)
  }

  return Array.from(porMotivo.entries())
    .map(([motivoId, v]) => {
      const motivo = MOTIVOS_BY_ID.get(motivoId)
      return {
        motivo_id: motivoId,
        motivo_descricao: motivo?.descricao ?? "Parada",
        motivo_codigo: motivo?.codigo ?? null,
        grupo_perda: motivo?.grupo_perda ?? null,
        is_planejada: motivo?.is_planejada ?? null,
        duracao_total_seg: Math.round(v.seg),
        duracao_total_fmt: fmtHMS(v.seg),
        ocorrencias: v.qtd,
        breakdown_ct: Array.from(v.porCt.entries()).map(([ctId, ctV]) => {
          const ct = CENTROS_BY_ID.get(ctId)
          return {
            centro_trabalho_id: ctId,
            ct_codigo: ct?.codigo ?? "",
            ct_nome: ct?.nome ?? null,
            duracao_seg: Math.round(ctV.seg),
            duracao_fmt: fmtHMS(ctV.seg),
            ocorrencias: ctV.qtd,
          }
        }),
      }
    })
    .sort((a, b) => b.duracao_total_seg - a.duracao_total_seg)
}

export function relatorioProducaoOrdens(f: ReportFilters, nowMs = demoNow()) {
  const buckets = bucketsFiltrados(f, nowMs)
  const porCorrida = new Map<string, HourBucket[]>()
  for (const b of buckets) {
    if (!b.corrida_id) continue
    if (!porCorrida.has(b.corrida_id)) porCorrida.set(b.corrida_id, [])
    porCorrida.get(b.corrida_id)!.push(b)
  }

  const porProduto = new Map<string, number>()
  const linhas = Array.from(porCorrida.entries()).map(([corridaId, list]) => {
    const agg = aggregate(list)
    const produto = list[0].produto_id ? PRODUTOS_BY_ID.get(list[0].produto_id) : null
    const corrida = corridaEm(list[0].centro_trabalho_id, list[0].inicio + HOUR_MS / 2)
    if (produto) porProduto.set(produto.produto_id, (porProduto.get(produto.produto_id) ?? 0) + agg.good)
    return {
      produto_id: produto?.produto_id ?? null,
      produto_codigo: produto?.codigo ?? null,
      produto_descricao: produto?.descricao ?? null,
      ordem_id: corrida?.ordem_id ?? corridaId,
      ordem_codigo: corrida?.ordem_codigo ?? null,
      por_ordem: agg.good,
      por_produto: 0,
      scrap: agg.scrap,
      rework: agg.rework,
    }
  })

  for (const l of linhas) {
    l.por_produto = l.produto_id ? porProduto.get(l.produto_id) ?? 0 : 0
  }

  return linhas.sort((a, b) => b.por_ordem - a.por_ordem)
}

export function relatorioPlanosAcao() {
  return getStore().planosAcao.map((p) => ({
    plano_acao_id: p.id,
    public_id: `PA-DEMO-${p.id.slice(0, 4).toUpperCase()}`,
    titulo: p.o_que,
    status: p.estado,
    itens: [
      {
        plano_acao_item_id: p.item_id,
        o_que: p.o_que,
        quem_nome: p.quem_nome,
        quando_utc: p.quando,
        status: p.estado,
      },
    ],
    plano_melhoria_titulo: null,
  }))
}

export function relatorioAnotacoes(f: ReportFilters) {
  const centros = centrosFiltrados(f)
  const ids = new Set(centros.map((c) => c.centro_trabalho_id))
  return getStore()
    .anotacoes.filter((a) => {
      const t = new Date(a.data_hora).getTime()
      if (!Number.isFinite(t) || t < f.startUtc || t > f.endUtc) return false
      return !a.centro_trabalho_id || ids.has(a.centro_trabalho_id)
    })
    .map((a) => {
      const ct = a.centro_trabalho_id ? CENTROS_BY_ID.get(a.centro_trabalho_id) : null
      return {
        anotacao_id: a.id,
        centro_trabalho_id: a.centro_trabalho_id ?? "",
        ct_codigo: ct?.codigo ?? null,
        ct_nome: ct?.nome ?? null,
        anotacao_time_utc: a.data_hora,
        texto: a.texto,
        autor_nome: a.usuario_nome,
      }
    })
}

export function relatorioConsolidado(f: ReportFilters, nowMs = demoNow()) {
  return {
    producao_hora: relatorioProducaoHora(f, nowMs),
    producao_dia: relatorioProducaoDia(f, nowMs),
    oee: relatorioOee(f, nowMs),
    grafico_perdas: relatorioGraficoPerdas(f, nowMs),
    paradas: relatorioParadas(f, nowMs),
    paradas_pareto: relatorioParadasPareto(f, nowMs),
    producao_ordens: relatorioProducaoOrdens(f, nowMs),
    planos_acao: relatorioPlanosAcao(),
    anotacoes: relatorioAnotacoes(f),
    meta: {
      empresaId: EMPRESA_ID,
      startUtc: iso(f.startUtc),
      endUtc: iso(f.endUtc),
      gerado_em: iso(nowMs),
    },
  }
}


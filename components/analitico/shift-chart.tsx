// components/analitico/shift-chart.tsx
"use client"

/**
 * ══════════════════════════════════════════════════════════════════
 * SHIFT CHART — comparação por turno (MES / Analítico)
 *
 * Gráfico de barras HORIZONTAIS, uma linha por turno, sempre na
 * ordem operacional fixa: MANHÃ → TARDE → NOITE.
 *
 * Motivação de design (analista industrial):
 *   - N pequeno (3 turnos, ou 1 quando filtrado). Barras horizontais
 *     deixam o rótulo do turno legível e permitem "bater o olho" e
 *     comparar melhor/pior turno sem esforço.
 *   - Cor SÓBRIA por padrão (grafite). Cor só aparece com significado:
 *       • verde  = melhor turno / dentro da meta
 *       • vermelho = pior turno / crítico
 *       • âmbar  = atenção / não-planejado
 *   - Cada aba tem enriquecimentos próprios (empilhado, marcador de
 *     meta/ideal, chips de decomposição) construídos em buildShiftChart().
 *
 * NÃO altera backend, endpoints, filtros nem auto-refresh: consome as
 * mesmas rows que a API já devolve por turno.
 * ══════════════════════════════════════════════════════════════════
 */

import React, { useRef, useState, useCallback } from "react"
import { BarChart2 } from "lucide-react"

/* ─────────────────────────── formatadores ─────────────────────────── */
const pad2 = (n: number) => String(n).padStart(2, "0")

function fmtN(n: number, dec = 0): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
/** n já em escala 0–100 */
function fmtPct(n: number, dec = 1): string {
  if (!Number.isFinite(n)) return "—"
  return `${n.toFixed(dec).replace(".", ",")}%`
}
/** segundos → h:mm (durações longas: paradas, perdas) */
function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00"
  const t = Math.round(s)
  return `${Math.floor(t / 3600)}:${pad2(Math.floor((t % 3600) / 60))}`
}
/** segundos → m:ss (durações curtas: tempo de ciclo) */
function fmtMMSS(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00"
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${pad2(t % 60)}`
}
function numOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/* ─────────────────────────── paleta escura ─────────────────────────── */
// Cores SÓLIDAS (texto, dots, legenda, marcador) — tons escuros
export const SHIFT_PAL = {
  good: "#15803d",       // verde escuro
  warn: "#b45309",       // âmbar/laranja escuro
  bad: "#b91c1c",        // vermelho escuro
  volume: "#3f3f46",     // grafite escuro
  planned: "#334155",    // slate escuro (planejada)
  unplanned: "#b45309",  // âmbar → marrom (não-planejada)
  scrap: "#b91c1c",      // refugo (vermelho)
  rework: "#b45309",     // retrabalho (âmbar)
  target: "#0f172a",     // marcador de meta/ideal
}

// Degradês (preenchimento das barras): claro no topo → escuro/marrom na base
const SHIFT_GRAD: Record<string, string> = {
  "#15803d": "linear-gradient(180deg,#22c55e 0%,#15803d 50%,#14532d 100%)", // verde claro → muito escuro
  "#b45309": "linear-gradient(180deg,#f59e0b 0%,#b45309 50%,#78350f 100%)", // laranja/âmbar → marrom
  "#b91c1c": "linear-gradient(180deg,#ef4444 0%,#991b1b 55%,#651a0e 100%)", // vermelho claro → escuro/marrom
  "#3f3f46": "linear-gradient(180deg,#52525b 0%,#3f3f46 50%,#27272a 100%)", // grafite
  "#334155": "linear-gradient(180deg,#64748b 0%,#334155 50%,#1e293b 100%)", // slate
}
/** preenchimento (degradê) correspondente a uma cor sólida conhecida */
function fillFor(c: string): string {
  return SHIFT_GRAD[c] ?? c
}

/* ─────────────────────── ordenação por turno ──────────────────────── */
function normShift(name: string): string {
  // lowercase + trim; casa tanto "Manhã" quanto "manha" via includes("manh")
  return String(name ?? "").toLowerCase().trim()
}
/** Manhã=0, Tarde=1, Noite=2, demais depois (estável). */
export function shiftOrdinal(name: string): number {
  const s = normShift(name)
  if (s.includes("manh")) return 0            // manhã / manha
  if (s.includes("tarde")) return 1
  if (s.includes("noite") || s.includes("noturno")) return 2
  return 3
}
export function sortByShift<T extends { turno?: string }>(rows: T[]): T[] {
  return [...(rows ?? [])].sort((a, b) => {
    const d = shiftOrdinal(String(a?.turno ?? "")) - shiftOrdinal(String(b?.turno ?? ""))
    return d !== 0 ? d : String(a?.turno ?? "").localeCompare(String(b?.turno ?? ""))
  })
}

/* ───────────────────────────── tipos ──────────────────────────────── */
export interface ShiftSegment { value: number; color: string; label: string }
export interface ShiftBadge { label: string; value: string; color: string }
export interface ShiftTip { label: string; value: string; color?: string; strong?: boolean }

export interface ShiftBar {
  shift: string
  value: number          // valor primário em unidades do eixo
  display: string        // valor primário formatado
  color: string          // cor da barra primária
  segments?: ShiftSegment[]
  /** segunda barra comparativa (ex.: ciclo ideal ao lado do ciclo real) */
  secondary?: { value: number; color: string; label: string }
  target?: number
  targetLabel?: string
  targetDisplay?: string
  tag?: "best" | "worst" | null
  badges?: ShiftBadge[]
  tooltip: ShiftTip[]
}

export interface ShiftLegend { label: string; color: string; kind: "box" | "tick" }

export interface ShiftChartConfig {
  bars: ShiftBar[]
  axisMax: number
  primaryLabel: string
  subtitle?: string
  legend?: ShiftLegend[]
  thresholds?: number[]   // linhas de referência (mesma escala do eixo)
  emptyHint?: string
}

export type ShiftTab =
  | "oee" | "producao" | "paradas" | "refugo"
  | "retrabalho" | "ciclo" | "perdas" | "pessoas"

export interface MetricLike {
  key: string
  label: string
  unit?: string
  isPercent?: boolean
  isTime?: boolean
}

/* ───────────────────── direção (maior/menor é melhor) ───────────────── */
const LOWER_BETTER = new Set([
  "scrap", "rework", "refugo", "retrabalho",
  "taxa_refugo", "taxa_retrabalho",
  "duracao_seg", "dur_planejada_seg", "dur_nao_planejada_seg",
  "tempo_perdido_seg", "ocorrencias", "qtd_perdida",
  "desvio_seg", "ciclo_medio_seg", "ciclo_ideal_seg", "mttr_seg",
])

/** v em 0–100, maior é melhor */
function pctBand(v: number): string {
  if (!Number.isFinite(v)) return SHIFT_PAL.volume
  return v >= 70 ? SHIFT_PAL.good : v >= 55 ? SHIFT_PAL.warn : SHIFT_PAL.bad
}
/** taxa de defeito (0–100): quanto menor melhor */
function rateBand(v: number): string {
  if (!Number.isFinite(v)) return SHIFT_PAL.volume
  return v <= 2 ? SHIFT_PAL.good : v <= 5 ? SHIFT_PAL.warn : SHIFT_PAL.bad
}

/* ═══════════════════════════════════════════════════════════════════
 * BUILDER — mapeia rows (já por turno) → configuração do gráfico
 * ═══════════════════════════════════════════════════════════════════ */
export function buildShiftChart(
  tab: ShiftTab,
  rowsIn: any[],
  metric: MetricLike,
): ShiftChartConfig {
  const rows = sortByShift(rowsIn ?? [])
  const key = metric?.key ?? ""
  const isPct = !!metric?.isPercent
  const isTime = !!metric?.isTime
  const lowerBetter = LOWER_BETTER.has(key)

  const primaryLabel = `${metric?.label ?? "Valor"}${metric?.unit ? ` (${metric.unit})` : ""}`

  const secFmt = (v: unknown) => fmtSec(numOf(v))
  // ciclo usa m:ss (segundos); paradas/perdas usam h:mm (horas)
  const durFmt = tab === "ciclo" ? fmtMMSS : fmtSec
  const nFmt = (v: unknown) => fmtN(numOf(v))
  const rateFmt = (v: unknown) =>
    v == null || !Number.isFinite(Number(v)) ? "—" : fmtPct(numOf(v) * 100, 1)
  const pct0 = (v: unknown) =>
    v == null || !Number.isFinite(Number(v)) ? "—" : fmtPct(numOf(v) * 100, 0)

  const fmtPrimary = (v: number) =>
    isPct ? fmtPct(v, 1) : isTime ? durFmt(v) : fmtN(v, 0)

  // valores primários na escala do eixo
  const pv = rows.map((r) => numOf(r?.[key]) * (isPct ? 100 : 1))

  // melhor / pior (só com ≥2 turnos com valor > 0 e valores distintos)
  let best = -1, worst = -1
  const pos = rows.map((_, i) => i).filter((i) => pv[i] > 0)
  if (pos.length >= 2 && new Set(pos.map((i) => pv[i])).size > 1) {
    let hi = pos[0], lo = pos[0]
    for (const i of pos) { if (pv[i] > pv[hi]) hi = i; if (pv[i] < pv[lo]) lo = i }
    if (lowerBetter) { best = lo; worst = hi } else { best = hi; worst = lo }
  }

  const barColor = (i: number): string => {
    if (isPct && !lowerBetter) return pctBand(pv[i])
    if (i === best) return SHIFT_PAL.good
    if (i === worst) return SHIFT_PAL.bad
    return SHIFT_PAL.volume
  }

  const bars: ShiftBar[] = rows.map((r, i) => {
    const bar: ShiftBar = {
      shift: String(r?.turno ?? "—"),
      value: pv[i],
      display: fmtPrimary(pv[i]),
      color: barColor(i),
      tag: i === best ? "best" : i === worst ? "worst" : null,
      tooltip: [],
    }

    switch (tab) {
      case "oee": {
        bar.tooltip = [
          { label: "OEE", value: rateFmt(r?.oee), color: pctBand(numOf(r?.oee) * 100), strong: true },
          { label: "Disponibilidade", value: rateFmt(r?.disponibilidade) },
          { label: "Performance", value: rateFmt(r?.performance) },
          { label: "Qualidade", value: rateFmt(r?.qualidade) },
          { label: "Aprovado", value: nFmt(r?.total_good) },
          { label: "Produzido", value: nFmt(r?.total_produzido) },
        ]
        bar.badges = [
          { label: "D", value: pct0(r?.disponibilidade), color: pctBand(numOf(r?.disponibilidade) * 100) },
          { label: "P", value: pct0(r?.performance), color: pctBand(numOf(r?.performance) * 100) },
          { label: "Q", value: pct0(r?.qualidade), color: pctBand(numOf(r?.qualidade) * 100) },
        ]
        break
      }
      case "producao": {
        const good = numOf(r?.good)
        const scrap = numOf(r?.scrap)
        const rework = numOf(r?.rework)
        const cap = numOf(r?.capacidade)
        bar.tooltip = [
          { label: "Aprovado", value: nFmt(good), color: SHIFT_PAL.volume, strong: true },
          { label: "Refugo", value: nFmt(scrap), color: SHIFT_PAL.scrap },
          { label: "Retrabalho", value: nFmt(rework), color: SHIFT_PAL.rework },
          { label: "Total produzido", value: nFmt(r?.total_produzido) },
          { label: "Capacidade", value: nFmt(cap), color: SHIFT_PAL.target },
        ]
        if (key === "good" || key === "total_produzido") {
          bar.segments = [
            { value: good, color: SHIFT_PAL.volume, label: "Aprovado" },
            { value: scrap, color: SHIFT_PAL.scrap, label: "Refugo" },
            { value: rework, color: SHIFT_PAL.rework, label: "Retrabalho" },
          ]
          // marcador ▏ = capacidade (meta e FPY removidas a pedido)
          if (cap > 0) {
            bar.target = cap
            bar.targetLabel = "Capac."
            bar.targetDisplay = nFmt(cap)
          }
        }
        break
      }
      case "paradas": {
        const plan = numOf(r?.dur_planejada_seg)
        const nplan = numOf(r?.dur_nao_planejada_seg)
        bar.tooltip = [
          { label: "Duração total", value: secFmt(r?.duracao_seg), strong: true },
          { label: "Planejada", value: secFmt(plan), color: SHIFT_PAL.planned },
          { label: "Não-planejada", value: secFmt(nplan), color: SHIFT_PAL.unplanned },
          { label: "Ocorrências", value: nFmt(r?.ocorrencias) },
          { label: "Qtd. planejada", value: nFmt(r?.qtd_planejada) },
          { label: "Qtd. não-planej.", value: nFmt(r?.qtd_nao_planejada) },
        ]
        if (key === "duracao_seg") {
          bar.segments = [
            { value: plan, color: SHIFT_PAL.planned, label: "Planejada" },
            { value: nplan, color: SHIFT_PAL.unplanned, label: "Não-planejada" },
          ]
        }
        break
      }
      case "perdas": {
        const plan = numOf(r?.dur_planejada_seg)
        const nplan = numOf(r?.dur_nao_planejada_seg)
        bar.tooltip = [
          { label: "Tempo perdido", value: secFmt(r?.tempo_perdido_seg), strong: true },
          { label: "Planejada", value: secFmt(plan), color: SHIFT_PAL.planned },
          { label: "Não-planejada", value: secFmt(nplan), color: SHIFT_PAL.unplanned },
          { label: "Qtd. perdida", value: nFmt(r?.qtd_perdida) },
          { label: "Refugo", value: nFmt(r?.scrap) },
          { label: "Retrabalho", value: nFmt(r?.rework) },
        ]
        if (key === "tempo_perdido_seg") {
          bar.segments = [
            { value: plan, color: SHIFT_PAL.planned, label: "Planejada" },
            { value: nplan, color: SHIFT_PAL.unplanned, label: "Não-planejada" },
          ]
        }
        break
      }
      case "refugo": {
        bar.tooltip = [
          { label: "Refugo", value: nFmt(r?.refugo), color: SHIFT_PAL.scrap, strong: true },
          { label: "Total produzido", value: nFmt(r?.total_produzido) },
          { label: "Taxa de refugo", value: rateFmt(r?.taxa_refugo) },
        ]
        if (key === "refugo") {
          bar.badges = [
            { label: "Taxa", value: rateFmt(r?.taxa_refugo), color: rateBand(numOf(r?.taxa_refugo) * 100) },
          ]
        }
        break
      }
      case "retrabalho": {
        bar.tooltip = [
          { label: "Retrabalho", value: nFmt(r?.retrabalho), color: SHIFT_PAL.rework, strong: true },
          { label: "Total produzido", value: nFmt(r?.total_produzido) },
          { label: "Taxa de retrabalho", value: rateFmt(r?.taxa_retrabalho) },
        ]
        if (key === "retrabalho") {
          bar.badges = [
            { label: "Taxa", value: rateFmt(r?.taxa_retrabalho), color: rateBand(numOf(r?.taxa_retrabalho) * 100) },
          ]
        }
        break
      }
      case "ciclo": {
        const real = numOf(r?.ciclo_medio_seg)
        const ideal = numOf(r?.ciclo_ideal_seg)
        const desvio = numOf(r?.desvio_seg)
        const desvioTxt = `${desvio > 0 ? "+" : desvio < 0 ? "-" : ""}${durFmt(Math.abs(desvio))}`
        bar.tooltip = [
          { label: "Ciclo real", value: durFmt(real), color: SHIFT_PAL.volume, strong: true },
          { label: "Ciclo ideal", value: durFmt(ideal), color: SHIFT_PAL.target },
          { label: "Desvio", value: desvioTxt },
          { label: "Total ciclos", value: nFmt(r?.total_ciclos) },
        ]
        if (key === "ciclo_medio_seg") {
          // barra de cima = ciclo real; barra de baixo = ciclo ideal (comparação direta)
          if (ideal > 0) {
            bar.secondary = { value: ideal, color: SHIFT_PAL.target, label: "Ideal" }
            bar.targetLabel = "Ideal"
            bar.targetDisplay = durFmt(ideal)
          }
          bar.badges = [{
            label: "Desvio",
            value: desvioTxt,
            color: desvio > ideal * 0.1 ? SHIFT_PAL.bad : desvio > 0 ? SHIFT_PAL.warn : SHIFT_PAL.good,
          }]
        }
        break
      }
      case "pessoas": {
        bar.tooltip = [
          { label: "Pessoas ativas", value: nFmt(r?.pessoas_ativas), strong: true },
          { label: "Interações", value: nFmt(r?.total_interacoes) },
        ]
        break
      }
    }
    return bar
  })

  // eixo — escala pelos DADOS (valor/segmentos) + alvos legítimos (capacidade,
  // ciclo ideal) e barra secundária, para que o marcador/ideal sempre apareça.
  let axisMax = isPct ? 100 : 1
  if (!isPct) {
    let dataMax = 1
    for (const b of bars) {
      const segSum = (b.segments ?? []).reduce((a, s) => a + Math.max(0, s.value), 0)
      dataMax = Math.max(dataMax, b.value, segSum)
      if (b.secondary && b.secondary.value > 0) dataMax = Math.max(dataMax, b.secondary.value)
      if (b.target != null && b.target > 0) dataMax = Math.max(dataMax, b.target)
    }
    axisMax = dataMax * 1.1
  }

  // legenda + subtítulo por aba
  let legend: ShiftLegend[] | undefined
  let subtitle: string | undefined
  let thresholds: number[] | undefined

  switch (tab) {
    case "oee":
      subtitle = "OEE por turno — cor por faixa (verde ≥70% · âmbar 55–70% · vermelho <55%). Chips D·P·Q mostram o fator que puxa o OEE para baixo."
      legend = [
        { label: "≥70%", color: SHIFT_PAL.good, kind: "box" },
        { label: "55–70%", color: SHIFT_PAL.warn, kind: "box" },
        { label: "<55%", color: SHIFT_PAL.bad, kind: "box" },
      ]
      if (isPct && !lowerBetter) thresholds = [55, 70]
      break
    case "producao":
      subtitle = (key === "good" || key === "total_produzido")
        ? "Produzido por turno (Aprovado/Refugo/Retrabalho empilhados). Marcador ▏= capacidade."
        : "Comparação por turno. Verde = melhor turno, vermelho = pior."
      if (key === "good" || key === "total_produzido") {
        legend = [
          { label: "Aprovado", color: SHIFT_PAL.volume, kind: "box" },
          { label: "Refugo", color: SHIFT_PAL.scrap, kind: "box" },
          { label: "Retrabalho", color: SHIFT_PAL.rework, kind: "box" },
          { label: "Capacidade", color: SHIFT_PAL.target, kind: "tick" },
        ]
      }
      break
    case "paradas":
      subtitle = "Tempo parado por turno: planejada vs não-planejada. Menor é melhor — foque no âmbar (não-planejada)."
      if (key === "duracao_seg") legend = [
        { label: "Planejada", color: SHIFT_PAL.planned, kind: "box" },
        { label: "Não-planejada", color: SHIFT_PAL.unplanned, kind: "box" },
      ]
      break
    case "perdas":
      subtitle = "Tempo perdido por turno: planejada vs não-planejada. Menor é melhor."
      if (key === "tempo_perdido_seg") legend = [
        { label: "Planejada", color: SHIFT_PAL.planned, kind: "box" },
        { label: "Não-planejada", color: SHIFT_PAL.unplanned, kind: "box" },
      ]
      break
    case "refugo":
      subtitle = "Barra = quantidade de refugo; chip = taxa %. Barra curta + taxa alta = problema de taxa em baixo volume."
      break
    case "retrabalho":
      subtitle = "Barra = quantidade de retrabalho; chip = taxa %. Barra curta + taxa alta = problema de taxa em baixo volume."
      break
    case "ciclo":
      subtitle = "Ciclo real (barra de cima) vs ciclo ideal (barra de baixo) por turno. Quanto mais próximas, melhor."
      if (key === "ciclo_medio_seg") legend = [
        { label: "Ciclo real", color: SHIFT_PAL.volume, kind: "box" },
        { label: "Ciclo ideal", color: SHIFT_PAL.target, kind: "box" },
      ]
      break
    case "pessoas":
      subtitle = "Pessoas ativas por turno (interações no tooltip)."
      break
  }

  return { bars, axisMax, primaryLabel, subtitle, legend, thresholds }
}

/* ═══════════════════════════════════════════════════════════════════
 * COMPONENTE
 * ═══════════════════════════════════════════════════════════════════ */
export function ShiftChart({ config }: { config: ShiftChartConfig }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)

  const onMove = useCallback((i: number, e: React.MouseEvent) => {
    // coordenadas de viewport → tooltip com position:fixed (não é cortado pelo overflow do card)
    setHover({ i, x: e.clientX, y: e.clientY })
  }, [])

  const { bars, axisMax } = config
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / (axisMax || 1)) * 100))}%`

  if (!bars.length) {
    return (
      <div className="w-full min-h-[280px] flex items-center justify-center border border-dashed border-zinc-200 dark:border-white/[0.08] bg-zinc-50/50 dark:bg-white/[0.015]">
        <div className="text-center text-zinc-400 dark:text-white/25">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-bold text-zinc-500 dark:text-white/40">Sem dados para o período</p>
          <p className="text-xs mt-1 text-zinc-400 dark:text-white/25">
            {config.emptyHint ?? "Ajuste os filtros ou o intervalo de datas"}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full px-2 sm:px-3 py-3">
      {/* Cabeçalho: métrica + legenda */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/45">
            {config.primaryLabel}
          </div>
          {config.subtitle && (
            <p className="text-[11px] text-zinc-400 dark:text-white/28 mt-0.5 max-w-2xl leading-snug">
              {config.subtitle}
            </p>
          )}
        </div>
        {config.legend && config.legend.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {config.legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 dark:text-white/40">
                {l.kind === "tick" ? (
                  <span className="w-[3px] h-3.5" style={{ background: l.color }} />
                ) : (
                  <span className="w-2.5 h-2.5" style={{ background: fillFor(l.color) }} />
                )}
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Barras por turno */}
      <div className="mt-3 space-y-1.5">
        {bars.map((b, i) => {
          const segs = b.segments && b.segments.length
            ? b.segments
            : [{ value: b.value, color: b.color, label: config.primaryLabel }]
          const hasSecondary = !!b.secondary && b.secondary.value > 0
          let acc = 0
          return (
            <div
              key={`${b.shift}-${i}`}
              className="flex items-center gap-2 sm:gap-3 py-1.5 group"
              onMouseMove={(e) => onMove(i, e)}
              onMouseEnter={(e) => onMove(i, e)}
              onMouseLeave={() => setHover(null)}
            >
              {/* rótulo do turno + tag melhor/pior */}
              <div className="w-16 sm:w-24 shrink-0 text-right pr-1">
                <div className="text-[12px] sm:text-[13px] font-bold text-zinc-700 dark:text-white/70 truncate">
                  {b.shift}
                </div>
                {b.tag && (
                  <div
                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] mt-0.5"
                    style={{ color: b.tag === "best" ? SHIFT_PAL.good : SHIFT_PAL.bad }}
                  >
                    {b.tag === "best" ? "▲ melhor" : "▼ pior"}
                  </div>
                )}
              </div>

              {/* trilho + barra */}
              <div className="relative flex-1 h-9 sm:h-10">
                <div className="absolute inset-0 bg-zinc-100 dark:bg-white/[0.045]" />
                {/* linhas de referência (ex.: OEE 55% / 70%) */}
                {config.thresholds?.map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 bottom-0 w-px bg-zinc-300/70 dark:bg-white/15"
                    style={{ left: pct(t) }}
                    title={`${t}%`}
                  />
                ))}
                {/* segmentos (empilhado) ou barra única.
                    Com barra secundária (ciclo ideal), a primária ocupa a
                    metade de cima e a secundária a metade de baixo. */}
                {segs.map((s, si) => {
                  const left = pct(acc)
                  const width = pct(s.value)
                  acc += Math.max(0, s.value)
                  if (s.value <= 0) return null
                  return (
                    <div
                      key={si}
                      className="absolute transition-[width] duration-300"
                      style={{
                        left,
                        width,
                        top: hasSecondary ? 3 : 4,
                        height: hasSecondary ? "calc(50% - 4px)" : "calc(100% - 8px)",
                        background: fillFor(s.color),
                      }}
                    />
                  )
                })}
                {/* barra secundária (ex.: ciclo ideal) */}
                {hasSecondary && (
                  <div
                    className="absolute transition-[width] duration-300"
                    style={{
                      left: 0,
                      width: pct(b.secondary!.value),
                      bottom: 3,
                      height: "calc(50% - 4px)",
                      background: fillFor(b.secondary!.color),
                    }}
                    title={`${b.secondary!.label} ${b.targetDisplay ?? ""}`}
                  />
                )}
                {/* marcador de meta/ideal — só quando cabe na escala (evita meta absurda) */}
                {b.target != null && b.target > 0 && b.target <= axisMax && (
                  <div
                    className="absolute -top-1 -bottom-1 w-[2px] z-10"
                    style={{ left: pct(b.target), background: SHIFT_PAL.target }}
                    title={`${b.targetLabel ?? "Meta"} ${b.targetDisplay ?? ""}`}
                  >
                    <span
                      className="absolute -top-[3px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rotate-45"
                      style={{ background: SHIFT_PAL.target }}
                    />
                  </div>
                )}
              </div>

              {/* valor primário + chips */}
              <div className="w-[92px] sm:w-32 shrink-0 text-right">
                <div className="text-[13px] sm:text-[15px] font-black tabular-nums leading-none" style={{ color: b.color }}>
                  {b.display}
                </div>
                {b.targetDisplay && (
                  <div className="text-[9px] text-zinc-400 dark:text-white/28 mt-0.5 tabular-nums">
                    {b.targetLabel} {b.targetDisplay}
                  </div>
                )}
                {b.badges && b.badges.length > 0 && (
                  <div className="flex items-center justify-end gap-1 mt-1 flex-wrap">
                    {b.badges.map((bd) => (
                      <span
                        key={bd.label}
                        className="inline-flex items-center gap-0.5 px-1 py-px text-[9px] font-bold tabular-nums"
                        style={{ background: `${bd.color}1a`, color: bd.color }}
                        title={`${bd.label}: ${bd.value}`}
                      >
                        <span className="opacity-70">{bd.label}</span>{bd.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* tooltip */}
      {hover && bars[hover.i] && (
        <div
          className="fixed pointer-events-none z-[100] border border-zinc-200 shadow-2xl overflow-hidden"
          style={{
            left: Math.max(8, Math.min(hover.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1280) - 232)),
            top: hover.y - 14,
            transform: hover.y > 220 ? "translateY(-100%)" : "translateY(18px)",
            minWidth: 200,
            background: "rgba(255,255,255,0.98)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div className="px-3 py-2 border-b border-zinc-100 bg-zinc-50">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              {bars[hover.i].shift}
            </span>
          </div>
          <div className="px-3 py-2 space-y-1">
            {bars[hover.i].tooltip.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  {t.color && <span className="w-2 h-2 flex-shrink-0" style={{ background: t.color }} />}
                  {t.label}
                </span>
                <span
                  className={`text-[12px] tabular-nums ${t.strong ? "font-black text-zinc-900" : "font-bold text-zinc-700"}`}
                  style={t.strong && t.color ? { color: t.color } : undefined}
                >
                  {t.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

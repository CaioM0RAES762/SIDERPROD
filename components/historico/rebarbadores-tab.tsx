"use client"

/**
 * ============================================================
 * ABA REBARBADORES — /historico
 *
 * Área analítica de desempenho dos rebarbadores por período,
 * turno, setor, centro de trabalho, produto e ordem/corrida.
 *
 * Fonte: /api/db/historico?mode=rebarbadores
 *  - grão: atuação (corrida × rebarbador) — mes.corridas.rebarbador_id
 *  - tendência diária: dia operacional 06h→06h
 *
 * Blocos: KPIs · Ranking (barras horizontais duplas) ·
 * Detalhe + tendência do selecionado · Scatter Eficiência × Parada ·
 * Tabela detalhada de atuações.
 * ============================================================
 */

import React, { useMemo, useState, useCallback, useRef } from "react"
import {
  Users,
  AlertTriangle,
  AlertCircle,
  Search,
  X,
  Copy,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Trophy,
  Clock,
  Activity,
  Target,
  Package,
  CalendarDays,
  Filter,
  BarChart3,
} from "lucide-react"
import {
  useHistoricoRebarbadores,
  type RebarbadorAtuacao,
  type RebarbadorTendenciaDia,
  type RebarbadorParada,
} from "@/hooks/historico/use-api"

/* ─────────────────────────────────────────────────────────────
 * FORMATADORES
 * ───────────────────────────────────────────────────────────── */
function fmtInt(v: number) {
  return Number.isFinite(v) ? Math.round(v).toLocaleString("pt-BR") : "0"
}

function fmtPcsH(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: v < 10 ? 1 : 0 })}`
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}

function secondsToHHmm(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function secondsToHHmmss(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

/** pçs/h BRUTO da atuação = good ÷ duração total (span, INCLUINDO paradas).
 *  Calculado no front (mesma base do ranking) para a tabela bater sempre com
 *  o ranking, mesmo que o valor a.pcs_h do backend esteja defasado/em cache. */
function atuacaoPcsH(a: RebarbadorAtuacao): number | null {
  const dur = a.dur_atuacao_seg
  return dur > 0 && a.good > 0 ? a.good / (dur / 3600) : (a.good > 0 ? null : (dur > 0 ? 0 : null))
}
/** aderência coerente com o pçs/h bruto: pçs/h ÷ meta (3600/ciclo_ideal). */
function atuacaoAderencia(a: RebarbadorAtuacao): number | null {
  const p = atuacaoPcsH(a)
  return a.meta_pcs_h != null && a.meta_pcs_h > 0 && p != null ? p / a.meta_pcs_h : null
}

function fmtMin(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "—"
  const min = seconds / 60
  if (min < 60) return `${min.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} min`
  return `${secondsToHHmm(seconds)} h`
}

/** "2026-06-26T13:00:00.000" (UTC sem Z) → "26/06 10:00" BRT */
function fmtUtcLocal(iso: string | null | undefined): string {
  if (!iso) return "—"
  const withZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(withZ)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

/** "2026-06-26T13:00:00.000" (UTC sem Z) → { date: "26/06", time: "10:00" } BRT */
function toBRTParts(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null
  const withZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(withZ)
  if (Number.isNaN(d.getTime())) return null
  return {
    date: d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }),
    time: d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
  }
}

/** dia operacional (YYYY-MM-DD) da atuação: inicio_utc − 6h */
function opDayOf(iso: string | null): string {
  if (!iso) return ""
  const withZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`
  const t = new Date(withZ).getTime()
  if (!Number.isFinite(t)) return ""
  return new Date(t - 6 * 3600_000).toISOString().slice(0, 10)
}

function fmtDiaBR(yyyymmdd: string) {
  if (!yyyymmdd || yyyymmdd.length < 10) return yyyymmdd
  return `${yyyymmdd.slice(8, 10)}/${yyyymmdd.slice(5, 7)}`
}

function csvEscape(v: any) {
  const s = String(v ?? "")
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/* ─────────────────────────────────────────────────────────────
 * AGREGAÇÃO (atuações → grupos)
 * ───────────────────────────────────────────────────────────── */
export type AgruparPor = "rebarbador" | "turno" | "ct" | "produto" | "ordem" | "dia"

interface AggRow {
  key:          string
  label:        string
  sub:          string
  rebarbadorId: string | null
  atuacoes:     number
  good:         number
  scrap:        number
  rework:       number
  total:        number
  dur:          number
  parada:       number
  paradaNplan:  number
  produzindo:   number
  qtdParadas:   number
  /** peças esperadas pelo ciclo ideal no tempo produzindo (só onde há ciclo) */
  esperado:     number
  temMeta:      boolean
  cts:          Set<string>
  turnos:       Set<string>
  ultimaAtuacao: string | null
  pcsH:         number | null
  aderencia:    number | null
  qualidade:    number | null
  paradaMedia:  number | null
}

function groupKeyOf(a: RebarbadorAtuacao, por: AgruparPor): { key: string; label: string; sub: string } {
  switch (por) {
    case "turno":
      return { key: a.turno_nome ?? "—", label: a.turno_nome ?? "Sem turno", sub: "" }
    case "ct":
      return { key: a.centro_trabalho_id, label: a.ct_codigo ?? a.ct_nome ?? "—", sub: a.ct_nome ?? "" }
    case "produto":
      return { key: a.produto_id ?? "—", label: a.produto_codigo ?? "Sem produto", sub: a.produto_descricao ?? "" }
    case "ordem":
      return { key: a.ordem_id ?? a.corrida_id, label: a.ordem_codigo ?? "Sem ordem", sub: a.produto_descricao ?? "" }
    case "dia": {
      const d = opDayOf(a.inicio_utc)
      return { key: d || "—", label: d ? fmtDiaBR(d) : "Sem data", sub: "dia operacional" }
    }
    default:
      return { key: a.rebarbador_id, label: a.rebarbador_nome, sub: a.registro ? `Reg. ${a.registro}` : (a.cargo ?? "") }
  }
}

function aggregate(atuacoes: RebarbadorAtuacao[], por: AgruparPor): AggRow[] {
  const map = new Map<string, AggRow>()
  for (const a of atuacoes) {
    const { key, label, sub } = groupKeyOf(a, por)
    let g = map.get(key)
    if (!g) {
      g = {
        key, label, sub,
        rebarbadorId: por === "rebarbador" ? a.rebarbador_id : null,
        atuacoes: 0, good: 0, scrap: 0, rework: 0, total: 0,
        dur: 0, parada: 0, paradaNplan: 0, produzindo: 0, qtdParadas: 0,
        esperado: 0, temMeta: false,
        cts: new Set(), turnos: new Set(),
        ultimaAtuacao: null,
        pcsH: null, aderencia: null, qualidade: null, paradaMedia: null,
      }
      map.set(key, g)
    }
    g.atuacoes    += 1
    g.good        += a.good
    g.scrap       += a.scrap
    g.rework      += a.rework
    g.total       += a.total
    g.dur         += a.dur_atuacao_seg
    g.parada      += a.parada_seg
    g.paradaNplan += a.parada_nplan_seg
    g.produzindo  += a.tempo_produzindo_seg
    g.qtdParadas  += a.qtd_paradas
    if (a.ciclo_ideal_seg && a.ciclo_ideal_seg > 0) {
      // esperado sobre a DURAÇÃO TOTAL da atuação — coerente com o pçs/h bruto,
      // então aderência = good/esperado = pçs/h ÷ meta pçs/h.
      g.esperado += a.dur_atuacao_seg / a.ciclo_ideal_seg
      g.temMeta = true
    }
    if (a.ct_codigo) g.cts.add(a.ct_codigo)
    if (a.turno_nome) g.turnos.add(a.turno_nome)
    const ini = a.inicio_utc ?? ""
    if (ini && (!g.ultimaAtuacao || ini > g.ultimaAtuacao)) g.ultimaAtuacao = ini
  }

  const rows = Array.from(map.values())
  for (const g of rows) {
    // pçs/h bruto = good ÷ duração total de atuação (span, INCLUINDO paradas)
    const baseSeg = g.dur
    g.pcsH        = baseSeg > 0 ? g.good / (baseSeg / 3600) : null
    g.aderencia   = g.temMeta && g.esperado > 0 ? g.good / g.esperado : null
    g.qualidade   = g.total > 0 ? g.good / g.total : null
    g.paradaMedia = g.atuacoes > 0 ? g.parada / g.atuacoes : null
  }
  return rows
}

/* ─────────────────────────────────────────────────────────────
 * SUB-COMPONENTES BÁSICOS (mesmo padrão visual do Histórico)
 * ───────────────────────────────────────────────────────────── */
const CARD = "border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02]"
const LABEL = "text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30"
const SELECT_CLS = "w-full px-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none transition-colors"

function KpiBox({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: React.ElementType
}) {
  return (
    <div className={`${CARD} px-3.5 py-3 flex flex-col gap-0.5 min-w-0`}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3 flex-shrink-0" style={{ color: color ?? "#a1a1aa" }} />}
        <span className={`${LABEL} truncate`}>{label}</span>
      </div>
      <span className="text-xl font-black tabular-nums leading-tight truncate text-zinc-800 dark:text-white/90" style={color ? { color } : undefined}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-zinc-400 dark:text-white/28 truncate">{sub}</span>}
    </div>
  )
}

function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="h-full min-h-[180px] flex flex-col items-center justify-center gap-2 py-10">
      <Users className="w-6 h-6 text-zinc-300 dark:text-white/15" />
      <div className="text-sm font-bold text-zinc-400 dark:text-white/30">{title}</div>
      {sub && <div className="text-xs text-zinc-400 dark:text-white/22 max-w-md text-center">{sub}</div>}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * RANKING — barras horizontais duplas (parada ← | → pçs/h)
 * ───────────────────────────────────────────────────────────── */
type RankMetric = "pcs_h" | "good" | "parada" | "aderencia" | "qualidade"

const RANK_METRICS: Array<{ id: RankMetric; label: string }> = [
  { id: "pcs_h",     label: "Peças/hora" },
  { id: "good",      label: "Produção total" },
  { id: "parada",    label: "Tempo parado" },
  { id: "aderencia", label: "Aderência" },
  { id: "qualidade", label: "Qualidade" },
]

function metricValue(g: AggRow, m: RankMetric): number | null {
  switch (m) {
    case "good":      return g.good
    case "parada":    return g.parada
    case "aderencia": return g.aderencia
    case "qualidade": return g.qualidade
    default:          return g.pcsH
  }
}

function metricDisplay(g: AggRow, m: RankMetric): string {
  switch (m) {
    case "good":      return `${fmtInt(g.good)} pçs`
    case "parada":    return fmtMin(g.parada)
    case "aderencia": return fmtPct(g.aderencia)
    case "qualidade": return fmtPct(g.qualidade)
    default:          return g.pcsH == null ? "—" : `${fmtPcsH(g.pcsH)} pçs/h`
  }
}

/* Paletas monocromáticas em degradê — um único tom por lado, intensidade
 * cresce em direção à ponta da barra (longe do centro = valor maior). */
const GRADIENT_PARADA = "linear-gradient(90deg, #fda4af 0%, #f43f5e 50%, #9f1239 100%)"
const GRADIENT_PARADA_REV = "linear-gradient(270deg, #fda4af 0%, #f43f5e 50%, #9f1239 100%)"
const GRADIENT_METRIC = "linear-gradient(90deg, #fdba74 0%, #f97316 50%, #9a3412 100%)"

function RankingChart({ rows, metric, selectedId, onSelect, agruparPor }: {
  rows: AggRow[]
  metric: RankMetric
  selectedId: string | null
  onSelect: (rebarbadorId: string | null) => void
  agruparPor: AgruparPor
}) {
  const [showAll, setShowAll] = useState(false)
  const TOP_N = 12
  // quando a métrica já É tempo parado, a barra esquerda ficaria duplicada
  // com a direita — mostramos só uma barra (evita redundância/confusão)
  const singleBar = metric === "parada"

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const va = metricValue(a, metric)
      const vb = metricValue(b, metric)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      // parada: pior = maior → ranking decrescente também (quem mais parou no topo)
      return vb - va
    })
    return arr
  }, [rows, metric])

  const visible = showAll ? sorted : sorted.slice(0, TOP_N)
  const maxRight = Math.max(1e-9, ...sorted.map((g) => Math.abs(metricValue(g, metric) ?? 0)))
  const maxParada = Math.max(1e-9, ...sorted.map((g) => g.parada))

  // melhor/pior pelo critério (ignora nulls) — usado só para o ícone, não para a cor da barra
  const valids = sorted.filter((g) => metricValue(g, metric) != null)
  const bestKey  = metric === "parada" ? valids[valids.length - 1]?.key : valids[0]?.key
  const worstKey = metric === "parada" ? valids[0]?.key : valids[valids.length - 1]?.key

  const gridCols = singleBar
    ? "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:grid-cols-[minmax(120px,0.9fr)_minmax(340px,2.8fr)]"
    : "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:grid-cols-[minmax(120px,0.9fr)_minmax(160px,1.4fr)_minmax(160px,1.4fr)]"

  if (!rows.length) return <EmptyState title="Sem atuações no período" sub="Ajuste o período ou os filtros." />

  return (
    <div>
      {/* cabeçalho das colunas */}
      <div className={`grid ${gridCols} gap-x-3 px-4 pt-3 pb-1`}>
        <span className={LABEL}>{agruparPor === "rebarbador" ? "Rebarbador" : "Grupo"}</span>
        {!singleBar && <span className={`${LABEL} hidden sm:block text-right`}>← Tempo parado</span>}
        <span className={`${LABEL} text-right sm:text-left`}>{RANK_METRICS.find((m) => m.id === metric)?.label} →</span>
      </div>

      <div className="px-4 pb-3 space-y-1">
        {visible.map((g) => {
          const v = metricValue(g, metric)
          const wRight = v == null ? 0 : Math.max(2, (Math.abs(v) / maxRight) * 100)
          const wLeft = Math.max(g.parada > 0 ? 2 : 0, (g.parada / maxParada) * 100)
          const isSel = g.rebarbadorId != null && g.rebarbadorId === selectedId
          const isBest = g.key === bestKey && valids.length > 1
          const isWorst = g.key === worstKey && valids.length > 1
          const clickable = g.rebarbadorId != null
          return (
            <button
              key={g.key}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect(isSel ? null : g.rebarbadorId)}
              className={`w-full grid ${gridCols} gap-x-3 items-center py-1.5 px-1.5 -mx-1.5 text-left transition-colors ${
                isSel
                  ? "bg-orange-50 dark:bg-orange-500/[0.08] outline outline-1 outline-orange-300 dark:outline-orange-500/30"
                  : clickable ? "hover:bg-zinc-50 dark:hover:bg-white/[0.03]" : ""
              }`}
              title={clickable ? "Clique para detalhar" : undefined}
            >
              {/* identificação */}
              <span className="min-w-0 flex items-center gap-1.5">
                {isBest && <Trophy className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
                {isWorst && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold text-zinc-700 dark:text-white/75 truncate leading-tight">{g.label}</span>
                  <span className="block text-[10px] text-zinc-400 dark:text-white/25 truncate leading-tight tabular-nums">
                    {[
                      g.cts.size ? Array.from(g.cts).slice(0, 2).join(", ") : null,
                      g.turnos.size ? Array.from(g.turnos).slice(0, 2).join("/") : null,
                      `${g.atuacoes} atu.`,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </span>

              {/* barra esquerda: tempo parado (omitida quando a métrica já é tempo parado) */}
              {!singleBar && (
                <span className="hidden sm:flex items-center justify-end gap-2 min-w-0">
                  <span className="text-[11px] font-black tabular-nums text-zinc-700 dark:text-white/70 flex-shrink-0">{fmtMin(g.parada)}</span>
                  <span className="h-4 bg-zinc-100 dark:bg-white/[0.04] flex-1 min-w-0 flex justify-end">
                    <span
                      className="h-full"
                      style={{ width: `${wLeft}%`, background: GRADIENT_PARADA_REV }}
                    />
                  </span>
                </span>
              )}

              {/* barra direita: métrica do ranking (ou tempo parado, se singleBar) */}
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-4 bg-zinc-100 dark:bg-white/[0.04] flex-1 min-w-0">
                  <span
                    className="block h-full"
                    style={{
                      width: `${wRight}%`,
                      background: singleBar ? GRADIENT_PARADA : GRADIENT_METRIC,
                      opacity: isSel ? 1 : 0.92,
                    }}
                  />
                </span>
                <span className="text-[11px] font-black tabular-nums text-zinc-700 dark:text-white/75 flex-shrink-0 w-[74px] text-right">
                  {metricDisplay(g, metric)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {sorted.length > TOP_N && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="h-7 px-3 border border-zinc-200 dark:border-white/[0.08] text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {showAll ? "Mostrar top 12" : `Mostrar todos (${sorted.length})`}
          </button>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * TENDÊNCIA — linha diária de pçs/h do rebarbador selecionado
 * ───────────────────────────────────────────────────────────── */
function TrendChart({ dias, meta }: { dias: RebarbadorTendenciaDia[]; meta: number | null }) {
  const [hover, setHover] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)

  const W = 640, H = 190, PAD_L = 42, PAD_R = 12, PAD_T = 12, PAD_B = 26
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const pts = dias.filter((d) => d.pcs_h != null)
  const values = pts.map((d) => d.pcs_h as number)
  const maxY = Math.max(1e-9, ...values, meta ?? 0) * 1.15

  const x = (i: number) => PAD_L + (dias.length <= 1 ? plotW / 2 : (i / (dias.length - 1)) * plotW)
  const y = (v: number) => PAD_T + plotH - (v / maxY) * plotH

  if (!dias.length) {
    return <EmptyState title="Sem tendência diária" sub="Este rebarbador não tem produção registrada no período." />
  }
  if (!values.length) {
    return <EmptyState title="Sem produção registrada nestes dias" sub="Houve paradas no período, mas nenhuma peça boa contabilizada para calcular peças/hora." />
  }

  const linePath = dias
    .map((d, i) => (d.pcs_h == null ? null : `${x(i)},${y(d.pcs_h)}`))
    .reduce<{ path: string; pen: boolean }>(
      (acc, p) => {
        if (p == null) return { ...acc, pen: false }
        return { path: `${acc.path}${acc.pen ? " L" : " M"}${p}`, pen: true }
      },
      { path: "", pen: false }
    ).path

  // áreas preenchidas em degradê sob cada segmento contínuo da linha
  const baseline = PAD_T + plotH
  const areaSegments: string[] = []
  let seg: string[] = []
  const flushSeg = () => {
    if (seg.length > 1) {
      const first = seg[0].split(",")
      const last = seg[seg.length - 1].split(",")
      areaSegments.push(`M${seg.join(" L")} L${last[0]},${baseline} L${first[0]},${baseline} Z`)
    }
    seg = []
  }
  dias.forEach((d, i) => {
    if (d.pcs_h == null) { flushSeg(); return }
    seg.push(`${x(i)},${y(d.pcs_h)}`)
  })
  flushSeg()

  const onMove = (e: React.MouseEvent) => {
    const svg = ref.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const idx = dias.length <= 1
      ? 0
      : Math.round(((px - PAD_L) / plotW) * (dias.length - 1))
    setHover(Math.max(0, Math.min(dias.length - 1, idx)))
  }

  const hoverD = hover != null ? dias[hover] : null

  // ticks de Y (4)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxY * f)

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[190px]"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trendAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* grid + eixo Y */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-zinc-200 dark:text-white/[0.06]" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={9} className="fill-zinc-400 dark:fill-white/25 tabular-nums">
              {t >= 100 ? Math.round(t) : t.toFixed(t < 10 ? 1 : 0)}
            </text>
          </g>
        ))}

        {/* meta */}
        {meta != null && meta > 0 && (
          <g>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(meta)} y2={y(meta)} stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={W - PAD_R} y={y(meta) - 4} textAnchor="end" fontSize={9} fill="#22c55e" fontWeight={700}>
              META {fmtPcsH(meta)}
            </text>
          </g>
        )}

        {/* área em degradê sob a linha */}
        {areaSegments.map((d, i) => (
          <path key={i} d={d} fill="url(#trendAreaGradient)" stroke="none" />
        ))}

        {/* linha pçs/h */}
        {linePath && <path d={linePath} fill="none" stroke="#f97316" strokeWidth={2} />}

        {/* pontos + labels X */}
        {dias.map((d, i) => (
          <g key={d.dia}>
            {d.pcs_h != null && (
              <circle
                cx={x(i)} cy={y(d.pcs_h)}
                r={hover === i ? 4 : 2.5}
                fill={hover === i ? "#ea580c" : "#f97316"}
              />
            )}
            {(dias.length <= 14 || i % Math.ceil(dias.length / 14) === 0) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} className="fill-zinc-400 dark:fill-white/25 tabular-nums">
                {fmtDiaBR(d.dia)}
              </text>
            )}
          </g>
        ))}

        {/* cursor */}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-300 dark:text-white/15" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>

      {/* tooltip */}
      {hoverD && (
        <div
          className="absolute top-2 pointer-events-none border border-zinc-200 dark:border-white/[0.1] bg-white dark:bg-[#16181f] px-3 py-2 shadow-sm text-[11px] z-10"
          style={{ left: `${(x(dias.indexOf(hoverD)) / W) * 100}%`, transform: dias.indexOf(hoverD) > dias.length / 2 ? "translateX(-105%)" : "translateX(8px)" }}
        >
          <div className="font-black text-zinc-700 dark:text-white/80 tabular-nums mb-0.5">{fmtDiaBR(hoverD.dia)}</div>
          <div className="space-y-0.5 tabular-nums text-zinc-500 dark:text-white/45">
            <div>Peças/h: <b className="text-orange-500">{fmtPcsH(hoverD.pcs_h)}</b></div>
            <div>Aprovado: <b>{fmtInt(hoverD.good)}</b> · Total: <b>{fmtInt(hoverD.total)}</b></div>
            <div>Horas ativas: <b>{fmtInt(hoverD.horas_ativas)}h</b></div>
            <div>Parada: <b>{fmtMin(hoverD.parada_seg)}</b> ({fmtInt(hoverD.qtd_paradas)}×)</div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * SCATTER — Eficiência (pçs/h) × Parada média (min) por rebarbador
 * ───────────────────────────────────────────────────────────── */
function ScatterChart({ rows, selectedId, onSelect }: {
  rows: AggRow[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [hover, setHover] = useState<string | null>(null)

  const pts = rows.filter((g) => g.pcsH != null && g.rebarbadorId != null)
  const W = 900, H = 300, PAD_L = 52, PAD_R = 16, PAD_T = 18, PAD_B = 34
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  if (pts.length < 2) {
    return <EmptyState title="Dados insuficientes para dispersão" sub="É preciso pelo menos 2 rebarbadores com produção no período." />
  }

  const xs = pts.map((g) => g.pcsH as number)
  const ys = pts.map((g) => (g.paradaMedia ?? 0) / 60) // min
  const maxX = Math.max(...xs) * 1.12 || 1
  const maxY = Math.max(...ys, 1) * 1.15

  // linhas de referência: mediana de cada eixo (divisão dos quadrantes)
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }
  const refX = median(xs)
  const refY = median(ys)

  const x = (v: number) => PAD_L + (v / maxX) * plotW
  const y = (v: number) => PAD_T + plotH - (v / maxY) * plotH

  const hoverG = hover ? pts.find((g) => g.key === hover) : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full aspect-[900/300]" onMouseLeave={() => setHover(null)}>
        {/* fundo dos quadrantes (bem sutil)
         * eixo Y cresce para CIMA (mais parada no topo), então:
         *  topo-direita    = pçs/h alto  + parada alta  → ATENÇÃO (produz bem, mas para muito)
         *  topo-esquerda   = pçs/h baixo + parada alta  → CRÍTICO (pior combinação)
         *  base-direita    = pçs/h alto  + parada baixa → ALTO DESEMPENHO (melhor combinação)
         *  base-esquerda   = pçs/h baixo + parada baixa → POTENCIAL (não para, mas também não produz) */}
        <rect x={x(refX)} y={y(refY)} width={PAD_L + plotW - x(refX)} height={PAD_T + plotH - y(refY)} fill="#22c55e" opacity={0.06} />
        <rect x={x(refX)} y={PAD_T} width={PAD_L + plotW - x(refX)} height={y(refY) - PAD_T} fill="#f59e0b" opacity={0.05} />
        <rect x={PAD_L} y={PAD_T} width={x(refX) - PAD_L} height={y(refY) - PAD_T} fill="#ef4444" opacity={0.06} />
        <rect x={PAD_L} y={y(refY)} width={x(refX) - PAD_L} height={PAD_T + plotH - y(refY)} fill="#64748b" opacity={0.04} />

        {/* labels dos quadrantes */}
        <text x={W - PAD_R - 4} y={PAD_T + 12} textAnchor="end" fontSize={9} fill="#d97706" fontWeight={800} letterSpacing="0.08em">ATENÇÃO</text>
        <text x={W - PAD_R - 4} y={PAD_T + plotH - 6} textAnchor="end" fontSize={9} fill="#16a34a" fontWeight={800} letterSpacing="0.08em">ALTO DESEMPENHO</text>
        <text x={PAD_L + 4} y={PAD_T + 12} textAnchor="start" fontSize={9} fill="#dc2626" fontWeight={800} letterSpacing="0.08em">CRÍTICO</text>
        <text x={PAD_L + 4} y={PAD_T + plotH - 6} textAnchor="start" fontSize={9} fill="#64748b" fontWeight={800} letterSpacing="0.08em">POTENCIAL</text>

        {/* eixos */}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-300 dark:text-white/15" />
        <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-300 dark:text-white/15" />

        {/* linhas de referência (mediana) */}
        <line x1={x(refX)} x2={x(refX)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-300 dark:text-white/15" strokeDasharray="4 4" />
        <line x1={PAD_L} x2={W - PAD_R} y1={y(refY)} y2={y(refY)} stroke="currentColor" className="text-zinc-300 dark:text-white/15" strokeDasharray="4 4" />

        {/* ticks */}
        {[0, 0.5, 1].map((f) => (
          <text key={`tx${f}`} x={x(maxX * f)} y={H - 14} textAnchor="middle" fontSize={9} className="fill-zinc-400 dark:fill-white/25 tabular-nums">
            {(maxX * f).toFixed(0)}
          </text>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={`ty${f}`} x={PAD_L - 6} y={y(maxY * f) + 3} textAnchor="end" fontSize={9} className="fill-zinc-400 dark:fill-white/25 tabular-nums">
            {(maxY * f).toFixed(0)}
          </text>
        ))}
        <text x={PAD_L + plotW / 2} y={H - 2} textAnchor="middle" fontSize={9} className="fill-zinc-400 dark:fill-white/30" fontWeight={700} letterSpacing="0.1em">PEÇAS/HORA →</text>
        <text x={12} y={PAD_T + plotH / 2} textAnchor="middle" fontSize={9} className="fill-zinc-400 dark:fill-white/30" fontWeight={700} letterSpacing="0.1em" transform={`rotate(-90 12 ${PAD_T + plotH / 2})`}>PARADA MÉDIA (MIN) →</text>

        {/* pontos */}
        {pts.map((g) => {
          const px = x(g.pcsH as number)
          const py = y((g.paradaMedia ?? 0) / 60)
          const isSel = g.rebarbadorId === selectedId
          const isHov = hover === g.key
          return (
            <g key={g.key} className="cursor-pointer" onMouseEnter={() => setHover(g.key)} onClick={() => onSelect(isSel ? null : g.rebarbadorId)}>
              <circle cx={px} cy={py} r={isSel || isHov ? 7 : 5} fill={isSel ? "#f97316" : "#71717a"} opacity={isSel ? 1 : isHov ? 0.9 : 0.65} stroke={isSel ? "#ea580c" : "none"} strokeWidth={2} />
              {(isSel || isHov || pts.length <= 8) && (
                <text x={px} y={py - 9} textAnchor="middle" fontSize={9} fontWeight={700} className="fill-zinc-600 dark:fill-white/60">
                  {g.label.split(" ")[0]}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {hoverG && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-none border border-zinc-200 dark:border-white/[0.1] bg-white dark:bg-[#16181f] px-3 py-2 shadow-sm text-[11px] z-10 whitespace-nowrap">
          <div className="font-black text-zinc-700 dark:text-white/80 mb-0.5">{hoverG.label}</div>
          <div className="space-y-0.5 tabular-nums text-zinc-500 dark:text-white/45">
            <div>Peças/h: <b className="text-orange-500">{fmtPcsH(hoverG.pcsH)}</b> · Parada média: <b>{fmtMin(hoverG.paradaMedia)}</b></div>
            <div>Produção: <b>{fmtInt(hoverG.good)}</b> · Qualidade: <b>{fmtPct(hoverG.qualidade)}</b> · Aderência: <b>{fmtPct(hoverG.aderencia)}</b></div>
            <div>{Array.from(hoverG.cts).join(", ") || "—"} · {Array.from(hoverG.turnos).join("/") || "—"}</div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * TABELA DETALHADA DE ATUAÇÕES
 * ───────────────────────────────────────────────────────────── */
type SortCol =
  | "rebarbador" | "ct" | "turno" | "produto" | "ordem" | "inicio"
  | "good" | "scrap" | "rework" | "total" | "pcs_h" | "produzindo"
  | "parada" | "qtd_paradas" | "aderencia" | "qualidade"

function sortValue(a: RebarbadorAtuacao, col: SortCol): string | number {
  switch (col) {
    case "rebarbador":  return a.rebarbador_nome.toLowerCase()
    case "ct":          return (a.ct_codigo ?? "").toLowerCase()
    case "turno":       return (a.turno_nome ?? "").toLowerCase()
    case "produto":     return (a.produto_codigo ?? "").toLowerCase()
    case "ordem":       return (a.ordem_codigo ?? "").toLowerCase()
    case "inicio":      return a.inicio_utc ?? ""
    case "good":        return a.good
    case "scrap":       return a.scrap
    case "rework":      return a.rework
    case "total":       return a.total
    case "pcs_h":       return atuacaoPcsH(a) ?? -1
    case "produzindo":  return a.tempo_produzindo_seg
    case "parada":      return a.parada_seg
    case "qtd_paradas": return a.qtd_paradas
    case "aderencia":   return atuacaoAderencia(a) ?? -1
    case "qualidade":   return a.qualidade ?? -1
  }
}

function AtuacoesTable({ atuacoes, selectedId, onSelect }: {
  atuacoes: RebarbadorAtuacao[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [search, setSearch] = useState("")
  const [sortCol, setSortCol] = useState<SortCol>("inicio")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return atuacoes
    return atuacoes.filter((a) =>
      [a.rebarbador_nome, a.registro, a.ct_codigo, a.ct_nome, a.ordem_codigo, a.produto_codigo, a.produto_descricao, a.turno_nome]
        .some((v) => v && String(v).toLowerCase().includes(s))
    )
  }, [atuacoes, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = sortValue(a, sortCol)
      const vb = sortValue(b, sortCol)
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb))
      return sortDir === "asc" ? cmp : -cmp
    })
    return arr
  }, [filtered, sortCol, sortDir])

  // limites para destaque discreto (melhor/pior pçs/h entre linhas com valor)
  const pcsVals = sorted.map((a) => atuacaoPcsH(a)).filter((v): v is number => v != null && v > 0)
  const bestPcs = pcsVals.length > 1 ? Math.max(...pcsVals) : null
  const worstPcs = pcsVals.length > 1 ? Math.min(...pcsVals) : null

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortCol(col); setSortDir(col === "rebarbador" || col === "ct" ? "asc" : "desc") }
  }

  const copyTSV = async () => {
    try {
      const cols = HEADERS.map((h) => h.label)
      const lines = sorted.map((a) => rowCells(a).map((c) => c.text).join("\t"))
      await navigator.clipboard.writeText([cols.join("\t"), ...lines].join("\n"))
    } catch { }
  }

  const exportCSV = () => {
    const cols = HEADERS.map((h) => csvEscape(h.label)).join(",")
    const lines = sorted.map((a) => rowCells(a).map((c) => csvEscape(c.text)).join(","))
    const blob = new Blob([[cols, ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const el = document.createElement("a")
    el.href = url; el.download = "historico_rebarbadores_atuacoes.csv"
    document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url)
  }

  const HEADERS: Array<{ id: SortCol | null; label: string; num?: boolean }> = [
    { id: "rebarbador",  label: "Rebarbador" },
    { id: "ct",          label: "Posto/CT" },
    { id: "turno",       label: "Turno" },
    { id: "ordem",       label: "Ordem" },
    { id: "produto",     label: "Produto" },
    { id: "inicio",      label: "Atuação (início→fim)" },
    { id: "good",        label: "Aprovado",    num: true },
    { id: "scrap",       label: "Refugo",      num: true },
    { id: "rework",      label: "Retrab.",     num: true },
    { id: "pcs_h",       label: "Pçs/h",       num: true },
    { id: "produzindo",  label: "T. Produz.",  num: true },
    { id: "parada",      label: "T. Parado",   num: true },
    { id: "qtd_paradas", label: "Nº Par.",     num: true },
    { id: "aderencia",   label: "Aderência",   num: true },
    { id: "qualidade",   label: "Qualid.",     num: true },
  ]

  const rowCells = (a: RebarbadorAtuacao): Array<{ text: string; cls?: string }> => {
    const pv = atuacaoPcsH(a)      // pçs/h bruto (good ÷ duração total), igual ao ranking
    const ad = atuacaoAderencia(a) // aderência coerente com o pçs/h bruto
    return [
    { text: a.rebarbador_nome + (a.registro ? ` (${a.registro})` : "") },
    { text: a.ct_codigo ?? "—" },
    { text: a.turno_nome ?? "—" },
    { text: a.ordem_codigo ?? "—" },
    { text: a.produto_codigo ?? "—" },
    { text: `${fmtUtcLocal(a.inicio_utc)} → ${a.em_andamento ? "em andamento" : fmtUtcLocal(a.fim_utc)}` },
    { text: fmtInt(a.good) },
    { text: fmtInt(a.scrap), cls: a.scrap > 0 ? "text-red-500 dark:text-red-400" : undefined },
    { text: fmtInt(a.rework), cls: a.rework > 0 ? "text-amber-500" : undefined },
    {
      text: pv == null ? "—" : fmtPcsH(pv),
      cls: pv != null && bestPcs != null && pv === bestPcs
        ? "text-emerald-600 dark:text-emerald-400 font-black"
        : pv != null && worstPcs != null && pv === worstPcs
          ? "text-red-500 dark:text-red-400 font-black"
          : undefined,
    },
    { text: secondsToHHmmss(a.tempo_produzindo_seg) },
    { text: fmtMin(a.parada_seg) },
    { text: fmtInt(a.qtd_paradas) },
    { text: ad == null ? "sem meta" : fmtPct(ad), cls: ad == null ? "text-zinc-300 dark:text-white/20" : ad >= 1 ? "text-emerald-600 dark:text-emerald-400" : ad < 0.8 ? "text-red-500 dark:text-red-400" : undefined },
    { text: fmtPct(a.qualidade) },
    ]
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      {/* header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-black tracking-[0.06em] text-zinc-700 dark:text-white/75 uppercase">Atuações — Rebarbador × Posto × Corrida</span>
          <span className="text-[10px] text-zinc-400 dark:text-white/25 tabular-nums">{sorted.length} registros</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300 dark:text-white/20" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome, posto, ordem…"
              className="h-8 w-52 pl-8 pr-7 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-xs text-zinc-700 dark:text-white/65 placeholder:text-zinc-300 dark:placeholder:text-white/20 focus:outline-none focus:border-orange-400"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/25 hover:text-zinc-600 dark:hover:text-white/55 transition-colors" title="Copiar TSV" type="button" onClick={copyTSV}>
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/25 hover:text-zinc-600 dark:hover:text-white/55 transition-colors" title="Exportar CSV" type="button" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* corpo */}
      {sorted.length === 0 ? (
        <EmptyState
          title={search ? "Nenhum registro para a busca" : "Sem atuações no período"}
          sub={search ? "Tente outro termo." : "Nenhuma corrida com rebarbador atribuído nos filtros selecionados."}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-white/[0.06]">
                {HEADERS.map((h) => (
                  <th
                    key={h.label}
                    onClick={() => h.id && toggleSort(h.id)}
                    className={`px-2.5 py-2 font-bold uppercase tracking-[0.08em] text-[9px] text-zinc-400 dark:text-white/30 whitespace-nowrap select-none ${h.num ? "text-right" : "text-left"} ${h.id ? "cursor-pointer hover:text-zinc-600 dark:hover:text-white/55" : ""}`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {h.label}
                      {sortCol === h.id && (sortDir === "asc" ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const isSel = a.rebarbador_id === selectedId
                return (
                  <tr
                    key={`${a.corrida_id}-${a.rebarbador_id}`}
                    onClick={() => onSelect(isSel ? null : a.rebarbador_id)}
                    className={`border-b border-zinc-50 dark:border-white/[0.03] cursor-pointer transition-colors ${
                      isSel ? "bg-orange-50 dark:bg-orange-500/[0.07]" : "hover:bg-zinc-50 dark:hover:bg-white/[0.02]"
                    }`}
                  >
                    {rowCells(a).map((c, i) => (
                      <td
                        key={i}
                        className={`px-2.5 py-1.5 whitespace-nowrap tabular-nums ${HEADERS[i].num ? "text-right" : "text-left"} ${
                          i === 0 ? "font-bold text-zinc-700 dark:text-white/70" : "text-zinc-500 dark:text-white/45"
                        } ${c.cls ?? ""}`}
                      >
                        {c.text}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** célula "início → fim" da lista de paradas: data uma única vez quando cabe no mesmo dia, horários em destaque */
function ParadaRange({ inicioIso, fimIso, emAndamento }: { inicioIso: string | null; fimIso: string | null; emAndamento: boolean }) {
  const ini = toBRTParts(inicioIso)
  const fim = emAndamento ? null : toBRTParts(fimIso)
  if (!ini) return <span className="text-zinc-400 dark:text-white/25">—</span>

  const sameDay = fim != null && fim.date === ini.date

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-zinc-400 dark:text-white/30 text-[10px]">{ini.date}</span>
      <span className="font-bold text-zinc-600 dark:text-white/60">{ini.time}</span>
      <ArrowRight className="w-2.5 h-2.5 text-zinc-300 dark:text-white/20 flex-shrink-0" />
      {emAndamento ? (
        <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          em andamento
        </span>
      ) : fim ? (
        <>
          {!sameDay && <span className="text-zinc-400 dark:text-white/30 text-[10px]">{fim.date}</span>}
          <span className="font-bold text-zinc-600 dark:text-white/60">{fim.time}</span>
        </>
      ) : (
        <span className="text-zinc-400 dark:text-white/25">—</span>
      )}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────
 * PARADAS DO REBARBADOR SELECIONADO
 * Lista as paradas individuais (mes.paradas) que compõem o
 * "tempo parado" mostrado no detalhe — motivo, início, fim, duração.
 * ───────────────────────────────────────────────────────────── */
type ParadaSortCol = "inicio" | "duracao" | "motivo"

function ParadasList({ paradas, rebarbadorNome }: { paradas: RebarbadorParada[]; rebarbadorNome: string }) {
  const [sortCol, setSortCol] = useState<ParadaSortCol>("inicio")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const arr = [...paradas]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortCol === "duracao") cmp = a.duracao_seg - b.duracao_seg
      else if (sortCol === "motivo") cmp = (a.motivo_descricao ?? "").localeCompare(b.motivo_descricao ?? "")
      else cmp = String(a.inicio_utc ?? "").localeCompare(String(b.inicio_utc ?? ""))
      return sortDir === "asc" ? cmp : -cmp
    })
    return arr
  }, [paradas, sortCol, sortDir])

  const totalSeg = useMemo(() => paradas.reduce((s, p) => s + p.duracao_seg, 0), [paradas])
  const nPlanejadas = useMemo(() => paradas.filter((p) => p.is_planejada).length, [paradas])

  const toggleSort = (col: ParadaSortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortCol(col); setSortDir(col === "motivo" ? "asc" : "desc") }
  }

  const HEADERS: Array<{ id: ParadaSortCol | null; label: string; num?: boolean }> = [
    { id: "motivo",  label: "Motivo" },
    { id: null,      label: "Tipo" },
    { id: null,      label: "Posto/Ordem" },
    { id: "inicio",  label: "Início → Fim" },
    { id: "duracao", label: "Duração", num: true },
  ]

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
          <span className="text-sm font-black tracking-[0.06em] text-zinc-700 dark:text-white/75 uppercase truncate">
            Paradas de {rebarbadorNome}
          </span>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-white/25 tabular-nums uppercase tracking-[0.06em]">
          {paradas.length} paradas · {fmtMin(totalSeg)} parado{nPlanejadas ? ` · ${nPlanejadas} planejada${nPlanejadas > 1 ? "s" : ""}` : ""}
        </span>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="Nenhuma parada contabilizada" sub="Este rebarbador não teve paradas recortadas dentro do período/filtros selecionados." />
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-white dark:bg-[#0f1015] z-10">
              <tr className="border-b border-zinc-100 dark:border-white/[0.06]">
                {HEADERS.map((h) => (
                  <th
                    key={h.label}
                    onClick={() => h.id && toggleSort(h.id)}
                    className={`px-2.5 py-2 font-bold uppercase tracking-[0.08em] text-[9px] text-zinc-400 dark:text-white/30 whitespace-nowrap select-none ${h.num ? "text-right" : "text-left"} ${h.id ? "cursor-pointer hover:text-zinc-600 dark:hover:text-white/55" : ""}`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {h.label}
                      {sortCol === h.id && (sortDir === "asc" ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.parada_id} className="border-b border-zinc-50 dark:border-white/[0.03] hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-2.5 py-1.5 text-left font-bold text-zinc-700 dark:text-white/70 whitespace-nowrap">
                    {p.motivo_descricao ?? "Sem motivo"}
                  </td>
                  <td className="px-2.5 py-1.5 text-left whitespace-nowrap">
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${
                      p.is_planejada
                        ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                        : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
                    }`}>
                      {p.is_planejada ? "Planejada" : "Não planej."}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-left text-zinc-500 dark:text-white/45 whitespace-nowrap tabular-nums">
                    {[p.ct_codigo, p.ordem_codigo].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-left whitespace-nowrap tabular-nums">
                    <ParadaRange inicioIso={p.inicio_utc} fimIso={p.fim_utc} emAndamento={p.em_andamento} />
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-black text-zinc-700 dark:text-white/75 whitespace-nowrap tabular-nums">
                    {fmtMin(p.duracao_seg)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * COMPONENTE PRINCIPAL DA ABA
 * ───────────────────────────────────────────────────────────── */
export interface RebarbadoresTabProps {
  empresaId?: string
  range: { startUtc?: string; endUtc?: string }
  rangeError: string | null
  periodText: string
  filters: {
    setorId?: string
    turnoId?: string
    centroTrabalhoId?: string
    produtoId?: string
    ordemId?: string
  }
}

const AGRUPAR_OPCOES: Array<{ id: AgruparPor; label: string }> = [
  { id: "rebarbador", label: "Rebarbador" },
  { id: "turno",      label: "Turno" },
  { id: "ct",         label: "Centro de Trabalho" },
  { id: "produto",    label: "Produto" },
  { id: "ordem",      label: "Ordem/Corrida" },
  { id: "dia",        label: "Dia Operacional" },
]

export function RebarbadoresTab({ empresaId, range, rangeError, periodText, filters }: RebarbadoresTabProps) {
  const [rebarbadorId, setRebarbadorId] = useState("")
  const [agruparPor, setAgruparPor] = useState<AgruparPor>("rebarbador")
  const [rankMetric, setRankMetric] = useState<RankMetric>("pcs_h")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const api = useHistoricoRebarbadores({
    empresaId,
    range,
    filters: {
      ...filters,
      rebarbadorId: rebarbadorId || undefined,
    },
    enable: Boolean(range.startUtc && range.endUtc && !rangeError),
  })

  const { atuacoes, tendencia, funcionarios, paradas } = api

  /* agregado por rebarbador — base de KPIs, scatter e detalhe */
  const porRebarbador = useMemo(() => aggregate(atuacoes, "rebarbador"), [atuacoes])

  /* agregado pela dimensão escolhida — ranking */
  const porGrupo = useMemo(
    () => (agruparPor === "rebarbador" ? porRebarbador : aggregate(atuacoes, agruparPor)),
    [atuacoes, agruparPor, porRebarbador]
  )

  /* ── KPIs ──────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const n = porRebarbador.length
    const good = porRebarbador.reduce((s, g) => s + g.good, 0)
    // pçs/h média = good total ÷ duração total de atuação (span, incluindo paradas)
    const duracaoSeg = porRebarbador.reduce((s, g) => s + g.dur, 0)
    const paradaSeg = porRebarbador.reduce((s, g) => s + g.parada, 0)
    const pcsHMedia = duracaoSeg > 0 ? good / (duracaoSeg / 3600) : null

    const comMeta = porRebarbador.filter((g) => g.aderencia != null)
    const esperadoTot = comMeta.reduce((s, g) => s + g.esperado, 0)
    const goodComMeta = comMeta.reduce((s, g) => s + g.good, 0)
    const aderencia = esperadoTot > 0 ? goodComMeta / esperadoTot : null

    const valids = porRebarbador.filter((g) => g.pcsH != null && g.good > 0)
    const melhor = valids.length ? valids.reduce((a, b) => ((a.pcsH ?? 0) >= (b.pcsH ?? 0) ? a : b)) : null
    const maiorParada = porRebarbador.length
      ? porRebarbador.reduce((a, b) => (a.parada >= b.parada ? a : b))
      : null

    return {
      n, good, pcsHMedia,
      paradaMediaPorReb: n > 0 ? paradaSeg / n : null,
      aderencia,
      melhor,
      maiorParada: maiorParada && maiorParada.parada > 0 ? maiorParada : null,
    }
  }, [porRebarbador])

  /* ── detalhe do rebarbador selecionado ─────────────────── */
  const detalhe = useMemo(() => {
    if (!selectedId) return null
    const agg = porRebarbador.find((g) => g.rebarbadorId === selectedId)
    if (!agg) return null
    const dias = tendencia.filter((t) => t.rebarbador_id === selectedId)
    const atus = atuacoes.filter((a) => a.rebarbador_id === selectedId)
    const ultima = [...atus].sort((a, b) => String(b.inicio_utc).localeCompare(String(a.inicio_utc)))[0] ?? null
    // meta média do rebarbador (ponderada pela duração total da atuação)
    let metaNum = 0, metaDen = 0
    for (const a of atus) {
      if (a.meta_pcs_h != null) {
        const w = a.dur_atuacao_seg
        metaNum += a.meta_pcs_h * w
        metaDen += w
      }
    }
    const paradasSel = paradas
      .filter((p) => p.rebarbador_id === selectedId)
      .sort((a, b) => String(b.inicio_utc ?? "").localeCompare(String(a.inicio_utc ?? "")))
    return { agg, dias, ultima, paradas: paradasSel, meta: metaDen > 0 ? metaNum / metaDen : null }
  }, [selectedId, porRebarbador, tendencia, atuacoes, paradas])

  const onSelect = useCallback((id: string | null) => setSelectedId(id), [])

  /* ── estados globais ───────────────────────────────────── */
  if (rangeError) {
    return (
      <div className={`${CARD} h-[300px] flex flex-col items-center justify-center text-amber-500 gap-2`}>
        <AlertTriangle className="w-6 h-6" />
        <div className="text-sm font-bold">{rangeError}</div>
      </div>
    )
  }

  if (api.isLoading) {
    return (
      <div className={`${CARD} h-[400px] flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
          <span className="text-[11px] text-zinc-400 dark:text-white/28 uppercase tracking-[0.1em]">Carregando rebarbadores…</span>
        </div>
      </div>
    )
  }

  if (api.error) {
    return (
      <div className={`${CARD} h-[300px] flex flex-col items-center justify-center text-red-500 gap-2`}>
        <AlertCircle className="w-6 h-6" />
        <div className="text-sm font-bold">Erro ao carregar</div>
        <div className="text-xs text-zinc-400 dark:text-white/28">{api.errorMessage}</div>
      </div>
    )
  }

  if (!api.disponivel) {
    return (
      <div className={`${CARD} px-5 py-8 flex flex-col items-center gap-2 text-center`}>
        <AlertTriangle className="w-6 h-6 text-amber-500" />
        <div className="text-sm font-bold text-zinc-600 dark:text-white/60">Dados de rebarbadores indisponíveis</div>
        <div className="text-xs text-zinc-400 dark:text-white/30 max-w-lg">{api.motivoIndisponivel}</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">

      {/* ── FILTROS ESPECÍFICOS DA ABA ── */}
      <div className={`${CARD} px-4 py-3`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className={`${LABEL} mb-1 block`}>Rebarbador</label>
            <select value={rebarbadorId} onChange={(e) => { setRebarbadorId(e.target.value); setSelectedId(e.target.value || null) }} className={SELECT_CLS}>
              <option value="">Todos os rebarbadores</option>
              {funcionarios.map((f) => (
                <option key={f.funcionario_id} value={f.funcionario_id}>
                  {f.nome}{f.registro ? ` — ${f.registro}` : ""}{!f.is_active ? " (inativo)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={`${LABEL} mb-1 block`}>Agrupar ranking por</label>
            <select value={agruparPor} onChange={(e) => setAgruparPor(e.target.value as AgruparPor)} className={SELECT_CLS}>
              {AGRUPAR_OPCOES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={`${LABEL} mb-1 block`}>Métrica do ranking</label>
            <select value={rankMetric} onChange={(e) => setRankMetric(e.target.value as RankMetric)} className={SELECT_CLS}>
              {RANK_METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="text-[10px] text-zinc-400 dark:text-white/25 leading-snug pb-1">
            Peças/hora usa <b>good ÷ duração total da atuação</b> (span, <b>incluindo paradas</b>) — ritmo real,
            não estimado. Ex.: 22 pçs numa atuação de 1h = 22 pçs/h; 27 pçs em 2h = 13,5 pçs/h.
            Aderência compara com a meta do ciclo ideal da corrida; sem ciclo ideal, mostra “sem meta”.
          </div>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
        <KpiBox label="Rebarbadores" value={fmtInt(kpis.n)} sub="ativos no período" icon={Users} color="#f97316" />
        <KpiBox label="Produção Total" value={fmtInt(kpis.good)} sub="peças boas (good)" icon={Package} />
        <KpiBox label="Peças/h Média" value={kpis.pcsHMedia == null ? "—" : fmtPcsH(kpis.pcsHMedia)} sub="good ÷ horas de atuação" icon={Activity} />
        <KpiBox label="Parada Média" value={kpis.paradaMediaPorReb == null ? "—" : fmtMin(kpis.paradaMediaPorReb)} sub="por rebarbador" icon={Clock} />
        <KpiBox
          label="Aderência à Meta"
          value={kpis.aderencia == null ? "sem meta" : fmtPct(kpis.aderencia)}
          sub={kpis.aderencia == null ? "sem ciclo ideal" : "real ÷ esperado"}
          icon={Target}
          color={kpis.aderencia == null ? undefined : kpis.aderencia >= 1 ? "#16a34a" : kpis.aderencia < 0.8 ? "#dc2626" : undefined}
        />
        <KpiBox
          label="Melhor do Período"
          value={kpis.melhor ? kpis.melhor.label.split(" ")[0] : "—"}
          sub={kpis.melhor ? `${fmtPcsH(kpis.melhor.pcsH)} pçs/h` : "sem produção"}
          icon={Trophy}
          color="#16a34a"
        />
        <KpiBox
          label="Maior T. Parado"
          value={kpis.maiorParada ? kpis.maiorParada.label.split(" ")[0] : "—"}
          sub={kpis.maiorParada ? fmtMin(kpis.maiorParada.parada) : "sem paradas"}
          icon={AlertTriangle}
          color={kpis.maiorParada ? "#dc2626" : undefined}
        />
      </div>

      {/* ── RANKING ── */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-black tracking-[0.06em] text-orange-600 dark:text-orange-500 uppercase">Ranking de Rebarbadores</span>
            <span className="text-sm text-zinc-400 dark:text-white/30 font-medium tabular-nums">{periodText}</span>
          </div>
          <span className="text-[10px] text-zinc-400 dark:text-white/22 uppercase tracking-[0.08em]">
            {rankMetric === "parada"
              ? "Barra: tempo parado no período"
              : `Barra esquerda: tempo parado · Barra direita: ${RANK_METRICS.find((m) => m.id === rankMetric)?.label?.toLowerCase()}`}
          </span>
        </div>
        <RankingChart rows={porGrupo} metric={rankMetric} selectedId={selectedId} onSelect={onSelect} agruparPor={agruparPor} />
      </div>

      {/* ── DETALHE + SCATTER (lado a lado em desktop) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">

        {/* Detalhe do selecionado — sem overflow-hidden: o tooltip da
         * TrendChart é position:absolute e precisa poder "vazar" para fora
         * do card sem ser cortado. */}
        <div className={`${CARD} min-w-0`}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
            <span className="text-sm font-black tracking-[0.06em] text-zinc-700 dark:text-white/75 uppercase">
              {detalhe ? detalhe.agg.label : "Detalhe do Rebarbador"}
            </span>
            {detalhe ? (
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="h-7 px-2.5 inline-flex items-center gap-1 border border-zinc-200 dark:border-white/[0.08] text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400 dark:text-white/30 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
              >
                <X className="w-3 h-3" /> Limpar
              </button>
            ) : (
              <span className="text-[10px] text-zinc-400 dark:text-white/22 uppercase tracking-[0.08em]">Clique no ranking, scatter ou tabela</span>
            )}
          </div>

          {!detalhe ? (
            <EmptyState title="Nenhum rebarbador selecionado" sub="Selecione um rebarbador no ranking, no gráfico de dispersão ou na tabela para ver o desempenho detalhado." />
          ) : (
            <div className="p-4 space-y-3">
              {/* identificação + última atuação */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[10px] text-zinc-400 dark:text-white/28 tabular-nums">
                    {[detalhe.agg.sub, detalhe.ultima?.cargo].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {detalhe.ultima && (
                    <div className="text-[11px] text-zinc-500 dark:text-white/40 mt-1 leading-snug">
                      Última atuação: <b className="text-zinc-700 dark:text-white/65">{detalhe.ultima.ct_codigo ?? "—"}</b>
                      {detalhe.ultima.ordem_codigo ? <> · ordem <b className="text-zinc-700 dark:text-white/65">{detalhe.ultima.ordem_codigo}</b></> : null}
                      {detalhe.ultima.produto_codigo ? <> · {detalhe.ultima.produto_codigo}</> : null}
                      {detalhe.ultima.turno_nome ? <> · {detalhe.ultima.turno_nome}</> : null}
                      <> · {fmtUtcLocal(detalhe.ultima.inicio_utc)} → {detalhe.ultima.em_andamento ? "em andamento" : fmtUtcLocal(detalhe.ultima.fim_utc)}</>
                    </div>
                  )}
                </div>
              </div>

              {/* mini-KPIs do rebarbador */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  { l: "Peças/h",   v: fmtPcsH(detalhe.agg.pcsH), hl: true },
                  { l: "Produção",  v: fmtInt(detalhe.agg.good) },
                  { l: "T. Parado", v: fmtMin(detalhe.agg.parada) },
                  { l: "Par. Média",v: fmtMin(detalhe.agg.paradaMedia) },
                  { l: "Qualidade", v: fmtPct(detalhe.agg.qualidade) },
                  { l: "Aderência", v: detalhe.agg.aderencia == null ? "sem meta" : fmtPct(detalhe.agg.aderencia) },
                ].map((k) => (
                  <div key={k.l} className="border border-zinc-100 dark:border-white/[0.05] bg-zinc-50 dark:bg-white/[0.02] px-2 py-1.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28">{k.l}</div>
                    <div className={`text-sm font-black tabular-nums ${k.hl ? "text-orange-600 dark:text-orange-500" : "text-zinc-700 dark:text-white/80"}`}>{k.v}</div>
                  </div>
                ))}
              </div>

              {/* tendência */}
              <div>
                <div className={`${LABEL} mb-1`}>Tendência diária — peças/hora {detalhe.meta != null ? "(com meta)" : ""}</div>
                <TrendChart dias={detalhe.dias} meta={detalhe.meta} />
              </div>
            </div>
          )}
        </div>

        {/* Scatter Eficiência × Parada — sem overflow-hidden, mesmo motivo
         * do card de Detalhe: o tooltip de hover não pode ser cortado. */}
        <div className={`${CARD} min-w-0`}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
            <span className="text-sm font-black tracking-[0.06em] text-zinc-700 dark:text-white/75 uppercase">Eficiência × Parada</span>
            <span className="text-[10px] text-zinc-400 dark:text-white/22 uppercase tracking-[0.08em]">1 ponto = 1 rebarbador · linhas = mediana</span>
          </div>
          <div className="p-3">
            <ScatterChart rows={porRebarbador} selectedId={selectedId} onSelect={onSelect} />
          </div>
        </div>
      </div>

      {/* ── PARADAS DO REBARBADOR SELECIONADO ── */}
      {detalhe && (
        <ParadasList paradas={detalhe.paradas} rebarbadorNome={detalhe.agg.label} />
      )}

      {/* ── TABELA DETALHADA ── */}
      <AtuacoesTable atuacoes={atuacoes} selectedId={selectedId} onSelect={onSelect} />

      {/* ── LINHA DO TEMPO DE PARADAS (por rebarbador × dia operacional) ──
       * Busca dados PRÓPRIOS (range independente do filtro de data da página),
       * navegando livre até o dia atual em produção. */}
      <ParadasTimeline empresaId={empresaId} filters={filters} rebarbadorId={rebarbadorId || undefined} />

      {/* nota de método */}
      <div className="text-[10px] text-zinc-300 dark:text-white/14 px-1 uppercase tracking-[0.1em]">
        Fonte: corridas com rebarbador atribuído no posto · produção recortada à janela · paradas por corrida · tendência por dia operacional 06h→06h
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════
 * LINHA DO TEMPO DE PARADAS — por rebarbador × dia operacional
 *
 * Cada rebarbador vira uma "raia" (lane). As paradas preenchem a raia
 * como blocos coloridos por MOTIVO, posicionados pelo horário real (BRT)
 * dentro do dia operacional 06h→06h. Permite:
 *  - navegar dia a dia com ‹ › (ou ver todos os dias empilhados);
 *  - limitar a janela de horas exibida (ex.: 12:00 → 21:00);
 *  - filtrar por motivo (ex.: só café e janta);
 *  - relatório agregado de tempo parado por motivo no escopo atual.
 *
 * Duração usada = porção da parada DENTRO da janela de horas exibida,
 * então o desenho e o relatório sempre batem com o que está na tela.
 * ═════════════════════════════════════════════════════════════ */

const MOTIVO_PALETTE = [
  "#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444", "#eab308",
  "#14b8a6", "#ec4899", "#8b5cf6", "#f59e0b", "#06b6d4", "#84cc16",
]
const SEM_MOTIVO_COLOR = "#71717a"

/** Formata horário BRT do dia operacional (0–23h → HH:MM), 24h+ = madrugada. */
const BRT_DTF = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
})

/** ISO UTC (com/sem Z) → posição no dia operacional 06h→06h em BRT.
 *  opHour ∈ [6, 30): 06:00 = 6, meia-noite = 24, 05:59 ≈ 29.98.
 *  opDay = YYYY-MM-DD do dia operacional (vira às 06:00 BRT). */
function brtOpPos(iso: string | null): { opDay: string; opHour: number } | null {
  if (!iso) return null
  const withZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(withZ)
  if (Number.isNaN(d.getTime())) return null
  const parts = Object.fromEntries(BRT_DTF.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>
  const hour = Number(parts.hour) % 24
  const hf = hour + Number(parts.minute) / 60 + Number(parts.second) / 3600
  const opHour = hf < 6 ? hf + 24 : hf
  let opDay = `${parts.year}-${parts.month}-${parts.day}`
  if (hf < 6) {
    const prev = new Date(`${opDay}T12:00:00Z`)
    prev.setUTCDate(prev.getUTCDate() - 1)
    opDay = prev.toISOString().slice(0, 10)
  }
  return { opDay, opHour }
}

/** rótulo "HH:00" a partir de uma op-hour (6..30) */
function opHourLabel(op: number): string {
  const h = Math.floor(((op % 24) + 24) % 24)
  const m = Math.round((op - Math.floor(op)) * 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** nome do dia da semana (BRT) a partir de YYYY-MM-DD */
function weekdayBR(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" }).replace(".", "")
}

interface TLParada {
  p: RebarbadorParada
  opDay: string
  sOp: number
  eOp: number
  motivoKey: string
  motivoLabel: string
  planejada: boolean
}

/** soma n dias a um YYYY-MM-DD (dia operacional), retorna YYYY-MM-DD */
function addOpDays(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00Z`)
  if (Number.isNaN(dt.getTime())) return d
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

/** janela UTC que cobre os dias operacionais [dStart..dEnd].
 *  06:00 BRT = 09:00 UTC (Brasil sem horário de verão desde 2019, UTC-3 fixo). */
function opDayUtcRange(dStart: string, dEnd: string) {
  return { startUtc: `${dStart}T09:00:00.000Z`, endUtc: `${addOpDays(dEnd, 1)}T09:00:00.000Z` }
}

/** lista de dias operacionais YYYY-MM-DD de dStart a dEnd (inclusive), com teto de segurança */
function enumerateOpDays(dStart: string, dEnd: string, cap = 120): string[] {
  const out: string[] = []
  let cur = dStart
  let i = 0
  while (cur <= dEnd && i < cap) { out.push(cur); cur = addOpDays(cur, 1); i++ }
  return out
}

const DATE_INPUT_CLS =
  "h-8 px-2 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-xs text-zinc-700 dark:text-white/65 tabular-nums focus:outline-none [color-scheme:light] dark:[color-scheme:dark]"

function ParadasTimeline({ empresaId, filters, rebarbadorId }: {
  empresaId?: string
  filters: { setorId?: string; turnoId?: string; centroTrabalhoId?: string; produtoId?: string; ordemId?: string }
  rebarbadorId?: string
}) {
  // dia operacional de "agora" (teto da navegação — não dá pra ir pro futuro)
  const todayOp = useMemo(() => brtOpPos(new Date().toISOString())?.opDay ?? new Date().toISOString().slice(0, 10), [])

  const [dayMode, setDayMode] = useState<"single" | "all">("single")
  const [anchorDay, setAnchorDay] = useState(todayOp)                 // modo "um dia"
  const [rangeStart, setRangeStart] = useState(() => addOpDays(todayOp, -6)) // modo "todos os dias"
  const [rangeEnd, setRangeEnd] = useState(todayOp)
  const [startOp, setStartOp] = useState(6)
  const [endOp, setEndOp] = useState(30)
  const [motivoFilter, setMotivoFilter] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; t: TLParada; nome: string; color: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const LANE_LABEL_W = "w-[120px] sm:w-[150px]"

  // range de datas PRÓPRIO — independente do filtro de data da página. As
  // dimensões (setor/turno/CT/produto/ordem/rebarbador) continuam aplicadas.
  const rMin = rangeStart <= rangeEnd ? rangeStart : rangeEnd
  const rMax = rangeEnd >= rangeStart ? rangeEnd : rangeStart
  const fetchRange = dayMode === "single" ? opDayUtcRange(anchorDay, anchorDay) : opDayUtcRange(rMin, rMax)

  // NÃO gatear em empresaId: o servidor deriva a empresa da sessão/JWT e o
  // prop costuma chegar undefined (mesmo padrão do fetch do componente pai).
  const api = useHistoricoRebarbadores({
    empresaId,
    range: fetchRange,
    filters: { ...filters, rebarbadorId },
    enable: Boolean(fetchRange.startUtc && fetchRange.endUtc),
  })

  // nome do rebarbador por id (paradas só trazem o id)
  const nomeById = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of api.funcionarios) m.set(f.funcionario_id, f.nome)
    for (const a of api.atuacoes) if (!m.has(a.rebarbador_id)) m.set(a.rebarbador_id, a.rebarbador_nome)
    return m
  }, [api.funcionarios, api.atuacoes])

  /* enriquecer paradas com posição no dia operacional */
  const enriched = useMemo<TLParada[]>(() => {
    const out: TLParada[] = []
    for (const p of api.paradas) {
      const s = brtOpPos(p.inicio_utc)
      if (!s) continue
      const e = brtOpPos(p.fim_utc)
      let eOp = e ? e.opHour : s.opHour
      // parada que cruza a virada das 06:00 (ou sem fim no mesmo dia op): fecha no fim do dia
      if (!e || e.opDay !== s.opDay || eOp < s.opHour) eOp = 30
      out.push({
        p,
        opDay: s.opDay,
        sOp: s.opHour,
        eOp,
        motivoKey: p.motivo_id ?? p.motivo_codigo ?? p.motivo_descricao ?? "__sem__",
        motivoLabel: p.motivo_descricao ?? p.motivo_codigo ?? "Sem motivo",
        planejada: p.is_planejada,
      })
    }
    return out
  }, [api.paradas])

  /* motivos distintos + cor estável (por ordem alfabética) */
  const { motivoList, colorOf } = useMemo(() => {
    const map = new Map<string, { key: string; label: string; planejada: boolean }>()
    for (const t of enriched) if (!map.has(t.motivoKey)) map.set(t.motivoKey, { key: t.motivoKey, label: t.motivoLabel, planejada: t.planejada })
    const list = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
    const colorOf = new Map<string, string>()
    let i = 0
    for (const m of list) colorOf.set(m.key, m.key === "__sem__" ? SEM_MOTIVO_COLOR : MOTIVO_PALETTE[i++ % MOTIVO_PALETTE.length])
    return { motivoList: list, colorOf }
  }, [enriched])

  const span = Math.max(0.5, endOp - startOp)
  const winSeg = useCallback(
    (t: TLParada) => Math.max(0, Math.min(t.eOp, endOp) - Math.max(t.sOp, startOp)) * 3600,
    [startOp, endOp]
  )

  /* dias operacionais em escopo: no modo intervalo, TODOS os dias do range
   * escolhido (mesmo os sem parada) — para o intervalo aparecer completo. */
  const scopeDays = dayMode === "single" ? [anchorDay] : enumerateOpDays(rMin, rMax)
  const groups = useMemo(() => {
    return scopeDays.map((day) => {
      const inDay = enriched.filter(
        (t) =>
          t.opDay === day &&
          t.sOp < endOp && t.eOp > startOp &&
          (motivoFilter.size === 0 || motivoFilter.has(t.motivoKey))
      )
      const byReb = new Map<string, TLParada[]>()
      for (const t of inDay) {
        const arr = byReb.get(t.p.rebarbador_id)
        if (arr) arr.push(t)
        else byReb.set(t.p.rebarbador_id, [t])
      }
      const rebs = Array.from(byReb.entries())
        .map(([id, items]) => ({
          id,
          nome: nomeById.get(id) ?? "—",
          items: items.sort((a, b) => a.sOp - b.sOp),
          totalSeg: items.reduce((s, t) => s + winSeg(t), 0),
        }))
        .sort((a, b) => b.totalSeg - a.totalSeg)
      return { day, rebs, totalSeg: rebs.reduce((s, r) => s + r.totalSeg, 0) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeDays.join(","), enriched, startOp, endOp, motivoFilter, nomeById, winSeg])

  /* relatório agregado por motivo no escopo atual */
  const report = useMemo(() => {
    const m = new Map<string, { key: string; label: string; seg: number; count: number }>()
    for (const g of groups) for (const r of g.rebs) for (const t of r.items) {
      const cur = m.get(t.motivoKey) ?? { key: t.motivoKey, label: t.motivoLabel, seg: 0, count: 0 }
      cur.seg += winSeg(t)
      cur.count += 1
      m.set(t.motivoKey, cur)
    }
    const arr = Array.from(m.values()).sort((a, b) => b.seg - a.seg)
    return { arr, total: arr.reduce((s, x) => s + x.seg, 0), maxSeg: Math.max(1, ...arr.map((x) => x.seg)) }
  }, [groups, winSeg])

  /* ticks de hora do eixo */
  const ticks = useMemo(() => {
    const step = span <= 6 ? 1 : span <= 13 ? 2 : 3
    const out: number[] = []
    for (let h = Math.ceil(startOp); h <= Math.floor(endOp); h++) if ((h - Math.ceil(startOp)) % step === 0) out.push(h)
    return out
  }, [startOp, endOp, span])

  const pctL = (op: number) => ((Math.min(Math.max(op, startOp), endOp) - startOp) / span) * 100

  const toggleMotivo = (key: string) =>
    setMotivoFilter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const onSegMove = (e: React.MouseEvent, t: TLParada, nome: string, color: string) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, t, nome, color })
  }

  const HOUR_VALUES = Array.from({ length: 25 }, (_, i) => 6 + i) // 6..30

  const totalReportMin = report.total

  return (
    <div className={`${CARD} overflow-hidden`}>
      {/* header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="w-4 h-4 text-orange-500 flex-shrink-0" />
          <span className="text-sm font-black tracking-[0.06em] text-zinc-700 dark:text-white/75 uppercase">
            Linha do Tempo de Paradas
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-white/25 uppercase tracking-[0.08em] hidden sm:inline">
            por rebarbador · dia operacional 06h→06h
          </span>
        </div>
        {/* alternância dia único / todos */}
        <div className="inline-flex border border-zinc-200 dark:border-white/[0.09]">
          {(["single", "all"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDayMode(mode)}
              className={`h-7 px-3 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors ${
                dayMode === mode
                  ? "bg-orange-500 text-white"
                  : "text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
              }`}
            >
              {mode === "single" ? "Um dia" : "Todos os dias"}
            </button>
          ))}
        </div>
      </div>

      {/* ── CONTROLES (navegação de data própria, livre até hoje) ── */}
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {dayMode === "single" ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAnchorDay(addOpDays(anchorDay, -1))}
                    className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.09] text-zinc-500 dark:text-white/45 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                    title="Dia anterior"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={anchorDay}
                    max={todayOp}
                    onChange={(e) => e.target.value && setAnchorDay(e.target.value > todayOp ? todayOp : e.target.value)}
                    className={DATE_INPUT_CLS}
                  />
                  <span className="text-[11px] text-zinc-400 dark:text-white/30 tabular-nums min-w-[32px] capitalize">{weekdayBR(anchorDay)}</span>
                  <button
                    type="button"
                    onClick={() => setAnchorDay(addOpDays(anchorDay, 1))}
                    disabled={anchorDay >= todayOp}
                    className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.09] text-zinc-500 dark:text-white/45 hover:bg-zinc-100 dark:hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Próximo dia"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  {anchorDay !== todayOp && (
                    <button
                      type="button"
                      onClick={() => setAnchorDay(todayOp)}
                      className="h-8 px-2.5 border border-orange-300 dark:border-orange-500/30 text-[10px] font-bold uppercase tracking-[0.06em] text-orange-600 dark:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10"
                      title="Ir para o dia em produção"
                    >
                      Hoje
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={LABEL}>De</span>
                  <input
                    type="date"
                    value={rMin}
                    max={todayOp}
                    onChange={(e) => e.target.value && setRangeStart(e.target.value > todayOp ? todayOp : e.target.value)}
                    className={DATE_INPUT_CLS}
                  />
                  <span className={LABEL}>Até</span>
                  <input
                    type="date"
                    value={rMax}
                    max={todayOp}
                    onChange={(e) => e.target.value && setRangeEnd(e.target.value > todayOp ? todayOp : e.target.value)}
                    className={DATE_INPUT_CLS}
                  />
                  <span className="text-[10px] text-zinc-400 dark:text-white/28 tabular-nums uppercase tracking-[0.06em]">{scopeDays.length} dia{scopeDays.length > 1 ? "s" : ""}</span>
                </div>
              )}

              {/* janela de horas */}
              <div className="flex items-center gap-1.5">
                <span className={LABEL}>Janela</span>
                <select
                  value={startOp}
                  onChange={(e) => { const v = Number(e.target.value); setStartOp(Math.min(v, endOp - 1)) }}
                  className="h-8 px-2 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-xs text-zinc-700 dark:text-white/65 tabular-nums focus:outline-none"
                >
                  {HOUR_VALUES.slice(0, -1).map((h) => (
                    <option key={h} value={h}>{opHourLabel(h)}{h >= 24 ? " +1d" : ""}</option>
                  ))}
                </select>
                <span className="text-zinc-400 dark:text-white/30 text-xs">→</span>
                <select
                  value={endOp}
                  onChange={(e) => { const v = Number(e.target.value); setEndOp(Math.max(v, startOp + 1)) }}
                  className="h-8 px-2 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-xs text-zinc-700 dark:text-white/65 tabular-nums focus:outline-none"
                >
                  {HOUR_VALUES.slice(1).map((h) => (
                    <option key={h} value={h}>{opHourLabel(h)}{h >= 24 ? " +1d" : ""}</option>
                  ))}
                </select>
                {(startOp !== 6 || endOp !== 30) && (
                  <button
                    type="button"
                    onClick={() => { setStartOp(6); setEndOp(30) }}
                    className="h-8 px-2.5 border border-zinc-200 dark:border-white/[0.09] text-[10px] font-bold uppercase tracking-[0.06em] text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                    title="Dia todo (06:00 → 06:00)"
                  >
                    Dia todo
                  </button>
                )}
              </div>
            </div>

            {/* filtro de motivos / legenda */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-zinc-400 dark:text-white/30">
                <Filter className="w-3 h-3" />
                <span className={LABEL}>Motivos</span>
              </span>
              {motivoList.map((m) => {
                const active = motivoFilter.size === 0 || motivoFilter.has(m.key)
                const color = colorOf.get(m.key) ?? SEM_MOTIVO_COLOR
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleMotivo(m.key)}
                    className={`inline-flex items-center gap-1.5 h-6 px-2 border text-[10px] font-bold transition-colors ${
                      active
                        ? "border-zinc-300 dark:border-white/20 text-zinc-700 dark:text-white/75"
                        : "border-zinc-200 dark:border-white/[0.06] text-zinc-300 dark:text-white/20 line-through"
                    }`}
                    title={m.planejada ? "Parada planejada" : "Parada não planejada"}
                  >
                    <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: color, opacity: active ? 1 : 0.35 }} />
                    {m.label}
                  </button>
                )
              })}
              {motivoFilter.size > 0 && (
                <button
                  type="button"
                  onClick={() => setMotivoFilter(new Set())}
                  className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-bold uppercase tracking-[0.06em] text-orange-600 dark:text-orange-500 hover:underline"
                >
                  <X className="w-3 h-3" /> Limpar ({motivoFilter.size})
                </button>
              )}
            </div>
          </div>

          {/* ── GRÁFICO (raias) ── */}
          <div ref={wrapRef} className="relative px-4 py-3">
            {api.isLoading ? (
              <div className="flex items-center justify-center gap-3 py-10">
                <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent animate-spin" />
                <span className="text-[11px] text-zinc-400 dark:text-white/28 uppercase tracking-[0.1em]">Carregando paradas…</span>
              </div>
            ) : groups.every((g) => g.rebs.length === 0) ? (
              <EmptyState title="Sem paradas no escopo" sub="Nenhuma parada de rebarbador no dia/intervalo com a janela de horas e os motivos selecionados." />
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <div key={g.day}>
                    {dayMode === "all" && (
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-black text-zinc-600 dark:text-white/60 tabular-nums">
                          {fmtDiaBR(g.day)} <span className="text-zinc-400 dark:text-white/30 font-medium">· {weekdayBR(g.day)}</span>
                        </span>
                        <span className="text-[10px] text-zinc-400 dark:text-white/28 tabular-nums">{fmtMin(g.totalSeg)} parado</span>
                      </div>
                    )}

                    {/* eixo de horas */}
                    <div className="flex items-stretch">
                      <div className={`${LANE_LABEL_W} flex-shrink-0`} />
                      <div className="relative flex-1 h-4">
                        {ticks.map((h) => (
                          <span
                            key={h}
                            className="absolute top-0 text-[9px] text-zinc-400 dark:text-white/25 tabular-nums -translate-x-1/2"
                            style={{ left: `${pctL(h)}%` }}
                          >
                            {opHourLabel(h)}
                          </span>
                        ))}
                      </div>
                    </div>

                    {g.rebs.length === 0 ? (
                      <div className="text-[11px] text-zinc-400 dark:text-white/25 pl-[120px] sm:pl-[150px] py-2">Sem paradas neste dia para os filtros.</div>
                    ) : (
                      <div className="space-y-1.5 mt-1">
                        {g.rebs.map((r) => (
                          <div key={r.id} className="flex items-center">
                            {/* nome + total */}
                            <div className={`${LANE_LABEL_W} flex-shrink-0 pr-2 min-w-0`}>
                              <div className="text-[11px] font-bold text-zinc-700 dark:text-white/70 truncate leading-tight">{r.nome}</div>
                              <div className="text-[9px] text-zinc-400 dark:text-white/28 tabular-nums">{fmtMin(r.totalSeg)} · {r.items.length}×</div>
                            </div>
                            {/* raia */}
                            <div className="relative flex-1 h-8 bg-zinc-100/70 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.05]">
                              {/* gridlines */}
                              {ticks.map((h) => (
                                <span key={h} className="absolute top-0 bottom-0 w-px bg-zinc-200/70 dark:bg-white/[0.05]" style={{ left: `${pctL(h)}%` }} />
                              ))}
                              {/* blocos de parada */}
                              {r.items.map((t) => {
                                const left = pctL(t.sOp)
                                const width = Math.max(0.4, pctL(t.eOp) - left)
                                const color = colorOf.get(t.motivoKey) ?? SEM_MOTIVO_COLOR
                                const segSeg = winSeg(t)
                                const wide = width > 9
                                return (
                                  <div
                                    key={t.p.parada_id}
                                    className="absolute top-0.5 bottom-0.5 flex items-center px-1 overflow-hidden cursor-default"
                                    style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: t.planejada ? 0.95 : 0.82, borderLeft: t.planejada ? "none" : `2px solid rgba(0,0,0,0.25)` }}
                                    onMouseMove={(e) => onSegMove(e, t, r.nome, color)}
                                    onMouseLeave={() => setHover(null)}
                                    title={`${t.motivoLabel} — ${fmtUtcLocal(t.p.inicio_utc)} → ${fmtUtcLocal(t.p.fim_utc)} — ${fmtMin(segSeg)}${t.planejada ? " (planejada)" : ""}`}
                                  >
                                    {wide && (
                                      <span className="text-[9px] font-bold text-white truncate leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
                                        {t.motivoLabel} · {fmtMin(segSeg)}
                                      </span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* tooltip */}
            {hover && (
              <div
                className="absolute z-20 pointer-events-none border border-zinc-200 dark:border-white/[0.12] bg-white dark:bg-[#16181f] px-3 py-2 shadow-lg text-[11px] max-w-[260px]"
                style={{
                  left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 240),
                  top: hover.y + 14,
                }}
              >
                <div className="flex items-center gap-1.5 font-black text-zinc-700 dark:text-white/85 mb-1">
                  <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: hover.color }} />
                  {hover.t.motivoLabel}
                  <span className={`ml-1 px-1 py-0.5 text-[8px] font-bold uppercase tracking-[0.05em] ${hover.t.planejada ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400" : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"}`}>
                    {hover.t.planejada ? "Planej." : "Não pl."}
                  </span>
                </div>
                <div className="space-y-0.5 tabular-nums text-zinc-500 dark:text-white/45">
                  <div className="text-zinc-700 dark:text-white/70 font-bold">{hover.nome}</div>
                  <div>{fmtUtcLocal(hover.t.p.inicio_utc)} → {hover.t.p.em_andamento ? "em andamento" : fmtUtcLocal(hover.t.p.fim_utc)}</div>
                  <div>Duração na janela: <b className="text-zinc-700 dark:text-white/70">{fmtMin(winSeg(hover.t))}</b></div>
                  {(hover.t.p.ct_codigo || hover.t.p.ordem_codigo) && (
                    <div>{[hover.t.p.ct_codigo, hover.t.p.ordem_codigo].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── RELATÓRIO POR MOTIVO ── */}
          <div className="px-4 py-3 border-t border-zinc-100 dark:border-white/[0.06]">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.06em] text-zinc-600 dark:text-white/65">
                <BarChart3 className="w-3.5 h-3.5 text-orange-500" />
                Tempo parado por motivo
              </span>
              <span className="text-[10px] text-zinc-400 dark:text-white/28 tabular-nums uppercase tracking-[0.06em]">
                {dayMode === "all" ? `${scopeDays.length} dias · ${fmtDiaBR(rMin)}→${fmtDiaBR(rMax)}` : fmtDiaBR(anchorDay)} · janela {opHourLabel(startOp)}→{opHourLabel(endOp)} · total {fmtMin(totalReportMin)}
              </span>
            </div>
            {report.arr.length === 0 ? (
              <div className="text-[11px] text-zinc-400 dark:text-white/25 py-2">Nenhuma parada no escopo atual.</div>
            ) : (
              <div className="space-y-1.5">
                {report.arr.map((m) => {
                  const color = colorOf.get(m.key) ?? SEM_MOTIVO_COLOR
                  const pct = totalReportMin > 0 ? (m.seg / totalReportMin) * 100 : 0
                  return (
                    <div key={m.key} className="flex items-center gap-2">
                      <div className={`${LANE_LABEL_W} flex-shrink-0 flex items-center gap-1.5 min-w-0`}>
                        <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: color }} />
                        <span className="text-[11px] font-bold text-zinc-700 dark:text-white/70 truncate">{m.label}</span>
                      </div>
                      <div className="flex-1 h-5 bg-zinc-100 dark:bg-white/[0.03] relative min-w-0">
                        <div className="h-full" style={{ width: `${(m.seg / report.maxSeg) * 100}%`, background: color, opacity: 0.85 }} />
                      </div>
                      <div className="w-[128px] flex-shrink-0 text-right text-[11px] tabular-nums text-zinc-600 dark:text-white/55">
                        <b className="text-zinc-800 dark:text-white/80">{fmtMin(m.seg)}</b>
                        <span className="text-zinc-400 dark:text-white/30"> · {m.count}× · {pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
    </div>
  )
}

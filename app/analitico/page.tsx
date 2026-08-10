// app/analitico/page.tsx
"use client"

import React, {
  Suspense, useCallback, useEffect, useMemo, useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import {
  Activity, AlertCircle, AlertTriangle, BarChart2,
  BookOpen, Calendar, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Clock, Copy, Download,
  FileText, Filter, Layers, Minus, Package,
  Printer, RefreshCcw, TrendingDown, TrendingUp,
  Users, X, Zap, ArrowUpDown, Search,
} from "lucide-react"

import {
  useAnalitico,
  useAnaliticoLookups,
  useParadasPareto,
  GRANULARITY_LABELS,
  GRANULARITY_OPTIONS,
  type AnalyticsTab,
  type AnalyticsFilters,
  type Granularity,
  type AnalyticsSummary,
  type CentroTrabalho,
  type Turno,
  type Produto,
  type MotivoParada,
  type OrdemProducao,
} from "@/hooks/analitico/use-api"
import { ShiftChart, buildShiftChart, sortByShift, SHIFT_PAL, type ShiftTab } from "@/components/analitico/shift-chart"
import { RebarbadorAnaliticoSection } from "@/components/analitico/rebarbador-charts"

/* ══════════════════════════════════════════════════════════════
 * TAB CONFIG
 * ══════════════════════════════════════════════════════════════ */
interface TabDef {
  id: AnalyticsTab
  label: string
  shortLabel: string
  icon: React.ElementType
  color: string
  bgColor: string
  description: string
}

const TABS: TabDef[] = [
  { id: "oee", label: "OEE", shortLabel: "OEE", icon: Activity, color: "#7e390b", bgColor: "#eff6ff", description: "Eficiência global: Disponibilidade × Performance × Qualidade" },
  { id: "producao", label: "Produção", shortLabel: "Prod.", icon: Package, color: "#7e390b", bgColor: "#f0fdf4", description: "Volume produzido, capacidade, FPY e taxas de qualidade" },
  { id: "paradas", label: "Paradas", shortLabel: "Parad.", icon: Clock, color: "#7e390b", bgColor: "#fffbeb", description: "Tempo e frequência de paradas planejadas e não planejadas" },
  { id: "refugo", label: "Refugo", shortLabel: "Ref.", icon: AlertCircle, color: "#7e390b", bgColor: "#fef2f2", description: "Peças descartadas — quantidade e taxa percentual" },
  { id: "retrabalho", label: "Retrabalho", shortLabel: "Retrab", icon: RefreshCcw, color: "#7e390b", bgColor: "#fff7ed", description: "Peças reprocessadas — custo oculto de qualidade" },
  { id: "ciclo", label: "Ciclo", shortLabel: "Ciclo", icon: Zap, color: "#7e390b", bgColor: "#f5f3ff", description: "Tempo de ciclo real vs. ideal — velocidade de processo" },
  { id: "perdas", label: "Perdas", shortLabel: "Perd.", icon: TrendingDown, color: "#7e390b", bgColor: "#eef2ff", description: "Perdas totais por tempo e quantidade" },
  { id: "pessoas", label: "Rebarbadores", shortLabel: "Rebarb.", icon: Users, color: "#7e390b", bgColor: "#ecfeff", description: "Rebarbadores ativos e interações registradas" },
]

/* ══════════════════════════════════════════════════════════════
 * METRIC & COLUMN CONFIG
 * ══════════════════════════════════════════════════════════════ */
interface MetricDef {
  label: string
  key: string
  unit?: string
  /**
   * isPercent = true  →  API retorna valor em escala decimal 0–1
   *                      (ex: oee=0.9111, availability=1.0000).
   *                      A UI multiplica por 100 antes de exibir.
   */
  isPercent?: boolean
  isTime?: boolean
}

type ColKind = "text" | "number" | "time" | "pct" | "badge"
interface ColDef { key: string; label: string; kind?: ColKind; sortable?: boolean }

interface TabConfig {
  metrics: MetricDef[]
  columns: ColDef[]
  hasMotivo?: boolean
}

const TAB_CONFIGS: Record<AnalyticsTab, TabConfig> = {
  oee: {
    metrics: [
      { label: "OEE", key: "oee", unit: "%", isPercent: true },
      { label: "Disponibilidade", key: "disponibilidade", unit: "%", isPercent: true },
      { label: "Performance", key: "performance", unit: "%", isPercent: true },
      { label: "Qualidade", key: "qualidade", unit: "%", isPercent: true },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "oee", label: "OEE (%)", kind: "pct", sortable: true },
      { key: "disponibilidade", label: "Disponib. (%)", kind: "pct", sortable: true },
      { key: "performance", label: "Perf. (%)", kind: "pct", sortable: true },
      { key: "qualidade", label: "Qualidade (%)", kind: "pct", sortable: true },
      { key: "total_good", label: "Aprovado", kind: "number", sortable: true },
      { key: "total_produzido", label: "Total Prod.", kind: "number", sortable: true },
    ],
  },
  producao: {
    metrics: [
      { label: "Aprovado", key: "good", unit: "UN" },
      { label: "Total Produzido", key: "total_produzido", unit: "UN" },
      { label: "Capacidade", key: "capacidade", unit: "UN" },
      { label: "1ª Passagem", key: "fpy", unit: "%", isPercent: true },
      { label: "Refugo", key: "scrap", unit: "UN" },
      { label: "Retrabalho", key: "rework", unit: "UN" },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "good", label: "Aprovado", kind: "number", sortable: true },
      { key: "total_produzido", label: "Total", kind: "number", sortable: true },
      { key: "capacidade", label: "Capacidade", kind: "number", sortable: true },
      { key: "fpy", label: "1ª Passagem (%)", kind: "pct", sortable: true },
      { key: "scrap", label: "Refugo", kind: "number", sortable: true },
      { key: "rework", label: "Retrabalho", kind: "number", sortable: true },
      { key: "ciclo_medio_seg", label: "Ciclo Médio", kind: "number", sortable: true },
      { key: "ciclo_ideal_seg", label: "Ciclo Ideal", kind: "number", sortable: true },
    ],
  },
  paradas: {
    hasMotivo: true,
    metrics: [
      { label: "Duração Total", key: "duracao_seg", unit: "s", isTime: true },
      { label: "Dur. Planejada", key: "dur_planejada_seg", unit: "s", isTime: true },
      { label: "Dur. N.Planejada", key: "dur_nao_planejada_seg", unit: "s", isTime: true },
      { label: "Ocorrências", key: "ocorrencias", unit: "UN" },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "duracao_fmt", label: "Duração Total", kind: "text", sortable: false },
      { key: "dur_planejada_seg", label: "Planejada", kind: "number", sortable: true },
      { key: "dur_nao_planejada_seg", label: "Não Planejada", kind: "number", sortable: true },
      { key: "ocorrencias", label: "Ocorrências", kind: "number", sortable: true },
      { key: "mttr_seg", label: "MTTR", kind: "number", sortable: true },
      { key: "mtbf_seg", label: "MTBF", kind: "number", sortable: true },
    ],
  },
  refugo: {
    metrics: [
      { label: "Qtd. Refugo", key: "refugo", unit: "UN" },
      { label: "Taxa de Refugo", key: "taxa_refugo", unit: "%", isPercent: true },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "refugo", label: "Qtd. Refugo", kind: "number", sortable: true },
      { key: "taxa_refugo", label: "Taxa (%)", kind: "pct", sortable: true },
      { key: "total_produzido", label: "Total", kind: "number", sortable: true },
    ],
  },
  retrabalho: {
    metrics: [
      { label: "Qtd. Retrabalho", key: "retrabalho", unit: "UN" },
      { label: "Taxa de Retrabalho", key: "taxa_retrabalho", unit: "%", isPercent: true },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "retrabalho", label: "Qtd. Retrabalho", kind: "number", sortable: true },
      { key: "taxa_retrabalho", label: "Taxa (%)", kind: "pct", sortable: true },
      { key: "total_produzido", label: "Total", kind: "number", sortable: true },
    ],
  },
  ciclo: {
    metrics: [
      { label: "Ciclo Médio", key: "ciclo_medio_seg", unit: "s", isTime: true },
      { label: "Ciclo Ideal", key: "ciclo_ideal_seg", unit: "s", isTime: true },
      { label: "Desvio", key: "desvio_seg", unit: "s" },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "ciclo_medio_fmt", label: "Ciclo Médio", kind: "text", sortable: false },
      { key: "ciclo_ideal_seg", label: "Ideal (s)", kind: "number", sortable: true },
      { key: "desvio_seg", label: "Desvio (s)", kind: "number", sortable: true },
      { key: "total_ciclos", label: "Total Ciclos", kind: "number", sortable: true },
    ],
  },
  perdas: {
    hasMotivo: true,
    metrics: [
      { label: "Tempo Perdido", key: "tempo_perdido_seg", unit: "s", isTime: true },
      { label: "Qtd. Perdida", key: "qtd_perdida", unit: "UN" },
      { label: "Paradas Plan.", key: "dur_planejada_seg", unit: "s", isTime: true },
      { label: "Paradas N.Plan.", key: "dur_nao_planejada_seg", unit: "s", isTime: true },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "tempo_perdido_fmt", label: "Tempo Perdido", kind: "text", sortable: false },
      { key: "qtd_perdida", label: "Qtd. Perdida", kind: "number", sortable: true },
      { key: "scrap", label: "Refugo", kind: "number", sortable: true },
      { key: "rework", label: "Retrabalho", kind: "number", sortable: true },
    ],
  },
  pessoas: {
    metrics: [
      { label: "Pessoas Ativas", key: "pessoas_ativas", unit: "UN" },
      { label: "Interações", key: "total_interacoes", unit: "UN" },
    ],
    columns: [
      { key: "turno", label: "Período", kind: "text", sortable: true },
      { key: "pessoas_ativas", label: "Pessoas Ativas", kind: "number", sortable: true },
      { key: "total_interacoes", label: "Interações", kind: "number", sortable: true },
    ],
  },
}

const PARETO_COLUMNS: ColDef[] = [
  { key: "motivo_descricao", label: "Motivo", kind: "text", sortable: true },
  { key: "motivo_grupo_perda", label: "Grupo", kind: "badge", sortable: true },
  { key: "is_planejada", label: "Planejada", kind: "badge", sortable: true },
  { key: "duracao_total_seg", label: "Dur. (s)", kind: "number", sortable: true },
  { key: "quantidade", label: "Ocorrências", kind: "number", sortable: true },
  { key: "percentual_duracao", label: "%", kind: "pct", sortable: true },
  { key: "percentual_acumulado", label: "% Acum.", kind: "pct", sortable: true },
]

/* ══════════════════════════════════════════════════════════════
 * UTILS
 * ══════════════════════════════════════════════════════════════ */
const pad2 = (n: number) => String(n).padStart(2, "0")

function utcToYMD(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function toIsoUTC(s: string, eod = false): Date | undefined {
  if (!s) return undefined
  const [y, m, d] = s.split("-").map(Number)
  if (!y || !m || !d) return undefined
  return eod
    ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
}

/**
 * Data local do dispositivo (America/Sao_Paulo), não UTC — precisa bater
 * com o dia operacional (computeOpWindow trata Y/M/D como wall-clock
 * local). Usar utcToYMD aqui erraria o dia perto da virada 21h–00h BRT,
 * quando o calendário UTC já está no dia seguinte.
 */
function todayLocalYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function defaultRange() {
  const today = todayLocalYMD()
  return { start: today, end: today }
}

function fmtBR(s: string) {
  if (!s || s.length < 10) return s
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

function fmtN(n: number, dec = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/**
 * Formata um número qualquer como porcentagem.
 * n deve estar em escala 0–100 (já convertido do decimal 0–1 da API).
 */
function fmtPct(n: number, dec = 2) {
  if (!Number.isFinite(n)) return "—"
  return `${n.toFixed(dec).replace(".", ",")}%`
}

/**
 * Converte valor decimal 0–1 (retornado pela API/views SQL) para escala 0–100.
 * Usado para todas as métricas marcadas como isPercent.
 *
 * FIX PRINCIPAL: as views vw_oee_por_turno e vw_hist_oee_diario retornam
 * availability/performance/quality/oee como decimal(8,4) entre 0.0000 e 1.0000.
 * Sem esta conversão o OEE exibia "0,91%" em vez de "91,11%".
 */
function decimalToPct(v: number): number {
  return v * 100
}

/** Grupos de perda vêm do banco em inglês (catálogo) — tradução só de exibição. */
const GRUPO_PERDA_PT: Record<string, string> = {
  AVAILABILITY: "Disponibilidade",
  PERFORMANCE: "Performance",
  QUALITY: "Qualidade",
}
function grupoPerdaPt(s: string | null | undefined): string {
  const key = String(s ?? "").trim().toUpperCase()
  return GRUPO_PERDA_PT[key] ?? String(s ?? "")
}

function fmtSec(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00"
  const sInt = Math.round(s)
  const h = Math.floor(sInt / 3600)
  const m = Math.floor((sInt % 3600) / 60)
  return `${h}:${pad2(m)}`
}

/** m:ss — para tempo de ciclo (segundos), evita "0:00" que o h:mm produziria */
function fmtMMSS(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00"
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${pad2(t % 60)}`
}

function numOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function csvEscape(v: any) {
  const s = String(v ?? "")
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function diffDays(start: string, end: string) {
  const s = toIsoUTC(start)?.getTime() ?? 0
  const e = toIsoUTC(end, true)?.getTime() ?? 0
  return Math.max(1, Math.round((e - s) / 86_400_000))
}

function shiftRange(start: string, end: string, delta: number) {
  const ms = delta * 86_400_000
  return {
    start: utcToYMD(new Date((toIsoUTC(start)?.getTime() ?? 0) + ms)),
    end: utcToYMD(new Date((toIsoUTC(end, true)?.getTime() ?? 0) + ms)),
  }
}

function getTrend(data: number[]): "up" | "down" | "flat" {
  const valid = data.filter(v => Number.isFinite(v) && v !== 0)
  if (valid.length < 2) return "flat"
  const half = Math.floor(valid.length / 2)
  const first = valid.slice(0, half).reduce((a, b) => a + b, 0) / half
  const second = valid.slice(half).reduce((a, b) => a + b, 0) / (valid.length - half)
  const diff = (second - first) / Math.abs(first || 1)
  return diff > 0.02 ? "up" : diff < -0.02 ? "down" : "flat"
}

/* ══════════════════════════════════════════════════════════════
 * DATE RANGE PICKER — idêntico ao /historico
 * ══════════════════════════════════════════════════════════════ */
const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

type PresetId = "hoje" | "ontem" | "7d" | "30d" | "semana_atual" | "semana_ant" | "mes_atual" | "mes_ant" | "personalizado"

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "semana_atual", label: "Semana atual" },
  { id: "semana_ant", label: "Semana anterior" },
  { id: "mes_atual", label: "Mês atual" },
  { id: "mes_ant", label: "Mês anterior" },
  { id: "personalizado", label: "Personalizado" },
]

function applyPreset(id: PresetId): { start: Date; end: Date } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  switch (id) {
    case "hoje": return { start: today, end: today }
    case "ontem": return { start: yesterday, end: yesterday }
    case "7d": { const s = new Date(today); s.setDate(today.getDate() - 6); return { start: s, end: today } }
    case "30d": { const s = new Date(today); s.setDate(today.getDate() - 29); return { start: s, end: today } }
    case "semana_atual": {
      const day = today.getDay(), diff = (day + 6) % 7
      const s = new Date(today); s.setDate(today.getDate() - diff)
      const e = new Date(s); e.setDate(s.getDate() + 6)
      return { start: s, end: e }
    }
    case "semana_ant": {
      const day = today.getDay(), diff = (day + 6) % 7
      const e = new Date(today); e.setDate(today.getDate() - diff - 1)
      const s = new Date(e); s.setDate(e.getDate() - 6)
      return { start: s, end: e }
    }
    case "mes_atual": {
      const s = new Date(today.getFullYear(), today.getMonth(), 1)
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return { start: s, end: e }
    }
    case "mes_ant": {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const e = new Date(today.getFullYear(), today.getMonth(), 0)
      return { start: s, end: e }
    }
    default: return { start: today, end: today }
  }
}

function yyyymmddToDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/* ══════════════════════════════════════════════════════════════
 * JANELA DO DIA OPERACIONAL (06h→06h, hora local da planta)
 *
 * O backend filtra por instantes UTC (bucket_time_utc etc.). Um dia
 * operacional vai de HH:MM local do dia D até HH:MM local do dia D+1
 * (ex.: 06:00 → 06:00). Precisamos converter a "hora de parede" local
 * (America/Sao_Paulo) para o instante UTC correto — robusto a fuso/DST
 * via Intl, sem hardcode de −03:00.
 * ══════════════════════════════════════════════════════════════ */
const TZ_PLANTA = "America/Sao_Paulo"

/** [h, m] a partir de "HH:MM" (default 06:00 se inválido) */
function hmParts(hm: string): [number, number] {
  const [h, m] = String(hm ?? "").split(":").map(Number)
  return [Number.isFinite(h) ? h : 6, Number.isFinite(m) ? m : 0]
}

/** Quanto o fuso local está adiantado em relação ao UTC, no instante dado (ms). */
function tzOffsetMs(utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_PLANTA, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(utcDate)) p[part.type] = part.value
  const hour = p.hour === "24" ? "00" : p.hour
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second)
  return asUTC - utcDate.getTime()
}

/** Hora de parede local (America/Sao_Paulo) → instante UTC. */
function localWallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0)
  const off = tzOffsetMs(new Date(guess))
  let result = new Date(guess - off)
  const off2 = tzOffsetMs(result)
  if (off2 !== off) result = new Date(guess - off2)
  return result
}

/**
 * Deriva a janela UTC efetiva a partir das datas (YYYY-MM-DD) e horários
 * (HH:MM) de início/fim do dia operacional. Quando o horário de fim ≤ o de
 * início, o fim cai no dia seguinte (ex.: 06:00→06:00, 21:30→06:00).
 */
function computeOpWindow(startYMD: string, endYMD: string, startHM: string, endHM: string) {
  const [sh, sm] = hmParts(startHM)
  const [eh, em] = hmParts(endHM)
  const crosses = eh * 60 + em <= sh * 60 + sm
  const s = yyyymmddToDate(startYMD)
  const e = yyyymmddToDate(endYMD)
  if (crosses) e.setDate(e.getDate() + 1)
  const startDt = localWallToUtc(s.getFullYear(), s.getMonth(), s.getDate(), sh, sm)
  const endDt = localWallToUtc(e.getFullYear(), e.getMonth(), e.getDate(), eh, em)
  const endDateDisplay = `${pad2(e.getDate())}/${pad2(e.getMonth() + 1)}/${e.getFullYear()}`
  return { startDt, endDt, endDateDisplay, crosses }
}

function DateRangePicker({ isOpen, onClose, startDate, endDate, onSelect }: {
  isOpen: boolean; onClose: () => void
  startDate: Date; endDate: Date
  onSelect: (s: Date, e: Date) => void
}) {
  const [preset, setPreset] = useState<PresetId>("personalizado")
  const [s, setS] = useState(startDate), [e, setE] = useState(endDate)
  const [picking, setPicking] = useState<"start" | "end">("start")
  const [lm, setLm] = useState(new Date(startDate.getFullYear(), startDate.getMonth(), 1))
  const [rm, setRm] = useState(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1))

  useEffect(() => {
    if (!isOpen) return
    setS(startDate); setE(endDate)
    setLm(new Date(startDate.getFullYear(), startDate.getMonth(), 1))
    setRm(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1))
  }, [isOpen, startDate, endDate])

  const handleDay = (d: Date) => {
    setPreset("personalizado")
    if (picking === "start" || d < s) { setS(d); setE(d); setPicking("end") }
    else { setE(d); setPicking("start") }
  }

  const Cal = ({ month, setMonth }: { month: Date; setMonth: (d: Date) => void }) => {
    const y = month.getFullYear(), mo = month.getMonth()
    const off = (new Date(y, mo, 1).getDay() + 6) % 7
    const dim = new Date(y, mo + 1, 0).getDate()
    const prev = new Date(y, mo, 0).getDate()
    const days: { date: Date; cur: boolean }[] = []
    for (let i = 0; i < off; i++) days.push({ date: new Date(y, mo - 1, prev - off + i + 1), cur: false })
    for (let i = 1; i <= dim; i++) days.push({ date: new Date(y, mo, i), cur: true })
    while (days.length < 42) days.push({ date: new Date(y, mo + 1, days.length - off - dim + 1), cur: false })
    return (
      <div className="w-52">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(new Date(y, mo - 1, 1))} className="p-1 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors">
            <ChevronLeft className="w-4 h-4 text-zinc-400 dark:text-white/30" />
          </button>
          <span className="text-sm font-bold text-zinc-800 dark:text-white/75">{MONTHS_PT[mo]} {y}</span>
          <button onClick={() => setMonth(new Date(y, mo + 1, 1))} className="p-1 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors">
            <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-white/30" />
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {"STQQSSD".split("").map((d, i) => (
            <div key={i} className="text-center text-[10px] font-bold text-zinc-400 dark:text-white/25 py-0.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d, i) => {
            const isSt = d.date.toDateString() === s.toDateString()
            const isEn = d.date.toDateString() === e.toDateString()
            const inR = d.date > s && d.date < e
            return (
              <button key={i} onClick={() => d.cur && handleDay(d.date)}
                className={[
                  "py-1.5 text-[12px] font-medium transition-all",
                  !d.cur ? "text-zinc-300 dark:text-white/12 cursor-default" : "text-zinc-700 dark:text-white/60 hover:bg-zinc-100 dark:hover:bg-white/[0.07]",
                  (isSt || isEn) ? "!bg-zinc-900 dark:!bg-white !text-white dark:!text-zinc-900 !font-bold" : "",
                  (inR && !isSt && !isEn) ? "!bg-zinc-100 dark:!bg-white/[0.08] !text-zinc-800 dark:!text-white/70" : "",
                ].filter(Boolean).join(" ")}
              >{d.date.getDate()}</button>
            )
          })}
        </div>
      </div>
    )
  }

  if (!isOpen) return null
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-sm p-4"
      onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-[#0d1117] border border-zinc-200 dark:border-white/[0.1] shadow-2xl overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-white/[0.07] bg-zinc-50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-zinc-900 dark:text-white/80 text-sm tracking-tight">Selecionar período</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.07] transition-colors">
            <X className="w-4 h-4 text-zinc-400 dark:text-white/30" />
          </button>
        </div>
        <div className="flex flex-col sm:flex-row">
          {/* presets */}
          <div className="w-full sm:w-44 border-b sm:border-b-0 sm:border-r border-zinc-100 dark:border-white/[0.06] p-3 bg-zinc-50/60 dark:bg-white/[0.015]">
            <p className="text-[10px] font-bold text-zinc-400 dark:text-white/25 uppercase tracking-[0.2em] mb-2 px-1">Atalhos rápidos</p>
            {PRESETS.map(p => (
              <button key={p.id}
                onClick={() => { setPreset(p.id); if (p.id !== "personalizado") { const { start, end } = applyPreset(p.id); setS(start); setE(end) } }}
                className={[
                  "w-full text-left px-2.5 py-1.5 text-[12px] font-medium mb-0.5 transition-all",
                  preset === p.id
                    ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold"
                    : "text-zinc-600 dark:text-white/40 hover:bg-white dark:hover:bg-white/[0.06]",
                ].join(" ")}
              >{p.label}</button>
            ))}
          </div>
          {/* calendars */}
          <div className="p-5 flex flex-col sm:flex-row gap-6">
            <Cal month={lm} setMonth={setLm} />
            <Cal month={rm} setMonth={setRm} />
          </div>
        </div>
        {/* footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-zinc-100 dark:border-white/[0.07] bg-zinc-50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2 border border-zinc-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.03] px-3 py-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-sm font-mono text-zinc-700 dark:text-white/60 tabular-nums">
              {s.toLocaleDateString("pt-BR")} — {e.toLocaleDateString("pt-BR")}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 border border-zinc-200 dark:border-white/[0.1] text-sm text-zinc-600 dark:text-white/40 hover:bg-zinc-50 dark:hover:bg-white/[0.06] transition-colors font-medium">
              Cancelar
            </button>
            <button onClick={() => { onSelect(s, e); onClose() }}
              className="px-5 py-2 bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold transition-colors">
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
 * SELECT FIELD
 * ══════════════════════════════════════════════════════════════ */
function SelectField({
  label, value, onChange, children, hint, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void
  children: React.ReactNode; hint?: string; disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30">{label}</label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none pl-3 pr-8 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-amber-500/30 text-zinc-700 dark:text-white/65 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {children}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-white/30 pointer-events-none" />
      </div>
      {hint && <p className="text-[10px] text-zinc-400 dark:text-white/22">{hint}</p>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
 * OEE SUMMARY BAR
 * FIX: summary values chegam como decimal 0–1 da API.
 *      Multiplicamos por 100 antes de comparar thresholds e exibir.
 * ══════════════════════════════════════════════════════════════ */
function OeeSummaryBar({ summary }: { summary: AnalyticsSummary }) {
  const items = [
    { label: "OEE", rawValue: summary.oee_geral, icon: Activity },
    { label: "Disponibilidade", rawValue: summary.disponibilidade_geral, icon: CheckCircle2 },
    { label: "Performance", rawValue: summary.performance_geral, icon: Zap },
    { label: "Qualidade", rawValue: summary.qualidade_geral, icon: BarChart2 },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {items.map(({ label, rawValue }) => {
        // FIX: API retorna 0.0–1.0 (decimal(8,4) do SQL Server).
        // Convertemos para 0–100 para thresholds e exibição.
        const v = rawValue != null ? decimalToPct(rawValue) : null
        const color = v == null ? "#a1a1aa" : v >= 70 ? "#16a34a" : v >= 55 ? "#f59e0b" : "#ef4444"
        const status = v == null ? "N/D" : v >= 70 ? "Excelente" : v >= 55 ? "Atenção" : "Crítico"

        return (
          <div
            key={label}
            className="relative overflow-hidden border bg-white dark:bg-white/[0.025] p-4"
            style={{
              borderColor: v == null ? "rgba(0,0,0,0.08)" : `${color}28`,
              borderLeftWidth: "2px",
              borderLeftColor: color,
            }}
          >
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 dark:text-white/30 mb-2">{label}</div>
            <div
              className="text-2xl font-black tabular-nums leading-none"
              style={{ color }}
            >
              {/* v já está em 0–100, fmtPct não multiplica */}
              {v != null ? fmtPct(v) : "—"}
            </div>
            {v != null && (
              <div
                className="absolute top-3 right-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
                style={{ background: `${color}18`, color }}
              >
                {status}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
 * KPI CARD
 * ══════════════════════════════════════════════════════════════ */
function KpiCard({
  label, value, sub, color, trend, formatter, isPrimary,
}: {
  label: string; value: number; sub?: string; color?: string
  trend?: "up" | "down" | "flat"; formatter?: (v: number) => string
  isPrimary?: boolean
}) {
  const fmt = formatter ?? (v => fmtN(v, 2))
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus
  const trendColor = "oklch(0.45 0.14 60)"
  const trendBorderColor = "oklch(0.72 0.16 65)"
  const displayValue = fmt(value)
  const unitMatch = displayValue.match(/^(.+?)\s*(%|op\.|p\S*\/h)$/i)
  const valueText = unitMatch ? unitMatch[1] : displayValue
  const unitText = unitMatch ? unitMatch[2] : null
  const valueColor = isPrimary ? "oklch(0.45 0.14 60)" : "oklch(0.18 0.025 255)"
  const cardBorderColor = "rgba(0,0,0,0.08)"

  return (
    <div
      className="relative overflow-hidden border bg-white dark:bg-white/[0.025] p-4 font-mono tabular-nums"
      style={{
        fontFamily: "var(--font-mono), 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
        borderTopColor: cardBorderColor,
        borderRightColor: cardBorderColor,
        borderBottomColor: cardBorderColor,
        borderLeftColor: cardBorderColor,
      }}
    >
      {isPrimary && (
        <div
          aria-hidden="true"
          className="absolute left-0 top-1/2 w-0.5 -translate-y-1/2"
          style={{ height: "85%", background: "oklch(0.72 0.16 65)" }}
        />
      )}
      <div
        className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
        style={{ color: "oklch(0.62 0.018 255)" }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="tabular-nums"
          style={{
            color: valueColor,
            fontFamily: "var(--font-mono), 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
            fontSize: "28px",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {valueText}
        </span>
        {unitText && (
          <span
            className="tabular-nums"
            style={{
              color: "oklch(0.62 0.018 255)",
              fontFamily: "var(--font-mono), 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
              fontSize: "14px",
              fontWeight: 400,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {unitText}
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-1 text-[10px] font-normal tabular-nums" style={{ color: "oklch(0.62 0.018 255)" }}>
          {sub}
        </div>
      )}
      {trend && (
        <div
          className="absolute top-3 right-3 flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
          style={{
            background: "oklch(0.72 0.16 65 / 0.08)",
            borderColor: trendBorderColor,
            color: trendColor,
          }}
        >
          <TrendIcon className="w-2.5 h-2.5" />
          {trend === "up" ? "Alta" : trend === "down" ? "Baixa" : "Estável"}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
 * STATUS BADGE
 * ══════════════════════════════════════════════════════════════ */
function StatusBadge({ loading, error, count }: { loading: boolean; error: Error | null; count: number }) {
  if (loading) return (
    <div className="flex items-center gap-2 px-2.5 py-1 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25">
      <div className="w-1.5 h-1.5 bg-amber-500 animate-pulse" />
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">Carregando…</span>
    </div>
  )
  if (error) return (
    <div className="flex items-center gap-2 px-2.5 py-1 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25">
      <div className="w-1.5 h-1.5 bg-red-500" />
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-red-600 dark:text-red-400">Erro na consulta</span>
    </div>
  )
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25">
      <div className="w-1.5 h-1.5 bg-emerald-500" />
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400">{count} registro{count !== 1 ? "s" : ""}</span>
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════
 * DATA TABLE
 * FIX: colunas kind="pct" recebem valores 0–1 da API.
 *      Multiplicamos por 100 antes de fmtPct.
 *      Keys dos <option> usam índice como sufixo para evitar
 *      duplicatas quando o backend repete IDs (CT × turno cross join).
 * ══════════════════════════════════════════════════════════════ */
function DataTable({
  columns, rows, sortCol, sortDir, onSort,
  page, totalPages, pageSize, totalRows,
  onPrev, onNext, onPageSize, onCopy, onExport, onPrint,
  renderCell: renderCellOverride, rowAccent, totals, legend,
}: {
  columns: ColDef[]; rows: any[]
  sortCol: string | null; sortDir: "asc" | "desc"; onSort: (k: string) => void
  page: number; totalPages: number; pageSize: number; totalRows: number
  onPrev: () => void; onNext: () => void
  onPageSize: (n: number) => void
  onCopy: () => void; onExport: () => void; onPrint: () => void
  /** Renderização customizada por coluna (ex.: cor por limiar, mini-barra). Retornar undefined cai no default. */
  renderCell?: (col: ColDef, row: any) => React.ReactNode | undefined
  /** Destaque de linha (ex.: melhor/pior turno) — borda + tag na 1ª coluna. */
  rowAccent?: (row: any) => { color: string; tag?: string } | undefined
  /** Linha de totais/médias do período filtrado (não só a página atual), por chave de coluna. */
  totals?: Record<string, React.ReactNode>
  /** Legenda curta exibida abaixo do cabeçalho (cores/símbolos usados nas células). */
  legend?: React.ReactNode
}) {
  const [search, setSearch] = useState("")

  const filteredRows = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r => Object.values(r).some(v => String(v ?? "").toLowerCase().includes(q)))
  }, [rows, search])

  const startN = totalRows ? (page - 1) * pageSize + 1 : 0
  const endN = totalRows ? Math.min(page * pageSize, totalRows) : 0

  const renderCell = (col: ColDef, v: any) => {
    if (v == null || v === "") return <span className="text-zinc-300 dark:text-white/15 select-none">—</span>
    switch (col.kind) {
      case "pct": {
        // FIX: API retorna decimais 0–1 → multiplicar por 100 antes de exibir
        const raw = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."))
        const display = Number.isFinite(raw) ? decimalToPct(raw) : NaN
        return (
          <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">
            {Number.isFinite(display) ? fmtPct(display) : String(v)}
          </span>
        )
      }
      case "number":
        return <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{fmtN(numOf(v))}</span>
      case "time":
        return <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{String(v)}</span>
      case "badge": {
        const s = String(v)
        const bColor = s === "AVAILABILITY" || s === "true" ? "#10b981"
          : s === "PERFORMANCE" ? "#3b82f6"
            : s === "QUALITY" ? "#8b5cf6"
              : s === "false" ? "#94a3b8"
                : "#64748b"
        return (
          <span
            className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{ background: `${bColor}15`, color: bColor, border: `1px solid ${bColor}30` }}
          >
            {s === "true" ? "Sim" : s === "false" ? "Não" : grupoPerdaPt(s)}
          </span>
        )
      }
      default:
        return <span className="font-bold text-[12px] text-zinc-700 dark:text-white/70">{String(v)}</span>
    }
  }

  return (
    <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-zinc-300 dark:text-white/20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-white/45">Dados detalhados</span>
          <span className="text-[10px] font-bold text-zinc-400 dark:text-white/20 bg-zinc-100 dark:bg-white/[0.05] px-2 py-0.5 tabular-nums">
            {totalRows} reg.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-white/30" />
            <input
              type="text"
              placeholder="Filtrar…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 pr-7 text-[11px] border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-zinc-600 dark:text-white/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30 w-36 placeholder:text-zinc-300 dark:placeholder:text-white/18"
            />
            {search && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setSearch("")}
              >
                <X className="w-3.5 h-3.5 text-zinc-400 dark:text-white/30 hover:text-zinc-700" />
              </button>
            )}
          </div>
          <div className="h-5 w-px bg-zinc-200 dark:bg-white/[0.07]" />
          <button
            className="p-2 hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
            title="Copiar TSV"
            onClick={onCopy}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-2 hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
            title="Exportar CSV"
            onClick={onExport}
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-2 hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
            title="Imprimir"
            onClick={onPrint}
          >
            <Printer className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {legend && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-2 border-b border-zinc-100 dark:border-white/[0.05] bg-zinc-50/60 dark:bg-white/[0.01] text-[10px] text-zinc-500 dark:text-white/40">
          {legend}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-white/[0.06] bg-zinc-50 dark:bg-transparent">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && onSort(col.key)}
                  className={[
                    "px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-white/28 select-none whitespace-nowrap",
                    col.kind === "text" ? "text-left" : "text-right",
                    col.sortable ? "cursor-pointer hover:text-zinc-700 dark:hover:text-white/55 transition-colors" : "",
                  ].join(" ")}
                >
                  <span className={`inline-flex items-center gap-1.5 ${col.kind === "text" ? "" : "justify-end"}`}>
                    {col.label}
                    {col.sortable && sortCol !== col.key && (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                    {sortCol === col.key && (
                      <span className="text-amber-500 font-black">
                        {sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length ? filteredRows.map((row, i) => {
              const accent = rowAccent?.(row)
              return (
                <tr
                  key={i}
                  className="border-b border-zinc-100 dark:border-white/[0.04] hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors"
                >
                  {columns.map((col, ci) => {
                    const custom = renderCellOverride?.(col, row)
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-2 ${col.kind === "text" ? "text-left" : "text-right"}`}
                        style={ci === 0 && accent ? { borderLeft: `3px solid ${accent.color}` } : undefined}
                      >
                        {ci === 0 && accent?.tag && (
                          <span
                            className="inline-flex items-center justify-center w-4 h-4 mr-1.5 text-[10px] font-black text-white align-middle"
                            style={{ background: accent.color }}
                          >
                            {accent.tag}
                          </span>
                        )}
                        {custom !== undefined ? custom : renderCell(col, row?.[col.key])}
                      </td>
                    )
                  })}
                </tr>
              )
            }) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-zinc-400 dark:text-white/18">
                    <Search className="w-6 h-6 opacity-30" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">
                      {search ? `Sem resultados para "${search}"` : "Nenhum dado nos filtros selecionados"}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          {totals && filteredRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 dark:border-white/[0.12] bg-zinc-50 dark:bg-white/[0.03]">
                {columns.map((col, ci) => (
                  <td
                    key={col.key}
                    className={`px-4 py-2 ${col.kind === "text" ? "text-left" : "text-right"}`}
                  >
                    {ci === 0
                      ? <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-white/50">Total do período</span>
                      : (totals[col.key] ?? <span className="text-zinc-300 dark:text-white/15">—</span>)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2.5 border-t border-zinc-100 dark:border-white/[0.05] bg-zinc-50/50 dark:bg-white/[0.015]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onPrev}
            disabled={page <= 1}
            className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-zinc-500 dark:text-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 h-8 inline-flex items-center text-[11px] font-mono font-bold bg-white dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] tabular-nums text-zinc-600 dark:text-white/55">
            {page} / {totalPages}
          </span>
          <button
            onClick={onNext}
            disabled={page >= totalPages}
            className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-zinc-500 dark:text-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-400 dark:text-white/22 tabular-nums">
            {startN}–{endN} de {totalRows}
          </span>
          <select
            value={pageSize}
            onChange={e => onPageSize(Number(e.target.value))}
            className="appearance-none pl-2.5 pr-7 py-1.5 text-[11px] border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-amber-500/30 text-zinc-600 dark:text-white/55 font-medium"
          >
            {[10, 25, 50, 100].map(n => (
              <option key={n} value={n}>{n} / página</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
 * MAIN CONTENT
 * ══════════════════════════════════════════════════════════════ */
function AnalyticContent() {
  const sp = useSearchParams()
  const router = useRouter()

  const defaults = useMemo(() => defaultRange(), [])

  /* ── state ──────────────────────────────────────────────── */
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(() => {
    const t = sp.get("tab") as AnalyticsTab
    return TABS.some(x => x.id === t) ? t : "oee"
  })
  const [granularity] = useState<Granularity>(() => {
    const g = sp.get("gran") as Granularity
    return GRANULARITY_OPTIONS.includes(g) ? g : "op_day"
  })
  const [startDate, setStartDate] = useState(() => sp.get("start") || defaults.start)
  const [endDate, setEndDate] = useState(() => sp.get("end") || defaults.end)
  // Horários do dia operacional (local, editáveis). Default 06:00 → 06:00.
  const [startTime, setStartTime] = useState(() => sp.get("st") || "06:00")
  const [endTime, setEndTime] = useState(() => sp.get("et") || "06:00")

  const [fCentro, setFCentro] = useState("")
  const [fTurno, setFTurno] = useState("")
  const [fProduto, setFProduto] = useState("")
  const [fOrdem, setFOrdem] = useState("")
  const [fMotivo, setFMotivo] = useState("")
  const [fGrupoPerda, setFGrupoPerda] = useState<"" | "AVAILABILITY" | "PERFORMANCE" | "QUALITY">("")

  const [filtersOpen, setFiltersOpen] = useState(true)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [paretoMode, setParetoMode] = useState(false)
  const [metric, setMetric] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const cfg = TAB_CONFIGS[activeTab]
  const tabDef = TABS.find(t => t.id === activeTab)!

  const selMetricLabel = metric || cfg.metrics[0]?.label
  const metricDef = cfg.metrics.find(m => m.label === selMetricLabel) ?? cfg.metrics[0]

  /* ── reset on tab change ─────────────────────────────────── */
  useEffect(() => {
    setMetric(cfg.metrics[0]?.label ?? "")
    setPage(1)
    setSortCol(null)
    setSortDir("asc")
    setParetoMode(false)
    if (!cfg.hasMotivo) {
      setFMotivo("")
      setFGrupoPerda("")
    } else if (activeTab === "paradas") {
      // Filtro "Grupo de Perda" fica oculto em Paradas — evita ficar
      // aplicado silenciosamente ao vir de outra aba (ex.: Perdas).
      setFGrupoPerda("")
    }
  }, [activeTab])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── URL sync ────────────────────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => {
      const nsp = new URLSearchParams()
      nsp.set("tab", activeTab)
      // Só grava start/end na URL quando divergem do padrão (hoje) — gravar
      // sempre congelaria a data: um reload amanhã reabriria a página presa
      // na data de hoje (mesma correção aplicada no /historico).
      const d = defaultRange()
      if (startDate !== d.start || endDate !== d.end) {
        nsp.set("start", startDate)
        nsp.set("end", endDate)
      }
      nsp.set("st", startTime)
      nsp.set("et", endTime)
      nsp.set("gran", granularity)
      router.replace(`?${nsp.toString()}`, { scroll: false })
    }, 400)
    return () => clearTimeout(t)
  }, [activeTab, startDate, endDate, startTime, endTime, granularity, router])

  /* ── dates (janela do dia operacional, hora local → UTC) ──── */
  const opWindow = useMemo(
    () => computeOpWindow(startDate, endDate, startTime, endTime),
    [startDate, endDate, startTime, endTime],
  )
  const startDt = opWindow.startDt
  const endDt = opWindow.endDt
  const hasDates = Boolean(startDt && endDt)

  const rangeError = useMemo(() => {
    if (!startDt || !endDt) return "Data inválida."
    if (endDt <= startDt) return "Fim do período deve ser após o início."
    if ((endDt.getTime() - startDt.getTime()) / 86_400_000 > 730) return "Limite: 2 anos."
    return null
  }, [startDt, endDt])

  // Ex.: "02/07/2026 06:00 — 03/07/2026 06:00"
  const periodText = `${fmtBR(startDate)} ${startTime} — ${opWindow.endDateDisplay} ${endTime}`

  /* ── lookups ─────────────────────────────────────────────── */
  const lookups = useAnaliticoLookups({
    include: ["centros", "turnos", "produtos", "motivos", "ordens"],
    limitOrdens: 300,
    enabled: true,
  })
  const centros = lookups.centros as CentroTrabalho[]
  const turnos = lookups.turnos as Turno[]
  const produtos = lookups.produtos as Produto[]
  const motivos = lookups.motivos as MotivoParada[]
  const ordens = lookups.ordens as OrdemProducao[]

  /* ── build filters ───────────────────────────────────────── */
  const filters = useMemo((): AnalyticsFilters => ({
    startUtc: startDt ?? new Date(),
    endUtc: endDt ?? new Date(),
    centroTrabalhoId: fCentro || undefined,
    turnoId: fTurno || undefined,
    produtoId: fProduto || undefined,
    ordemId: fOrdem || undefined,
    motivoId: fMotivo || undefined,
    motivoGrupoPerda: fGrupoPerda || undefined,
  }), [startDt, endDt, fCentro, fTurno, fProduto, fOrdem, fMotivo, fGrupoPerda])

  /* ── fetch ───────────────────────────────────────────────── */
  // Aba Rebarbadores (pessoas) tem fetch próprio (RebarbadorAnaliticoSection);
  // o fetch genérico por turno seria desperdício lá.
  const analitico = useAnalitico({
    tab: activeTab,
    granularity,
    filters,
    enabled: hasDates && !rangeError && activeTab !== "pessoas",
  })

  // Pareto de paradas — tabela de motivos (só quando o modo está ativo).
  // Sem este fetch o modo Pareto trocava as colunas mas continuava com as
  // linhas por turno → tabela toda "—".
  const paretoActive = paretoMode && activeTab === "paradas"
  const pareto = useParadasPareto({
    filters,
    topN: 50,
    enabled: paretoActive && hasDates && !rangeError,
  })

  /* ══════════════════════════════════════════════════════════
   * CHART DATA
   *
   * FIX PRINCIPAL — escala de percentuais:
   *   As views SQL retornam OEE/Availability/Performance/Quality
   *   como decimal(8,4) no range 0.0000–1.0000.
   *   Sem multiplicar por 100, o gráfico plotava barras ~1px de altura
   *   e o valor exibido era "0,91%" em vez de "91,11%".
   *
   *   Solução: quando metricDef.isPercent === true,
   *   multiplicamos cada valor por 100 ao extrair da API.
   * ══════════════════════════════════════════════════════════ */
  const orderedRows = useMemo(
    () => sortByShift(analitico.rows as any[]),
    [analitico.rows],
  )

  // buildShiftChart monta o gráfico específico da métrica selecionada
  // (empilhado, marcador de meta/ideal, chips D·P·Q, etc.), sempre por turno.
  const shiftConfig = useMemo(
    () => buildShiftChart(activeTab as ShiftTab, orderedRows, metricDef as any),
    [activeTab, orderedRows, metricDef],
  )

  // valores primários da métrica selecionada (já na escala de exibição) → KPIs
  const primaryValues = useMemo(
    () => shiftConfig.bars.map(b => b.value),
    [shiftConfig],
  )

  /* ── kpis ────────────────────────────────────────────────── */
  // primaryValues já estão na escala correta (0–100 para %, valor bruto para outros)
  const kpis = useMemo(() => {
    const valid = primaryValues.filter(v => Number.isFinite(v) && v !== 0)
    if (!valid.length) return { count: 0, min: 0, max: 0, avg: 0, sum: 0, trend: "flat" as const }
    const sum = valid.reduce((a, b) => a + b, 0)
    return {
      count: analitico.rows.length,
      min: Math.min(...valid),
      max: Math.max(...valid),
      avg: sum / valid.length,
      sum,
      trend: getTrend(valid),
    }
  }, [primaryValues, analitico.rows.length])

  /* ── table ───────────────────────────────────────────────── */
  const columns = paretoActive ? PARETO_COLUMNS : cfg.columns
  const tableSource = paretoActive ? (pareto.rows as any[]) : (analitico.rows as any[])

  const sortedRows = useMemo(() => {
    const rows = [...tableSource]
    if (!sortCol) return sortByShift(rows)
    const col = columns.find(c => c.key === sortCol)
    rows.sort((a, b) => {
      const av = a?.[sortCol], bv = b?.[sortCol]
      const diff = col?.kind === "text" ? String(av ?? "").localeCompare(String(bv ?? ""))
        : col?.kind === "time" ? numOf(av) - numOf(bv)
          : numOf(av) - numOf(bv)
      return sortDir === "asc" ? diff : -diff
    })
    return rows
  }, [tableSource, sortCol, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const curPage = Math.min(page, totalPages)
  const pagedRows = sortedRows.slice((curPage - 1) * pageSize, curPage * pageSize)

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }, [sortCol])

  /* ── formatters ──────────────────────────────────────────── */
  // primaryValues já estão em escala 0–100 para isPercent → fmtPct recebe valor em 0–100
  const valueFormatter = useMemo(() => {
    const timeFmt = activeTab === "ciclo" ? fmtMMSS : fmtSec
    if (metricDef?.isPercent) return (v: number) => fmtPct(v)
    if (metricDef?.isTime) return (v: number) => timeFmt(v)
    return (v: number) => fmtN(v, 0)
  }, [metricDef, activeTab])

  /* ── misc ────────────────────────────────────────────────── */
  const hasFilters = Boolean(fCentro || fTurno || fProduto || fOrdem || fMotivo || fGrupoPerda)

  const clearFilters = useCallback(() => {
    setFCentro("")
    setFTurno("")
    setFProduto("")
    setFOrdem("")
    setFMotivo("")
    setFGrupoPerda("")
    // volta à janela do dia operacional padrão (06:00 → 06:00)
    setStartTime("06:00")
    setEndTime("06:00")
    setPage(1)
  }, [])

  const windowDays = useMemo(() => diffDays(startDate, endDate), [startDate, endDate])
  const goPrev = () => {
    const { start, end } = shiftRange(startDate, endDate, -windowDays)
    setStartDate(start); setEndDate(end)
  }
  const goNext = () => {
    const { start, end } = shiftRange(startDate, endDate, windowDays)
    setStartDate(start); setEndDate(end)
  }

  // Valor de célula para export/cópia — mesma escala do que a tela exibe
  // (pct 0–1 → "91,11%", badge true/false → Sim/Não, grupo de perda em pt).
  const cellText = useCallback((col: ColDef, row: any): string => {
    const v = row?.[col.key]
    if (v == null || v === "") return ""
    if (col.kind === "pct") {
      const raw = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."))
      return Number.isFinite(raw) ? fmtPct(decimalToPct(raw)) : String(v)
    }
    if (col.kind === "badge") {
      const s = String(v)
      return s === "true" ? "Sim" : s === "false" ? "Não" : grupoPerdaPt(s)
    }
    return String(v)
  }, [])

  // Exporta TODAS as linhas filtradas/ordenadas (não só a página visível).
  const exportCsv = useCallback(() => {
    const header = columns.map(c => c.label).join(";")
    const lines = sortedRows.map(r => columns.map(c => csvEscape(cellText(c, r))).join(";"))
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `analitico_${activeTab}_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [columns, sortedRows, cellText, activeTab, startDate, endDate])

  const copyTable = useCallback(async () => {
    const h = columns.map(c => c.label).join("\t")
    const l = sortedRows.map(r => columns.map(c => cellText(c, r)).join("\t"))
    await navigator.clipboard.writeText([h, ...l].join("\n")).catch(() => { })
  }, [columns, sortedRows, cellText])

  /* ══════════════════════════════════════════════════════════
   * TABELAS INTERATIVAS — OEE / Produção / Paradas
   * Cores por limiar, mini-barras inline, badge de melhor/pior
   * turno e linha de totais do período (calculada sobre TODAS
   * as linhas filtradas, não só a página atual). Não muda dados
   * vindos da API — só como o valor já existente é exibido.
   * Pareto (paradas) usa outro schema de colunas → fica de fora.
   * ══════════════════════════════════════════════════════════ */
  const interactiveTab = (activeTab === "oee" || activeTab === "producao" || activeTab === "paradas")
    && !paretoActive

  const oeeRenderCell = useCallback((col: ColDef, row: any): React.ReactNode | undefined => {
    if (col.key === "oee" || col.key === "disponibilidade" || col.key === "performance" || col.key === "qualidade") {
      const v = row?.[col.key]
      if (v == null) return undefined
      const pct = decimalToPct(numOf(v))
      const color = pct >= 70 ? SHIFT_PAL.good : pct >= 55 ? SHIFT_PAL.warn : SHIFT_PAL.bad
      return (
        <div className="inline-flex flex-col items-end gap-1 w-16">
          <span className="tabular-nums font-black text-[12px]" style={{ color }}>{fmtPct(pct)}</span>
          <div className="w-full h-1 bg-zinc-100 dark:bg-white/10 overflow-hidden">
            <div className="h-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
          </div>
        </div>
      )
    }
    if (col.key === "turno") {
      const d = decimalToPct(numOf(row?.disponibilidade))
      const p = decimalToPct(numOf(row?.performance))
      const q = decimalToPct(numOf(row?.qualidade))
      const min = Math.min(d, p, q)
      const factor = min === d ? "D" : min === p ? "P" : "Q"
      const factorLabel = factor === "D" ? "Disponibilidade" : factor === "P" ? "Performance" : "Qualidade"
      const color = min >= 70 ? SHIFT_PAL.good : min >= 55 ? SHIFT_PAL.warn : SHIFT_PAL.bad
      return (
        <span className="inline-flex items-center gap-2">
          <span className="font-bold text-zinc-700 dark:text-white/70">{String(row?.turno ?? "—")}</span>
          <span
            className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-black text-white flex-shrink-0"
            style={{ background: color }}
            title={`Fator limitante: ${factorLabel}`}
          >
            {factor}
          </span>
        </span>
      )
    }
    return undefined
  }, [])

  const producaoRenderCell = useCallback((col: ColDef, row: any): React.ReactNode | undefined => {
    if (col.key === "good") {
      return <span className="tabular-nums font-bold text-[12px]" style={{ color: SHIFT_PAL.good }}>{fmtN(numOf(row?.good))}</span>
    }
    if (col.key === "scrap") {
      const v = numOf(row?.scrap)
      return <span className="tabular-nums font-bold text-[12px]" style={v > 0 ? { color: SHIFT_PAL.bad } : undefined}>{fmtN(v)}</span>
    }
    if (col.key === "rework") {
      const v = numOf(row?.rework)
      return <span className="tabular-nums font-bold text-[12px]" style={v > 0 ? { color: SHIFT_PAL.warn } : undefined}>{fmtN(v)}</span>
    }
    if (col.key === "fpy") {
      if (row?.fpy == null) return undefined
      const pct = decimalToPct(numOf(row.fpy))
      const color = pct >= 98 ? SHIFT_PAL.good : pct >= 90 ? SHIFT_PAL.warn : SHIFT_PAL.bad
      return <span className="tabular-nums font-bold text-[12px]" style={{ color }}>{fmtPct(pct)}</span>
    }
    if (col.key === "capacidade") {
      const cap = numOf(row?.capacidade)
      const total = numOf(row?.total_produzido)
      if (!(cap > 0)) return undefined
      const pct = Math.min(100, (total / cap) * 100)
      const color = pct >= 95 ? SHIFT_PAL.good : pct >= 75 ? SHIFT_PAL.warn : SHIFT_PAL.bad
      return (
        <div className="inline-flex flex-col items-end gap-1 w-20" title={`${fmtN(total)} / ${fmtN(cap)} (${pct.toFixed(0)}%)`}>
          <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{fmtN(cap)}</span>
          <div className="w-full h-1 bg-zinc-100 dark:bg-white/10 overflow-hidden">
            <div className="h-full" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      )
    }
    if (col.key === "ciclo_ideal_seg") {
      const v = row?.ciclo_ideal_seg
      if (v == null) return undefined
      return <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{fmtMMSS(numOf(v))}</span>
    }
    if (col.key === "ciclo_medio_seg") {
      const v = row?.ciclo_medio_seg
      if (v == null) return undefined
      const real = numOf(v)
      const ideal = numOf(row?.ciclo_ideal_seg)
      const ratio = ideal > 0 ? real / ideal : null
      const color = ratio == null ? SHIFT_PAL.volume : ratio <= 1.05 ? SHIFT_PAL.good : ratio <= 1.2 ? SHIFT_PAL.warn : SHIFT_PAL.bad
      return (
        <span
          className="tabular-nums font-bold text-[12px]"
          style={{ color }}
          title={ideal > 0 ? `Ideal: ${fmtMMSS(ideal)}` : undefined}
        >
          {fmtMMSS(real)}
        </span>
      )
    }
    return undefined
  }, [])

  const paradasRenderCell = useCallback((col: ColDef, row: any): React.ReactNode | undefined => {
    if (col.key === "duracao_fmt") {
      const plan = numOf(row?.dur_planejada_seg)
      const nplan = numOf(row?.dur_nao_planejada_seg)
      const tot = plan + nplan
      const planPct = tot > 0 ? (plan / tot) * 100 : 0
      return (
        <div className="inline-flex flex-col items-end gap-1 w-24">
          <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{String(row?.duracao_fmt ?? "—")}</span>
          {tot > 0 && (
            <div className="w-full h-1.5 flex overflow-hidden" title={`Planejada ${fmtSec(plan)} · Não planejada ${fmtSec(nplan)}`}>
              <div style={{ width: `${planPct}%`, background: SHIFT_PAL.planned }} />
              <div style={{ width: `${100 - planPct}%`, background: SHIFT_PAL.unplanned }} />
            </div>
          )}
        </div>
      )
    }
    if (col.key === "dur_planejada_seg" || col.key === "dur_nao_planejada_seg") {
      const isPlan = col.key === "dur_planejada_seg"
      const v = numOf(row?.[col.key])
      const tot = numOf(row?.dur_planejada_seg) + numOf(row?.dur_nao_planejada_seg)
      const pct = tot > 0 ? (v / tot) * 100 : 0
      return (
        <div className="inline-flex flex-col items-end gap-0.5">
          <span className="tabular-nums font-bold text-[12px]" style={{ color: isPlan ? SHIFT_PAL.planned : SHIFT_PAL.unplanned }}>
            {fmtSec(v)}
          </span>
          <span className="text-[9px] tabular-nums text-zinc-400 dark:text-white/30">{pct.toFixed(0)}% do total</span>
        </div>
      )
    }
    if (col.key === "ocorrencias") {
      const qp = numOf(row?.qtd_planejada)
      const qn = numOf(row?.qtd_nao_planejada)
      return (
        <div className="inline-flex flex-col items-end gap-0.5">
          <span className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{fmtN(numOf(row?.ocorrencias))}</span>
          <span className="text-[9px] tabular-nums text-zinc-400 dark:text-white/30">{fmtN(qp)} plan · {fmtN(qn)} n.plan</span>
        </div>
      )
    }
    if (col.key === "mttr_seg" || col.key === "mtbf_seg") {
      const v = row?.[col.key]
      if (v == null) return undefined
      const isMttr = col.key === "mttr_seg"
      return (
        <span
          className="tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70"
          title={isMttr ? "Tempo médio de reparo por parada" : "Tempo médio entre falhas (rodando)"}
        >
          {fmtSec(numOf(v))}
        </span>
      )
    }
    return undefined
  }, [])

  const tableRenderCell = interactiveTab
    ? (activeTab === "oee" ? oeeRenderCell : activeTab === "producao" ? producaoRenderCell : paradasRenderCell)
    : undefined

  // Melhor/pior turno do conjunto filtrado (para badge ▲/▼ na 1ª coluna)
  const tableAccentRows = useMemo(() => {
    if (!interactiveTab || sortedRows.length < 2) return null
    const valueOf = (r: any) => {
      if (activeTab === "oee") return numOf(r?.oee)
      if (activeTab === "producao") return numOf(r?.total_produzido)
      return -(numOf(r?.dur_planejada_seg) + numOf(r?.dur_nao_planejada_seg)) // paradas: menos tempo parado = melhor
    }
    let bestRow: any = null, worstRow: any = null
    let bestVal = -Infinity, worstVal = Infinity
    for (const r of sortedRows) {
      const v = valueOf(r)
      if (v > bestVal) { bestVal = v; bestRow = r }
      if (v < worstVal) { worstVal = v; worstRow = r }
    }
    if (!bestRow || !worstRow || bestRow === worstRow) return null
    return { bestRow, worstRow }
  }, [interactiveTab, activeTab, sortedRows])

  const tableRowAccent = useCallback((row: any) => {
    if (!tableAccentRows) return undefined
    if (row === tableAccentRows.bestRow) return { color: SHIFT_PAL.good, tag: "▲" }
    if (row === tableAccentRows.worstRow) return { color: SHIFT_PAL.bad, tag: "▼" }
    return undefined
  }, [tableAccentRows])

  // Totais/médias sobre TODO o conjunto filtrado (sortedRows), não só a página exibida
  const tableTotals = useMemo((): Record<string, React.ReactNode> | undefined => {
    if (!interactiveTab || !sortedRows.length) return undefined
    const sum = (k: string) => sortedRows.reduce((a, r) => a + numOf(r?.[k]), 0)
    const bold = (node: React.ReactNode, color?: string) => (
      <span className="tabular-nums font-black text-[12px]" style={color ? { color } : undefined}>{node}</span>
    )
    if (activeTab === "oee") {
      const avg = (k: string) => sum(k) / sortedRows.length
      return {
        oee: bold(fmtPct(decimalToPct(avg("oee")))),
        disponibilidade: bold(fmtPct(decimalToPct(avg("disponibilidade")))),
        performance: bold(fmtPct(decimalToPct(avg("performance")))),
        qualidade: bold(fmtPct(decimalToPct(avg("qualidade")))),
        total_good: bold(fmtN(sum("total_good"))),
        total_produzido: bold(fmtN(sum("total_produzido"))),
      }
    }
    if (activeTab === "producao") {
      const good = sum("good"), tot = sum("total_produzido"), cap = sum("capacidade")
      const scrap = sum("scrap"), rework = sum("rework")
      const fpy = tot > 0 ? (good / tot) * 100 : 0
      const weightedAvg = (key: string) => {
        const withVal = sortedRows.filter(r => r?.[key] != null)
        if (!withVal.length) return null
        const w = withVal.reduce((a, r) => a + numOf(r?.total_produzido), 0)
        if (w > 0) return withVal.reduce((a, r) => a + numOf(r?.[key]) * numOf(r?.total_produzido), 0) / w
        return withVal.reduce((a, r) => a + numOf(r?.[key]), 0) / withVal.length
      }
      const cm = weightedAvg("ciclo_medio_seg")
      const ci = weightedAvg("ciclo_ideal_seg")
      return {
        good: bold(fmtN(good), SHIFT_PAL.good),
        total_produzido: bold(fmtN(tot)),
        capacidade: bold(fmtN(cap)),
        fpy: bold(fmtPct(fpy)),
        scrap: bold(fmtN(scrap), scrap > 0 ? SHIFT_PAL.bad : undefined),
        rework: bold(fmtN(rework), rework > 0 ? SHIFT_PAL.warn : undefined),
        ciclo_medio_seg: cm != null ? bold(fmtMMSS(cm)) : undefined,
        ciclo_ideal_seg: ci != null ? bold(fmtMMSS(ci)) : undefined,
      }
    }
    // paradas
    const plan = sum("dur_planejada_seg"), nplan = sum("dur_nao_planejada_seg")
    const totOcorr = sum("ocorrencias")
    const mtbfRows = sortedRows.filter(r => r?.mtbf_seg != null)
    const mtbfAvg = mtbfRows.length ? mtbfRows.reduce((a, r) => a + numOf(r?.mtbf_seg), 0) / mtbfRows.length : null
    return {
      duracao_fmt: bold(fmtSec(plan + nplan)),
      dur_planejada_seg: bold(fmtSec(plan), SHIFT_PAL.planned),
      dur_nao_planejada_seg: bold(fmtSec(nplan), SHIFT_PAL.unplanned),
      ocorrencias: bold(fmtN(totOcorr)),
      mttr_seg: totOcorr > 0 ? bold(fmtSec((plan + nplan) / totOcorr)) : undefined,
      mtbf_seg: mtbfAvg != null ? bold(fmtSec(mtbfAvg)) : undefined,
    }
  }, [interactiveTab, activeTab, sortedRows])

  const tableLegend = useMemo((): React.ReactNode => {
    if (!interactiveTab) return null
    const Dot = ({ color, label }: { color: string; label: string }) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 flex-shrink-0" style={{ background: color }} />
        {label}
      </span>
    )
    if (activeTab === "oee") {
      return (
        <>
          <Dot color={SHIFT_PAL.good} label="≥70% excelente" />
          <Dot color={SHIFT_PAL.warn} label="55–69% atenção" />
          <Dot color={SHIFT_PAL.bad} label="<55% crítico" />
          <span>D/P/Q = fator limitante (menor dos três)</span>
          <span>▲/▼ = melhor/pior turno em OEE</span>
        </>
      )
    }
    if (activeTab === "producao") {
      return (
        <>
          <Dot color={SHIFT_PAL.good} label="Aprovado" />
          <Dot color={SHIFT_PAL.bad} label="Refugo" />
          <Dot color={SHIFT_PAL.warn} label="Retrabalho" />
          <span>Barra em Capacidade = total produzido / capacidade</span>
          <span>Ciclo Médio colorido pelo desvio do Ciclo Ideal</span>
          <span>▲/▼ = melhor/pior turno em volume total</span>
        </>
      )
    }
    return (
      <>
        <Dot color={SHIFT_PAL.planned} label="Planejada" />
        <Dot color={SHIFT_PAL.unplanned} label="Não planejada" />
        <span>MTTR = tempo médio de reparo por parada</span>
        <span>MTBF = tempo médio entre falhas</span>
        <span>▲/▼ = menor/maior tempo parado</span>
      </>
    )
  }, [interactiveTab, activeTab])

  /* ══════════════════════════════════════════════════════════
   * RENDER
   * ══════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-h-screen">
        <Header onMenuClick={() => setSidebarOpen(true)} title="Analítico" />

        {/* ══ TABS — sticky abaixo do header, largura total ══ */}
        <div className="sticky top-12 z-40 bg-zinc-100 dark:bg-[#0f1117] border-b border-zinc-200 dark:border-white/[0.07] flex overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-shrink-0 flex items-center gap-2 px-5 py-3 text-[11px] font-bold tracking-[0.1em] uppercase transition-all ${active
                    ? "text-zinc-900 dark:text-white"
                    : "text-zinc-400 dark:text-white/28 hover:text-zinc-700 dark:hover:text-white/55 hover:bg-zinc-200/60 dark:hover:bg-white/[0.04]"
                  }`}
              >
                <Icon
                  className="w-3.5 h-3.5"
                  style={{ color: active ? "#f97316" : undefined }}
                />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
                )}
              </button>
            )
          })}

          {/* Descrição da aba + Pareto — lado direito */}
          <div className="ml-auto flex items-center gap-2 pl-3 pr-4 flex-shrink-0 border-l border-zinc-200 dark:border-white/[0.07]">
            <tabDef.icon className="w-3 h-3 flex-shrink-0 hidden md:block" style={{ color: "#f97316" }} />
            <span className="text-[10px] text-zinc-400 dark:text-white/28 max-w-[320px] hidden md:block leading-tight truncate">
              {tabDef.description}
            </span>

            {activeTab === "paradas" && (
              <>
                <span className="w-px h-4 bg-zinc-200 dark:bg-white/[0.08]" />
                <button
                  onClick={() => setParetoMode(v => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-[0.06em] transition-colors ${paretoMode
                      ? "bg-amber-500 border-amber-500 text-white"
                      : "border-zinc-200 dark:border-white/[0.08] text-zinc-500 dark:text-white/45 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                    }`}
                  title="Análise de Pareto de paradas"
                  type="button"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Pareto</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-3 lg:p-5 space-y-3">

          {/* ══ FILTERS ═══════════════════════════════════════ */}
          <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
            {/* Filter header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
              <div className="flex items-center gap-3 min-w-0 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-zinc-300 dark:text-white/25" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28">Filtros</span>
                </div>
                <div className="h-4 w-px bg-zinc-200 dark:bg-white/[0.08]" />
                <span className="text-sm font-bold text-zinc-600 dark:text-white/60 tabular-nums">{periodText}</span>
                {hasFilters && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10 px-2 py-0.5">
                    Filtros ativos
                  </span>
                )}
                {(analitico.isLoading || analitico.error || (paretoActive && (pareto.isLoading || pareto.error))) && (
                  <StatusBadge
                    loading={analitico.isLoading || (paretoActive && pareto.isLoading)}
                    error={analitico.error ?? (paretoActive ? pareto.error : null)}
                    count={paretoActive ? pareto.rows.length : analitico.rows.length}
                  />
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => setFiltersOpen(v => !v)}
                  className="h-8 px-3 inline-flex items-center gap-1.5 border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.04] text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-[10px] font-bold uppercase tracking-[0.08em] transition-colors"
                  type="button"
                >
                  {filtersOpen
                    ? <><ChevronUp className="w-3.5 h-3.5" /> Recolher</>
                    : <><Filter className="w-3.5 h-3.5" /> Filtros</>
                  }
                </button>
                <div className="h-5 w-px bg-zinc-200 dark:bg-white/[0.07]" />
                <button
                  onClick={exportCsv}
                  className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/25 hover:text-zinc-600 dark:hover:text-white/55 transition-colors"
                  title="Exportar CSV"
                  type="button"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter body */}
            {filtersOpen && (
              <div className="p-4 space-y-4">
                {rangeError && (
                  <div className="flex items-center gap-2.5 border border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.08] px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">{rangeError}</span>
                  </div>
                )}

                {/* Row 1: Período + métrica */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Período */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30 mb-1 block">
                      Período
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDatePicker(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 hover:border-amber-400 dark:hover:border-amber-500/40 hover:bg-zinc-50 dark:hover:bg-white/[0.06] transition-colors text-left"
                    >
                      <Calendar className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-sm font-medium tabular-nums">{periodText}</span>
                    </button>
                    {showDatePicker && (
                      <DateRangePicker
                        isOpen={showDatePicker}
                        onClose={() => setShowDatePicker(false)}
                        startDate={yyyymmddToDate(startDate)}
                        endDate={yyyymmddToDate(endDate)}
                        onSelect={(s, e) => {
                          const pad = (n: number) => String(n).padStart(2, "0")
                          setStartDate(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`)
                          setEndDate(`${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`)
                          setPage(1)
                        }}
                      />
                    )}
                    {/* Horários do dia operacional — editáveis */}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30">Início</span>
                        <input
                          type="time"
                          value={startTime}
                          onChange={e => { setStartTime(e.target.value || "06:00"); setPage(1) }}
                          className="w-full px-2 py-1.5 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-sm font-medium tabular-nums text-zinc-700 dark:text-white/65 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30">Fim (dia seg.)</span>
                        <input
                          type="time"
                          value={endTime}
                          onChange={e => { setEndTime(e.target.value || "06:00"); setPage(1) }}
                          className="w-full px-2 py-1.5 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-sm font-medium tabular-nums text-zinc-700 dark:text-white/65 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Métrica */}
                  <SelectField
                    label="Métrica do gráfico"
                    value={selMetricLabel}
                    onChange={v => { setMetric(v); setPage(1) }}
                  >
                    {cfg.metrics.map(m => (
                      <option key={m.label} value={m.label}>
                        {m.label}{m.unit ? ` (${m.unit})` : ""}
                      </option>
                    ))}
                  </SelectField>
                </div>

                {/* Row 2: Filtros dimensionais
                 * FIX duplicate keys: adicionamos o índice como sufixo nos keys dos <option>
                 * porque a view vw_oee_por_turno cruza todos os CTs × turnos, e em alguns
                 * casos o lookup pode retornar IDs duplicados (e.g. mesmo CT em múltiplos
                 * contextos). O índice garante unicidade sem alterar o value.
                 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <SelectField
                    label="Centro de Trabalho"
                    value={fCentro}
                    onChange={v => { setFCentro(v); setPage(1) }}
                    hint={
                      lookups.isLoading
                        ? "Carregando…"
                        : centros.length
                          ? `${centros.length} centros disponíveis`
                          : undefined
                    }
                  >
                    <option value="">Todos os centros</option>
                    {centros.map((c, idx) => (
                      <option key={`ct-${c.centro_trabalho_id}-${idx}`} value={c.centro_trabalho_id}>
                        {c.codigo ? `${c.codigo} — ` : ""}{c.nome}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Turno"
                    value={fTurno}
                    onChange={v => {
                      setFTurno(v)
                      // Ao escolher um turno, a janela passa a ser a dele
                      // (ex.: Noite 21:30 → 06:00). Sem turno, volta ao dia
                      // operacional padrão 06:00 → 06:00. Continua editável.
                      const t = turnos.find(x => x.turno_id === v)
                      if (v && t?.hora_inicio && t?.hora_fim) {
                        setStartTime(String(t.hora_inicio).slice(0, 5))
                        setEndTime(String(t.hora_fim).slice(0, 5))
                      } else {
                        setStartTime("06:00")
                        setEndTime("06:00")
                      }
                      setPage(1)
                    }}
                    hint={
                      lookups.isLoading
                        ? "Carregando…"
                        : turnos.length
                          ? `${turnos.length} turnos`
                          : undefined
                    }
                  >
                    <option value="">Todos os turnos</option>
                    {turnos.map((t, idx) => (
                      <option key={`turno-${t.turno_id}-${idx}`} value={t.turno_id}>
                        {t.nome}
                        {t.hora_inicio ? ` (${t.hora_inicio}–${t.hora_fim})` : ""}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Produto"
                    value={fProduto}
                    onChange={v => { setFProduto(v); setPage(1) }}
                    hint={
                      lookups.isLoading
                        ? "Carregando…"
                        : produtos.length
                          ? `${produtos.length} produtos`
                          : undefined
                    }
                  >
                    <option value="">Todos os produtos</option>
                    {produtos.map((p, idx) => (
                      <option key={`prod-${p.produto_id}-${idx}`} value={p.produto_id}>
                        {p.codigo ? `${p.codigo} — ` : ""}{p.descricao}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Ordem de Produção"
                    value={fOrdem}
                    onChange={v => { setFOrdem(v); setPage(1) }}
                    hint={
                      lookups.isLoading
                        ? "Carregando…"
                        : ordens.length
                          ? `${ordens.length} ordens no período`
                          : "Nenhuma ordem"
                    }
                  >
                    <option value="">Todas as ordens</option>
                    {ordens
                      .filter(o => o?.ordem_id)
                      .map((o, idx) => (
                        <option key={`ordem-${o.ordem_id}-${idx}`} value={o.ordem_id}>
                          {o.ordem_codigo ?? o.ordem_id}
                          {o.produto_descricao ? ` — ${o.produto_descricao}` : ""}
                        </option>
                      ))}
                  </SelectField>
                </div>

                {/* Row 3: Motivo (+ Grupo de Perda apenas fora de Paradas) */}
                {cfg.hasMotivo && (
                  <div className={`grid grid-cols-1 ${activeTab === "paradas" ? "" : "sm:grid-cols-2"} gap-3`}>
                    <SelectField
                      label="Motivo de Parada"
                      value={fMotivo}
                      onChange={v => { setFMotivo(v); setPage(1) }}
                      hint={motivos.length ? `${motivos.length} motivos` : undefined}
                    >
                      <option value="">Todos os motivos</option>
                      {motivos.map((m, idx) => (
                        <option key={`motivo-${m.motivo_id}-${idx}`} value={m.motivo_id}>
                          {m.grupo_perda ? `[${grupoPerdaPt(m.grupo_perda)}] ` : ""}
                          {m.descricao}
                          {m.is_planejada ? " ✓" : ""}
                        </option>
                      ))}
                    </SelectField>

                    {activeTab !== "paradas" && (
                      <SelectField
                        label="Grupo de Perda"
                        value={fGrupoPerda}
                        onChange={v => { setFGrupoPerda(v as any); setPage(1) }}
                      >
                        <option value="">Todos os grupos</option>
                        <option value="AVAILABILITY">Disponibilidade</option>
                        <option value="PERFORMANCE">Performance</option>
                        <option value="QUALITY">Qualidade</option>
                      </SelectField>
                    )}
                  </div>
                )}

                {/* Row 4: Actions */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-zinc-100 dark:border-white/[0.05]">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-white/22">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Filtros atualizam gráfico e tabela automaticamente
                  </div>
                  <div className="flex items-center gap-2">
                    {hasFilters && (
                      <button
                        onClick={clearFilters}
                        type="button"
                        className="inline-flex items-center gap-1.5 h-8 px-3 border border-red-200 dark:border-red-500/25 text-[10px] font-bold uppercase tracking-[0.08em] bg-red-50 dark:bg-red-500/[0.08] hover:bg-red-100 dark:hover:bg-red-500/15 text-red-500 dark:text-red-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Limpar filtros
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const d = defaultRange()
                        setStartDate(d.start)
                        setEndDate(d.end)
                        setMetric(cfg.metrics[0]?.label ?? "")
                        setParetoMode(false)
                        clearFilters()
                      }}
                      type="button"
                      className="inline-flex items-center gap-1.5 h-8 px-3 border border-zinc-200 dark:border-white/[0.07] text-[10px] font-bold uppercase tracking-[0.08em] bg-zinc-50 dark:bg-white/[0.03] hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-zinc-500 dark:text-white/35 transition-colors"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                      Reset geral
                    </button>
                    <button
                      onClick={() => analitico.refresh()}
                      type="button"
                      className="inline-flex items-center gap-1.5 h-8 px-4 text-[10px] font-bold uppercase tracking-[0.08em] bg-zinc-900 dark:bg-white/[0.08] hover:bg-zinc-700 dark:hover:bg-white/[0.14] text-white transition-colors"
                    >
                      <RefreshCcw
                        className={`w-3.5 h-3.5 ${analitico.isLoading ? "animate-spin" : ""}`}
                      />
                      Atualizar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ══ OEE SUMMARY ═══════════════════════════════════ */}
          {activeTab === "oee" && analitico.summary && !analitico.isLoading && (
            <OeeSummaryBar summary={analitico.summary} />
          )}

          {/* ══ KPI CARDS ═════════════════════════════════════ */}
          {!rangeError && !analitico.isLoading && primaryValues.some(v => v !== 0) &&
            !(activeTab === "oee" && analitico.summary) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                <KpiCard
                  label="Média"
                  value={kpis.avg}
                  sub={`${kpis.count} pontos · ${selMetricLabel}`}
                  color="#f97316"
                  isPrimary
                  trend={kpis.trend}
                  formatter={valueFormatter}
                />
                <KpiCard
                  label="Máximo"
                  value={kpis.max}
                  formatter={valueFormatter}
                />
                <KpiCard
                  label="Mínimo"
                  value={kpis.min}
                  formatter={valueFormatter}
                />
                {!metricDef?.isPercent && (
                  <KpiCard
                    label="Total Período"
                    value={kpis.sum}
                    sub="Soma do período"
                    formatter={metricDef?.isTime ? (activeTab === "ciclo" ? fmtMMSS : fmtSec) : v => fmtN(v)}
                  />
                )}
                <KpiCard
                  label="Pontos"
                  value={kpis.count}
                  sub={GRANULARITY_LABELS[granularity]}
                  formatter={v => fmtN(v, 0)}
                />
              </div>
            )
          }

          {/* ══ CHART ═════════════════════════════════════════
              Aba Rebarbadores (pessoas) usa o RebarbadorAnaliticoSection
              dedicado logo abaixo — o gráfico genérico por turno aqui
              não agrega nada útil pra rebarbador (fica de fora). */}
          {activeTab !== "pessoas" && (
          <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
            {/* Chart header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.08] hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/65 transition-colors disabled:opacity-20"
                  onClick={goPrev}
                  disabled={!!rangeError}
                  title="Período anterior"
                  type="button"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black tracking-[0.06em]" style={{ color: tabDef.color }}>
                      {tabDef.label.toUpperCase()}
                      {paretoActive ? " · PARETO" : ""}
                    </span>
                    <span className="text-sm text-zinc-400 dark:text-white/30 font-medium tabular-nums">{periodText}</span>
                  </div>
                  {!analitico.isLoading && !analitico.error && primaryValues.length > 0 && (
                    <div className="text-[10px] text-zinc-400 dark:text-white/22 mt-0.5 flex items-center gap-2 tabular-nums">
                      <span
                        className="w-2 h-2 flex-shrink-0"
                        style={{ background: tabDef.color }}
                      />
                      <span className="font-semibold text-zinc-500 dark:text-white/45">{selMetricLabel}</span>
                      {metricDef?.unit ? <span className="text-zinc-400 dark:text-white/25">({metricDef.unit})</span> : null}
                      <span className="text-zinc-300 dark:text-white/15">·</span>
                      <span>{primaryValues.length} {primaryValues.length === 1 ? "turno" : "turnos"}</span>
                      <span className="text-zinc-300 dark:text-white/15">·</span>
                      {/* valueFormatter já recebe valor na escala correta */}
                      <span>média {valueFormatter(kpis.avg)}</span>
                    </div>
                  )}
                </div>

                <button
                  className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.08] hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/65 transition-colors disabled:opacity-20"
                  onClick={goNext}
                  disabled={!!rangeError}
                  title="Próximo período"
                  type="button"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyTable}
                  className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
                  title="Copiar TSV"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={exportCsv}
                  className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
                  title="Exportar CSV"
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => window.print()}
                  className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
                  title="Imprimir"
                >
                  <Printer className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Chart body */}
            <div className="px-2 pb-2 pt-1">
              {rangeError ? (
                <div className="h-[420px] lg:h-[500px] flex flex-col items-center justify-center gap-3 text-amber-500">
                  <AlertTriangle className="w-6 h-6" />
                  <span className="text-sm font-bold">{rangeError}</span>
                </div>
              ) : analitico.isLoading ? (
                <div className="h-[420px] lg:h-[500px] flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
                  <span className="text-[11px] text-zinc-400 dark:text-white/28 uppercase tracking-[0.1em]">Carregando dados…</span>
                </div>
              ) : analitico.error ? (
                <div className="h-[420px] lg:h-[500px] border border-red-100 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.05] flex flex-col items-center justify-center gap-4 p-6">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                  <div className="text-center">
                    <p className="text-sm font-bold text-red-600 dark:text-red-400 uppercase tracking-[0.08em]">Falha ao carregar dados</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-white/35 max-w-sm font-mono">
                      {String(analitico.error?.message ?? analitico.error)}
                    </p>
                  </div>
                  <button
                    onClick={() => analitico.refresh()}
                    className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-600 dark:text-white/55 hover:bg-zinc-50 dark:hover:bg-white/[0.07] transition-colors"
                    type="button"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Tentar novamente
                  </button>
                </div>
              ) : (
                <ShiftChart config={shiftConfig} />
              )}
            </div>

            {/* Chart footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-100 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]">
              <div className="text-[10px] text-zinc-400 dark:text-white/22 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                Agregação por{" "}
                <span className="font-bold text-zinc-500 dark:text-white/40">
                  {GRANULARITY_LABELS[granularity].toUpperCase()}
                </span>
                {analitico.url && (
                  <>
                    {" · "}
                    <a
                      href={analitico.url}
                      target="_blank"
                      rel="noopener"
                      className="underline underline-offset-2 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                    >
                      ver URL da API
                    </a>
                  </>
                )}
              </div>
              {/* O relógio muda entre o HTML gerado no servidor e o primeiro
                  render do cliente; sem isto o React acusa hydration mismatch. */}
              <div
                suppressHydrationWarning
                className="text-[10px] text-zinc-400 dark:text-white/22 flex items-center gap-1 tabular-nums"
              >
                <Clock className="w-3 h-3" />
                {new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} BRT
              </div>
            </div>
          </div>
          )}

          {/* ══ REBARBADORES — ranking + eficiência x parada ═══ */}
          <RebarbadorAnaliticoSection
            filters={filters}
            enabled={activeTab === "pessoas" && hasDates && !rangeError}
          />

          {/* ══ DATA TABLE ════════════════════════════════════
              Fora da aba Rebarbadores — lá a tabela genérica por turno
              não tem colunas úteis; RebarbadoresTable (dentro da seção
              acima) já cobre o detalhamento por pessoa. */}
          {activeTab !== "pessoas" && (
          <DataTable
            columns={columns}
            rows={pagedRows}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={handleSort}
            page={curPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalRows={sortedRows.length}
            onPrev={() => setPage(p => Math.max(1, p - 1))}
            onNext={() => setPage(p => Math.min(totalPages, p + 1))}
            onPageSize={n => { setPageSize(n); setPage(1) }}
            onCopy={copyTable}
            onExport={exportCsv}
            onPrint={() => window.print()}
            renderCell={tableRenderCell}
            rowAccent={tableRowAccent}
            totals={tableTotals}
            legend={tableLegend}
          />
          )}

          {/* ══ FOOTER ════════════════════════════════════════ */}
          <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-white/22 px-1 pb-2 flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-zinc-500 dark:text-white/35">/api/db/analitico</span>
              <span className="text-zinc-300 dark:text-white/15">·</span>
              <span>Aba: <span className="font-mono text-zinc-500 dark:text-white/35">{activeTab}</span></span>
              <span className="text-zinc-300 dark:text-white/15">·</span>
              <span>Gran.: <span className="font-mono text-zinc-500 dark:text-white/35">{granularity}</span></span>
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Sistema MES — SiderProd
            </span>
          </div>

        </div>
      </main>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
 * PAGE WRAPPER
 * ══════════════════════════════════════════════════════════════ */
export default function AnalyticPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
            <span className="text-[11px] text-zinc-400 dark:text-white/28 uppercase tracking-[0.1em]">Carregando Analítico…</span>
          </div>
        </div>
      }
    >
      <AnalyticContent />
    </Suspense>
  )
}

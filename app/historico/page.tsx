"use client"

import React, { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import {
  Link2,
  Download,
  Filter,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Printer,
  Info,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCcw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Zap,
  Clock,
  Package,
  Users,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  Calendar,
} from "lucide-react"

import {
  useHistorico,
  useHistoricoSetores,
  useHistoricoTurnos,
  useHistoricoCentrosTrabalho,
  useHistoricoProdutos,
  useHistoricoOrdens,
  type HistoryTab,
  type Granularity,
  type ProducaoMetric,
  type ParadasMetric,
  type CicloMetric,
  type PerdasMetric,
  type UnitSelect,
  type HistorySeries,
  type HistoryTableRow,
} from "@/hooks/historico/use-api"
import { RebarbadoresTab } from "@/components/historico/rebarbadores-tab"

/* ─────────────────────────────────────────────────────────────
 * CONFIG DE ABAS — com ícones, cor e descrição
 * ───────────────────────────────────────────────────────────── */

interface TabConfig {
  id: HistoryTab
  label: string
  shortLabel: string
  icon: React.ElementType
  color: string
  description: string
}

const TABS: TabConfig[] = [
  {
    id: "oee",
    label: "OEE",
    shortLabel: "OEE",
    icon: Activity,
    color: "#7e390b",
    description: "Eficiência global do equipamento — disponibilidade × performance × qualidade",
  },
  {
    id: "producao",
    label: "Produção",
    shortLabel: "Prod.",
    icon: Package,
    color: "#7e390b",
    description: "Volume produzido, refugo, retrabalho e taxa de qualidade",
  },
  {
    id: "paradas",
    label: "Paradas",
    shortLabel: "Parad.",
    icon: Clock,
    color: "#7e390b",
    description: "Tempo e frequência de paradas planejadas e não planejadas",
  },
  {
    id: "refugo",
    label: "Refugo",
    shortLabel: "Ref.",
    icon: AlertCircle,
    color: "#7e390b",
    description: "Peças descartadas — quantidade absoluta e taxa percentual",
  },
  {
    id: "retrabalho",
    label: "Retrabalho",
    shortLabel: "Retrab.",
    icon: RefreshCcw,
    color: "#7e390b",
    description: "Peças que precisaram de retrabalho — custo oculto de qualidade",
  },
  {
    id: "ciclo",
    label: "Ciclo",
    shortLabel: "Ciclo",
    icon: Zap,
    color: "#7e390b",
    description: "Tempo de ciclo real vs. ideal — indicador de performance de velocidade",
  },
  {
    id: "perdas",
    label: "Perdas",
    shortLabel: "Perdas",
    icon: TrendingDown,
    color: "#7e390b",
    description: "Perdas totais por tempo e quantidade — base para análise de causas",
  },
  {
    // id interno mantido como "pessoas" por compatibilidade de URL/API;
    // a interface exibe "Rebarbadores".
    id: "pessoas",
    label: "Rebarbadores",
    shortLabel: "Rebarb.",
    icon: Users,
    color: "#7e390b",
    description: "Desempenho dos rebarbadores por posto, corrida, turno e produto",
  },

]

/* Legendas das variáveis por aba */
const SERIES_LEGENDS: Record<string, Record<string, string>> = {
  oee: {
    OEE: "Eficiência global = Disponibilidade × Performance × Qualidade. Meta típica industrial: ≥ 85%.",
    Disponibilidade:
      "% do tempo planejado em que o equipamento estava efetivamente operando (excluindo paradas não planejadas).",
    Performance:
      "Velocidade real vs. velocidade ideal. Abaixo de 100% indica micro-paradas ou ritmo lento.",
    Qualidade:
      "% de peças boas sobre o total produzido — índice de qualidade de primeira passagem.",
  },
  producao: {
    Bom: "Peças aprovadas no primeiro ciclo — sem retrabalho nem descarte.",
    Refugo: "Peças descartadas — perda definitiva de material e tempo.",
    Retrabalho: "Peças que voltaram para retrabalho — custo adicional de mão-de-obra.",
    "Total Produzido": "Soma de Bom + Refugo + Retrabalho — total bruto de ciclos realizados.",
    FPY: "Índice de qualidade de primeira passagem: % de peças boas sem qualquer retrabalho. Meta: ≥ 98%.",
    "Taxa Refugo": "% de peças refugadas sobre o total. Indicador direto de qualidade.",
    "Taxa Retrabalho": "% de peças reprocessadas. Alto retrabalho indica processo instável.",
    Meta: "Meta de produção planejada para o período.",
    "Desvio Meta": "Bom − Meta. Negativo = produção abaixo da meta planejada.",
  },
  paradas: {
    "Duração Total (s)": "Soma do tempo total de parada no período (planejadas + não planejadas).",
    "Dur. Planejada (s)": "Paradas previstas (setup, manutenção programada, refeições).",
    "Dur. N.Plan. (s)": "Paradas inesperadas — falhas, falta de material, problemas operacionais.",
    "Qtd. Planejada": "Número de ocorrências de paradas planejadas no período.",
    "Qtd. N.Plan.": "Número de falhas não planejadas. Alto valor indica processo frágil.",
  },
  refugo: {
    "Refugo (UN)": "Quantidade absoluta de peças descartadas.",
    "Taxa Refugo (%)": "% de refugo sobre total produzido. Meta ≤ 0,5% para indústria de precisão.",
    "Total Produzido": "Volume total bruto para cálculo da taxa.",
  },
  retrabalho: {
    "Retrabalho (UN)": "Quantidade de peças que passaram por reprocessamento.",
    "Taxa Retrabalho (%)": "% de retrabalho. Meta ≤ 1% em processos maduros.",
    "Total Produzido": "Base para cálculo da taxa.",
  },
  ciclo: {
    "Ciclo Médio (s)": "Tempo médio real ponderado por peças boas — exclui períodos parados.",
    "Ciclo Ideal (s)": "Tempo de ciclo de projeto (takt time do produto). Referência de velocidade.",
    "Desvio Ciclo (s)": "Diferença entre real e ideal. Positivo = mais lento que o projeto.",
    "Total Bom": "Quantidade de boas usada como peso para média ponderada do ciclo.",
  },
  perdas: {
    "Tempo Perdido Total (s)": "Toda parada, planejada ou não — base para análise de disponibilidade.",
    "Paradas Planejadas (s)": "Tempo de paradas previstas no plano de produção.",
    "Paradas N.Plan. (s)": "Tempo de paradas inesperadas — foco principal de melhoria contínua.",
    "Qtd. Perdida (UN)": "Peças perdidas (refugo + retrabalho convertido). Perda direta de capacidade.",
  },
  pessoas: {
    "Pessoas Ativas": "Operadores únicos com pelo menos uma interação no sistema no período.",
    "Total Interações": "Volume de ações registradas — correlaciona com intensidade de produção.",
  },
  eventos: {
    "Total Eventos": "Todos os eventos de produção registrados (contagens, paradas, trocas).",
    "Tipos Distintos": "Variedade de tipos de evento — diversidade de ocorrências no período.",
  },
}

/* ─────────────────────────────────────────────────────────────
 * HELPERS
 * ───────────────────────────────────────────────────────────── */
function pad2(n: number) { return String(n).padStart(2, "0") }

function utcDateToYYYYMMDD(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/**
 * Data local do dispositivo (America/Sao_Paulo), não UTC — precisa bater
 * com o dia operacional (yyyymmddToDate + janela local tratam Y/M/D como
 * wall-clock local). Usar utcDateToYYYYMMDD aqui erraria o dia perto da
 * virada 21h–00h BRT, quando o calendário UTC já está no dia seguinte.
 */
function todayLocalYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * Dia operacional ATUAL (YYYY-MM-DD). O dia operacional vira às 06:00 BRT,
 * então entre 00:00–05:59 ainda estamos no dia operacional anterior. Usar o
 * dia de calendário puro (todayLocalYMD) mostraria o dia operacional seguinte
 * cedo demais (janela futura, sem dados) nesse intervalo. Assim o padrão é
 * sempre o dia operacional em produção (dia atual 06:00 → amanhã 06:00), e
 * vira sozinho no fechamento do dia às 06:00.
 */
function currentOpDayYMD(opStartHour = 6) {
  const d = new Date()
  if (d.getHours() < opStartHour) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * OEE é melhor visto em tendência (últimos 5 dias); as demais abas usam
 * só o dia operacional atual — o padrão de período depende da aba.
 */
function defaultRangeForTab(tab: HistoryTab, todayYMD: string): { start: string; end: string } {
  if (tab !== "oee") return { start: todayYMD, end: todayYMD }
  const [y, m, d] = todayYMD.split("-").map(Number)
  const start = new Date(y, m - 1, d)
  start.setDate(start.getDate() - 4) // últimos 5 dias operacionais (inclui o atual)
  return { start: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`, end: todayYMD }
}

function toIsoUtcFromDateInput(dateStr: string, endOfDay = false) {
  if (!dateStr) return undefined
  const [y, m, d] = dateStr.split("-").map(Number)
  if (!y || !m || !d) return undefined
  const dt = endOfDay
    ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
  return dt.toISOString()
}

function formatBRFromYYYYMMDD(s: string) {
  if (!s || s.length < 10) return s
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function parseFlexibleNumber(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "boolean") return v ? 1 : 0
  const s = String(v).trim().replace(/\s+/g, "").replace(/[R$€]/g, "")
  if (!s) return 0
  if (s.includes(".") && s.includes(",")) {
    const n = Number(s.replace(/\./g, "").replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }
  if (s.includes(",") && !s.includes(".")) {
    const n = Number(s.replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function safeNum(v: unknown) { return parseFlexibleNumber(v) }

function fmtValue(v: number) {
  return Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "0"
}

function secondsToHHmm(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/**
 * Duração de ciclo — adaptativa. Ciclos costumam ser da ordem de segundos.
 * < 60s   → "9,5s" / "42s"
 * < 1h    → "mm:ss"
 * ≥ 1h    → "h:mm:ss"
 * Sem dado válido → "—" (nunca "00:00" falso).
 */
function formatCiclo(seconds: number): string {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return "—"
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace(".", ",") : Math.round(s)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  if (s < 3600) return `${m}:${String(sec).padStart(2, "0")}`
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  return `${h}:${String(mm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

/** Inteiro pt-BR (para quantidades). */
function fmtInt(v: number) {
  return Number.isFinite(v) ? Math.round(v).toLocaleString("pt-BR") : "0"
}

function diffDaysInclusiveUTC(startYYYYMMDD: string, endYYYYMMDD: string) {
  const sIso = toIsoUtcFromDateInput(startYYYYMMDD, false)
  const eIso = toIsoUtcFromDateInput(endYYYYMMDD, true)
  if (!sIso || !eIso) return 0
  const ms = new Date(eIso).getTime() - new Date(sIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.max(1, Math.round(ms / 86400000))
}

function shiftRangeDays(startYYYYMMDD: string, endYYYYMMDD: string, deltaDays: number) {
  const sIso = toIsoUtcFromDateInput(startYYYYMMDD, false)
  const eIso = toIsoUtcFromDateInput(endYYYYMMDD, true)
  if (!sIso || !eIso) return { start: startYYYYMMDD, end: endYYYYMMDD }
  const ds = new Date(new Date(sIso).getTime() + deltaDays * 86400000)
  const de = new Date(new Date(eIso).getTime() + deltaDays * 86400000)
  return { start: utcDateToYYYYMMDD(ds), end: utcDateToYYYYMMDD(de) }
}

function csvEscape(v: any) {
  const s = String(v ?? "")
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCSV(rows: Array<Record<string, any>>, columns: string[], headerNames?: string[]) {
  const header = (headerNames ?? columns).map(csvEscape).join(",")
  const lines = rows.map((r) => columns.map((c) => csvEscape(r?.[c])).join(","))
  return [header, ...lines].join("\n")
}

function isNonEmpty(v: unknown) {
  return v != null && String(v).trim() !== ""
}

function getTrend(data: number[]): "up" | "down" | "flat" {
  if (!data || data.length < 2) return "flat"
  const valid = data.filter(v => Number.isFinite(v) && v !== 0)
  if (valid.length < 2) return "flat"
  const half = Math.floor(valid.length / 2)
  const first = valid.slice(0, half).reduce((a, b) => a + b, 0) / half
  const second = valid.slice(half).reduce((a, b) => a + b, 0) / (valid.length - half)
  const diff = (second - first) / Math.abs(first || 1)
  if (diff > 0.02) return "up"
  if (diff < -0.02) return "down"
  return "flat"
}

/* ─────────────────────────────────────────────────────────────
 * DATE RANGE PICKER HELPERS
 * ───────────────────────────────────────────────────────────── */
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"]

type PresetId = "hoje"|"ontem"|"7d"|"30d"|"semana_atual"|"semana_ant"|"mes_atual"|"mes_ant"|"personalizado"

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "hoje",          label: "Hoje" },
  { id: "ontem",         label: "Ontem" },
  { id: "7d",            label: "Últimos 7 dias" },
  { id: "30d",           label: "Últimos 30 dias" },
  { id: "semana_atual",  label: "Semana atual" },
  { id: "semana_ant",    label: "Semana anterior" },
  { id: "mes_atual",     label: "Mês atual" },
  { id: "mes_ant",       label: "Mês anterior" },
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

const TZ_PLANTA = "America/Sao_Paulo"

function normalizeHM(hm: string | null | undefined, fallback = "06:00") {
  const m = String(hm ?? "").match(/^(\d{1,2}):(\d{2})/)
  if (!m) return fallback
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return fallback
  return `${pad2(h)}:${pad2(min)}`
}

function hmParts(hm: string): [number, number] {
  const norm = normalizeHM(hm)
  const [h, m] = norm.split(":").map(Number)
  return [h, m]
}

function tzOffsetMs(utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_PLANTA,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(utcDate)) p[part.type] = part.value
  const hour = p.hour === "24" ? "00" : p.hour
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second)
  return asUTC - utcDate.getTime()
}

function localWallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0)
  const off = tzOffsetMs(new Date(guess))
  let result = new Date(guess - off)
  const off2 = tzOffsetMs(result)
  if (off2 !== off) result = new Date(guess - off2)
  return result
}

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

/* ─────────────────────────────────────────────────────────────
 * DATE RANGE PICKER COMPONENT
 * ───────────────────────────────────────────────────────────── */
function DateRangePicker({ isOpen, onClose, startDate, endDate, onSelect, crosses = true }: {
  isOpen: boolean; onClose: () => void
  startDate: Date; endDate: Date
  onSelect: (s: Date, e: Date) => void
  /** janela cruza a meia-noite (fim ≤ início, ex.: 06:00→06:00): o dia
   *  operacional selecionado fecha na manhã seguinte, então o preview do
   *  fim mostra a data de fechamento (data selecionada + 1). */
  crosses?: boolean
}) {
  const [preset, setPreset] = useState<PresetId>("personalizado")
  const [s, setS] = useState(startDate), [e, setE] = useState(endDate)
  const [picking, setPicking] = useState<"start"|"end">("start")
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
              {s.toLocaleDateString("pt-BR")} — {(crosses ? new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1) : e).toLocaleDateString("pt-BR")}
            </span>
            {crosses && <span className="text-[10px] text-zinc-400 dark:text-white/30 uppercase tracking-[0.06em]">janela op. 06→06</span>}
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

/* ─────────────────────────────────────────────────────────────
 * PALETTE INDUSTRIAL (por índice de série)
 * ───────────────────────────────────────────────────────────── */
const SERIES_PALETTE = [
  "#d97706", // amber-600
  "#dc2626", // red-600
  "#2563eb", // blue-600
  "#059669", // emerald-600
  "#7c3aed", // violet-600
  "#0891b2", // cyan-600
  "#ea580c", // orange-600
  "#65a30d", // lime-600
  "#db2777", // pink-600
  "#64748b", // slate-500
]

// Laranja da navbar do Histórico (#f97316) num tom um pouco mais escuro p/ o OEE
const OEE_ORANGE = "#ea580c"
// Gradiente de "preto" p/ as demais séries de OEE — invertido no dark mode p/ visibilidade.
// Spread maior p/ mais contraste: Disponibilidade quase preto → regride até cinza.
const OEE_MONO_DARK  = ["#09090b", "#27272a", "#52525b"] // quase-preto → zinc-800 → zinc-600 (tema claro)
const OEE_MONO_LIGHT = ["#fafafa", "#b4b4bf", "#78787f"] // quase-branco → cinza → cinza escuro (tema escuro)

// Ordem/ranking das séries mono do OEE (Disponibilidade = mais escura/destacada)
const OEE_MONO_ORDER: Record<string, number> = { disponibilidade: 0, performance: 1, qualidade: 2 }
function oeeMonoRank(name: string, idx: number): number {
  const key = String(name).toLowerCase()
  return OEE_MONO_ORDER[key] ?? (idx > 0 ? (idx - 1) % 3 : 0)
}

/**
 * Cor de cada série por aba. Na aba OEE: OEE em laranja da navbar (mais escuro)
 * e Disponibilidade/Performance/Qualidade em tons de preto com degradê.
 */
function resolveSeriesColor(tab: HistoryTab, name: string, idx: number, isDark: boolean): string {
  if (tab === "oee") {
    const key = String(name).toLowerCase()
    if (key.includes("oee")) return OEE_ORANGE
    return (isDark ? OEE_MONO_LIGHT : OEE_MONO_DARK)[oeeMonoRank(name, idx)]
  }
  return SERIES_PALETTE[idx % SERIES_PALETTE.length]
}

/**
 * Tradução de exibição: nomes de série/coluna que o backend devolve em inglês
 * → português. Usado só na CAMADA DE EXIBIÇÃO (legenda, tooltip, cabeçalho de
 * tabela); os lookups internos continuam usando o nome cru do backend.
 */
const SERIES_NAME_PT: Record<string, string> = {
  Good: "Bom",
  Scrap: "Refugo",
  Rework: "Retrabalho",
  "Total Good": "Total Bom",
  Target: "Meta",
  "Desvio Target": "Desvio Meta",
  "Scrap (UN)": "Refugo (UN)",
  "Rework (UN)": "Retrabalho (UN)",
  "Total Good (UN)": "Total Bom (UN)",
}
function ptSeriesName(name: string): string {
  return SERIES_NAME_PT[String(name)] ?? String(name)
}

/* ─────────────────────────────────────────────────────────────
 * KPI CARD
 * ───────────────────────────────────────────────────────────── */
function KpiCard({
  label,
  value,
  sub,
  trend,
  isPrimary,
  formatter,
}: {
  label: string
  value: number
  sub?: string
  trend?: "up" | "down" | "flat"
  color?: string
  isPrimary?: boolean
  formatter?: (v: number) => string
}) {
  const fmt = formatter ?? fmtValue
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
          style={{
            height: "85%",
            background: "oklch(0.72 0.16 65)",
          }}
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

function ChartTooltip({
  x,
  y,
  label,
  items,
  formatter,
  containerRect,
}: {
  x: number
  y: number
  label: string
  items: Array<{ name: string; value: number; color: string; display?: string; strong?: boolean; divider?: boolean }>
  formatter?: (v: number) => string
  containerRect?: DOMRect
}) {
  const fmt = formatter ?? fmtValue

  // Parâmetros de tamanho
  const tooltipWidth = 232
  const estimatedHeight = 45 + (items.length * 26) // Altura estimada dinâmica baseada na qtd de itens
  const cW = containerRect?.width ?? 800
  const cH = containerRect?.height ?? 400

  // Trava horizontal (esq/dir)
  let left = x + 16
  if (left + tooltipWidth > cW) {
    left = x - tooltipWidth - 16
  }
  left = Math.max(8, Math.min(left, cW - tooltipWidth - 8)) // Não deixa sumir nas laterais

  // Trava vertical (cima/baixo)
  let top = y - estimatedHeight - 16
  if (top < 8) {
    top = y + 16 // Joga o tooltip para debaixo do mouse se bater no teto
  }
  top = Math.max(8, Math.min(top, cH - estimatedHeight - 8)) // Não deixa sumir no rodapé

  return (
    <div
      className="absolute pointer-events-none z-[100] border shadow-2xl transition-all duration-75"
      style={{
        left,
        top,
        minWidth: 180,
        maxWidth: tooltipWidth,
        background: "rgba(255,255,255,0.97)",
        borderColor: "rgba(0,0,0,0.12)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="px-3 py-2 border-b border-zinc-100">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {items.map((it, i) => (
          <div
            key={`${it.name}-${i}`}
            className={`flex items-center justify-between gap-4 ${it.divider ? "mt-1.5 pt-1.5 border-t border-zinc-100" : ""}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="flex-shrink-0 w-2 h-2"
                style={{ background: it.color, opacity: it.strong ? 0 : 1 }}
              />
              <span className={`text-[11px] truncate ${it.strong ? "text-zinc-600 font-bold" : "text-zinc-500"}`}>{it.name}</span>
            </div>
            <span className={`text-[12px] tabular-nums flex-shrink-0 ${it.strong ? "font-black text-zinc-900" : "font-bold text-zinc-800"}`}>
              {it.display ?? fmt(it.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * MULTI-LINE CHART — canvas industrial
 * ───────────────────────────────────────────────────────────── */
function MultiLineChart({
  labels,
  seriesList,
  yLabel,
  valueFormatter,
  axisFormatter,
  activeSeriesIndices,
  tab,
}: {
  labels: string[]
  seriesList: HistorySeries[]
  yLabel: string
  valueFormatter?: (v: number) => string
  axisFormatter?: (v: number) => string
  activeSeriesIndices: Set<number>
  tab?: HistoryTab
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string
    items: Array<{ name: string; value: number; color: string }>
    containerRect?: DOMRect
  } | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const seriesSafe = useMemo(() => {
    return (seriesList ?? []).map((s, idx) => ({
      idx,
      name: String((s as any)?.name ?? `Série ${idx + 1}`),
      data: (Array.isArray((s as any)?.data) ? (s as any).data : []).map(safeNum),
      color: SERIES_PALETTE[idx % SERIES_PALETTE.length],
      active: activeSeriesIndices.has(idx),
    }))
  }, [seriesList, activeSeriesIndices])

  const hasData = useMemo(() => {
    if (!labels?.length || !seriesSafe?.length) return false
    return seriesSafe.some((s) => s.active && s.data.some((v: number) => Number.isFinite(v) && v !== 0))
  }, [labels, seriesSafe])

  const fmt = valueFormatter ?? ((v: number) => fmtValue(v))
  const fmtAxis = axisFormatter ?? ((v: number) =>
    Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : Number.isFinite(v) ? v.toFixed(0) : "0"
  )

  useEffect(() => {
    const canvasEl = canvasRef.current
    const containerEl = containerRef.current
    if (!canvasEl || !containerEl) return
    const ctx = canvasEl.getContext("2d")
    if (!ctx) return

    const PAD = { top: 32, right: 28, bottom: 52, left: 80 }

    const draw = (hIdx: number | null) => {
      const isDark = document.documentElement.classList.contains("dark")
      const rect = containerEl.getBoundingClientRect()
      const W = rect.width
      const H = rect.height
      const CW = W - PAD.left - PAD.right
      const CH = H - PAD.top - PAD.bottom

      ctx.clearRect(0, 0, W, H)

      const n = labels?.length ?? 0
      if (!n || CW <= 0 || CH <= 0) return

      const activeSeries = seriesSafe.filter((s) => s.active)
      const all = activeSeries.flatMap((s) => s.data).filter(Number.isFinite)
      const maxRaw = all.length ? Math.max(...all) : 0
      const minRaw = all.length ? Math.min(...all) : 0
      const pad = Math.abs(maxRaw - minRaw) * 0.1 || maxRaw * 0.15 || 1
      const maxVal = maxRaw + pad
      const minVal = Math.min(0, minRaw - pad * 0.5)
      const range = maxVal - minVal || 1

      const toY = (v: number) => PAD.top + CH - ((v - minVal) / range) * CH
      const toX = (i: number) => PAD.left + (n > 1 ? (CW / (n - 1)) * i : CW / 2)

      // Fundo sutil da área do gráfico
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.014)" : "rgba(0,0,0,0.014)"
      ctx.fillRect(PAD.left, PAD.top, CW, CH)

      // ── Background grid ──────────────────────────────────────
      const gridLines = 5
      for (let i = 0; i <= gridLines; i++) {
        const gy = PAD.top + (CH / gridLines) * i
        const gv = maxVal - (range / gridLines) * i

        ctx.beginPath()
        ctx.setLineDash([2, 6])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)"
        ctx.lineWidth = 1
        ctx.moveTo(PAD.left, gy)
        ctx.lineTo(W - PAD.right, gy)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = isDark ? "rgba(255,255,255,0.40)" : "rgba(0,0,0,0.55)"
        ctx.font = "500 11px 'Inter', system-ui, sans-serif"
        ctx.textAlign = "right"
        ctx.fillText(fmtAxis(gv), PAD.left - 10, gy + 4)
      }

      // baseline
      if (minVal <= 0 && maxVal >= 0) {
        const gy = toY(0)
        ctx.beginPath()
        ctx.setLineDash([])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.18)"
        ctx.lineWidth = 1
        ctx.moveTo(PAD.left, gy)
        ctx.lineTo(W - PAD.right, gy)
        ctx.stroke()
      }

      // ── Y label ──────────────────────────────────────────────
      ctx.save()
      ctx.translate(16, H / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.44)"
      ctx.font = "600 11px 'Inter', system-ui, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText(yLabel, 0, 0)
      ctx.restore()

      // ── X labels ─────────────────────────────────────────────
      const stepLabel = n > 20 ? Math.ceil(n / 12) : n > 12 ? 2 : 1
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.45)"
      ctx.font = "500 10.5px 'Inter', system-ui, sans-serif"
      ctx.textAlign = "center"
      for (let i = 0; i < n; i++) {
        if (i % stepLabel !== 0 && i !== n - 1) continue
        ctx.fillText(String(labels[i] ?? ""), toX(i), H - 14)
      }

      // vertical hover line
      if (hIdx !== null && hIdx >= 0 && hIdx < n) {
        const hx = toX(hIdx)
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.26)" : "rgba(0,0,0,0.28)"
        ctx.lineWidth = 1.5
        ctx.moveTo(hx, PAD.top)
        ctx.lineTo(hx, H - PAD.bottom)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // ── Series lines + area fill ──────────────────────────────
      // Ordem de desenho: no OEE, a série "OEE" vai SEMPRE por último para
      // que sua linha (e área) fiquem na frente de todas — senão os
      // preenchimentos das outras séries (que descem até a base) cobrem a linha.
      const drawOrder = [...seriesSafe].reverse()
      const orderedSeries = tab === "oee"
        ? [
            ...drawOrder.filter((s) => !String(s.name).toLowerCase().includes("oee")),
            ...drawOrder.filter((s) => String(s.name).toLowerCase().includes("oee")),
          ]
        : drawOrder
      for (const s of orderedSeries) {
        if (!s.active) continue
        const data = s.data.length ? s.data : Array(n).fill(0)
        const col  = resolveSeriesColor((tab ?? "oee") as HistoryTab, s.name, s.idx, isDark)
        const isOeeTab = tab === "oee"
        const isOee = isOeeTab && String(s.name).toLowerCase().includes("oee")

        // area fill — degradê ancorado na linha, some gradualmente.
        // No OEE: preenchimento com mais contraste, mais forte em Disponibilidade e
        // regredindo (Performance, Qualidade). OEE mantém destaque próprio.
        let topA = "3a", midA = "16"
        if (isOee) { topA = "55"; midA = "22" }
        else if (isOeeTab) {
          const rank = oeeMonoRank(s.name, s.idx)
          topA = ["72", "50", "34"][rank] ?? "3a" // disponibilidade forte → regride
          midA = ["3a", "26", "18"][rank] ?? "16"
        }
        const gradient = ctx.createLinearGradient(0, PAD.top, 0, H - PAD.bottom)
        gradient.addColorStop(0, `${col}${topA}`)
        gradient.addColorStop(0.45, `${col}${midA}`)
        gradient.addColorStop(1, `${col}00`)

        ctx.beginPath()
        ctx.moveTo(toX(0), toY(safeNum(data[0])))
        for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(safeNum(data[i])))
        ctx.lineTo(toX(n - 1), toY(minVal))
        ctx.lineTo(toX(0), toY(minVal))
        ctx.closePath()
        ctx.fillStyle = gradient
        ctx.fill()

        // linha nítida — stroke limpo, sem glow neon. OEE um pouco mais grossa p/ destacar.
        ctx.save()
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const lx = toX(i), ly = toY(safeNum(data[i]))
          if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly)
        }
        ctx.strokeStyle = col
        ctx.lineWidth = isOee ? 2.75 : 2
        ctx.lineJoin = "round"; ctx.lineCap = "round"
        ctx.stroke()
        ctx.restore()

        // marcadores — tiny dots apenas em séries esparsas; hover sempre visível
        for (let i = 0; i < n; i++) {
          const x = toX(i); const y = toY(safeNum(data[i]))
          const isHoverDot = hIdx === i

          if (isHoverDot) {
            // hover: círculo limpo — anel de fundo + preenchimento colorido
            ctx.beginPath()
            ctx.arc(x, y, 9, 0, Math.PI * 2)
            ctx.fillStyle = isDark ? "#0f1117" : "#ffffff"
            ctx.fill()
            ctx.beginPath()
            ctx.arc(x, y, 6, 0, Math.PI * 2)
            ctx.fillStyle = col
            ctx.fill()
          } else if (n <= 24) {
            // séries esparsas: tiny tick (sem borda, direto na cor)
            ctx.beginPath()
            ctx.arc(x, y, 2.5, 0, Math.PI * 2)
            ctx.fillStyle = col
            ctx.globalAlpha = 0.80
            ctx.fill()
            ctx.globalAlpha = 1
          }
        }
      }
    }

    const resizeAndDraw = () => {
      const rect = containerEl.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvasEl.width = Math.max(1, Math.floor(rect.width * dpr))
      canvasEl.height = Math.max(1, Math.floor(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(hoveredIdx)
    }

    const ro = new ResizeObserver(resizeAndDraw)
    ro.observe(containerEl)
    resizeAndDraw()
    return () => ro.disconnect()
  }, [labels, seriesSafe, yLabel, fmtAxis, hoveredIdx, tab])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const containerEl = containerRef.current
    if (!containerEl) return
    const rect = containerEl.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const PAD = { top: 32, right: 28, bottom: 52, left: 80 }
    const CW = rect.width - PAD.left - PAD.right
    const n = labels?.length ?? 0
    if (!n) { setTooltip(null); setHoveredIdx(null); return }
    if (x < PAD.left - 10 || x > rect.width - PAD.right + 10 || y < PAD.top - 10 || y > rect.height - PAD.bottom + 10) {
      setTooltip(null); setHoveredIdx(null); return
    }
    const xStep = n > 1 ? CW / (n - 1) : CW
    const idx = clamp(Math.round((x - PAD.left) / xStep), 0, n - 1)
    setHoveredIdx(idx)
    const isDarkNow = document.documentElement.classList.contains("dark")
    const items = seriesSafe
      .filter((s) => s.active)
      .map((s) => ({ name: ptSeriesName(s.name), value: safeNum(s.data[idx]), color: resolveSeriesColor((tab ?? "oee") as HistoryTab, s.name, s.idx, isDarkNow) }))
    const activeSeries = seriesSafe.filter((s) => s.active)
    const all = activeSeries.flatMap((s) => s.data).filter(Number.isFinite)
    const maxVal = all.length ? Math.max(...all) : 1
    const minVal = Math.min(0, all.length ? Math.min(...all) : 0)
    const v0 = items[0]?.value ?? 0
    const CH = rect.height - PAD.top - PAD.bottom
    const yx = PAD.top + CH - ((v0 - minVal) / ((maxVal - minVal) || 1)) * CH
    setTooltip({ x: PAD.left + xStep * idx, y: yx, label: String(labels[idx]), items, containerRect: rect })
  }, [labels, seriesSafe, tab])

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
    setHoveredIdx(null)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="border border-zinc-200 dark:border-white/[0.08] bg-white/95 dark:bg-[#0f1117]/90 px-5 py-4 text-center max-w-xs">
            <BarChart2 className="w-8 h-8 text-zinc-300 dark:text-white/10 mx-auto mb-2" />
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/35">Sem dados para exibir</div>
            <div className="text-[11px] text-zinc-400 dark:text-white/20 mt-1">Ajuste o período ou filtros para visualizar dados.</div>
          </div>
        </div>
      )}
      {tooltip && (
        <ChartTooltip
          x={tooltip.x}
          y={tooltip.y}
          label={tooltip.label}
          items={tooltip.items}
          formatter={fmt}
          containerRect={tooltip.containerRect}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * PALETA INDUSTRIAL — barras empilhadas
 * ───────────────────────────────────────────────────────────── */
const BAR_COLORS: Record<string, { top: string; bottom: string }> = {
  // PARADAS — âmbar/laranja fechado × vermelho industrial
  "N.Planejada":   { top: "#ef4444", bottom: "#7f1d1d" },
  "Planejada":     { top: "#f59e0b", bottom: "#92400e" },
  "Qtd. N.Plan.":  { top: "#ef4444", bottom: "#7f1d1d" },
  "Qtd. Planejada":{ top: "#f59e0b", bottom: "#92400e" },
  // PRODUÇÃO — verde/azul/vermelho industriais
  "Bom":           { top: "#22c55e", bottom: "#166534" },
  "Retrabalho":    { top: "#3b82f6", bottom: "#1e3a8a" },
  "Refugo":        { top: "#ef4444", bottom: "#7f1d1d" },
}
function barGradient(ctx: CanvasRenderingContext2D, name: string, x: number, yTop: number, h: number, fallbackColor: string) {
  const c = BAR_COLORS[name]
  const top    = c?.top    ?? fallbackColor
  const bottom = c?.bottom ?? fallbackColor
  const g = ctx.createLinearGradient(x, yTop, x, yTop + Math.max(h, 1))
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  return g
}

/* ─────────────────────────────────────────────────────────────
 * STACKED BAR CHART — canvas industrial
 * Largura das barras adaptativa ao número de períodos.
 * Gradiente por segmento. Click drill-down. Linha secundária (%).
 * ───────────────────────────────────────────────────────────── */
interface StackedSegment {
  name:  string
  data:  number[]
  color: string
}

/**
 * Largura da barra = fração do slot, proporcional à densidade de dias.
 * Poucos dias → barras largas (1 dia ≈ 90% da área útil, 2 dias ≈ 41% cada).
 * Muitos dias → barras finas. Sem cap fixo em px (deixa a barra crescer).
 */
function adaptiveBarWidth(n: number, slotW: number): number {
  let frac: number
  if (n <= 1)       frac = 0.90
  else if (n <= 2)  frac = 0.82
  else if (n <= 3)  frac = 0.78
  else if (n <= 5)  frac = 0.74
  else if (n <= 7)  frac = 0.70
  else if (n <= 14) frac = 0.66
  else if (n <= 31) frac = 0.60
  else if (n <= 60) frac = 0.54
  else              frac = 0.48
  return Math.max(2, slotW * frac)
}

function StackedBarChart({
  labels,
  segments,
  yLabel,
  valueFormatter,
  axisFormatter,
  secondaryLine,
  secondaryLabel,
  secondaryFormatter,
  secondaryMax,
  extraLines,
  activeSegmentIndices,
  onClickBar,
  buildTooltip,
}: {
  labels:             string[]
  segments:           StackedSegment[]
  yLabel:             string
  valueFormatter?:    (v: number) => string
  axisFormatter?:     (v: number) => string
  secondaryLine?:     { name: string; data: number[]; color: string }
  secondaryLabel?:    string
  secondaryFormatter?:(v: number) => string
  /** força o teto do eixo secundário (ex.: 1 para FPY 0–100%) */
  secondaryMax?:      number
  /** linhas extra sobrepostas com escala própria compartilhada (ex.: ciclo real/ideal em s) */
  extraLines?:        Array<{ name: string; data: number[]; color: string; dashed?: boolean }>
  activeSegmentIndices: Set<number>
  onClickBar?:        (idx: number, label: string) => void
  /** tooltip customizado por índice (formatação por item) */
  buildTooltip?:      (idx: number) => Array<{ name: string; value: number; color: string; display?: string; strong?: boolean; divider?: boolean }>
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string
    items: Array<{ name: string; value: number; color: string }>
    containerRect?: DOMRect
  } | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const fmt     = valueFormatter  ?? fmtValue
  const fmtAxis = axisFormatter   ?? ((v: number) =>
    Math.abs(v) >= 3600 ? secondsToHHmm(v) : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : v.toFixed(0))
  const fmtSec  = secondaryFormatter ?? ((v: number) => `${(v * 100).toFixed(0)}%`)

  const activeSegs = useMemo(() =>
    segments.filter((_, i) => activeSegmentIndices.has(i)),
    [segments, activeSegmentIndices])

  const hasData = useMemo(() =>
    labels?.length > 0 && activeSegs.some(s => s.data.some(v => Number.isFinite(v) && v !== 0)),
    [labels, activeSegs])

  const PAD_L = 80
  const PAD_R_BASE = 28
  const PAD_R_SEC  = 58

  useEffect(() => {
    const canvasEl    = canvasRef.current
    const containerEl = containerRef.current
    if (!canvasEl || !containerEl) return
    const ctx = canvasEl.getContext("2d")
    if (!ctx) return

    const PAD_R = secondaryLine ? PAD_R_SEC : PAD_R_BASE
    const PAD   = { top: 32, right: PAD_R, bottom: 52, left: PAD_L }

    const draw = (hIdx: number | null) => {
      const isDark = document.documentElement.classList.contains("dark")
      const rect   = containerEl.getBoundingClientRect()
      const W = rect.width, H = rect.height
      const CW = W - PAD.left - PAD.right
      const CH = H - PAD.top  - PAD.bottom
      ctx.clearRect(0, 0, W, H)
      const n = labels?.length ?? 0
      if (!n || CW <= 0 || CH <= 0) return

      // slot layout (bar chart — slots, not points)
      const slotW = CW / n
      const barW  = adaptiveBarWidth(n, slotW)
      const slotX = (i: number) => PAD.left + slotW * i + slotW / 2

      // stacked max
      const totals = labels.map((_, i) =>
        activeSegs.reduce((s, seg) => s + (Number.isFinite(seg.data[i]) ? Math.max(0, seg.data[i]) : 0), 0))
      const maxVal = Math.max(...totals, 1) * 1.10

      const toY = (v: number) => PAD.top + CH - (v / maxVal) * CH

      // background
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"
      ctx.fillRect(PAD.left, PAD.top, CW, CH)

      // grid + Y labels (left)
      const gridN = 5
      ctx.save()
      for (let gi = 0; gi <= gridN; gi++) {
        const gy = PAD.top + (CH / gridN) * gi
        const gv = maxVal * (1 - gi / gridN)
        ctx.beginPath(); ctx.setLineDash([2, 6])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)"
        ctx.lineWidth = 1
        ctx.moveTo(PAD.left, gy); ctx.lineTo(W - PAD.right, gy)
        ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.42)" : "rgba(0,0,0,0.55)"
        ctx.font = "500 11px 'Inter', system-ui, sans-serif"
        ctx.textAlign = "right"
        ctx.fillText(fmtAxis(gv), PAD.left - 10, gy + 4)
      }
      ctx.restore()

      // Y label left
      ctx.save(); ctx.translate(16, H / 2); ctx.rotate(-Math.PI / 2)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.45)"
      ctx.font = "600 11px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
      ctx.fillText(yLabel, 0, 0); ctx.restore()

      // Y label right (secondary)
      if (secondaryLine && secondaryLabel) {
        ctx.save(); ctx.translate(W - 10, H / 2); ctx.rotate(Math.PI / 2)
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.38)"
        ctx.font = "600 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
        ctx.fillText(secondaryLabel, 0, 0); ctx.restore()
      }

      // X labels
      const stepL = n > 60 ? Math.ceil(n / 15) : n > 30 ? Math.ceil(n / 12) : n > 14 ? 2 : 1
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.45)"
      ctx.font = "500 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
      for (let i = 0; i < n; i++) {
        if (i % stepL !== 0 && i !== n - 1) continue
        ctx.fillText(String(labels[i] ?? ""), slotX(i), H - 14)
      }

      // hover column highlight
      if (hIdx !== null && hIdx >= 0 && hIdx < n) {
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"
        ctx.fillRect(slotX(hIdx) - slotW / 2, PAD.top, slotW, CH)
        ctx.beginPath(); ctx.setLineDash([3, 5])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.25)"
        ctx.lineWidth = 1.5
        ctx.moveTo(slotX(hIdx), PAD.top); ctx.lineTo(slotX(hIdx), PAD.top + CH)
        ctx.stroke(); ctx.setLineDash([])
      }

      // ── STACKED BARS ─────────────────────────────────────
      for (let i = 0; i < n; i++) {
        let yBase    = PAD.top + CH
        const isHov  = hIdx === i
        const bx     = slotX(i) - barW / 2
        let totalH   = 0
        const segParts: Array<{ yTop: number; h: number; name: string; color: string }> = []

        for (const seg of activeSegs) {
          const v = Math.max(0, Number.isFinite(seg.data[i]) ? seg.data[i] : 0)
          if (v === 0) continue
          const barH = Math.max(1, (v / maxVal) * CH)
          segParts.push({ yTop: yBase - barH, h: barH, name: seg.name, color: seg.color })
          totalH += barH
          yBase  -= barH
        }

        for (let si = 0; si < segParts.length; si++) {
          const part    = segParts[si]
          const isTop   = si === segParts.length - 1
          const alpha   = isHov ? 1 : 0.92

          ctx.save()
          ctx.globalAlpha = alpha
          ctx.shadowColor = isHov ? `${part.color}66` : "transparent"
          ctx.shadowBlur  = isHov ? 8 : 0

          // gradient fill — pontas RETAS (sem arredondamento)
          const grad = barGradient(ctx, part.name, bx, part.yTop, part.h, part.color)
          ctx.fillStyle = grad
          ctx.fillRect(bx, part.yTop, barW, part.h)
          void isTop

          // separator line between segments
          if (si < segParts.length - 1) {
            ctx.fillStyle = isDark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)"
            ctx.fillRect(bx, part.yTop + part.h - 1, barW, 1.5)
          }

          // light sheen at top of each segment
          const sheenGrad = ctx.createLinearGradient(bx, part.yTop, bx, part.yTop + Math.min(part.h, 8))
          sheenGrad.addColorStop(0, "rgba(255,255,255,0.18)")
          sheenGrad.addColorStop(1, "rgba(255,255,255,0)")
          ctx.fillStyle = sheenGrad
          ctx.fillRect(bx, part.yTop, barW, Math.min(part.h, 8))

          ctx.restore()
        }

        // hover: bright border around the whole bar stack
        if (isHov && totalH > 0) {
          const stackTop = PAD.top + CH - totalH
          ctx.strokeStyle = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.45)"
          ctx.lineWidth = 1.5
          ctx.strokeRect(bx + 0.75, stackTop + 0.75, barW - 1.5, totalH - 1.5)
        }
      }

      // ── SECONDARY LINE (FPY / %) ──────────────────────────
      if (secondaryLine) {
        const secData = secondaryLine.data
        const validSec = secData.filter(Number.isFinite)
        const secMax   = secondaryMax ?? (Math.max(...validSec, 0.001) * 1.08)
        const toYSec   = (v: number) => PAD.top + CH - (Math.max(0, v) / secMax) * CH

        // secondary Y ticks (right)
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.42)"
        ctx.font = "500 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "left"
        for (let gi = 0; gi <= gridN; gi++) {
          const gy = PAD.top + (CH / gridN) * gi
          const gv = secMax * (1 - gi / gridN)
          ctx.fillText(fmtSec(gv), W - PAD.right + 6, gy + 4)
        }

        // line — stroke limpo, sem glow neon
        ctx.save()
        ctx.beginPath()
        let started = false
        for (let i = 0; i < n; i++) {
          if (!Number.isFinite(secData[i])) continue
          const lx = slotX(i); const ly = toYSec(secData[i])
          if (!started) { ctx.moveTo(lx, ly); started = true } else ctx.lineTo(lx, ly)
        }
        ctx.strokeStyle = secondaryLine.color; ctx.lineWidth = 2
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke()
        ctx.restore()

        // dots — pequenos e discretos
        for (let i = 0; i < n; i++) {
          if (!Number.isFinite(secData[i])) continue
          const lx = slotX(i); const ly = toYSec(secData[i])
          if (hIdx === i) {
            ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2)
            ctx.fillStyle = isDark ? "#0f1117" : "#ffffff"; ctx.fill()
            ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2)
            ctx.fillStyle = secondaryLine.color; ctx.fill()
          } else if (n <= 45) {
            ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI * 2)
            ctx.globalAlpha = 0.75; ctx.fillStyle = secondaryLine.color; ctx.fill()
            ctx.globalAlpha = 1
          }
        }
      }

      // ── LINHAS EXTRA (ciclo real / ideal — escala própria em s) ──
      if (extraLines && extraLines.length) {
        const allVals = extraLines.flatMap(l => l.data.filter(Number.isFinite))
        const exMax   = Math.max(...allVals, 0.001) * 1.12
        const toYEx   = (v: number) => PAD.top + CH - (Math.max(0, v) / exMax) * CH
        for (const line of extraLines) {
          const d = line.data
          ctx.save()
          ctx.beginPath()
          if (line.dashed) ctx.setLineDash([7, 4])
          let started = false
          for (let i = 0; i < n; i++) {
            if (!Number.isFinite(d[i])) continue
            const lx = slotX(i); const ly = toYEx(d[i])
            if (!started) { ctx.moveTo(lx, ly); started = true } else ctx.lineTo(lx, ly)
          }
          // ideal (tracejada) mais destacada; real (sólida) traço firme
          ctx.strokeStyle = line.color; ctx.lineWidth = line.dashed ? 2.5 : 2.5
          ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.globalAlpha = 1
          ctx.stroke(); ctx.setLineDash([]); ctx.restore()
          // dots discretos apenas na linha sólida (ciclo real)
          if (!line.dashed && n <= 45) {
            for (let i = 0; i < n; i++) {
              if (!Number.isFinite(d[i])) continue
              const lx = slotX(i); const ly = toYEx(d[i])
              if (hIdx === i) {
                ctx.beginPath(); ctx.arc(lx, ly, 5.5, 0, Math.PI * 2)
                ctx.fillStyle = isDark ? "#0f1117" : "#ffffff"; ctx.fill()
                ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2)
                ctx.fillStyle = line.color; ctx.fill()
              } else {
                ctx.beginPath(); ctx.arc(lx, ly, 1.8, 0, Math.PI * 2)
                ctx.globalAlpha = 0.7; ctx.fillStyle = line.color; ctx.fill(); ctx.globalAlpha = 1
              }
            }
          }
        }
      }
    }

    const resizeAndDraw = () => {
      const rect = containerEl.getBoundingClientRect()
      const dpr  = window.devicePixelRatio || 1
      canvasEl.width  = Math.max(1, Math.floor(rect.width  * dpr))
      canvasEl.height = Math.max(1, Math.floor(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(hoveredIdx)
    }

    const ro = new ResizeObserver(resizeAndDraw)
    ro.observe(containerEl)
    resizeAndDraw()
    return () => ro.disconnect()
  }, [labels, activeSegs, yLabel, fmtAxis, fmtSec, hoveredIdx, secondaryLine, secondaryLabel, secondaryMax, extraLines])

  // mouse move — slot-based hit test
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const containerEl = containerRef.current
    if (!containerEl) return
    const rect = containerEl.getBoundingClientRect()
    const x    = e.clientX - rect.left
    const PAD_R = secondaryLine ? PAD_R_SEC : PAD_R_BASE
    const CW    = rect.width - PAD_L - PAD_R
    const n     = labels?.length ?? 0
    if (!n) { setTooltip(null); setHoveredIdx(null); return }
    if (x < PAD_L - 8 || x > rect.width - PAD_R + 8) { setTooltip(null); setHoveredIdx(null); return }
    const slotW = CW / n
    const idx   = clamp(Math.floor((x - PAD_L) / slotW), 0, n - 1)
    setHoveredIdx(idx)

    let items: Array<{ name: string; value: number; color: string; display?: string; strong?: boolean; divider?: boolean }>
    if (buildTooltip) {
      items = buildTooltip(idx)
    } else {
      items = []
      for (const seg of activeSegs) items.push({ name: seg.name, value: safeNum(seg.data[idx]), color: seg.color })
      if (secondaryLine) items.push({ name: secondaryLine.name, value: safeNum(secondaryLine.data[idx]), color: secondaryLine.color })
      if (extraLines) for (const l of extraLines) items.push({ name: l.name, value: safeNum(l.data[idx]), color: l.color })
    }

    const PAD_T = 32, PAD_B = 52
    const CH    = rect.height - PAD_T - PAD_B
    const tot   = activeSegs.reduce((s, seg) => s + Math.max(0, safeNum(seg.data[idx])), 0)
    const maxV  = Math.max(...labels.map((_, i) => activeSegs.reduce((s, seg) => s + Math.max(0, safeNum(seg.data[i])), 0)), 1) * 1.10
    const yx    = PAD_T + CH - (tot / maxV) * CH
    const cx    = PAD_L + slotW * idx + slotW / 2
    setTooltip({ x: cx, y: yx, label: String(labels[idx]), items, containerRect: rect })
  }, [labels, activeSegs, secondaryLine, extraLines, buildTooltip])

  const handleMouseLeave = useCallback(() => { setTooltip(null); setHoveredIdx(null) }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onClickBar) return
    const containerEl = containerRef.current
    if (!containerEl) return
    const rect  = containerEl.getBoundingClientRect()
    const x     = e.clientX - rect.left
    const PAD_R = secondaryLine ? PAD_R_SEC : PAD_R_BASE
    const CW    = rect.width - PAD_L - PAD_R
    const n     = labels?.length ?? 0
    if (!n || x < PAD_L - 8 || x > rect.width - PAD_R + 8) return
    const idx = clamp(Math.floor((x - PAD_L) / (CW / n)), 0, n - 1)
    onClickBar(idx, String(labels[idx]))
  }, [labels, onClickBar, secondaryLine])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${onClickBar ? "cursor-pointer" : "cursor-crosshair"}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="border border-zinc-200 dark:border-white/[0.08] bg-white/95 dark:bg-[#0f1117]/90 px-5 py-4 text-center max-w-xs">
            <BarChart2 className="w-8 h-8 text-zinc-300 dark:text-white/10 mx-auto mb-2" />
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/35">Sem dados para exibir</div>
          </div>
        </div>
      )}
      {tooltip && (
        <ChartTooltip x={tooltip.x} y={tooltip.y} label={tooltip.label}
          items={tooltip.items} formatter={fmt} containerRect={tooltip.containerRect} />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * DRILLDOWN PANEL — painel de detalhes ao clicar no gráfico
 * ───────────────────────────────────────────────────────────── */
interface DrilldownInfo {
  label:    string
  startUtc: string
  endUtc:   string
}

interface DrilldownCtRow {
  centro_trabalho_id: string | null
  ct_codigo: string | null
  ct_nome:   string | null
  dur_planejada_seg:     number
  dur_nao_planejada_seg: number
  qtd_paradas:           number
  qtd_nao_planejadas:    number
}

interface DrilldownMotivoRow {
  motivo_id:          string | null
  motivo_codigo:      string | null
  motivo_descricao:   string | null
  motivo_grupo_perda: string | null
  is_planejada:       boolean | null
  duracao_total_seg:  number
  quantidade:         number
  /** fração 0–1 da duração total (backend: percentual_duracao) */
  percentual_duracao:   number
  /** fração 0–1 acumulada (backend: percentual_acumulado) */
  percentual_acumulado: number
}

function DrilldownPanel({
  info,
  onClose,
  filters,
}: {
  info:    DrilldownInfo
  onClose: () => void
  filters: {
    setorId?:          string
    turnoId?:          string
    centroTrabalhoId?: string
    produtoId?:        string
    ordemId?:          string
    empresaId?:        string
  }
}) {
  const [ctData, setCtData]         = useState<DrilldownCtRow[]>([])
  const [motivoData, setMotivoData] = useState<DrilldownMotivoRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)

    const sp = new URLSearchParams()
    sp.set("startUtc", info.startUtc)
    sp.set("endUtc",   info.endUtc)
    if (filters.empresaId)        sp.set("empresaId",        filters.empresaId)
    if (filters.setorId)          sp.set("setorId",          filters.setorId)
    if (filters.turnoId)          sp.set("turnoId",          filters.turnoId)
    if (filters.centroTrabalhoId) sp.set("centroTrabalhoId", filters.centroTrabalhoId)
    if (filters.produtoId)        sp.set("produtoId",        filters.produtoId)
    if (filters.ordemId)          sp.set("ordemId",          filters.ordemId)

    const ctUrl     = `/api/db/historico?mode=paradas_ct&${sp.toString()}`
    const paretoUrl = `/api/db/historico?tab=paradas_pareto&granularity=op_day&paretoTopN=10&${sp.toString()}`

    Promise.all([
      fetch(ctUrl).then(r => r.json()),
      fetch(paretoUrl).then(r => r.json()),
    ])
      .then(([ctRes, paretoRes]) => {
        setCtData(Array.isArray(ctRes?.data) ? ctRes.data : [])
        const pareto = paretoRes?.pareto ?? paretoRes?.result?.pareto ?? []
        setMotivoData(Array.isArray(pareto) ? pareto : [])
      })
      .catch((e) => setError(String(e?.message ?? "Erro ao carregar dados.")))
      .finally(() => setLoading(false))
  }, [info.startUtc, info.endUtc, filters.empresaId, filters.setorId, filters.turnoId, filters.centroTrabalhoId, filters.produtoId, filters.ordemId])

  const totalNPlan = ctData.reduce((s, r) => s + safeNum(r.dur_nao_planejada_seg), 0)
  const totalPlan  = ctData.reduce((s, r) => s + safeNum(r.dur_planejada_seg), 0)

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-[#0d1117] border border-zinc-200 dark:border-white/[0.1] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-white/[0.07] bg-zinc-50 dark:bg-white/[0.02] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-amber-500" />
            <div>
              <div className="font-black text-zinc-900 dark:text-white/85 text-sm tracking-tight">Detalhes de Paradas</div>
              <div className="text-[11px] text-zinc-400 dark:text-white/28 font-mono mt-0.5">{info.label}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.07] transition-colors">
            <X className="w-4 h-4 text-zinc-400 dark:text-white/30" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 px-5 py-4 text-red-500">
              <AlertCircle className="w-4 h-4" /> <span className="text-sm">{error}</span>
            </div>
          ) : (
            <div className="p-5 space-y-6">
              {/* KPIs do dia */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "N.Planejada Total", value: secondsToHHmm(totalNPlan), color: "#dc2626" },
                  { label: "Planejada Total",   value: secondsToHHmm(totalPlan),  color: "#d97706" },
                  { label: "Total Paradas",     value: String(ctData.reduce((s,r)=>s+safeNum(r.qtd_paradas),0)), color: "#2563eb" },
                  { label: "N.Plan. Ocorr.",    value: String(ctData.reduce((s,r)=>s+safeNum(r.qtd_nao_planejadas),0)), color: "#dc2626" },
                ].map(k => (
                  <div key={k.label} className="border bg-white dark:bg-white/[0.025] p-3" style={{ borderColor: `${k.color}22`, borderLeftWidth:"2px", borderLeftColor: k.color }}>
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400 dark:text-white/30 mb-1">{k.label}</div>
                    <div className="text-xl font-black tabular-nums" style={{ color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* CT breakdown */}
              {ctData.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 dark:text-white/30 mb-2">Paradas por Posto / CT</div>
                  <div className="space-y-2">
                    {ctData.slice(0, 8).map((row, i) => {
                      const nplan = safeNum(row.dur_nao_planejada_seg)
                      const plan  = safeNum(row.dur_planejada_seg)
                      const total = nplan + plan
                      const pct   = totalNPlan > 0 ? (nplan / totalNPlan) * 100 : 0
                      return (
                        <div key={`${row.centro_trabalho_id}-${i}`} className="flex items-center gap-3">
                          <div className="w-20 text-right text-[10px] font-bold text-zinc-500 dark:text-white/40 flex-shrink-0 truncate">
                            {row.ct_codigo ?? "—"}
                          </div>
                          <div className="flex-1 flex h-5 overflow-hidden bg-zinc-100 dark:bg-white/[0.05]">
                            {nplan > 0 && (
                              <div
                                className="h-full flex items-center justify-end pr-1 text-[9px] font-bold text-white"
                                style={{ width: `${Math.min(100, pct)}%`, background: "#dc2626", minWidth: nplan > 0 ? 4 : 0 }}
                              />
                            )}
                            {plan > 0 && (
                              <div
                                className="h-full"
                                style={{ width: `${totalNPlan > 0 ? (plan/totalNPlan)*100 : 0}%`, background: "#d97706", minWidth: plan > 0 ? 2 : 0 }}
                              />
                            )}
                          </div>
                          <div className="text-[11px] font-black tabular-nums text-zinc-700 dark:text-white/70 w-16 text-right flex-shrink-0">
                            {secondsToHHmm(total)}
                          </div>
                          <div className="text-[10px] text-zinc-400 dark:text-white/30 w-8 text-right flex-shrink-0">
                            {pct.toFixed(0)}%
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[9px] text-zinc-400 dark:text-white/25">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 inline-block" style={{background:"#dc2626"}}/> N.Planejada</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 inline-block" style={{background:"#d97706"}}/> Planejada</span>
                  </div>
                </div>
              )}

              {/* Motivos pareto */}
              {motivoData.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 dark:text-white/30 mb-2">Top Motivos (Pareto)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-100 dark:border-white/[0.06]">
                          {["Motivo","Grupo","Plan?","Duração","Ocorr.","% Dur."].map(h => (
                            <th key={h} className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400 dark:text-white/25 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {motivoData.slice(0, 10).map((m, i) => (
                          <tr key={i} className="border-b border-zinc-100 dark:border-white/[0.04] hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
                            <td className="px-2 py-1.5 font-medium text-zinc-700 dark:text-white/65 max-w-[140px] truncate">{m.motivo_descricao ?? m.motivo_codigo ?? "Sem motivo"}</td>
                            <td className="px-2 py-1.5 text-zinc-400 dark:text-white/30">{m.motivo_grupo_perda ?? "—"}</td>
                            <td className="px-2 py-1.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 ${m.is_planejada ? "bg-amber-50 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400" : "bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"}`}>
                                {m.is_planejada ? "Sim" : "Não"}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 font-black tabular-nums text-zinc-800 dark:text-white/75">{secondsToHHmm(m.duracao_total_seg)}</td>
                            <td className="px-2 py-1.5 tabular-nums text-zinc-500 dark:text-white/40">{m.quantidade}</td>
                            <td className="px-2 py-1.5 font-bold text-zinc-600 dark:text-white/55">
                              {/* backend devolve fração 0–1 em percentual_duracao — antes lia
                                  m.percentual (campo inexistente) e mostrava sempre 0,0% */}
                              <div className="flex items-center gap-1.5">
                                <div className="w-12 h-1.5 bg-zinc-100 dark:bg-white/[0.07] overflow-hidden">
                                  <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (m.percentual_duracao ?? 0) * 100)}%` }} />
                                </div>
                                {((m.percentual_duracao ?? 0) * 100).toFixed(1)}%
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {ctData.length === 0 && motivoData.length === 0 && (
                <div className="text-center py-8 text-zinc-400 dark:text-white/25 text-sm">Nenhuma parada registrada neste período.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * PARADAS — TABELA DE DETALHE (paradas individuais do dia)
 * ───────────────────────────────────────────────────────────── */
interface ParadaDetalheRow {
  parada_id:          string
  ct_codigo:          string | null
  ct_nome:            string | null
  motivo_codigo:      string | null
  motivo_descricao:   string | null
  motivo_grupo_perda: string | null
  is_planejada:       boolean | null
  inicio_utc:         string | null
  fim_utc:            string | null
  em_andamento:       boolean
  duracao_seg:        number
  ordem_codigo:       string | null
  produto_descricao:  string | null
  rebarbador_nome:    string | null
}

function fmtUtcToLocal(iso: string | null): string {
  if (!iso) return "—"
  // API envia UTC sem sufixo Z (CONVERT 126). Interpreta como UTC.
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function ParadasDetalheTable({
  startUtc,
  endUtc,
  filters,
}: {
  startUtc: string
  endUtc:   string
  filters: {
    empresaId?:        string
    setorId?:          string
    turnoId?:          string
    centroTrabalhoId?: string
    produtoId?:        string
    ordemId?:          string
  }
}) {
  const [rows, setRows]       = useState<ParadaDetalheRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const sp = new URLSearchParams()
    sp.set("mode", "paradas_detalhe")
    sp.set("startUtc", startUtc)
    sp.set("endUtc",   endUtc)
    if (filters.empresaId)        sp.set("empresaId",        filters.empresaId)
    if (filters.setorId)          sp.set("setorId",          filters.setorId)
    if (filters.turnoId)          sp.set("turnoId",          filters.turnoId)
    if (filters.centroTrabalhoId) sp.set("centroTrabalhoId", filters.centroTrabalhoId)
    if (filters.produtoId)        sp.set("produtoId",        filters.produtoId)
    if (filters.ordemId)          sp.set("ordemId",          filters.ordemId)

    fetch(`/api/db/historico?${sp.toString()}`)
      .then(r => r.json())
      .then(res => {
        if (cancelled) return
        setRows(Array.isArray(res?.data) ? res.data : [])
      })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? "Erro ao carregar detalhe.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startUtc, endUtc, filters.empresaId, filters.setorId, filters.turnoId, filters.centroTrabalhoId, filters.produtoId, filters.ordemId])

  const totalDur = rows.reduce((s, r) => s + safeNum(r.duracao_seg), 0)

  return (
    <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-white/45">Paradas do dia selecionado</span>
          <span className="text-[10px] font-bold text-zinc-400 dark:text-white/20 bg-zinc-100 dark:bg-white/[0.05] px-2 py-0.5">{rows.length} reg.</span>
        </div>
        {!loading && rows.length > 0 && (
          <span className="text-[11px] text-zinc-500 dark:text-white/40 tabular-nums">
            Tempo total parado: <span className="font-black text-zinc-700 dark:text-white/70">{secondsToHHmm(totalDur)}</span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-5 py-4 text-red-500"><AlertCircle className="w-4 h-4" /><span className="text-sm">{error}</span></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-400 dark:text-white/25 text-sm">Sem paradas para este dia.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-white/[0.06] bg-zinc-50 dark:bg-transparent">
                {["Centro / Posto", "Rebarbador", "Motivo", "Tipo", "Início", "Fim", "Duração", "Ordem / Produto"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400 dark:text-white/28 ${i >= 4 && i <= 6 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.parada_id} className="border-b border-zinc-100 dark:border-white/[0.04] hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors">
                  <td className="px-4 py-2 text-zinc-700 dark:text-white/65">
                    <span className="font-bold">{r.ct_codigo ?? "—"}</span>
                    {r.ct_nome && <span className="text-zinc-400 dark:text-white/30 ml-1.5 text-[11px]">{r.ct_nome}</span>}
                  </td>
                  <td className="px-4 py-2 text-[11px] whitespace-nowrap">
                    {r.rebarbador_nome
                      ? <span className="font-bold text-zinc-600 dark:text-white/55">{r.rebarbador_nome}</span>
                      : <span className="text-zinc-400 dark:text-white/25 italic">Indefinido</span>}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-white/55 max-w-[200px] truncate">{r.motivo_descricao ?? r.motivo_codigo ?? "Sem motivo"}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 ${r.is_planejada ? "bg-amber-50 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400" : "bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"}`}>
                      {r.is_planejada ? "Planejada" : "N.Planejada"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-500 dark:text-white/40 font-mono text-[11px] whitespace-nowrap">{fmtUtcToLocal(r.inicio_utc)}</td>
                  <td className="px-4 py-2 text-right text-zinc-500 dark:text-white/40 font-mono text-[11px] whitespace-nowrap">
                    {r.em_andamento ? <span className="text-amber-500 font-bold">em curso</span> : fmtUtcToLocal(r.fim_utc)}
                  </td>
                  <td className="px-4 py-2 text-right font-black tabular-nums text-zinc-800 dark:text-white/75">{secondsToHHmm(safeNum(r.duracao_seg))}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-white/40 text-[11px]">
                    {r.ordem_codigo && <span className="font-bold text-zinc-600 dark:text-white/55">{r.ordem_codigo}</span>}
                    {r.produto_descricao && <span className="ml-1.5 truncate">{r.produto_descricao}</span>}
                    {!r.ordem_codigo && !r.produto_descricao && "—"}
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
 * DETALHE DE PRODUÇÃO DO DIA (por posto / peça)
 * ───────────────────────────────────────────────────────────── */
interface ProducaoDetalheRow {
  centro_trabalho_id: string | null
  ct_codigo:          string | null
  ct_nome:            string | null
  produto_id:         string | null
  produto_codigo:     string | null
  produto_descricao:  string | null
  good:               number
  rework:             number
  scrap:              number
  total_produzido:    number
  ciclo_real_seg:     number | null
  ciclo_ideal_seg:    number | null
  capacidade:         number | null
  rebarbador_nome:    string | null
}

function ProducaoDetalheTable({
  startUtc,
  endUtc,
  filters,
}: {
  startUtc: string
  endUtc:   string
  filters: {
    empresaId?:        string
    setorId?:          string
    turnoId?:          string
    centroTrabalhoId?: string
    produtoId?:        string
    ordemId?:          string
  }
}) {
  const [rows, setRows]       = useState<ProducaoDetalheRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const sp = new URLSearchParams()
    sp.set("mode", "producao_detalhe")
    sp.set("startUtc", startUtc)
    sp.set("endUtc",   endUtc)
    if (filters.empresaId)        sp.set("empresaId",        filters.empresaId)
    if (filters.setorId)          sp.set("setorId",          filters.setorId)
    if (filters.turnoId)          sp.set("turnoId",          filters.turnoId)
    if (filters.centroTrabalhoId) sp.set("centroTrabalhoId", filters.centroTrabalhoId)
    if (filters.produtoId)        sp.set("produtoId",        filters.produtoId)
    if (filters.ordemId)          sp.set("ordemId",          filters.ordemId)

    fetch(`/api/db/historico?${sp.toString()}`)
      .then(r => r.json())
      .then(res => {
        if (cancelled) return
        setRows(Array.isArray(res?.data) ? res.data : [])
      })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? "Erro ao carregar detalhe.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startUtc, endUtc, filters.empresaId, filters.setorId, filters.turnoId, filters.centroTrabalhoId, filters.produtoId, filters.ordemId])

  const totBom  = rows.reduce((s, r) => s + safeNum(r.good), 0)
  const totRet  = rows.reduce((s, r) => s + safeNum(r.rework), 0)
  const totRef  = rows.reduce((s, r) => s + safeNum(r.scrap), 0)
  const totProd = totBom + totRet + totRef

  return (
    <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-emerald-500" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-white/45">Produção do dia selecionado</span>
          <span className="text-[10px] font-bold text-zinc-400 dark:text-white/20 bg-zinc-100 dark:bg-white/[0.05] px-2 py-0.5">{rows.length} reg.</span>
        </div>
        {!loading && rows.length > 0 && (
          <span className="text-[11px] text-zinc-500 dark:text-white/40 tabular-nums">
            Total produzido: <span className="font-black text-zinc-700 dark:text-white/70">{fmtInt(totProd)}</span>
            <span className="text-zinc-300 dark:text-white/20"> · </span>
            Bom <span className="font-bold text-emerald-500">{fmtInt(totBom)}</span>
            <span className="text-zinc-300 dark:text-white/20"> · </span>
            Retrab. <span className="font-bold text-blue-500">{fmtInt(totRet)}</span>
            <span className="text-zinc-300 dark:text-white/20"> · </span>
            Refugo <span className="font-bold text-red-500">{fmtInt(totRef)}</span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-5 py-4 text-red-500"><AlertCircle className="w-4 h-4" /><span className="text-sm">{error}</span></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-400 dark:text-white/25 text-sm">Sem produção para este dia.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-white/[0.06] bg-zinc-50 dark:bg-transparent">
                {["Posto", "Rebarbador", "Peça", "Bom", "Retrab.", "Refugo", "Total", "Ciclo Real", "Ciclo Ideal", "Capacidade"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400 dark:text-white/28 ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const real  = r.ciclo_real_seg
                const ideal = r.ciclo_ideal_seg
                const slower = real != null && ideal != null && ideal > 0 && real > ideal * 1.02
                const faster = real != null && ideal != null && ideal > 0 && real < ideal * 0.98
                return (
                  <tr key={`${r.centro_trabalho_id ?? "?"}-${r.produto_id ?? "?"}-${i}`} className="border-b border-zinc-100 dark:border-white/[0.04] hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors">
                    <td className="px-4 py-2 text-zinc-700 dark:text-white/65">
                      <span className="font-bold">{r.ct_codigo ?? "—"}</span>
                      {r.ct_nome && <span className="text-zinc-400 dark:text-white/30 ml-1.5 text-[11px]">{r.ct_nome}</span>}
                    </td>
                    <td className="px-4 py-2 text-[11px] whitespace-nowrap">
                      {r.rebarbador_nome
                        ? <span className="font-bold text-zinc-600 dark:text-white/55">{r.rebarbador_nome}</span>
                        : <span className="text-zinc-400 dark:text-white/25 italic">Indefinido</span>}
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-white/55 max-w-[220px] truncate">
                      {r.produto_codigo && <span className="font-bold text-zinc-600 dark:text-white/55">{r.produto_codigo}</span>}
                      {r.produto_descricao && <span className="ml-1.5 text-[11px] text-zinc-400 dark:text-white/35">{r.produto_descricao}</span>}
                      {!r.produto_codigo && !r.produto_descricao && "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtInt(safeNum(r.good))}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">{fmtInt(safeNum(r.rework))}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-500 dark:text-red-400">{fmtInt(safeNum(r.scrap))}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-black text-zinc-800 dark:text-white/80">{fmtInt(safeNum(r.total_produzido))}</td>
                    <td className={`px-4 py-2 text-right font-mono text-[12px] font-bold ${slower ? "text-red-500 dark:text-red-400" : faster ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-600 dark:text-white/55"}`}>
                      {real != null ? formatCiclo(real) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[12px] text-zinc-500 dark:text-white/40">{ideal != null ? formatCiclo(ideal) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-white/55">{r.capacidade != null ? fmtInt(r.capacidade) : "—"}</td>
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

/* ─────────────────────────────────────────────────────────────
 * SERIES TOGGLE (legenda interativa)
 * ───────────────────────────────────────────────────────────── */
function SeriesLegend({
  seriesList,
  activeIndices,
  onToggle,
  tab,
}: {
  seriesList: HistorySeries[]
  activeIndices: Set<number>
  onToggle: (idx: number) => void
  tab: HistoryTab
}) {
  const [showInfo, setShowInfo] = useState<number | null>(null)
  const legends = SERIES_LEGENDS[tab] ?? {}

  if (!seriesList?.length) return null

  return (
    <div className="flex flex-wrap gap-2 items-start">
      {seriesList.map((s, idx) => {
        const active = activeIndices.has(idx)
        const name = String((s as any)?.name ?? `Série ${idx + 1}`)
        const color = resolveSeriesColor(tab, name, idx, false)
        const unit = (s as any)?.unit
        // legendas indexadas pelo nome traduzido (o backend manda em inglês)
        const desc = legends[ptSeriesName(name)] ?? legends[name]

        return (
          <div key={name} className="relative">
            <button
              type="button"
              onClick={() => onToggle(idx)}
              className={`flex items-center gap-2 px-2.5 py-1.5 border text-[11px] font-bold uppercase tracking-[0.07em] transition-all ${active
                  ? "border-transparent text-white"
                  : "border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-white/[0.03] text-zinc-300 dark:text-white/25 line-through opacity-50 hover:opacity-75"
                }`}
              style={active ? { background: color, borderColor: color } : {}}
              title={desc || name}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: active ? "rgba(255,255,255,0.85)" : color }}
              />
              {ptSeriesName(name)}
              {unit && <span className="opacity-70">({unit})</span>}
            </button>
            {desc && (
              <button
                type="button"
                className="absolute -top-1 -right-1 w-4 h-4 bg-zinc-100 dark:bg-white/[0.07] border border-zinc-200 dark:border-white/[0.12] flex items-center justify-center text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/60 transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowInfo(showInfo === idx ? null : idx) }}
              >
                <HelpCircle className="w-2.5 h-2.5" />
              </button>
            )}
            {showInfo === idx && desc && (
              <div className="absolute top-full left-0 z-40 mt-2 w-64 bg-white dark:bg-[#0a0d12] border border-zinc-200 dark:border-white/[0.1] text-zinc-800 dark:text-white text-[11px] leading-relaxed p-3 shadow-2xl">
                <div className="font-bold text-zinc-600 dark:text-white/65 mb-1">{ptSeriesName(name)}</div>
                <div className="text-zinc-500 dark:text-white/35">{desc}</div>
                <div
                  className="absolute -top-1.5 left-4 w-3 h-3 rotate-45 bg-white dark:bg-[#0a0d12] border-l border-t border-zinc-200 dark:border-white/[0.1]"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * DATA TABLE — industrial, multi-colunas
 * ───────────────────────────────────────────────────────────── */
function DataTable({
  rows,
  seriesList,
  valueLabelFallback,
  valueFormatter,
  onCopy,
  onExportCSV,
  onPrint,
  tab,
}: {
  rows: HistoryTableRow[]
  seriesList: HistorySeries[]
  valueLabelFallback: string
  valueFormatter?: (v: number) => string
  onCopy?: () => void
  onExportCSV?: () => void
  onPrint?: () => void
  tab: HistoryTab
}) {
  const fmt = valueFormatter ?? ((v: number) => fmtValue(v))
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [search, setSearch] = useState("")

  const columns = useMemo(() => {
    if (rows?.length) {
      const keys = new Set<string>()
      for (const r of rows) Object.keys(r ?? {}).forEach((k) => keys.add(k))
      const skip = new Set(["bucket", "label", "dia_utc"])
      const ordered = ["dia", ...Array.from(keys).filter((k) => k !== "dia" && !skip.has(k))]
      if (ordered.length > 1) return ordered
    }
    const sCols = seriesList?.length ? seriesList.map((s) => String((s as any)?.name)) : [valueLabelFallback]
    return ["dia", ...Array.from(new Set(sCols.filter(Boolean)))]
  }, [rows, seriesList, valueLabelFallback])

  // "dia" chega formatado ("DD/MM/YYYY" ou "DD/MM/YYYY HH:00") — converte
  // para número ordenável AAAAMMDDHHmm; parseFlexibleNumber devolveria 0
  // para todas as linhas e a ordenação por Período não fazia nada.
  const diaSortValue = (row: HistoryTableRow): number => {
    const s = String(row["dia"] ?? "")
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
    if (!m) return 0
    return Number(`${m[3]}${m[2]}${m[1]}${(m[4] ?? "0").padStart(2, "0")}${m[5] ?? "00"}`)
  }

  const sortedRows = useMemo(() => {
    let r = [...rows]
    if (search) r = r.filter((row) =>
      Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(search.toLowerCase()))
    )
    if (sortCol) {
      r = r.sort((a, b) => {
        const diff = sortCol === "dia"
          ? diaSortValue(a) - diaSortValue(b)
          : parseFlexibleNumber(a[sortCol] ?? 0) - parseFlexibleNumber(b[sortCol] ?? 0)
        return sortDir === "asc" ? diff : -diff
      })
    }
    return r
  }, [rows, sortCol, sortDir, search])

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("desc") }
  }

  return (
    <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-zinc-300 dark:text-white/20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-white/45">Tabela de dados</span>
          <span className="text-[10px] font-bold text-zinc-400 dark:text-white/20 bg-zinc-100 dark:bg-white/[0.05] px-2 py-0.5">
            {sortedRows.length} reg.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Filtrar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-3 pr-7 text-[11px] border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-zinc-600 dark:text-white/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30 w-28 placeholder:text-zinc-300 dark:placeholder:text-white/18"
            />
            {search && (
              <button className="absolute right-2 top-1.5" onClick={() => setSearch("")}>
                <X className="w-3 h-3 text-zinc-400 dark:text-white/30" />
              </button>
            )}
          </div>
          <button className="p-2 hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors" title="Copiar TSV" type="button" onClick={onCopy}>
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button className="p-2 hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors" title="Exportar CSV" type="button" onClick={onExportCSV}>
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button className="p-2 hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors" title="Imprimir" type="button" onClick={onPrint}>
            <Printer className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full text-sm font-mono tabular-nums"
          style={{ fontFamily: "var(--font-mono), 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace" }}
        >
          <thead>
            <tr className="border-b border-zinc-100 dark:border-white/[0.06] bg-zinc-50 dark:bg-white/[0.025]">
              {columns.map((c) => (
                <th
                  key={c}
                  className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] select-none cursor-pointer transition-colors ${c === "dia" ? "text-left" : "text-right"
                    }`}
                  style={{ color: c === "dia" ? "oklch(0.45 0.14 60)" : "oklch(0.62 0.018 255)" }}
                  onClick={() => handleSort(c)}
                >
                  <span className={`flex items-center gap-1 ${c === "dia" ? "justify-start" : "justify-end"}`}>
                    {c === "dia" ? "Período" : ptSeriesName(c)}
                    {sortCol === c && (
                      <span className="text-amber-500">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const rowKey = String((row as any)?.dia ?? `row-${idx}`)
              return (
                <tr
                  key={`row-${rowKey}-${idx}`}
                  className="border-b border-zinc-100 dark:border-white/[0.04] hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors"
                >
                  {columns.map((c) => {
                    const val = (row as Record<string, unknown>)[c]
                    if (c === "dia") return (
                      <td
                        key={`${rowKey}-${c}`}
                        className="px-4 py-2 font-mono text-[12px] font-bold whitespace-nowrap tabular-nums"
                        style={{ color: "oklch(0.18 0.025 255)" }}
                      >
                        {String(val ?? "")}
                      </td>
                    )
                    const n = parseFlexibleNumber(val)
                    const isNum = val != null && (typeof val === "number" || (typeof val === "string" && String(val).trim() !== "" && Number.isFinite(Number(String(val).replace(",", ".")))))
                    return (
                      <td
                        key={`${rowKey}-${c}`}
                        className="px-4 py-2 text-right font-mono text-[13px] font-bold tabular-nums"
                        style={{
                          color: isNum ? "oklch(0.18 0.025 255)" : "oklch(0.62 0.018 255)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {isNum ? fmt(n) : String(val ?? "—")}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {!sortedRows.length && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-[11px] text-zinc-400 dark:text-white/18 uppercase tracking-[0.1em]">
                  Nenhum dado encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * RANGE PRESET BUTTONS
 * ───────────────────────────────────────────────────────────── */
function RangePresets({ onSelect }: { onSelect: (start: string, end: string) => void }) {
  const presets = [
    { label: "Hoje", days: 0 },
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
  ]
  return (
    <div className="flex gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] border border-white/[0.07] bg-white/[0.03] text-white/30 hover:bg-amber-500/15 hover:border-amber-500/30 hover:text-amber-400 transition-colors"
          onClick={() => {
            const end = utcDateToYYYYMMDD(new Date())
            const start = p.days === 0 ? end : utcDateToYYYYMMDD(new Date(Date.now() - p.days * 86400000))
            onSelect(start, end)
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * SELECT FIELD
 * ───────────────────────────────────────────────────────────── */
function SelectField({
  label,
  value,
  onChange,
  children,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
      >
        {children}
      </select>
      {hint && <p className="text-[10px] text-zinc-400 dark:text-white/22">{hint}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * MAIN CONTENT
 * ───────────────────────────────────────────────────────────── */
function HistoricoContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const defaultEnd = useMemo(() => currentOpDayYMD(), [])
  // Resolvemos a aba inicial direto da URL (em vez de esperar o useEffect
  // de sync) pra já nascer com o período certo (ver defaultRangeForTab).
  const initialTab = useMemo<HistoryTab>(() => {
    const t = searchParams.get("tab")
    return TABS.some((x) => x.id === t) ? (t as HistoryTab) : "oee"
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const initialRange = useMemo(() => defaultRangeForTab(initialTab, defaultEnd), [initialTab, defaultEnd])

  // Vira true assim que o usuário escolhe um período manualmente (calendário
  // ou período anterior/próximo) — a partir daí, trocar de aba NÃO pisa mais
  // na escolha do usuário. Enquanto false, cada troca de aba reaplica o
  // padrão daquela aba (ver efeito abaixo). Começa true se a URL já trouxe
  // um startDate explícito (link compartilhado/aba com estado salvo).
  const periodTouchedRef = useRef(
    Boolean(searchParams.get("startDate") && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("startDate")!))
  )

  // As cascatas (setor→limpa CT, produto→limpa ordem) não podem disparar
  // quando o setor/produto acabou de ser hidratado da URL — senão um link
  // compartilhado com setor+CT (ou produto+ordem) perdia o CT/ordem no load.
  const setorFromUrlRef = useRef<string | null>(null)
  const produtoFromUrlRef = useRef<string | null>(null)
  const ctCascadeMountedRef = useRef(false)
  const ordemCascadeMountedRef = useRef(false)

  // ─── STATE ───────────────────────────────────────────────
  const [empresaId, setEmpresaId] = useState("")
  const [activeTab, setActiveTab] = useState<HistoryTab>(initialTab)
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [startTime, setStartTime] = useState("06:00")
  const [endTime, setEndTime] = useState("06:00")
  const [granularity, setGranularity] = useState<Granularity>("op_day")
  const [setorId, setSetorId] = useState("")
  const [turnoId, setTurnoId] = useState("")
  const [centroTrabalhoId, setCentroTrabalhoId] = useState("")
  const [produtoId, setProdutoId] = useState("")
  const [ordemId, setOrdemId] = useState("")
  const [producaoMetric, setProducaoMetric] = useState<ProducaoMetric>("Qtd. Produzida e Capacidade")
  const [unit, setUnit] = useState<UnitSelect>("UN")
  const [paradasMetric, setParadasMetric] = useState<ParadasMetric>("Duração")
  const [cicloMetric, setCicloMetric] = useState<CicloMetric>("Tempo de Ciclo")
  const [perdasMetric, setPerdasMetric] = useState<PerdasMetric>("Tempo perdido")
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [showLegends, setShowLegends] = useState(true)
  const [activeSeriesIndices, setActiveSeriesIndices] = useState<Set<number>>(new Set())
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [drilldown, setDrilldown] = useState<DrilldownInfo | null>(null)
  const [selectedDay, setSelectedDay] = useState<{ rawDay: string; label: string; startUtc: string; endUtc: string } | null>(null)
  const [nowLabel, setNowLabel] = useState<string | null>(null)
  // memoizados p/ manter a mesma referência de objeto Date entre renders (o relógio ao
  // vivo do rodapé re-renderiza este componente a cada segundo; sem isso, o DateRangePicker
  // via inline `yyyymmddToDate(...)` recebia um Date novo por render e resetava a seleção do usuário)
  const pickerStartDate = useMemo(() => yyyymmddToDate(startDate), [startDate])
  const pickerEndDate = useMemo(() => yyyymmddToDate(endDate), [endDate])

  useEffect(() => {
    const tick = () => setNowLabel(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // ─── VALIDATION ──────────────────────────────────────────
  const rangeError = useMemo(() => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/
    if (!validDate.test(startDate) || !validDate.test(endDate)) return "Data inválida."
    const op = computeOpWindow(startDate, endDate, startTime, endTime)
    if (!Number.isFinite(op.startDt.getTime()) || !Number.isFinite(op.endDt.getTime())) return "Data inválida."
    if (op.endDt <= op.startDt) return "Fim deve ser maior que início."
    if ((op.endDt.getTime() - op.startDt.getTime()) / 86400000 > 365 * 2) return "Limite: 2 anos."
    return null
  }, [startDate, endDate, startTime, endTime])

  const rangeIso = useMemo(() => {
    const op = computeOpWindow(startDate, endDate, startTime, endTime)
    return {
      startUtc: op.startDt.toISOString(),
      endUtc: op.endDt.toISOString(),
    }
  }, [startDate, endDate, startTime, endTime])

  const periodText = useMemo(() => {
    const startFmt = formatBRFromYYYYMMDD(startDate)
    const op = computeOpWindow(startDate, endDate, startTime, endTime)
    return `${startFmt} ${normalizeHM(startTime)} — ${op.endDateDisplay} ${normalizeHM(endTime)}`
  }, [startDate, endDate, startTime, endTime])

  const activeTabConfig = useMemo(() => TABS.find((t) => t.id === activeTab) ?? TABS[0], [activeTab])

  // ─── URL SYNC ────────────────────────────────────────────
  useEffect(() => {
    const g = (k: string) => searchParams.get(k) ?? ""
    const tab = g("tab"); if (TABS.some((t) => t.id === tab)) setActiveTab(tab as HistoryTab)
    const emp = g("empresaId"); if (emp) setEmpresaId(emp)
    const s = g("startDate"); if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) { setStartDate(s); periodTouchedRef.current = true }
    const e = g("endDate"); if (e && /^\d{4}-\d{2}-\d{2}$/.test(e)) { setEndDate(e); periodTouchedRef.current = true }
    const st = g("st") || g("startTime"); if (st) setStartTime(normalizeHM(st))
    const et = g("et") || g("endTime"); if (et) setEndTime(normalizeHM(et))
    const gran = g("granularity"); if (gran) setGranularity(gran as Granularity)
    const setor = g("setorId"); if (setor) { setorFromUrlRef.current = setor; setSetorId(setor) }
    const turno = g("turnoId"); if (turno) setTurnoId(turno)
    const ct = g("centroTrabalhoId"); if (ct) setCentroTrabalhoId(ct)
    const prod = g("produtoId"); if (prod) { produtoFromUrlRef.current = prod; setProdutoId(prod) }
    const ord = g("ordemId"); if (ord) setOrdemId(ord)
    const pm = g("producaoMetric"); if (pm) setProducaoMetric(pm as ProducaoMetric)
    const um = g("unit"); if (um) setUnit(um as UnitSelect)
    const pam = g("paradasMetric"); if (pam) setParadasMetric(pam as ParadasMetric)
    const cm = g("cicloMetric"); if (cm) setCicloMetric(cm as CicloMetric)
    const pem = g("perdasMetric"); if (pem) setPerdasMetric(pem as PerdasMetric)
    const fo = g("filtersOpen"); if (fo === "0") setFiltersOpen(false)
  }, []) // only on mount

  // Reaplica o período padrão da aba (OEE = últimos 7 dias, demais = hoje)
  // toda vez que a aba muda — cobre a troca via botões da própria página
  // (setActiveTab direto), não só o primeiro carregamento. Só entra em
  // ação enquanto o usuário não escolheu um período manualmente
  // (periodTouchedRef); depois disso a escolha do usuário é respeitada
  // ao trocar de aba.
  useEffect(() => {
    if (periodTouchedRef.current) return
    const range = defaultRangeForTab(activeTab, currentOpDayYMD())
    setStartDate(range.start)
    setEndDate(range.end)
  }, [activeTab])

  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams()
      const set = (k: string, v: string) => { if (v) sp.set(k, v) }
      sp.set("tab", activeTab)
      set("empresaId", empresaId)
      // Só grava startDate/endDate na URL quando divergem do padrão da aba
      // (usuário escolheu manualmente) — se sempre gravássemos, um reload
      // no dia seguinte "congelaria" a data de ontem (periodTouchedRef lê
      // a presença desses parâmetros pra saber se o usuário mexeu ou não).
      const tabDefaults = defaultRangeForTab(activeTab, currentOpDayYMD())
      if (startDate !== tabDefaults.start || endDate !== tabDefaults.end) {
        sp.set("startDate", startDate)
        sp.set("endDate", endDate)
      }
      sp.set("st", normalizeHM(startTime))
      sp.set("et", normalizeHM(endTime))
      sp.set("granularity", granularity)
      sp.set("filtersOpen", filtersOpen ? "1" : "0")
      set("setorId", setorId); set("turnoId", turnoId); set("centroTrabalhoId", centroTrabalhoId)
      set("produtoId", produtoId); set("ordemId", ordemId)
      sp.set("producaoMetric", producaoMetric); sp.set("unit", unit)
      sp.set("paradasMetric", paradasMetric); sp.set("cicloMetric", cicloMetric)
      sp.set("perdasMetric", perdasMetric)
      router.replace(`?${sp.toString()}`)
    }, 300)
    return () => clearTimeout(t)
  }, [activeTab, empresaId, startDate, endDate, startTime, endTime, granularity, setorId, turnoId, centroTrabalhoId, produtoId, ordemId, producaoMetric, unit, paradasMetric, cicloMetric, perdasMetric, filtersOpen, router])

  // cascades — pulam a 1ª execução (mount) e a transição vinda da URL
  useEffect(() => {
    if (!ctCascadeMountedRef.current) { ctCascadeMountedRef.current = true; return }
    if (setorFromUrlRef.current !== null && setorFromUrlRef.current === setorId) {
      setorFromUrlRef.current = null
      return
    }
    setCentroTrabalhoId("")
  }, [setorId])
  useEffect(() => {
    if (!ordemCascadeMountedRef.current) { ordemCascadeMountedRef.current = true; return }
    if (produtoFromUrlRef.current !== null && produtoFromUrlRef.current === produtoId) {
      produtoFromUrlRef.current = null
      return
    }
    setOrdemId("")
  }, [produtoId])

  // reset active series when tab changes
  useEffect(() => { setActiveSeriesIndices(new Set()) }, [activeTab])

  // limpa seleção de dia / drilldown quando filtros, período ou aba mudam
  useEffect(() => {
    setSelectedDay(null)
    setDrilldown(null)
  }, [activeTab, startDate, endDate, startTime, endTime, granularity, setorId, turnoId, centroTrabalhoId, produtoId, ordemId])

  // ─── LISTS ───────────────────────────────────────────────
  const setores = useHistoricoSetores({ empresaId: empresaId || undefined, enable: true })
  const turnos = useHistoricoTurnos({ empresaId: empresaId || undefined, enable: true })
  const centros = useHistoricoCentrosTrabalho({ empresaId: empresaId || undefined, setorId: setorId || undefined, enable: true })
  const produtos = useHistoricoProdutos({ empresaId: empresaId || undefined, enable: true })
  const ordens = useHistoricoOrdens({
    empresaId: empresaId || undefined,
    range: rangeIso,
    enable: Boolean(rangeIso.startUtc && rangeIso.endUtc && !rangeError),
  })

  // ─── DATA FETCH ──────────────────────────────────────────
  const historico = useHistorico({
    empresaId: empresaId || undefined,
    tab: activeTab,
    granularity,
    range: rangeIso,
    filters: {
      setorId: setorId || undefined,
      turnoId: turnoId || undefined,
      centroTrabalhoId: centroTrabalhoId || undefined,
      produtoId: produtoId || undefined,
      ordemId: ordemId || undefined,
    },
    producaoMetric: activeTab === "producao" ? producaoMetric : undefined,
    paradasMetric: activeTab === "paradas" ? paradasMetric : undefined,
    cicloMetric: activeTab === "ciclo" ? cicloMetric : undefined,
    perdasMetric: activeTab === "perdas" ? perdasMetric : undefined,
    unit: ["producao", "refugo", "retrabalho", "perdas"].includes(activeTab) ? unit : undefined,
    // aba Rebarbadores (id interno "pessoas") tem fetch próprio no componente
    enable: activeTab !== "pessoas" && Boolean(rangeIso.startUtc && rangeIso.endUtc && !rangeError),
  })

  // Ciclo secundário — carregado apenas enquanto aba PRODUÇÃO está ativa
  const historicoCiclo = useHistorico({
    empresaId: empresaId || undefined,
    tab: "ciclo",
    granularity,
    range: rangeIso,
    filters: {
      setorId: setorId || undefined,
      turnoId: turnoId || undefined,
      centroTrabalhoId: centroTrabalhoId || undefined,
      produtoId: produtoId || undefined,
      ordemId: ordemId || undefined,
    },
    cicloMetric: "Ciclo Médio",
    enable: activeTab === "producao" && Boolean(rangeIso.startUtc && rangeIso.endUtc && !rangeError),
  })

  const cicloKpis = useMemo(() => {
    if (activeTab !== "producao") return null
    const realS  = historicoCiclo.seriesList?.find(s => s.name === "Ciclo Médio (s)")?.data ?? []
    const idealS = historicoCiclo.seriesList?.find(s => s.name === "Ciclo Ideal (s)")?.data ?? []
    const valid  = (arr: number[]) => arr.filter(v => Number.isFinite(v) && v > 0)
    const avg    = (arr: number[]) => { const v = valid(arr); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 }
    const avgReal  = avg(realS)
    const avgIdeal = avg(idealS)
    const hasData  = avgReal > 0 && avgIdeal > 0
    const desvio   = hasData ? ((avgReal - avgIdeal) / avgIdeal) * 100 : null
    return { avgReal, avgIdeal, desvio, count: valid(realS).length, hasData }
  }, [activeTab, historicoCiclo.seriesList])

  // Ciclo real/ideal por dia (label "DD/MM") — usado no tooltip da Produção
  const cicloByDay = useMemo(() => {
    const map = new Map<string, { real: number; ideal: number }>()
    if (activeTab !== "producao") return map
    const labels = Array.isArray(historicoCiclo.labels) ? historicoCiclo.labels.map(String) : []
    const realS  = historicoCiclo.seriesList?.find(s => s.name === "Ciclo Médio (s)")?.data ?? []
    const idealS = historicoCiclo.seriesList?.find(s => s.name === "Ciclo Ideal (s)")?.data ?? []
    labels.forEach((l, i) => {
      map.set(l, { real: safeNum(realS[i]), ideal: safeNum(idealS[i]) })
    })
    return map
  }, [activeTab, historicoCiclo.labels, historicoCiclo.seriesList])

  // ─── DERIVED DATA ────────────────────────────────────────
  const isTimeMode = (activeTab === "paradas" && paradasMetric === "Duração") ||
    (activeTab === "perdas" && perdasMetric === "Tempo perdido")

  const labelsFromApi = useMemo(() =>
    (Array.isArray(historico.labels) ? historico.labels : []).map(String),
    [historico.labels]
  )

  const chartLabels = useMemo(() => {
    return labelsFromApi.map((l) => {
      if (granularity === "hour") {
        const m = l.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2})/)
        if (m) return `${m[1].slice(8, 10)}/${m[1].slice(5, 7)} ${m[2].padStart(2, "0")}h`
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(l)) return `${l.slice(8, 10)}/${l.slice(5, 7)}`
      return l
    })
  }, [labelsFromApi, granularity])

  const seriesComputed = useMemo((): HistorySeries[] => {
    const list = Array.isArray(historico.seriesList) ? historico.seriesList : []
    return list.map((s: any) => ({
      name: String(s?.name ?? "Valor"),
      data: (Array.isArray(s?.data) ? s.data : []).map(safeNum),
      ...(s?.unit ? { unit: String(s.unit) } : {}),
    }))
  }, [historico.seriesList])

  // Sync active series when new series list arrives
  useEffect(() => {
    if (seriesComputed.length) {
      setActiveSeriesIndices(new Set(seriesComputed.map((_, i) => i)))
    }
  }, [seriesComputed.length, activeTab])

  const tableDataRaw = useMemo(() =>
    (Array.isArray(historico.table) ? historico.table : []),
    [historico.table]
  )

  const tableRowsFormatted = useMemo(() =>
    tableDataRaw.map((row: any, idx: number) => {
      const diaRaw = String(row?.dia ?? labelsFromApi[idx] ?? "")
      let dia = diaRaw
      if (granularity === "hour") {
        const m = diaRaw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2})/)
        if (m) dia = `${formatBRFromYYYYMMDD(m[1])} ${m[2].padStart(2, "0")}:00`
        else if (/^\d{4}-\d{2}-\d{2}/.test(diaRaw)) dia = formatBRFromYYYYMMDD(diaRaw)
      } else if (/^\d{4}-\d{2}-\d{2}/.test(diaRaw)) {
        dia = formatBRFromYYYYMMDD(diaRaw)
      }
      return { ...row, dia } as HistoryTableRow
    }),
    [tableDataRaw, labelsFromApi, granularity]
  )

  const valueFormatter = useMemo(() => {
    if (activeTab === "oee") return (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
    if (isTimeMode) return (v: number) => secondsToHHmm(v)
    return (v: number) => fmtValue(v)
  }, [isTimeMode, activeTab])

  const axisFormatter = useMemo(() => {
    if (activeTab === "oee") return (v: number) => `${(v * 100).toFixed(0)}%`
    if (isTimeMode) return (v: number) => secondsToHHmm(v)
    return (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)
  }, [isTimeMode, activeTab])

  const yLabel = useMemo(() => {
    switch (activeTab) {
      case "oee": return "Eficiência (%)"
      case "producao": return `Quantidade (${unit})`
      case "paradas": return paradasMetric === "Quantidade" ? "Qtd. Paradas" : "Duração (HH:mm)"
      case "refugo": return `Refugo (${unit})`
      case "retrabalho": return `Retrabalho (${unit})`
      case "ciclo": return "Tempo de Ciclo (s)"
      case "perdas": return perdasMetric === "Quantidade perdida" ? `Qtd. Perdida (${unit})` : "Tempo Perdido (HH:mm)"
      case "pessoas": return "Pessoas / Interações"
      case "eventos": return "Qtd. Eventos"
      default: return "Valor"
    }
  }, [activeTab, unit, paradasMetric, perdasMetric])

  const tableFallback = useMemo(() => {
    switch (activeTab) {
      case "oee": return "OEE (%)"
      case "producao": return `Produção (${unit})`
      default: return "Valor"
    }
  }, [activeTab, unit])

  // ─── KPIs ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const series0 = seriesComputed?.[0]?.data ?? []
    const valid = series0.filter((v) => Number.isFinite(v) && v !== 0)
    if (!valid.length) return { min: 0, max: 0, avg: 0, sum: 0, count: valid.length, trend: "flat" as const }
    const min = Math.min(...valid)
    const max = Math.max(...valid)
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length
    const sum = valid.reduce((a, b) => a + b, 0)
    return { min, max, avg, sum, count: valid.length, trend: getTrend(valid) }
  }, [seriesComputed])

  // ─── CHART TYPE HELPERS ──────────────────────────────────
  // PARADAS e PRODUÇÃO sempre usam barras empilhadas (tempo/quantidade).
  const useStackedBar = useMemo(() => {
    if (activeTab === "paradas")  return true
    if (activeTab === "producao") return true
    return false
  }, [activeTab])

  // Séries de duração (unit="s") para PARADAS — barras empilhadas por tempo
  const paradasDurationSegs = useMemo((): StackedSegment[] => {
    if (activeTab !== "paradas") return []
    const planSeries  = seriesComputed.find(s => s.name === "Dur. Planejada (s)")
    const nplanSeries = seriesComputed.find(s => s.name === "Dur. N.Plan. (s)")
    const result: StackedSegment[] = []
    if (planSeries)  result.push({ name: "Planejada",     data: planSeries.data,  color: "#f59e0b" })
    if (nplanSeries) result.push({ name: "N.Planejada",   data: nplanSeries.data, color: "#ef4444" })
    return result
  }, [activeTab, seriesComputed])

  // Séries de quantidade para PARADAS — barras empilhadas por ocorrências
  const paradasQtySegs = useMemo((): StackedSegment[] => {
    if (activeTab !== "paradas") return []
    const planS  = seriesComputed.find(s => s.name === "Qtd. Planejada")
    const nplanS = seriesComputed.find(s => s.name === "Qtd. N.Plan.")
    const result: StackedSegment[] = []
    if (planS)  result.push({ name: "Qtd. Planejada", data: planS.data,  color: "#f59e0b" })
    if (nplanS) result.push({ name: "Qtd. N.Plan.",   data: nplanS.data, color: "#ef4444" })
    return result
  }, [activeTab, seriesComputed])

  // Linha secundária de PARADAS: quantidade total (no modo Duração) — sóbria
  const paradasQtyLine = useMemo(() => {
    if (activeTab !== "paradas") return undefined
    const planS  = seriesComputed.find(s => s.name === "Qtd. Planejada")?.data ?? []
    const nplanS = seriesComputed.find(s => s.name === "Qtd. N.Plan.")?.data ?? []
    const n = Math.max(planS.length, nplanS.length)
    if (!n) return undefined
    const data = Array.from({ length: n }, (_, i) => safeNum(planS[i]) + safeNum(nplanS[i]))
    return { name: "Qtd. Total", data, color: "#64748b" }
  }, [activeTab, seriesComputed])

  // Tooltip de PARADAS — durações + quantidades por tipo + totais
  const buildParadasTooltip = useCallback((idx: number) => {
    const durPlan  = safeNum(seriesComputed.find(s => s.name === "Dur. Planejada (s)")?.data[idx])
    const durNplan = safeNum(seriesComputed.find(s => s.name === "Dur. N.Plan. (s)")?.data[idx])
    const qtdPlan  = safeNum(seriesComputed.find(s => s.name === "Qtd. Planejada")?.data[idx])
    const qtdNplan = safeNum(seriesComputed.find(s => s.name === "Qtd. N.Plan.")?.data[idx])
    return [
      { name: "Planejada",     value: durPlan,  color: "#f59e0b", display: secondsToHHmm(durPlan) },
      { name: "N.Planejada",   value: durNplan, color: "#ef4444", display: secondsToHHmm(durNplan) },
      { name: "Duração Total", value: durPlan + durNplan, color: "#334155", display: secondsToHHmm(durPlan + durNplan), strong: true, divider: true },
      { name: "Qtd. Planejada",value: qtdPlan,  color: "#f59e0b", display: fmtInt(qtdPlan), divider: true },
      { name: "Qtd. N.Plan.",  value: qtdNplan, color: "#ef4444", display: fmtInt(qtdNplan) },
      { name: "Qtd. Total",    value: qtdPlan + qtdNplan, color: "#334155", display: fmtInt(qtdPlan + qtdNplan), strong: true },
    ]
  }, [seriesComputed])

  // Séries de quantidade para PRODUÇÃO (Good→Bom, Rework→Retrabalho, Scrap→Refugo)
  const producaoStackSegs = useMemo((): StackedSegment[] => {
    if (activeTab !== "producao") return []
    const MAP: Array<{ api: string; pt: string; color: string }> = [
      { api: "Good",   pt: "Bom",        color: "#22c55e" },
      { api: "Rework", pt: "Retrabalho", color: "#3b82f6" },
      { api: "Scrap",  pt: "Refugo",     color: "#ef4444" },
    ]
    return MAP.flatMap(({ api, pt, color }) => {
      const s = seriesComputed.find(s => s.name === api)
      return s ? [{ name: pt, data: s.data, color }] : []
    })
  }, [activeTab, seriesComputed])

  // Tooltip da PRODUÇÃO — Bom/Retrab/Refugo + Total + Ciclo real/ideal/desvio do dia
  const buildProducaoTooltip = useCallback((idx: number) => {
    const items: Array<{ name: string; value: number; color: string; display?: string; strong?: boolean; divider?: boolean }> = []
    let total = 0
    for (const seg of producaoStackSegs) {
      const v = safeNum(seg.data[idx])
      total += v
      items.push({ name: seg.name, value: v, color: seg.color, display: fmtInt(v) })
    }
    items.push({ name: "Total Produzido", value: total, color: "#334155", display: fmtInt(total), strong: true, divider: true })
    // ciclo é buscado pelo dia BRUTO (YYYY-MM-DD), mesma chave do mapa — não pelo label formatado
    const cic = cicloByDay.get(String(labelsFromApi[idx] ?? ""))
    if (cic && (cic.real > 0 || cic.ideal > 0)) {
      const desvio = cic.real > 0 && cic.ideal > 0 ? ((cic.real - cic.ideal) / cic.ideal) * 100 : null
      items.push({ name: "Ciclo Real",  value: cic.real,  color: "#a3b400", display: formatCiclo(cic.real),  divider: true })
      items.push({ name: "Ciclo Ideal", value: cic.ideal, color: "#475569", display: formatCiclo(cic.ideal) })
      items.push({ name: "Desvio Ciclo", value: desvio ?? 0, color: "#64748b", display: desvio == null ? "—" : `${desvio > 0 ? "+" : ""}${desvio.toFixed(1)}%` })
    }
    return items
  }, [producaoStackSegs, cicloByDay, labelsFromApi])

  // Linhas de ciclo real (sólida) e ideal (tracejada) sobre o gráfico de produção,
  // alinhadas ao dia BRUTO. Valores ausentes viram NaN → a linha simplesmente pula o ponto.
  const producaoCicloLines = useMemo(() => {
    if (activeTab !== "producao") return undefined
    const real:  number[] = []
    const ideal: number[] = []
    let any = false
    for (const raw of labelsFromApi) {
      const cic = cicloByDay.get(String(raw))
      const r  = cic && cic.real  > 0 ? cic.real  : NaN
      const id = cic && cic.ideal > 0 ? cic.ideal : NaN
      if (Number.isFinite(r) || Number.isFinite(id)) any = true
      real.push(r); ideal.push(id)
    }
    if (!any) return undefined
    return [
      // ciclo real na cor do relógio do header (#c8f000, verde-amarelado neon) — só a cor, sem glow
      { name: "Ciclo Real (s)",  data: real,  color: "#c8f000", dashed: false },
      { name: "Ciclo Ideal (s)", data: ideal, color: "#475569", dashed: true },
    ]
  }, [activeTab, labelsFromApi, cicloByDay])

  // Segmentos efetivos de PARADAS conforme métrica (Duração vs Quantidade)
  const paradasSegs = useMemo(
    () => paradasMetric === "Quantidade" ? paradasQtySegs : paradasDurationSegs,
    [paradasMetric, paradasQtySegs, paradasDurationSegs]
  )

  // activeSegmentIndices mapeado para StackedBar de PARADAS
  const paradasActiveSegs = useMemo(() => {
    const all = new Set<number>()
    paradasSegs.forEach((_, i) => all.add(i))
    return all
  }, [paradasSegs])

  // activeSegmentIndices mapeado para StackedBar de PRODUÇÃO
  const producaoActiveSegs = useMemo(() => {
    const all = new Set<number>()
    producaoStackSegs.forEach((_, i) => all.add(i))
    return all
  }, [producaoStackSegs])

  // KPI override para PARADAS duração — rastreia series corretas
  const kpisDuration = useMemo(() => {
    if (activeTab !== "paradas" || paradasMetric !== "Duração") return null
    const nplanS = seriesComputed.find(s => s.name === "Dur. N.Plan. (s)")?.data ?? []
    const planS  = seriesComputed.find(s => s.name === "Dur. Planejada (s)")?.data ?? []
    const totalS = seriesComputed.find(s => s.name === "Duração Total (s)")?.data ?? []
    const validTotal = totalS.filter(v => Number.isFinite(v) && v > 0)
    const validNplan = nplanS.filter(v => Number.isFinite(v) && v > 0)
    if (!validTotal.length) return null
    return {
      avgTotal:  validTotal.reduce((a, b) => a + b, 0) / validTotal.length,
      maxTotal:  Math.max(...validTotal),
      minTotal:  Math.min(...validTotal),
      sumTotal:  validTotal.reduce((a, b) => a + b, 0),
      sumNplan:  validNplan.reduce((a, b) => a + b, 0),
      sumPlan:   planS.filter(Number.isFinite).reduce((a, b) => a + b, 0),
      trend:     getTrend(validTotal),
      count:     validTotal.length,
    }
  }, [activeTab, paradasMetric, seriesComputed])

  // Reconstrói o dia operacional YYYY-MM-DD a partir de um rótulo "DD/MM",
  // usando o(s) ano(s) da janela selecionada. Os labels da API vêm formatados
  // (labelFromBucket → "DD/MM"), então o dia bruto NÃO está nos labels.
  const reconstructOpDay = useCallback((label: string): string => {
    const m = String(label).match(/^(\d{2})\/(\d{2})/)
    if (!m) return ""
    const dd = m[1], mm = m[2]
    const sY = Number(startDate.slice(0, 4))
    const eY = Number(endDate.slice(0, 4))
    for (let y = sY; y <= eY; y++) {
      const cand = `${y}-${mm}-${dd}`
      if (cand >= startDate && cand <= endDate) return cand
    }
    return Number.isFinite(sY) ? `${sY}-${mm}-${dd}` : ""
  }, [startDate, endDate])

  // Handler: clique numa barra (PARADAS ou PRODUÇÃO) → seleciona o dia
  const handleBarClick = useCallback((idx: number, label: string) => {
    if (activeTab !== "paradas" && activeTab !== "producao") return
    // 1) tenta o dia BRUTO da tabela (quando alinhado); 2) senão reconstrói do rótulo "DD/MM".
    const rawFromTable = String((tableDataRaw[idx] as any)?.dia ?? "")
    const dm = rawFromTable.match(/^(\d{4}-\d{2}-\d{2})/)
    const dateStr = dm ? dm[1] : reconstructOpDay(String(label || labelsFromApi[idx] || ""))
    if (!dateStr) return // sem dia válido (ex.: granularidade por hora) → não seleciona
    const op = computeOpWindow(dateStr, dateStr, startTime, endTime)
    const startU = op.startDt.toISOString()
    const endU = op.endDt.toISOString()
    setSelectedDay(prev =>
      prev?.rawDay === dateStr
        ? null // clicar de novo no mesmo dia limpa a seleção
        : { rawDay: dateStr, label, startUtc: startU, endUtc: endU }
    )
  }, [activeTab, labelsFromApi, tableDataRaw, startTime, endTime, reconstructOpDay])

  // ─── HANDLERS ────────────────────────────────────────────
  const windowDays = useMemo(() => diffDaysInclusiveUTC(startDate, endDate), [startDate, endDate])

  const goPrev = () => {
    const { start, end } = shiftRangeDays(startDate, endDate, -Math.max(1, windowDays))
    periodTouchedRef.current = true
    setStartDate(start); setEndDate(end)
  }
  const goNext = () => {
    const { start, end } = shiftRangeDays(startDate, endDate, Math.max(1, windowDays))
    periodTouchedRef.current = true
    setStartDate(start); setEndDate(end)
  }

  const toggleSeries = useCallback((idx: number) => {
    setActiveSeriesIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        if (next.size === 1) return prev // keep at least one
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }, [])

  const shareableUrl = useMemo(() =>
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`
      : "",
    [searchParams]
  )

  const copyShareLink = async () => {
    try { await navigator.clipboard.writeText(shareableUrl) } catch { }
  }

  // cabeçalhos traduzidos (backend manda nomes de série em inglês: Good/Scrap/…)
  const exportHeaderName = (c: string) => (c === "dia" ? "Período" : ptSeriesName(c))

  const copyTableTSV = async () => {
    try {
      if (!tableRowsFormatted.length) return
      const cols = ["dia", ...new Set(tableRowsFormatted.flatMap((r) => Object.keys(r).filter((k) => k !== "dia")))]
      const tsv = [cols.map(exportHeaderName).join("\t"), ...tableRowsFormatted.map((r) => cols.map((c) => String((r as any)?.[c] ?? "")).join("\t"))].join("\n")
      await navigator.clipboard.writeText(tsv)
    } catch { }
  }

  const exportCSV = () => {
    if (!tableRowsFormatted.length) return
    const cols = ["dia", ...new Set(tableRowsFormatted.flatMap((r) => Object.keys(r).filter((k) => k !== "dia")))]
    const csv = toCSV(tableRowsFormatted as any, cols, cols.map(exportHeaderName))
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `historico_${activeTab}_${startDate}_${endDate}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  const resetGeral = () => {
    periodTouchedRef.current = false
    const range = defaultRangeForTab(activeTab, currentOpDayYMD())
    setEmpresaId(""); setStartDate(range.start); setEndDate(range.end)
    setStartTime("06:00"); setEndTime("06:00")
    setGranularity("op_day"); setSetorId(""); setTurnoId(""); setCentroTrabalhoId("")
    setProdutoId(""); setOrdemId(""); setProducaoMetric("Qtd. Produzida e Capacidade")
    setUnit("UN"); setParadasMetric("Duração"); setCicloMetric("Tempo de Ciclo")
    setPerdasMetric("Tempo perdido")
  }

  const limparFiltros = () => {
    setSetorId(""); setTurnoId(""); setCentroTrabalhoId(""); setProdutoId(""); setOrdemId("")
    setStartTime("06:00"); setEndTime("06:00")
  }

  // ordens safe
  const ordensSafe = useMemo(() => {
    const list = Array.isArray((ordens as any).data) ? (ordens as any).data : []
    return list.filter((o: any) => isNonEmpty(o?.ordem_id) || isNonEmpty(o?.ordem_public_id) || isNonEmpty(o?.ordem_codigo))
  }, [ordens])

  const hasActiveFilters = Boolean(setorId || turnoId || centroTrabalhoId || produtoId || ordemId)

  // ─── RENDER ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-h-screen">
        <Header onMenuClick={() => setSidebarOpen(true)} title="Histórico" />

        {/* ── TABS — sticky abaixo do header, largura total ── */}
        <div className="sticky top-12 z-40 bg-zinc-100 dark:bg-[#0f1117] border-b border-zinc-200 dark:border-white/[0.07] flex overflow-x-auto">
          {TABS.map((tab) => {
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
          {/* descrição da aba ativa — inline no lado direito */}
          <div className="ml-auto flex items-center gap-2 pr-5 flex-shrink-0">
            <span className="w-px h-4 bg-zinc-200 dark:bg-white/[0.08]" />
            <activeTabConfig.icon
              className="w-3 h-3 flex-shrink-0"
              style={{ color: "#f97316" }}
            />
            <span className="text-[10px] text-zinc-400 dark:text-white/28 max-w-[320px] hidden md:block leading-tight">
              {activeTabConfig.description}
            </span>
          </div>
        </div>

        <div className="p-3 lg:p-5 space-y-3">

          {/* ── FILTROS ── */}
          <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
            {/* header do painel de filtros */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
              <div className="flex items-center gap-3 min-w-0">
                <Filter className="w-4 h-4 text-zinc-300 dark:text-white/25 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-zinc-600 dark:text-white/60 truncate tabular-nums">
                    {periodText}
                    <span className="ml-2 text-[10px] font-bold tracking-[0.1em] uppercase text-zinc-400 dark:text-white/28 bg-zinc-100 dark:bg-white/[0.06] px-2 py-0.5">
                      {granularity === "op_day" ? "Dia Operacional" : granularity === "hour" ? "Hora" : granularity}
                    </span>
                    {hasActiveFilters && (
                      <span className="ml-2 text-[10px] font-bold tracking-[0.1em] uppercase text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10 px-2 py-0.5">
                        Filtros ativos
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  className="h-8 px-3 inline-flex items-center gap-1.5 border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.04] text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-[10px] font-bold uppercase tracking-[0.08em] transition-colors"
                  onClick={() => setFiltersOpen((v) => !v)}
                  type="button"
                >
                  {filtersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {filtersOpen ? "Recolher" : "Filtros"}
                </button>
                <div className="h-5 w-px bg-zinc-200 dark:bg-white/[0.07]" />
                <button className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/25 hover:text-zinc-600 dark:hover:text-white/55 transition-colors" title="Copiar link" type="button" onClick={copyShareLink}>
                  <Link2 className="w-3.5 h-3.5" />
                </button>
                <button className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/25 hover:text-zinc-600 dark:hover:text-white/55 transition-colors" title="Exportar CSV" type="button" onClick={exportCSV}>
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/25 hover:text-zinc-600 dark:hover:text-white/55 transition-colors"
                  title="Ver consulta"
                  type="button"
                  onClick={() => alert(JSON.stringify((historico as any)?.query ?? {}, null, 2))}
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* conteúdo do filtro */}
            {filtersOpen && (
              <div className="p-4 space-y-4">
                {rangeError && (
                  <div className="flex items-center gap-2.5 border border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/08 px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <div className="text-sm text-amber-700 dark:text-amber-400 font-medium">{rangeError}</div>
                  </div>
                )}

                {/* Linha 1: período + granularidade + métrica */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                        startDate={pickerStartDate}
                        endDate={pickerEndDate}
                        crosses={computeOpWindow(startDate, endDate, startTime, endTime).crosses}
                        onSelect={(s, e) => {
                          const pad = (n: number) => String(n).padStart(2, "0")
                          periodTouchedRef.current = true
                          setStartDate(`${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`)
                          setEndDate(`${e.getFullYear()}-${pad(e.getMonth()+1)}-${pad(e.getDate())}`)
                        }}
                      />
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30">Início</span>
                        <input
                          type="time"
                          value={normalizeHM(startTime)}
                          onChange={(e) => setStartTime(normalizeHM(e.target.value))}
                          className="w-full px-2 py-1.5 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-sm font-medium tabular-nums text-zinc-700 dark:text-white/65 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30">Fim</span>
                        <input
                          type="time"
                          value={normalizeHM(endTime)}
                          onChange={(e) => setEndTime(normalizeHM(e.target.value))}
                          className="w-full px-2 py-1.5 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-sm font-medium tabular-nums text-zinc-700 dark:text-white/65 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <SelectField
                      label="Visualizar por"
                      value={granularity}
                      onChange={(v) => setGranularity(v as Granularity)}
                    >
                      <option value="hour">Hora (máx. detalhe)</option>
                      <option value="op_day">Dia Operacional ({normalizeHM(startTime)}→{normalizeHM(endTime)})</option>
                      <option value="Dia">Dia Calendário</option>
                      <option value="Mês">Mês</option>
                    </SelectField>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-400 dark:text-white/30 mb-1 block">
                      Métrica
                    </label>
                    {["producao", "refugo", "retrabalho"].includes(activeTab) && (
                      <div className="flex gap-2">
                        <select
                          value={producaoMetric}
                          onChange={(e) => setProducaoMetric(e.target.value as ProducaoMetric)}
                          className="flex-1 px-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none transition-colors"
                        >
                          <option value="Qtd. Produzida e Capacidade">Completo</option>
                          <option value="Qtd. Produzida">Só Produção</option>
                          <option value="Capacidade">Só Capacidade</option>
                        </select>
                        <select
                          value={unit}
                          onChange={(e) => setUnit(e.target.value as UnitSelect)}
                          className="w-20 px-2 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none transition-colors"
                        >
                          <option value="UN">UN</option>
                        </select>
                      </div>
                    )}
                    {activeTab === "paradas" && (
                      <select value={paradasMetric} onChange={(e) => setParadasMetric(e.target.value as ParadasMetric)} className="w-full px-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none transition-colors">
                        <option value="Duração">Duração (HH:mm)</option>
                        <option value="Quantidade">Quantidade de ocorrências</option>
                      </select>
                    )}
                    {activeTab === "ciclo" && (
                      <select value={cicloMetric} onChange={(e) => setCicloMetric(e.target.value as CicloMetric)} className="w-full px-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none transition-colors">
                        <option value="Tempo de Ciclo">Tempo de Ciclo (s)</option>
                        <option value="Ciclo Médio">Ciclo Médio Ponderado</option>
                      </select>
                    )}
                    {activeTab === "perdas" && (
                      <select value={perdasMetric} onChange={(e) => setPerdasMetric(e.target.value as PerdasMetric)} className="w-full px-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-sm bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 focus:outline-none transition-colors">
                        <option value="Tempo perdido">Tempo perdido (HH:mm)</option>
                        <option value="Quantidade perdida">Quantidade perdida (UN)</option>
                      </select>
                    )}
                    {["oee", "eventos", "pessoas"].includes(activeTab) && (
                      <div className="px-3 py-2 text-[11px] text-zinc-400 dark:text-white/22 border border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-white/[0.02]">
                        — {activeTab === "pessoas" ? "REBARBADORES" : activeTab.toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Linha 2: filtros de dimensão */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  <SelectField label="Setor" value={setorId} onChange={setSetorId}>
                    <option value="">Todos os setores</option>
                    {setores.data?.map((s: any) => (
                      <option key={s.setor_id} value={s.setor_id}>{s.nome}</option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Turno"
                    value={turnoId}
                    onChange={(v) => {
                      setTurnoId(v)
                      const t = (turnos as any).data?.find((x: any) => x.turno_id === v)
                      if (v && t?.hora_inicio && t?.hora_fim) {
                        setStartTime(normalizeHM(t.hora_inicio))
                        setEndTime(normalizeHM(t.hora_fim))
                      } else {
                        setStartTime("06:00")
                        setEndTime("06:00")
                      }
                    }}
                  >
                    <option value="">Todos os turnos</option>
                    {(turnos as any).data?.map((t: any) => (
                      <option key={t.turno_id} value={t.turno_id}>
                        {t.nome}
                        {t.hora_inicio ? ` (${normalizeHM(t.hora_inicio)}–${normalizeHM(t.hora_fim)})` : ""}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField label="Centro de Trabalho" value={centroTrabalhoId} onChange={setCentroTrabalhoId}>
                    <option value="">Todos</option>
                    {(centros as any).data?.map((c: any) => (
                      <option key={c.centro_trabalho_id} value={c.centro_trabalho_id}>
                        {c.codigo} — {c.nome}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField label="Produto" value={produtoId} onChange={setProdutoId}>
                    <option value="">Todos</option>
                    {(produtos as any).data?.map((p: any) => (
                      <option key={p.produto_id} value={p.produto_id}>
                        {p.codigo} — {p.descricao}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Ordem de Produção"
                    value={ordemId}
                    onChange={setOrdemId}
                    hint={`${ordensSafe.length} ordens no período`}
                  >
                    <option value="">Todas</option>
                    {ordensSafe.map((o: any, idx: number) => {
                      const id = String(o?.ordem_id ?? o?.ordem_public_id ?? `ordem-${idx}`)
                      const codigo = String(o?.ordem_codigo ?? o?.ordem_public_id ?? "—")
                      const desc = String(o?.produto_descricao ?? "")
                      return (
                        <option key={`${id}-${idx}`} value={id}>
                          {desc ? `${codigo} — ${desc}` : codigo}
                        </option>
                      )
                    })}
                  </SelectField>
                </div>

                {/* Linha 3: ações */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-zinc-100 dark:border-white/[0.05]">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-white/22">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Filtros atualizam gráfico e tabela automaticamente
                  </div>
                  <div className="flex items-center gap-2">
                    {hasActiveFilters && (
                      <button
                        onClick={limparFiltros}
                        type="button"
                        className="inline-flex items-center gap-1.5 h-8 px-3 border border-red-200 dark:border-red-500/25 text-[10px] font-bold uppercase tracking-[0.08em] bg-red-50 dark:bg-red-500/08 hover:bg-red-100 dark:hover:bg-red-500/15 text-red-500 dark:text-red-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Limpar filtros
                      </button>
                    )}
                    <button
                      onClick={resetGeral}
                      type="button"
                      className="inline-flex items-center gap-1.5 h-8 px-3 border border-zinc-200 dark:border-white/[0.07] text-[10px] font-bold uppercase tracking-[0.08em] bg-zinc-50 dark:bg-white/[0.03] hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-zinc-500 dark:text-white/35 transition-colors"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                      Reset geral
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── ABA REBARBADORES — layout analítico próprio ──── */}
          {activeTab === "pessoas" && (
            <RebarbadoresTab
              empresaId={empresaId || undefined}
              range={rangeIso}
              rangeError={rangeError}
              periodText={periodText}
              filters={{
                setorId:          setorId || undefined,
                turnoId:          turnoId || undefined,
                centroTrabalhoId: centroTrabalhoId || undefined,
                produtoId:        produtoId || undefined,
                ordemId:          ordemId || undefined,
              }}
            />
          )}

          {/* ── KPI CARDS ─────────────────────────────────────── */}
          {activeTab !== "pessoas" && !rangeError && !historico.isLoading && seriesComputed.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
              {kpisDuration ? (
                // KPIs específicos para PARADAS modo Duração
                <>
                  <KpiCard label="Média Diária" value={kpisDuration.avgTotal} sub={`${kpisDuration.count} dias operacionais`} trend={kpisDuration.trend} color="#f97316" isPrimary formatter={secondsToHHmm} />
                  <KpiCard label="Máx. Diário"   value={kpisDuration.maxTotal} formatter={secondsToHHmm} />
                  <KpiCard label="Mín. Diário"   value={kpisDuration.minTotal} formatter={secondsToHHmm} />
                  <KpiCard label="Total Paradas" value={kpisDuration.sumTotal} sub="Soma do período" formatter={secondsToHHmm} />
                  <KpiCard label="N.Planejada"   value={kpisDuration.sumNplan} sub="Soma período" color="#dc2626" formatter={secondsToHHmm} />
                  <KpiCard label="Planejada"     value={kpisDuration.sumPlan}  sub="Soma período" color="#d97706" formatter={secondsToHHmm} />
                </>
              ) : (
                // KPIs genéricos para demais abas
                <>
                  <KpiCard
                    label="Média"
                    value={kpis.avg}
                    sub={`Série principal • ${kpis.count} pontos`}
                    trend={kpis.trend}
                    color="#f97316"
                    isPrimary
                    formatter={valueFormatter}
                  />
                  <KpiCard label="Máximo" value={kpis.max} formatter={valueFormatter} />
                  <KpiCard label="Mínimo" value={kpis.min} formatter={valueFormatter} />
                  {activeTab !== "oee" && (
                    <KpiCard
                      label="Total"
                      value={kpis.sum}
                      sub="Soma do período"
                      formatter={!isTimeMode ? (v) => fmtValue(v) : (v) => secondsToHHmm(v)}
                    />
                  )}
                  {seriesComputed.length > 1 && !(activeTab === "paradas") && (
                    <KpiCard
                      label={seriesComputed[1]?.name ? ptSeriesName(seriesComputed[1].name) : "S2 Média"}
                      value={(seriesComputed[1]?.data ?? []).filter(Number.isFinite).reduce((a, b, _, arr) => a + b / arr.length, 0)}
                      formatter={valueFormatter}
                    />
                  )}
                  {seriesComputed.length > 2 && !(activeTab === "paradas") && (
                    <KpiCard
                      label={seriesComputed[2]?.name ? ptSeriesName(seriesComputed[2].name) : "S3 Média"}
                      value={(seriesComputed[2]?.data ?? []).filter(Number.isFinite).reduce((a, b, _, arr) => a + b / arr.length, 0)}
                      formatter={valueFormatter}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* ── CICLO MÉDIO (aba PRODUÇÃO) ── */}
          {activeTab === "producao" && cicloKpis && !historicoCiclo.isLoading && (
            <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400 dark:text-white/30 mb-2.5">Ciclo Médio do Período</div>
              {cicloKpis.hasData ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-zinc-400 dark:text-white/30">Ciclo Real</span>
                    <span className="text-xl font-black tabular-nums text-zinc-800 dark:text-white/90">{formatCiclo(cicloKpis.avgReal)}</span>
                    <span className="text-[10px] text-zinc-400 dark:text-white/28">média dos {cicloKpis.count} dias</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-zinc-400 dark:text-white/30">Ciclo Ideal</span>
                    <span className="text-xl font-black tabular-nums text-zinc-800 dark:text-white/90">{formatCiclo(cicloKpis.avgIdeal)}</span>
                    <span className="text-[10px] text-zinc-400 dark:text-white/28">takt time do produto</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-zinc-400 dark:text-white/30">Desvio</span>
                    <span
                      className="text-xl font-black tabular-nums"
                      style={{ color: cicloKpis.desvio == null ? undefined : cicloKpis.desvio > 0.05 ? "#ef4444" : cicloKpis.desvio < -0.05 ? "#22c55e" : undefined }}
                    >
                      {cicloKpis.desvio == null ? "—" : `${cicloKpis.desvio > 0 ? "+" : ""}${cicloKpis.desvio.toFixed(1)}%`}
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-white/28">
                      {cicloKpis.desvio == null ? "" : cicloKpis.desvio > 0.05 ? "mais lento que o ideal" : cicloKpis.desvio < -0.05 ? "mais rápido que o ideal" : "no alvo"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-zinc-400 dark:text-white/30 py-1">Sem dados de ciclo para o período/filtros selecionados.</div>
              )}
            </div>
          )}

          {/* ── GRÁFICO ── */}
          {activeTab !== "pessoas" && (
          <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
            {/* chart header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.08] hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/65 transition-colors disabled:opacity-20"
                  type="button"
                  onClick={goPrev}
                  disabled={!!rangeError}
                  title="Período anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black tracking-[0.06em]" style={{ color: activeTabConfig.color }}>{activeTabConfig.label.toUpperCase()}</span>
                    <span className="text-sm text-zinc-400 dark:text-white/30 font-medium tabular-nums">{periodText}</span>
                    {historico.isLoading && (
                      <span className="text-[11px] text-amber-500 dark:text-amber-400 font-semibold animate-pulse">Carregando…</span>
                    )}
                  </div>
                  {!historico.isLoading && !historico.error && chartLabels.length > 0 && (
                    <div className="text-[10px] text-zinc-400 dark:text-white/22 mt-0.5 tabular-nums">
                      {chartLabels.length} pontos · média {valueFormatter(kpis.avg)} · min {valueFormatter(kpis.min)} · max {valueFormatter(kpis.max)}
                    </div>
                  )}
                </div>

                <button
                  className="h-8 w-8 flex items-center justify-center border border-zinc-200 dark:border-white/[0.08] hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/65 transition-colors disabled:opacity-20"
                  type="button"
                  onClick={goNext}
                  disabled={!!rangeError}
                  title="Próximo período"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  className="h-8 px-2.5 flex items-center gap-1.5 border border-zinc-200 dark:border-white/[0.08] hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/55 transition-colors"
                  onClick={() => setShowLegends((v) => !v)}
                  type="button"
                  title="Mostrar/ocultar legendas"
                >
                  {showLegends ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Legendas</span>
                </button>
                <button
                  className="h-8 w-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
                  onClick={() => window.print()}
                  type="button"
                  title="Imprimir"
                >
                  <Printer className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* legenda interativa das séries */}
            {showLegends && seriesComputed.length > 0 && !historico.isLoading && (
              <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-white/[0.05] bg-zinc-50 dark:bg-white/[0.015]">
                {useStackedBar && activeTab === "paradas" ? (
                  // Legenda simplificada para stacked bar de PARADAS
                  <div className="flex flex-wrap gap-2 items-center">
                    {paradasSegs.map((seg, i) => {
                      const bc = BAR_COLORS[seg.name]
                      const bg = bc ? `linear-gradient(135deg, ${bc.top}, ${bc.bottom})` : seg.color
                      return (
                        <span key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-white" style={{ background: bg }}>
                          <span className="w-2 h-2 rounded-full bg-white/80" />{seg.name}
                        </span>
                      )
                    })}
                    {paradasMetric === "Duração" && paradasQtyLine && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-white" style={{ background: paradasQtyLine.color }}>
                        <span className="w-2 h-2 rounded-full bg-white/80" />Qtd. Paradas
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-400 dark:text-white/25 ml-2 flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Clique numa barra para detalhar o dia
                    </span>
                  </div>
                ) : useStackedBar && activeTab === "producao" ? (
                  // Legenda simplificada para stacked bar de PRODUÇÃO
                  <div className="flex flex-wrap gap-2 items-center">
                    {producaoStackSegs.map((seg, i) => {
                      const bc = BAR_COLORS[seg.name]
                      const bg = bc ? `linear-gradient(135deg, ${bc.top}, ${bc.bottom})` : seg.color
                      return (
                        <span key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-white" style={{ background: bg }}>
                          <span className="w-2 h-2 rounded-full bg-white/80" />{seg.name}
                        </span>
                      )
                    })}
                    {producaoCicloLines && (
                      <>
                        <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.07em] text-zinc-600 dark:text-white/60 border border-zinc-200 dark:border-white/[0.12]">
                          <span className="w-3.5 h-[3px] rounded-sm" style={{ background: "#c8f000" }} />Ciclo Real
                        </span>
                        <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.07em] text-zinc-500 dark:text-white/45 border border-zinc-200 dark:border-white/[0.12]">
                          <span className="w-3.5 h-0 border-t-2 border-dashed" style={{ borderColor: "#475569" }} />Ciclo Ideal
                        </span>
                      </>
                    )}
                    <span className="text-[10px] text-zinc-400 dark:text-white/25 ml-2 flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Clique numa barra para detalhar o dia
                    </span>
                  </div>
                ) : (
                  <SeriesLegend
                    seriesList={seriesComputed}
                    activeIndices={activeSeriesIndices}
                    onToggle={toggleSeries}
                    tab={activeTab}
                  />
                )}
              </div>
            )}

            {/* canvas */}
            <div className="px-2 pb-2 pt-1">
              <div className="h-[420px] lg:h-[500px]">
                {rangeError ? (
                  <div className="h-full flex flex-col items-center justify-center text-amber-500 gap-2">
                    <AlertTriangle className="w-6 h-6" />
                    <div className="text-sm font-bold">{rangeError}</div>
                  </div>
                ) : historico.isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
                      <span className="text-[11px] text-zinc-400 dark:text-white/28 uppercase tracking-[0.1em]">Carregando dados…</span>
                    </div>
                  </div>
                ) : historico.error ? (
                  <div className="h-full flex flex-col items-center justify-center text-red-500 gap-2">
                    <AlertCircle className="w-6 h-6" />
                    <div className="text-sm font-bold">Erro ao carregar</div>
                    <div className="text-xs text-zinc-400 dark:text-white/28">{(historico as any).errorMessage}</div>
                  </div>
                ) : useStackedBar && activeTab === "paradas" && paradasSegs.length > 0 ? (
                  paradasMetric === "Quantidade" ? (
                    <StackedBarChart
                      labels={chartLabels}
                      segments={paradasSegs}
                      yLabel="Qtd. Paradas"
                      valueFormatter={fmtInt}
                      axisFormatter={(v) => fmtInt(v)}
                      activeSegmentIndices={paradasActiveSegs}
                      onClickBar={handleBarClick}
                      buildTooltip={buildParadasTooltip}
                    />
                  ) : (
                    <StackedBarChart
                      labels={chartLabels}
                      segments={paradasSegs}
                      yLabel="Duração (HH:mm)"
                      valueFormatter={secondsToHHmm}
                      axisFormatter={secondsToHHmm}
                      secondaryLine={paradasQtyLine}
                      secondaryLabel="Qtd. Paradas"
                      secondaryFormatter={(v) => fmtInt(v)}
                      activeSegmentIndices={paradasActiveSegs}
                      onClickBar={handleBarClick}
                      buildTooltip={buildParadasTooltip}
                    />
                  )
                ) : useStackedBar && activeTab === "producao" && producaoStackSegs.length > 0 ? (
                  <StackedBarChart
                    labels={chartLabels}
                    segments={producaoStackSegs}
                    yLabel={`Quantidade (${unit})`}
                    valueFormatter={fmtValue}
                    axisFormatter={(v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : v.toFixed(0)}
                    extraLines={producaoCicloLines}
                    activeSegmentIndices={producaoActiveSegs}
                    onClickBar={handleBarClick}
                    buildTooltip={buildProducaoTooltip}
                  />
                ) : (
                  <MultiLineChart
                    labels={chartLabels}
                    seriesList={
                      activeTab === "paradas" && paradasMetric === "Duração"
                        ? seriesComputed.filter(s => (s as any).unit === "s" || s.name.includes("(s)") || s.name.includes("Total"))
                        : activeTab === "paradas" && paradasMetric === "Quantidade"
                        ? seriesComputed.filter(s => (s as any).unit !== "s" && !s.name.includes("Dur."))
                        : seriesComputed
                    }
                    yLabel={yLabel}
                    valueFormatter={valueFormatter}
                    axisFormatter={axisFormatter}
                    activeSeriesIndices={activeSeriesIndices}
                    tab={activeTab}
                  />
                )}
              </div>
            </div>

            {/* chart footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-100 dark:border-white/[0.05]">
              <div className="text-[10px] text-zinc-400 dark:text-white/22 uppercase tracking-[0.1em]">
                Agrupado por{" "}
                <span className="font-bold text-zinc-600 dark:text-white/38">
                  {granularity === "op_day" ? `Dia Operacional (${normalizeHM(startTime)}→${normalizeHM(endTime)})` : granularity === "hour" ? "Hora" : granularity}
                </span>
              </div>
              <div className="text-[10px] text-zinc-300 dark:text-white/18">
                {useStackedBar && activeTab === "paradas"
                  ? "Clique numa barra para detalhar paradas do dia"
                  : useStackedBar && activeTab === "producao"
                  ? "Clique numa barra para detalhar produção do dia"
                  : "Passe o mouse no gráfico para detalhes"}
              </div>
            </div>
          </div>
          )}

          {/* ── DRILLDOWN PANEL ── */}
          {drilldown && activeTab === "paradas" && (
            <DrilldownPanel
              info={drilldown}
              onClose={() => setDrilldown(null)}
              filters={{
                empresaId:        empresaId || undefined,
                setorId:          setorId || undefined,
                turnoId:          turnoId || undefined,
                centroTrabalhoId: centroTrabalhoId || undefined,
                produtoId:        produtoId || undefined,
                ordemId:          ordemId || undefined,
              }}
            />
          )}

          {/* ── BANNER DE DIA SELECIONADO (PARADAS / PRODUÇÃO) ── */}
          {selectedDay && (activeTab === "paradas" || activeTab === "producao") && (
            <div className={`flex items-center justify-between gap-3 flex-wrap border px-4 py-2.5 ${activeTab === "paradas" ? "border-amber-300 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/[0.06]" : "border-emerald-300 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/[0.06]"}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                {activeTab === "paradas"
                  ? <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  : <BarChart2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                <span className={`text-sm font-bold truncate ${activeTab === "paradas" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                  Detalhando dia: {formatBRFromYYYYMMDD(selectedDay.rawDay) || selectedDay.label}
                </span>
                <span className={`text-[10px] uppercase tracking-[0.08em] hidden sm:inline ${activeTab === "paradas" ? "text-amber-600/70 dark:text-amber-400/50" : "text-emerald-600/70 dark:text-emerald-400/50"}`}>{normalizeHM(startTime)}→{normalizeHM(endTime)}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {activeTab === "paradas" && (
                  <button
                    type="button"
                    onClick={() => setDrilldown({ label: formatBRFromYYYYMMDD(selectedDay.rawDay) || selectedDay.label, startUtc: selectedDay.startUtc, endUtc: selectedDay.endUtc })}
                    className="inline-flex items-center gap-1.5 h-8 px-3 border border-amber-300 dark:border-amber-500/30 text-[10px] font-bold uppercase tracking-[0.08em] bg-white dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 transition-colors"
                  >
                    <BarChart2 className="w-3.5 h-3.5" /> Resumo do dia
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 border border-zinc-200 dark:border-white/[0.1] text-[10px] font-bold uppercase tracking-[0.08em] bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.08] text-zinc-500 dark:text-white/45 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Limpar seleção
                </button>
              </div>
            </div>
          )}

          {/* ── TABELA ────────────────────────────────────────── */}
          {activeTab !== "pessoas" && (selectedDay && activeTab === "paradas" ? (
            <ParadasDetalheTable
              startUtc={selectedDay.startUtc}
              endUtc={selectedDay.endUtc}
              filters={{
                empresaId:        empresaId || undefined,
                setorId:          setorId || undefined,
                turnoId:          turnoId || undefined,
                centroTrabalhoId: centroTrabalhoId || undefined,
                produtoId:        produtoId || undefined,
                ordemId:          ordemId || undefined,
              }}
            />
          ) : selectedDay && activeTab === "producao" ? (
            <ProducaoDetalheTable
              startUtc={selectedDay.startUtc}
              endUtc={selectedDay.endUtc}
              filters={{
                empresaId:        empresaId || undefined,
                setorId:          setorId || undefined,
                turnoId:          turnoId || undefined,
                centroTrabalhoId: centroTrabalhoId || undefined,
                produtoId:        produtoId || undefined,
                ordemId:          ordemId || undefined,
              }}
            />
          ) : (
            <DataTable
              rows={tableRowsFormatted}
              seriesList={seriesComputed}
              valueLabelFallback={tableFallback}
              valueFormatter={valueFormatter}
              onCopy={copyTableTSV}
              onExportCSV={exportCSV}
              onPrint={() => window.print()}
              tab={activeTab}
            />
          ))}

          {/* ── FOOTER INFO ── */}
          <div className="flex items-center justify-between text-[10px] text-zinc-300 dark:text-white/14 px-1 pb-2 flex-wrap gap-2 uppercase tracking-[0.1em]">
            <span>SQL Server · mes · dia operacional {normalizeHM(startTime)}→{normalizeHM(endTime)} BRT</span>
            <span suppressHydrationWarning>{nowLabel ?? "--/--/---- --:--:--"} BRT</span>
          </div>

        </div>
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * EXPORT
 * ───────────────────────────────────────────────────────────── */
export default function HistoricoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
            <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-white/28">Carregando…</span>
          </div>
        </div>
      }
    >
      <HistoricoContent />
    </Suspense>
  )
}

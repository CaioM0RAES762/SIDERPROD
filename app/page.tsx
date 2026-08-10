// app/page.tsx
"use client"

import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts"
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Clock,
  ExternalLink,
  Grid3X3,
  List,
  Loader2,
  Package,
  RefreshCcw,
  Search,
  X,
  Zap,
  Sparkles,
  SlidersHorizontal,
  Activity,
  Eye,
  EyeOff,
} from "lucide-react"
import {
  useCentrosTrabalhoCards,
  useDashboardCicloInstantaneo,
  useDashboardHistoricoDia,
  useDashboardStatsFromCards,
  useGrupos,
  useTotalParadasNoTurno,
  useParadasAgregadasPeriodoMultiCT,
  useProducaoDiaOperacional,
  useOeeTendenciaDia,
  type CentroTrabalhoCardVM,
  type Grupo,
  type HistoricoTurnoVM,
  type ProducaoDiaOpRow,
  type OeeConsolidadoTurnoRow,
  useIsReconnecting,
  isFatalApiError,
} from "@/hooks/use-api"

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const POLL_CARDS_MS = 10_000
// 10s (era 5s): stats deriva da MESMA chave SWR dos cards e o ManagerPanel
// dispara queries pesadas (paradas agregadas + produção dia op) neste intervalo.
// A 5s, cada ciclo enfileirava ~11 queries de listCards + agregações no pool
// (max 30), saturando o banco e causando timeouts/abort. 10s mantém "ao vivo"
// sem saturar.
const POLL_STATS_MS = 10_000
const POLL_GRUPOS_MS = 30_000
const POLL_MODAL_MS = 2_000
const STORAGE_KEY = "mes_dashboard_filters_v2"
const PROD_CHART_DESKTOP_WINDOW = 12
const PROD_CHART_TABLET_WINDOW = 8
const PROD_CHART_TABLET_QUERY = "(max-width: 1024px)"

// OEE_INTERVAL_MS / OEE_MAX_POINTS removidos — tendência agora vem da API por turno


// ─── HELPERS ──────────────────────────────────────────────────────────────────
const cx = (...c: (string | boolean | undefined | null)[]) => c.filter(Boolean).join(" ")
const UI_FONT = "Geist, 'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const MONO_FONT = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"

// ─── Paleta RETRABALHO (âmbar escuro / amarronzado) ───────────────────────────
// Usada quando o posto está em modo REWORK: o card inteiro ganha um tom quente
// e escuro, para se distinguir à distância de um posto em contagem normal.
const RW_INK = "#6b3410" // texto forte (marrom escuro)
const RW_DEEP = "#7c3f12" // fundo do selo "RETRABALHO"
const RW_ACCENT = "#b45309" // laranja âmbar escuro: status, bordas, acentos
const RW_LINE = "#e3cfae" // divisórias quentes
const RW_TINT = "#fbf4e9" // fundo quente claro (só faixas de destaque)
const RW_CHIP = "#f6e8d3" // fundo de chip de peça

function safeN(v: any, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : fallback
}

function abbreviateCT(code: string): string {
  const s = (code ?? "").trim()
  const m = s.match(/^acab(?:amento)?(?:\s+posto)?\s*(\d+)/i)
  if (m) return `Acab${String(parseInt(m[1], 10)).padStart(2, "0")}`
  return s
}

function formatNumber(value?: number | string | null, decimals = 0) {
  if (value === null || value === undefined || value === "") return "—"
  const num = typeof value === "string" ? Number(value) : value
  if (!Number.isFinite(num)) return "—"
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function formatCompact(n: number): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  if (Math.abs(v) >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${+(v / 1_000).toFixed(0)}K`
  return String(Math.floor(v))
}

function formatDateTimeBR(d: Date) {
  return (
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` +
    ` • ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  )
}

function formatHHMM(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function hourLabel(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}h`
}

function pct(value?: number | null) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0
}

function parseHmsToSeconds(hms?: string | null) {
  if (!hms) return null
  const m = String(hms).trim().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
  if (!m) return null
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return Number.isFinite(total) ? total : null
}

function formatSecondsToHMS(totalSeconds: number) {
  const t = Math.max(0, Math.floor(totalSeconds))
  return (
    `${Math.floor(t / 3600)}h` +
    `${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}m` +
    `${String(t % 60).padStart(2, "0")}s`
  )
}

function liveHmsFromBase(baseSec: number | null, baseAtMs: number, nowMs: number) {
  if (baseSec == null) return null
  return formatSecondsToHMS(baseSec + Math.max(0, Math.floor((nowMs - baseAtMs) / 1000)))
}

function shiftNameFromHour(h: number) {
  if (h >= 6 && h < 14) return "Manhã"
  if (h >= 14 && h < 21) return "Tarde"
  return "Noite"
}

function resolveTurnoNome(s: CentroTrabalhoCardVM | null | undefined) {
  const fromApi = s?.turno_nome?.trim()
  if (fromApi) return fromApi
  if (s?.turno_inicio_utc) {
    const h = new Date(s.turno_inicio_utc).getHours()
    if (Number.isFinite(h)) return shiftNameFromHour(h)
  }
  return shiftNameFromHour(new Date().getHours())
}

function resolveOee(s: CentroTrabalhoCardVM) {
  const oee = Number(s.oee ?? 0)
  if (oee > 0) return pct(oee)
  const a = pct(s.availability)
  const p = pct(s.performance)
  const q = pct(s.quality)
  if (a > 0 || p > 0 || q > 0) return pct((a / 100) * (p / 100) * (q / 100) * 100)
  return 0
}

function getOeeTone(oee: number): "good" | "mid" | "bad" {
  return oee >= 70 ? "good" : oee >= 40 ? "mid" : "bad"
}

function oeeColor(v: number) {
  return v >= 70 ? "#059669" : v >= 40 ? "#d97706" : "#dc2626"
}

function oeeBg(v: number) {
  return v >= 70 ? "text-emerald-600" : v >= 40 ? "text-amber-500" : "text-rose-600"
}

function statusTone(status?: CentroTrabalhoCardVM["status"]): "good" | "bad" | "neutral" {
  return status === "producing" ? "good" : status === "stopped" ? "bad" : "neutral"
}

function stationSignature(s: CentroTrabalhoCardVM) {
  return [
    s.id,
    s.status,
    s.headline,
    s.tempo_status_hms,
    s.oee,
    s.availability,
    s.performance,
    s.quality,
    s.corrida_good,
    s.produzido_turno,
    s.peca_total_good,
    s.peca_meta_planejada,
    s.paradas_turno_qtd,
    (s as any).paradas_turno_tempo_seg,
    s.paradas_turno_tempo_hms,
    s.motivo_codigo,
    s.motivo_descricao,
  ]
    .map((v) => String(v ?? ""))
    .join("|")
}

function startOfCurrentShift(now = new Date()) {
  const d = new Date(now)
  const h = d.getHours()
  if (h >= 6 && h < 14) { d.setHours(6, 0, 0, 0); return d }
  if (h >= 14 && h < 22) { d.setHours(14, 0, 0, 0); return d }
  if (h >= 22) { d.setHours(22, 0, 0, 0); return d }
  d.setDate(d.getDate() - 1)
  d.setHours(22, 0, 0, 0)
  return d
}

function getDiaOperacional(nowMs = Date.now()) {
  const d = new Date(nowMs)
  const h = d.getHours()
  const inicio = new Date(d)
  const fim = new Date(d)
  if (h >= 6) {
    inicio.setHours(6, 0, 0, 0)
    fim.setDate(fim.getDate() + 1)
    fim.setHours(5, 59, 59, 999)
  } else {
    inicio.setDate(inicio.getDate() - 1)
    inicio.setHours(6, 0, 0, 0)
    fim.setHours(5, 59, 59, 999)
  }
  return { inicio, fim }
}

function resolveShiftStartForCharts(stations: CentroTrabalhoCardVM[]) {
  const timestamps = stations
    .map((s) => (s.turno_inicio_utc ? new Date(s.turno_inicio_utc).getTime() : NaN))
    .filter((t) => Number.isFinite(t)) as number[]
  if (timestamps.length > 0) return new Date(Math.min(...timestamps))
  return startOfCurrentShift(new Date())
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function useProdChartWindowSize() {
  const [size, setSize] = useState(PROD_CHART_DESKTOP_WINDOW)

  useEffect(() => {
    const media = window.matchMedia(PROD_CHART_TABLET_QUERY)
    const update = () => setSize(media.matches ? PROD_CHART_TABLET_WINDOW : PROD_CHART_DESKTOP_WINDOW)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return size
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function safeLoadFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === "object" ? obj : {}
  } catch { return {} }
}

function saveFilters(f: {
  viewMode: string
  selectedGrupo: number | ""
  statusFilter: string
  query: string
}) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(f)) } catch { }
}

// ─── HOOKS ────────────────────────────────────────────────────────────────────
function usePageVisibility() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const fn = () => setVisible(document.visibilityState === "visible")
    fn()
    document.addEventListener("visibilitychange", fn)
    return () => document.removeEventListener("visibilitychange", fn)
  }, [])
  return visible
}

function useLivePoll(callback: () => void | Promise<unknown>, intervalMs: number, enabled: boolean) {
  const cbRef = useRef(callback)
  cbRef.current = callback
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    let cancelled = false
    // Guarda anti-sobreposição: se um ciclo ainda está em andamento (ex.: banco
    // lento), pula o próximo tick em vez de empilhar requisições concorrentes.
    let inFlight = false
    const tick = async () => {
      if (inFlight || cancelled) return
      inFlight = true
      try {
        await cbRef.current()
      } catch {
        // erros são tratados pelo SWR/fetcher; aqui só evitamos quebrar o loop
      } finally {
        inFlight = false
      }
    }
    void tick()
    const id = window.setInterval(() => { void tick() }, intervalMs)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [intervalMs, enabled])
}

// ─── MINI COMPONENTS ──────────────────────────────────────────────────────────
function StatusPill({ status }: { status: CentroTrabalhoCardVM["status"] }) {
  const ok = status === "producing"
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold tracking-widest uppercase border shrink-0",
        ok
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-rose-50 border-rose-200 text-rose-700",
      )}
    >
      <span className={cx("inline-block w-1.5 h-1.5 rounded-full shrink-0", ok ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
      {ok ? "Produzindo" : "Parado"}
    </span>
  )
}

function OeeRing({ value, size = 72 }: { value: number; size?: number }) {
  const color = oeeColor(value)
  const r = 15
  const circ = 2 * Math.PI * r
  const dash = (value / 100) * circ

  return (
    <svg width={size} height={size} viewBox="0 0 38 38">
      <circle cx="19" cy="19" r={r} fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
      <circle
        cx="19" cy="19" r={r} fill="none"
        stroke={color} strokeWidth="3.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 19 19)"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text
        x="19" y="19.5"
        textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontWeight="800"
        fill={color}
        fontFamily="JetBrains Mono, monospace"
      >
        {value.toFixed(0)}%
      </text>
    </svg>
  )
}

function OeeArc({ value, size = 72 }: { value: number; size?: number }) {
  const color = value >= 70 ? "#16a35f" : value >= 40 ? "#e89000" : "#e0282f"
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (value / 100) * circ
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="#eef2f5" strokeWidth="10" strokeLinecap="butt" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="butt"
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text
        x="36" y="34"
        textAnchor="middle" dominantBaseline="middle"
        fontFamily={MONO_FONT}
        fill={color}
      >
        <tspan fontSize="16" fontWeight="700" letterSpacing="-0.4">{value.toFixed(0)}</tspan>
        <tspan fontSize="7" fontWeight="500" dy="-6" dx="1">%</tspan>
      </text>
      <text
        x="36" y="47"
        textAnchor="middle" dominantBaseline="middle"
        fontSize="7.5" fontWeight="600"
        fill="#8a98a8"
        fontFamily={UI_FONT}
        letterSpacing="1.8"
      >
        OEE
      </text>
    </svg>
  )
}

function MetricBar({ value, label, color }: { value: number; label: string; color: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="font-mono font-bold" style={{ color }}>{v.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden" style={{ background: "#edf0f4" }}>
        <div className="h-full transition-all duration-500" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  )
}

function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 last:pb-0" style={{ borderBottom: "1px solid #edf0f4" }}>
      <span style={{ fontFamily: UI_FONT, fontSize: "11px", color: "#64748b", flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: UI_FONT, fontSize: "12px", fontWeight: 600, color: "#0f172a", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  )
}

// ─── CUSTOM CHART SHAPES ─────────────────────────────────────────────────────

function DashedMetaBar(props: any) {
  const { x, y, width, height } = props
  if (!width || !height || height <= 0) return null
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        fill="#f1f3f5"
        stroke="#4b5563"
        strokeWidth={3}
        strokeDasharray="6 6"
        shapeRendering="crispEdges"
      />
    </g>
  )
}

function MetaBarLabel(props: any) {
  const { x, y, width, value } = props
  const n = safeN(value, 0)
  if (!width || n <= 0) return null
  return (
    <text
      x={x + width / 2}
      y={Math.max(18, y - 10)}
      textAnchor="middle"
      fontFamily="JetBrains Mono, monospace"
      fontSize={22}
      fontWeight={600}
      fill="#7b8796"
    >
      {formatNumber(n)}
    </text>
  )
}

function RealStackLabel({ ct, ctCodes, ...props }: any) {
  const { x, y, width, payload } = props
  if (!payload || !width) return null

  const lastPositiveCt = [...ctCodes]
    .reverse()
    .find((code: string) => safeN(payload[code] as any, 0) > 0)

  if (ct !== lastPositiveCt) return null

  const real = safeN(payload.real, 0)
  if (real <= 0) return null

  return (
    <text
      x={x + width / 2}
      y={Math.max(20, y - 10)}
      textAnchor="middle"
      fontFamily="JetBrains Mono, monospace"
      fontSize={25}
      fontWeight={900}
      fill="#020817"
    >
      {formatNumber(real)}
    </text>
  )
}

// ─── CHART TOOLTIPS ───────────────────────────────────────────────────────────

function fmtMin(seg: number | null | undefined): string {
  if (seg == null || !Number.isFinite(seg)) return "—"
  return `${Math.round(seg / 60)}min`
}

function OeeTendenciaTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as OeeTurnoPonto
  if (!d) return null

  const metrics = [
    {
      label: "Disponibilidade",
      val: d.availability,
      sub: d.run_time_seg != null && d.planned_time_seg != null
        ? `${fmtMin(d.run_time_seg)} operante / ${fmtMin(d.planned_time_seg)} planej.`
        : null,
      dot: "#60a5fa",
    },
    {
      label: "Performance",
      val: d.performance,
      sub: d.ideal_time_seg != null && d.run_time_seg != null
        ? `${fmtMin(d.ideal_time_seg)} ideal / ${fmtMin(d.run_time_seg)} real`
        : null,
      dot: "#fbbf24",
    },
    {
      label: "Qualidade",
      val: d.quality,
      sub: d.total_pecas > 0
        ? `${d.total_good.toLocaleString("pt-BR")} boas / ${d.total_pecas.toLocaleString("pt-BR")} total`
        : null,
      dot: "#a78bfa",
    },
  ]

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3.5 py-3 text-xs min-w-[220px]">
      <div className="text-[9px] uppercase tracking-[0.15em] text-slate-400 font-semibold mb-2">
        {d.label.replace("\n", " · ")}
      </div>
      <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
        <span className="text-slate-500 font-medium">OEE Geral</span>
        <span className="font-mono font-bold text-[14px]" style={{ color: d.oee != null ? oeeColor(d.oee) : "#94a3b8" }}>
          {d.oee != null ? `${d.oee.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="space-y-2">
        {metrics.map(({ label, val, sub, dot }) => (
          <div key={label}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: dot }} />
                {label}
              </span>
              <span className="font-mono font-semibold text-slate-800">
                {val != null ? `${val.toFixed(1)}%` : "—"}
              </span>
            </div>
            {sub && <div className="text-[9px] text-slate-400 pl-3.5 mt-0.5 font-mono">{sub}</div>}
          </div>
        ))}
      </div>
      {d.total_pecas > 0 && (
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400 font-mono">
          <span>Peças boas</span>
          <span className="font-bold text-slate-700">{d.total_good.toLocaleString("pt-BR")}</span>
        </div>
      )}
    </div>
  )
}

function StopTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as { causa: string; min: number; postos: { nome: string; min: number }[] }
  if (!d) return null
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3.5 py-3 text-xs min-w-[200px] max-w-[300px]">
      <div className="text-[9px] uppercase tracking-[0.15em] text-slate-400 font-semibold mb-1">Causa de parada</div>
      <div className="font-semibold text-slate-800 text-[12px] mb-2 leading-snug">{d.causa}</div>
      <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
        <span className="text-slate-500">Total acumulado</span>
        <span className="font-mono font-bold text-rose-600 text-[13px]">{d.min} min</span>
      </div>
      {d.postos?.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400 font-semibold mb-1">Por CT</div>
          {d.postos.slice(0, 6).map((p) => {
            const share = d.min > 0 ? (p.min / d.min) * 100 : 0
            return (
              <div key={p.nome}>
                <div className="flex items-center justify-between gap-3 mb-0.5">
                  <span className="text-slate-600 truncate">{p.nome}</span>
                  <span className="font-mono font-semibold text-slate-800 shrink-0">{p.min} min</span>
                </div>
                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.min(100, share)}%` }} />
                </div>
              </div>
            )
          })}
          {d.postos.length > 6 && <div className="text-[9px] text-slate-400 pt-1">+{d.postos.length - 6} CTs</div>}
        </div>
      )}
    </div>
  )
}

function ProdDiaOpTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const metaEntry = payload.find((p: any) => p.name === "__meta__")
  const ctEntries = payload.filter((p: any) => p.name !== "__meta__" && Number(p.value) > 0)
  const totalReal = ctEntries.reduce((acc: number, p: any) => acc + Number(p.value ?? 0), 0)
  const meta = metaEntry ? Number(metaEntry.value) : 0
  const diff = meta > 0 ? totalReal - meta : null
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3.5 py-3 text-xs min-w-[180px]">
      <div className="text-[9px] uppercase tracking-[0.15em] text-slate-400 font-semibold mb-1">{label}</div>
      {metaEntry && (
        <div className="flex items-center justify-between gap-4 mb-1.5 pb-1.5 border-b border-slate-100">
          <span className="text-slate-500">Meta</span>
          <span className="font-mono text-slate-500">{formatNumber(metaEntry.value)} pç</span>
        </div>
      )}
      <div className="space-y-0.5 mb-1.5">
        {ctEntries.map((p: any) => (
          <div key={p.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2 h-2 rounded-sm shrink-0 inline-block" style={{ background: p.fill }} />
              {p.name}
            </span>
            <span className="font-mono font-semibold text-slate-800">{formatNumber(p.value)} pç</span>
          </div>
        ))}
      </div>
      {ctEntries.length > 0 && (
        <div className="flex items-center justify-between gap-4 pt-1.5 border-t border-slate-100">
          <span className="text-slate-600 font-semibold">Total real</span>
          <span className="font-mono font-bold text-slate-900">{formatNumber(totalReal)} pç</span>
        </div>
      )}
      {diff != null && (
        <div className="flex items-center justify-between gap-4 mt-0.5">
          <span className="text-slate-400">vs. meta</span>
          <span className={cx("font-mono font-bold text-[11px]", diff >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {diff >= 0 ? "+" : ""}{formatNumber(diff)}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

/** Ponto do gráfico OEE Tendência por turno */
type OeeTurnoPonto = {
  xIdx: number
  label: string          // "Manhã\n06:00–12:15"
  turno_nome: string
  inicio_utc: string
  fim_utc: string
  oee: number | null            // 0–100
  availability: number | null   // 0–100
  performance: number | null    // 0–100
  quality: number | null        // 0–100
  run_time_seg: number | null
  planned_time_seg: number | null
  ideal_time_seg: number | null
  total_good: number
  total_pecas: number
}

type ParetoRow = { causa: string; min: number; postos: { nome: string; min: number }[] }
type ProdDiaOpPoint = { hora: string; hora_op_utc: string; meta: number; real: number; delta: number; [ct: string]: number | string }

// ─── REAL VS META SVG CHART ──────────────────────────────────────────────────
function RealVsMetaSVGChart({ data, ctCodes }: { data: ProdDiaOpPoint[]; ctCodes: string[] }) {
  const n = data.length
  if (n === 0) return null

  const VIEW_W = 560, VIEW_H = 158
  const PT = 20, PR = 16, PB = 26, PL = 36
  const plotW = VIEW_W - PL - PR   // 508
  const plotH = VIEW_H - PT - PB   // 112
  const slotW = plotW / n

  const rawMax = data.reduce((m, d) => Math.max(m, safeN(d.real, 0), safeN(d.meta, 0)), 1)
  const niceMax = Math.max(200, Math.ceil(rawMax * 1.22 / 100) * 100)
  const ys = (v: number) => PT + plotH - (v / niceMax) * plotH
  const baseY = PT + plotH

  const ctOp = (i: number) => Math.max(0.25, 1 - i * 0.13)

  const metaW = slotW * 0.35
  const metaOff = slotW * 0.04
  const realW = slotW * 0.48
  const realOff = slotW * 0.44

  const yTicks = [0, niceMax / 2, niceMax]

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" overflow="visible" style={{ display: "block" }}>
      {/* Y-axis grid + labels */}
      {yTicks.map((tick, ti) => {
        const y = ys(tick)
        return (
          <g key={tick}>
            {tick > 0 && (
              <line x1={PL} y1={y} x2={VIEW_W - PR} y2={y} stroke="var(--hairline)" strokeWidth="1" />
            )}
            <text x={PL - 4} y={y} textAnchor="end" dominantBaseline="middle"
              fontSize="8" fontFamily="'IBM Plex Mono',ui-monospace,monospace" fill="var(--ink-mute)">
              {tick}
            </text>
            {ti === 2 && (
              <text x={PL - 4} y={y - 9} textAnchor="end" dominantBaseline="middle"
                fontSize="7" fontWeight="700" letterSpacing="0.08em"
                fontFamily="'IBM Plex Mono',ui-monospace,monospace" fill="var(--ink-mute)">
                PÇ
              </text>
            )}
          </g>
        )
      })}

      {/* Baseline */}
      <line x1={PL} y1={baseY} x2={VIEW_W - PR} y2={baseY} stroke="var(--ink-soft)" strokeWidth="1" />

      {/* Per-slot bars + labels */}
      {data.map((point, i) => {
        const sx = PL + i * slotW
        const meta = safeN(point.meta, 0)
        const real = safeN(point.real, 0)
        const delta = safeN(point.delta, 0)
        const labelX = sx + slotW / 2

        // Build stacked segments
        let curY = baseY
        const segs: { ct: string; ci: number; segY: number; segH: number }[] = []
        for (let ci = 0; ci < ctCodes.length; ci++) {
          const val = safeN(point[ctCodes[ci]] as any, 0)
          if (val <= 0) continue
          const segH = (val / niceMax) * plotH
          const segY = curY - segH
          segs.push({ ct: ctCodes[ci], ci, segY, segH })
          curY = segY
        }
        const realTopY = curY

        return (
          <g key={point.hora_op_utc}>
            {/* META bar */}
            {meta > 0 && (
              <>
                <rect x={sx + metaOff} y={ys(meta)} width={metaW} height={Math.max(0, baseY - ys(meta))}
                  fill="none" stroke="var(--ink-soft)" strokeWidth="1" strokeDasharray="2 2" />
                <text x={sx + metaOff + metaW / 2} y={Math.max(PT + 8, ys(meta) - 3)}
                  textAnchor="middle" fontSize="8"
                  fontFamily="'IBM Plex Mono',ui-monospace,monospace" fill="var(--ink-mute)">
                  {formatNumber(meta)}
                </text>
              </>
            )}

            {/* REAL stacked bars */}
            {segs.map(({ ct, ci, segY, segH }) => (
              <g key={ct}>
                <rect x={sx + realOff} y={segY} width={realW} height={segH}
                  fill="var(--ink)" fillOpacity={ctOp(ci)} />
                {ci > 0 && (
                  <line x1={sx + realOff} y1={segY + segH} x2={sx + realOff + realW} y2={segY + segH}
                    stroke="var(--panel)" strokeWidth="0.5" />
                )}
              </g>
            ))}

            {/* Real total label above stack */}
            {real > 0 && (
              <text x={sx + realOff + realW / 2} y={Math.max(PT + 9, realTopY - 3)}
                textAnchor="middle" fontSize="9" fontWeight="700"
                fontFamily="'IBM Plex Mono',ui-monospace,monospace" fill="var(--ink)">
                {formatNumber(real)}
              </text>
            )}

            {/* X-axis: hour label */}
            <text x={labelX} y={VIEW_H - PB + 11} textAnchor="middle"
              fontSize="11" fontWeight="700"
              fontFamily="'IBM Plex Mono',ui-monospace,monospace" fill="var(--ink)">
              {point.hora}
            </text>

            {/* X-axis: delta */}
            {real > 0 && (
              <text x={labelX} y={VIEW_H - PB + 22} textAnchor="middle"
                fontSize="8" fontWeight="700"
                fontFamily="'IBM Plex Mono',ui-monospace,monospace"
                fill={delta >= 0 ? "var(--ok)" : "var(--danger)"}>
                {(delta >= 0 ? "+" : "") + formatNumber(delta)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── MANAGER PANEL ────────────────────────────────────────────────────────────
function ManagerPanel({
  stations,
  stats,
  liveEnabled,
}: {
  stations: CentroTrabalhoCardVM[]
  stats?: {
    total_centros: number
    produzindo: number
    parados: number
    oee_medio: number
    total_turno_good: number
  }
  liveEnabled: boolean
}) {
  const produzindo = stats?.produzindo ?? 0
  const parados = stats?.parados ?? 0
  const totalCts = stats?.total_centros ?? stations.length
  const oeeMedia = pct(stats?.oee_medio ?? 0)
  const totalProd = stats?.total_turno_good ?? 0

  const [isMounted, setIsMounted] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const stationsRef = useRef(stations)
  stationsRef.current = stations

  useEffect(() => {
    setIsMounted(true)
  }, [])

  // ── OEE TENDÊNCIA (por turno, via API) ──
  const oeeTendencia = useOeeTendenciaDia()
  useLivePoll(() => { oeeTendencia.mutate?.() }, 30_000, liveEnabled)

  /** Nomes amigáveis dos turnos e horários para o label do eixo-X */
  const TURNO_LABELS: Record<string, string> = {
    "manhã": "Manhã\n06:00–12:15",
    "tarde": "Tarde\n12:15–21:30",
    "noite": "Noite\n21:30–06:00",
  }

  const oeeShiftData = useMemo<OeeTurnoPonto[]>(() => {
    const rows: OeeConsolidadoTurnoRow[] = Array.isArray(oeeTendencia.data) ? oeeTendencia.data : []
    return rows.map((r, i) => {
      const nome = (r.turno_nome ?? "").trim()
      const label = TURNO_LABELS[nome.toLowerCase()] ?? nome
      const toP = (v: number | null) => v != null ? Math.min(100, Math.max(0, v * 100)) : null
      return {
        xIdx: i,
        label,
        turno_nome: nome,
        inicio_utc: r.inicio_utc,
        fim_utc: r.fim_utc,
        oee:          toP(r.oee),
        availability: toP(r.availability),
        performance:  toP(r.performance),
        quality:      toP(r.quality),
        run_time_seg:     r.run_time_seg     ?? null,
        planned_time_seg: r.planned_time_seg ?? null,
        ideal_time_seg:   r.ideal_time_seg   ?? null,
        total_good:  r.turno_good  ?? 0,
        total_pecas: r.total_pecas ?? 0,
      }
    })
  }, [oeeTendencia.data])

  // ── PARETO — Dia Operacional (06h–06h) ──
  const ctIds = useMemo(() => stations.map((s) => s.id), [stations])
  const [diaOp, setDiaOp] = useState(() => getDiaOperacional())
  useEffect(() => {
    const id = setInterval(() => setDiaOp(getDiaOperacional()), 60_000)
    return () => clearInterval(id)
  }, [])
  const diaOpInicioUtc = useMemo(() => diaOp.inicio.toISOString(), [diaOp])
  const diaOpFimUtc = useMemo(() => diaOp.fim.toISOString(), [diaOp])

  const paradasAgg = useParadasAgregadasPeriodoMultiCT(
    ctIds.length ? { centrosIds: ctIds, dataInicio: diaOpInicioUtc, dataFim: diaOpFimUtc } : undefined
  )
  useLivePoll(() => { paradasAgg.mutate?.() }, POLL_STATS_MS, liveEnabled && ctIds.length > 0)

  const stopCausas = useMemo((): ParetoRow[] => {
    if (!paradasAgg?.dataMap?.size) return []

    const map = new Map<string, { totalMin: number; postos: Map<string, number> }>()

    for (const [ctId, vm] of paradasAgg.dataMap) {
      const st = stations.find((s) => s.id === ctId)
      const postoNome = st?.nome?.trim() || st?.codigo?.trim() || `CT ${ctId.slice(0, 6)}`

      for (const motivo of vm.por_motivo) {
        const seg = safeN(motivo.tempo_total_seg, 0)
        if (seg <= 0) continue
        const min = Math.max(1, Math.round(seg / 60))
        const causa = motivo.motivo_descricao?.trim() || motivo.motivo_codigo?.trim() || "Não justificada"

        if (!map.has(causa)) map.set(causa, { totalMin: 0, postos: new Map() })

        const entry = map.get(causa)!
        entry.totalMin += min
        entry.postos.set(postoNome, (entry.postos.get(postoNome) ?? 0) + min)
      }
    }

    return Array.from(map.entries())
      .map(([causa, d]) => ({
        causa,
        min: d.totalMin,
        postos: Array.from(d.postos.entries()).map(([nome, min]) => ({ nome, min })).sort((a, b) => b.min - a.min),
      }))
      .sort((a, b) => b.min - a.min)
      .slice(0, 8)
  }, [paradasAgg?.dataMap, stations])

  // ── PROD VS META — Dia Operacional completo ──
  const prodDiaOp = useProducaoDiaOperacional({
    inicioUtc: diaOpInicioUtc,
    fimUtc: diaOpFimUtc,
    centrosIds: ctIds.length ? ctIds : null,
  })
  useLivePoll(() => { prodDiaOp.mutate?.() }, POLL_STATS_MS, liveEnabled && ctIds.length > 0)

  const { prodChartData, ctCodes } = useMemo((): { prodChartData: ProdDiaOpPoint[]; ctCodes: string[] } => {
    const rows: ProducaoDiaOpRow[] = Array.isArray(prodDiaOp.data) ? prodDiaOp.data : []
    if (!rows.length) return { prodChartData: [], ctCodes: [] }

    const ctSet = new Set<string>()
    rows.forEach((r) => ctSet.add(r.ct_codigo || r.centro_trabalho_id.slice(0, 8)))
    const codes = Array.from(ctSet).sort()

    const byHora = new Map<string, ProdDiaOpPoint>()
    rows.forEach((r) => {
      const slotMs = new Date(r.hora_op_utc).getTime()
      const localHour = new Date(slotMs + 6 * 3600 * 1000)
      const label = hourLabel(localHour)
      const ct = r.ct_codigo || r.centro_trabalho_id.slice(0, 8)

      if (!byHora.has(r.hora_op_utc)) {
        byHora.set(r.hora_op_utc, { hora: label, hora_op_utc: r.hora_op_utc, meta: 0, real: 0, delta: 0 })
      }

      const point = byHora.get(r.hora_op_utc)!
      point[ct] = safeN(r.total_good, 0)
      // META por CT/hora já vem calculada no backend (ciclo ideal da peça
      // que rodou naquela hora, descontando paradas, × 80%) — apenas somamos.
      point.meta = safeN(point.meta as any, 0) + safeN(r.meta_hora, 0)
    })

    for (const [, point] of byHora) {
      point.real = codes.reduce((sum, ct) => sum + safeN(point[ct] as any, 0), 0)
      point.delta = point.real - point.meta
    }

    const sorted = Array.from(byHora.values()).sort(
      (a, b) => new Date(a.hora_op_utc).getTime() - new Date(b.hora_op_utc).getTime()
    )

    return { prodChartData: sorted, ctCodes: codes }
  }, [prodDiaOp.data])

  const prodChartWindowSize = useProdChartWindowSize()
  const visibleProdChartData = useMemo(() => {
    const limit = Math.max(1, prodChartWindowSize)
    return prodChartData.length > limit ? prodChartData.slice(-limit) : prodChartData
  }, [prodChartData, prodChartWindowSize])

  const visibleProdTotal = useMemo(
    () => visibleProdChartData.reduce((sum, row) => sum + safeN(row.real, 0), 0),
    [visibleProdChartData],
  )

  const visibleMetaTotal = useMemo(
    () => visibleProdChartData.reduce((sum, row) => sum + safeN(row.meta, 0), 0),
    [visibleProdChartData],
  )

  const stoppedAlerts = useMemo(
    () => stations.filter((s) => s.status === "stopped"),
    [stations],
  )

  const warnCount = useMemo(() => stations.filter((s) => resolveOee(s) < 40).length, [stations])

  const totalMeta = useMemo(
    () => stations.reduce((sum, s) => sum + Number(s.peca_meta_planejada ?? 0), 0),
    [stations],
  )

  if (!isMounted) {
    return null
  }

  return (
    <div style={{ background: "transparent" }}>
      <div className="max-w-[1600px] 2xl:max-w-none mx-auto px-4 sm:px-6 py-4">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3">

          {/* TOTAL CTS */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e4e8ed", padding: "14px 16px 10px", display: "flex", flexDirection: "column", minHeight: "92px" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa3af" }}>Total CTs</span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", marginTop: "4px" }}>
              <span style={{ fontSize: "30px", fontWeight: 800, color: "#0f1117", lineHeight: 1, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: "-0.02em" }}>
                {String(totalCts).padStart(2, "0")}
              </span>
              <span style={{ fontSize: "11px", color: "#b0b8c4", marginTop: "3px" }}>postos cadastrados</span>
            </div>
            <div style={{ marginTop: "10px", height: "2px", background: "#f0f2f5", borderRadius: "1px" }} />
          </div>

          {/* PRODUZINDO */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e4e8ed", padding: "14px 16px 10px", display: "flex", flexDirection: "column", minHeight: "92px" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa3af" }}>Produzindo</span>
            <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: "5px", marginTop: "4px" }}>
              <span style={{ fontSize: "30px", fontWeight: 800, color: "#059669", lineHeight: 1, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: "-0.02em" }}>
                {String(produzindo).padStart(2, "0")}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#c0c8d4" }}>/{totalCts}</span>
            </div>
            <div style={{ marginTop: "10px", height: "2px", background: "#f0f2f5", borderRadius: "1px", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#059669", borderRadius: "1px", width: `${totalCts > 0 ? (produzindo / totalCts) * 100 : 0}%`, transition: "width 0.7s ease" }} />
            </div>
          </div>

          {/* PARADOS */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e4e8ed", padding: "14px 16px 10px", display: "flex", flexDirection: "column", minHeight: "92px" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa3af" }}>Parados</span>
            <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: "5px", marginTop: "4px" }}>
              <span style={{ fontSize: "30px", fontWeight: 800, lineHeight: 1, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: "-0.02em", color: parados > 0 ? "#dc2626" : "#0f1117" }}>
                {String(parados).padStart(2, "0")}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#c0c8d4" }}>/{totalCts}</span>
            </div>
            <div style={{ marginTop: "10px", height: "2px", background: "#f0f2f5", borderRadius: "1px", overflow: "hidden" }}>
              <div style={{ height: "100%", background: parados > 0 ? "#dc2626" : "#f0f2f5", borderRadius: "1px", width: `${totalCts > 0 ? (parados / totalCts) * 100 : 0}%`, transition: "width 0.7s ease" }} />
            </div>
          </div>

          {/* OEE MÉDIO */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e4e8ed", padding: "14px 16px 10px", display: "flex", flexDirection: "column", minHeight: "92px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa3af" }}>OEE Médio</span>
              <span style={{ fontSize: "10px", fontWeight: 600, color: "#d97706", letterSpacing: "0.03em" }}>meta 70%</span>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: "3px", marginTop: "4px" }}>
              <span style={{ fontSize: "30px", fontWeight: 800, lineHeight: 1, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: "-0.02em", color: oeeMedia >= 70 ? "#059669" : oeeMedia >= 40 ? "#d97706" : "#dc2626" }}>
                {oeeMedia.toFixed(1)}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#c0c8d4" }}>%</span>
            </div>
            <div style={{ marginTop: "10px", height: "2px", background: "#f0f2f5", borderRadius: "1px", overflow: "hidden", position: "relative" }}>
              <div style={{ height: "100%", borderRadius: "1px", width: `${Math.min(oeeMedia, 100)}%`, background: oeeMedia >= 70 ? "#059669" : oeeMedia >= 40 ? "#d97706" : "#dc2626", transition: "width 0.7s ease" }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, left: "70%", width: "1px", background: "#d97706", opacity: 0.5 }} />
            </div>
          </div>

          {/* PRODUÇÃO TOTAL */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e4e8ed", padding: "14px 16px 10px", display: "flex", flexDirection: "column", minHeight: "92px" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa3af" }}>Produção Total</span>
            <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: "5px", marginTop: "4px" }}>
              <span style={{ fontSize: totalProd >= 10000 ? "22px" : "30px", fontWeight: 800, color: "#0f1117", lineHeight: 1, fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: "-0.02em" }}>
                {formatNumber(totalProd)}
              </span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#b0b8c4" }}>pç</span>
            </div>
            <div style={{ marginTop: "10px", height: "2px", background: "#f0f2f5", borderRadius: "1px", overflow: "hidden" }}>
              {totalMeta > 0 && (
                <div style={{ height: "100%", background: "#64748b", borderRadius: "1px", width: `${Math.min((totalProd / totalMeta) * 100, 100)}%`, transition: "width 0.7s ease" }} />
              )}
            </div>
          </div>
        </div>

        {/* ── Alert bar ── */}
        <div className="flex items-center gap-2 mb-4 flex-wrap min-h-[26px]">

          {stoppedAlerts.length === 0 && warnCount === 0 ? (
            <div className="flex items-center gap-2">
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#059669", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: "11px", fontWeight: 500, color: "#6b7280" }}>Todos os postos operando normalmente</span>
            </div>
          ) : (
            <>
              {stoppedAlerts.length > 0 && (
                <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#9aa3af", flexShrink: 0, marginRight: "2px" }}>
                  Alertas
                </span>
              )}

              {stoppedAlerts.slice(0, 6).map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    background: "rgba(220,38,38,0.05)",
                    border: "1px solid rgba(220,38,38,0.18)",
                    borderRadius: "6px",
                    padding: "3px 8px 3px 7px",
                    maxWidth: "280px",
                  }}
                >
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#dc2626", flexShrink: 0, animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#b91c1c", flexShrink: 0, fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>
                    {s.codigo ?? s.nome}
                  </span>
                  <span style={{ fontSize: "11px", color: "#e57373", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {s.headline ?? "parada não justificada"}
                  </span>
                  {s.tempo_status_hms && (
                    <span style={{ fontSize: "10px", fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontWeight: 600, color: "#b91c1c", flexShrink: 0 }}>
                      {s.tempo_status_hms}
                    </span>
                  )}
                </div>
              ))}

              {stoppedAlerts.length > 6 && (
                <span style={{ fontSize: "11px", color: "#9aa3af", flexShrink: 0 }}>
                  +{stoppedAlerts.length - 6}
                </span>
              )}
            </>
          )}

          <div className="flex-1" />

          {warnCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(217,119,6,0.05)", border: "1px solid rgba(217,119,6,0.18)", borderRadius: "6px", padding: "3px 8px", flexShrink: 0 }}>
              <AlertTriangle style={{ width: "11px", height: "11px", color: "#d97706", flexShrink: 0 }} />
              <span style={{ fontSize: "11px", fontWeight: 500, color: "#92400e" }}>
                {warnCount} {warnCount === 1 ? "posto" : "postos"} com OEE abaixo da meta
              </span>
            </div>
          )}

          <button
            onClick={() => setShowDetails((v) => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              borderRadius: "6px",
              border: showDetails ? "1px solid #0f1117" : "1px solid #dde2e8",
              padding: "3px 10px",
              fontSize: "10px", fontWeight: 600,
              letterSpacing: "0.07em", textTransform: "uppercase",
              background: showDetails ? "#0f1117" : "#fff",
              color: showDetails ? "#fff" : "#6b7280",
              cursor: "pointer", transition: "all 0.15s ease",
              userSelect: "none",
            }}
            title={showDetails ? "Ocultar postos por causa de parada" : "Ver postos por causa de parada"}
          >
            {showDetails ? <EyeOff style={{ width: "11px", height: "11px" }} /> : <Eye style={{ width: "11px", height: "11px" }} />}
            Postos por Causa
          </button>
        </div>

        {/* ── CHARTS ── */}
        {/* Tokens visuais compartilhados pelos 3 gráficos — alinhados com os cards */}
        {/* bg-white · border-slate-200 · rounded-xl · grid suave · sem sombra pesada */}
        <div className="grid grid-cols-1 gap-3">

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* ① OEE Geral — por turno do dia operacional */}
            <div className="bg-white rounded-lg border border-stone-200 flex flex-col" style={{ minHeight: 0 }}>

              {/* Header */}
              <div style={{ padding: "0 18px", height: "52px", borderBottom: "1px solid #e2e7ee", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "3px", height: "22px", background: "#07111f", borderRadius: "1px", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.11em", color: "#07111f", lineHeight: 1.2 }}>OEE por Turno</div>
                    <div style={{ fontSize: "11px", fontWeight: 500, color: "#667085", marginTop: "1px" }}>Dia operacional · consolidado por turno</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {oeeTendencia.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span style={{ fontSize: "10px", fontFamily: MONO_FONT, color: "#8a98a8" }}>06h — 06h</span>
                </div>
              </div>

              {/* Chart — 70% */}
              <div style={{ flex: 7, minHeight: 0, display: "flex", flexDirection: "column", padding: "12px 10px 0 10px" }}>
                {oeeShiftData.length === 0 ? (
                  <div className="flex items-center justify-center flex-1 text-[11px] text-slate-400">
                    {oeeTendencia.isLoading ? "Carregando…" : "Sem dados para o dia operacional"}
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={oeeShiftData} margin={{ top: 28, right: 48, left: 2, bottom: 0 }} barCategoryGap="16%" barGap={2}>
                          <defs>
                            <linearGradient id="oeeBarGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#1e3045" />
                              <stop offset="100%" stopColor="#0a1018" />
                            </linearGradient>
                            <linearGradient id="dispBarGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#5c6974" />
                              <stop offset="100%" stopColor="#2e3840" />
                            </linearGradient>
                            <linearGradient id="perfBarGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#a8b2bc" />
                              <stop offset="100%" stopColor="#6a7882" />
                            </linearGradient>
                            <linearGradient id="qualBarGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#dce4ec" />
                              <stop offset="100%" stopColor="#b0bcc8" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 4" stroke="#e4e9ee" vertical={false} strokeWidth={1} />
                          <XAxis
                            dataKey="turno_nome"
                            tickLine={false}
                            axisLine={false}
                            tick={(props: any) => {
                              const nome = props.payload?.value ?? ""
                              const point = oeeShiftData.find((d) => d.turno_nome === nome)
                              const hasData = point?.oee != null
                              return (
                                <g transform={`translate(${props.x},${props.y})`}>
                                  <text x={0} y={0} dy={13} textAnchor="middle"
                                    fontSize={hasData ? 13 : 12} fontWeight={hasData ? 700 : 500}
                                    fill={hasData ? "#0f1117" : "#9aa3af"}
                                    fontFamily="Geist, Inter, system-ui, sans-serif">
                                    {nome}
                                  </text>
                                </g>
                              )
                            }}
                          />
                          <YAxis
                            width={42}
                            tick={{ fontSize: 10, fill: "#9aa3af", fontFamily: MONO_FONT }}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 100]}
                            ticks={[0, 25, 50, 75, 100]}
                            tickFormatter={(v) => `${v}`}
                          />
                          <ReferenceLine y={70} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "META", position: "right", offset: 6, fontSize: 10, fontWeight: 700, fill: "#dc2626" }} />
                          <Bar dataKey="oee" name="OEE" fill="url(#oeeBarGrad)" radius={[2, 2, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                            <LabelList dataKey="oee" position="top" formatter={(v: any) => (v != null && Number(v) > 0) ? `${Number(v).toFixed(0)}` : ""} style={{ fontSize: 11, fontWeight: 800, fontFamily: MONO_FONT, fill: "#0f1117" }} />
                          </Bar>
                          <Bar dataKey="availability" name="Disp." fill="url(#dispBarGrad)" radius={[2, 2, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                            <LabelList dataKey="availability" position="top" formatter={(v: any) => (v != null && Number(v) > 0) ? `${Number(v).toFixed(0)}` : ""} style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO_FONT, fill: "#3a4a58" }} />
                          </Bar>
                          <Bar dataKey="performance" name="Perf." fill="url(#perfBarGrad)" radius={[2, 2, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                            <LabelList dataKey="performance" position="top" formatter={(v: any) => (v != null && Number(v) > 0) ? `${Number(v).toFixed(0)}` : ""} style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO_FONT, fill: "#6a7882" }} />
                          </Bar>
                          <Bar dataKey="quality" name="Qual." fill="url(#qualBarGrad)" radius={[2, 2, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                            <LabelList dataKey="quality" position="top" formatter={(v: any) => (v != null && Number(v) > 0) ? `${Number(v).toFixed(0)}` : ""} style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO_FONT, fill: "#8a98a8" }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Legend */}
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px 10px", borderTop: "1px solid #edf0f4", marginTop: "8px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", fontWeight: 700, color: "#dc2626" }}>
                        <span style={{ display: "inline-block", width: "18px", borderTop: "2px dashed #dc2626" }} />
                        meta 70%
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {([["#1e3045", "#0a1018", "OEE"], ["#5c6974", "#2e3840", "DISP."], ["#a8b2bc", "#6a7882", "PERF."], ["#dce4ec", "#b0bcc8", "QUAL."]] as const).map(([c1, c2, lbl]) => (
                          <span key={lbl} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: "#8a98a8" }}>
                            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: `linear-gradient(to bottom, ${c1}, ${c2})`, flexShrink: 0 }} />
                            {lbl}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Table — 30% */}
              <div style={{ flex: 3, minHeight: 0, borderTop: "1px solid #e2e7ee", overflowY: "auto" }}>
                {oeeShiftData.length > 0 && (
                  <div className="overflow-x-auto scrollbar-soft">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "500px" }}>
                      <thead>
                        <tr style={{ background: "oklch(0.96 0.005 250 / 0.5)", position: "sticky", top: 0, zIndex: 1 }}>
                          <th style={{ padding: "6px 8px 6px 18px", textAlign: "left", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>TURNO</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)" }}>OEE</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)" }}>DISPONIB.</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)" }}>PERFORM.</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)" }}>QUALIDADE</th>
                          <th style={{ padding: "6px 18px 6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)" }}>PEÇAS BOAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {oeeShiftData.map((row) => {
                          const oeeClr = row.oee == null ? "var(--ink-mute)" : oeeColor(row.oee)
                          return (
                            <tr key={row.xIdx} style={{ borderTop: "1px solid var(--hairline)" }}>
                              <td style={{ padding: "6px 8px 6px 18px", fontFamily: UI_FONT, fontSize: "11px", fontWeight: 700, color: "var(--ink)", borderRight: "1px solid var(--hairline)" }}>
                                {row.turno_nome}
                              </td>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "12px", fontWeight: 700, color: oeeClr, borderRight: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums" }}>
                                {row.oee != null ? `${row.oee.toFixed(1)}%` : <span style={{ color: "var(--hairline)" }}>—</span>}
                              </td>
                              <td style={{ padding: "5px 8px", textAlign: "right", borderRight: "1px solid var(--hairline)" }}>
                                <div style={{ fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 600, color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                                  {row.availability != null ? `${row.availability.toFixed(1)}%` : <span style={{ color: "var(--hairline)" }}>—</span>}
                                </div>
                                {row.run_time_seg != null && row.planned_time_seg != null && (
                                  <div style={{ fontSize: "10px", color: "var(--ink-mute)", fontFamily: MONO_FONT, marginTop: "1px", whiteSpace: "nowrap" }}>
                                    {fmtMin(row.run_time_seg)} op · {fmtMin(row.planned_time_seg)} planj.
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: "5px 8px", textAlign: "right", borderRight: "1px solid var(--hairline)" }}>
                                <div style={{ fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 600, color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                                  {row.performance != null ? `${row.performance.toFixed(1)}%` : <span style={{ color: "var(--hairline)" }}>—</span>}
                                </div>
                                {row.ideal_time_seg != null && row.run_time_seg != null && (
                                  <div style={{ fontSize: "10px", color: "var(--ink-mute)", fontFamily: MONO_FONT, marginTop: "1px", whiteSpace: "nowrap" }}>
                                    {fmtMin(row.ideal_time_seg)} ideal · {fmtMin(row.run_time_seg)} real
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: "5px 8px", textAlign: "right", borderRight: "1px solid var(--hairline)" }}>
                                <div style={{ fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 600, color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                                  {row.quality != null ? `${row.quality.toFixed(1)}%` : <span style={{ color: "var(--hairline)" }}>—</span>}
                                </div>
                                {row.total_pecas > 0 && (
                                  <div style={{ fontSize: "10px", color: "var(--ink-mute)", fontFamily: MONO_FONT, marginTop: "1px", whiteSpace: "nowrap" }}>
                                    {row.total_good.toLocaleString("pt-BR")} boas · {row.total_pecas.toLocaleString("pt-BR")} total
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: "5px 18px 5px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                                {formatNumber(row.total_good)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ② Pareto de Paradas — Dia Operacional */}
            <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
              <div style={{ padding: "0 18px", height: "52px", borderBottom: "1px solid #e2e7ee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "3px", height: "22px", background: "#07111f", borderRadius: "1px", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.11em", color: "#07111f", lineHeight: 1.2 }}>Pareto de Paradas</div>
                    <div style={{ fontSize: "11px", fontWeight: 500, color: "#667085", marginTop: "1px" }}>Dia operacional · acumulado por causa</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {paradasAgg?.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#8a98a8" }}>minutos</span>
                </div>
              </div>
              <div style={{ padding: "18px 18px 14px" }}>

              {paradasAgg?.isLoading ? (
                <div className="flex items-center justify-center h-[140px] gap-2 text-[11px] text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                </div>
              ) : stopCausas.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[140px] gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                    <span className="text-emerald-600 text-base font-bold">✓</span>
                  </div>
                  <span className="text-[11px] text-emerald-700 font-semibold">Nenhuma parada registrada</span>
                </div>
              ) : (() => {
                const STOP_COLORS = ["#0b1420", "#2d3748", "#47515d", "#718096", "#8a929c", "#a0aec0", "#cbd5df", "#e2e8f0"]
                const totalMin = stopCausas.reduce((s, c) => s + c.min, 0)
                let cumulAccum = 0
                const COL = "minmax(0, 1fr) 120px 80px"
                return (
                  <div>
                    {/* Header row */}
                    <div style={{ display: "grid", gridTemplateColumns: COL, columnGap: "14px", paddingBottom: "10px", borderBottom: "1px solid #e2e7ee" }}>
                      <span style={{ fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.14em", color: "#8a98a8" }}>CAUSA</span>
                      <span style={{ fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.14em", color: "#8a98a8", textAlign: "right" }}>MINUTOS</span>
                      <span style={{ fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.14em", color: "#8a98a8", textAlign: "right" }}>ACUM.</span>
                    </div>
                    {/* Data rows */}
                    {stopCausas.map((item, i) => {
                      const itemPct = totalMin > 0 ? (item.min / totalMin) * 100 : 0
                      cumulAccum += itemPct
                      const barPct = stopCausas[0].min > 0 ? (item.min / stopCausas[0].min) * 100 : 0
                      return (
                        <div key={item.causa} style={{ display: "grid", gridTemplateColumns: COL, columnGap: "14px", alignItems: "center", minHeight: "58px", borderBottom: "1px solid #f0f4f7", paddingTop: "8px", paddingBottom: "8px" }}>
                          {/* CAUSA column — inclui % da causa no canto direito da barra */}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "13px", fontWeight: 800, color: "#07111f", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.causa}
                            </div>
                            <div style={{ fontSize: "11px", color: "#667085", fontFamily: "JetBrains Mono, monospace", marginTop: "2px" }}>
                              {item.postos.length} CT
                            </div>
                            <div style={{ position: "relative", marginTop: "6px", height: "20px", background: "#f1f3f5", borderRadius: "1px", overflow: "hidden" }}>
                              <div style={{ width: `${barPct}%`, height: "100%", background: STOP_COLORS[i] ?? "#e2e8f0" }} />
                              <span style={{ position: "absolute", right: "4px", top: "2px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px", fontWeight: 700, color: barPct > 50 ? "#ffffff" : "#475569", lineHeight: 1 }}>
                                {itemPct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          {/* MINUTOS column */}
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", fontWeight: 900, color: "#07111f" }}>{item.min}</span>
                            <span style={{ fontSize: "10px", textTransform: "uppercase", color: "#667085", marginLeft: "3px" }}>MIN</span>
                          </div>
                          {/* ACUM column */}
                          <div style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "14px", fontWeight: 700, color: "#475569" }}>
                            {Math.min(100, cumulAccum).toFixed(0)}%
                          </div>
                        </div>
                      )
                    })}
                    {/* Footer */}
                    <div style={{ borderTop: "1px solid #e2e7ee", paddingTop: "14px", marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.14em", color: "#8a98a8" }}>TOTAL NO DIA OPERACIONAL</span>
                      <div>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "20px", fontWeight: 900, color: "#07111f" }}>{totalMin}</span>
                        <span style={{ fontSize: "10px", textTransform: "uppercase", color: "#667085", marginLeft: "4px" }}>MIN</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Painel de detalhes Pareto — breakdown por CT */}
              {showDetails && stopCausas.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  <div className="text-[9px] uppercase tracking-[0.14em] text-slate-400 font-semibold mb-2">Postos por causa</div>
                  {stopCausas.map((item) => item.postos.length > 0 && (
                    <div key={item.causa} className="flex items-start gap-2">
                      <span className="text-[10px] font-semibold text-slate-600 shrink-0 min-w-[120px] truncate">{item.causa}</span>
                      <span className="text-[9px] text-slate-400 leading-relaxed">
                        {item.postos.slice(0, 6).map((p) => p.nome).join(" · ")}{item.postos.length > 6 ? ` +${item.postos.length - 6}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
          </div>

          {/* ③ Real vs Meta — Dia Operacional completo */}
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
            {/* Internal wrapper: padding 16px 20px 20px per spec */}
            <div style={{ padding: "16px 20px 20px" }}>
              {/* ── Header ── */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "14px" }}>
                <div>
                  <div style={{ fontFamily: UI_FONT, fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--ink)", lineHeight: 1.2 }}>
                    REAL VS. META
                  </div>
                  <div style={{ fontFamily: UI_FONT, fontSize: "11px", fontWeight: 500, color: "var(--ink-mute)", marginTop: "2px" }}>
                    Dia operacional · meta = 80% cap./hora
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {prodDiaOp.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--ink-mute)" as any }} />}
                  <span style={{ fontFamily: MONO_FONT, fontSize: "10px", color: "var(--ink-mute)" }}>por hora</span>
                </div>
              </div>

              {/* ── Chart / loading / empty ── */}
              {prodDiaOp?.isLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "150px", gap: "8px", color: "var(--ink-mute)", fontSize: "11px", fontFamily: UI_FONT }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                </div>
              ) : prodChartData.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "150px", color: "var(--ink-mute)", fontSize: "11px", fontFamily: UI_FONT }}>
                  Sem dados de produção no dia operacional
                </div>
              ) : (
                <>
                  {/* SVG chart — viewBox 560×150, fluid */}
                  <RealVsMetaSVGChart data={visibleProdChartData} ctCodes={ctCodes} />

                  {/* ── Legend ── */}
                  <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: "12px", marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", rowGap: "6px" }}>
                    {/* Meta swatch */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                      <span style={{ display: "inline-block", width: "10px", height: "10px", border: "1.5px dashed var(--ink-soft)", boxSizing: "border-box", flexShrink: 0 }} />
                      <span style={{ fontFamily: UI_FONT, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)" }}>Meta</span>
                    </span>
                    {/* CT swatches */}
                    {ctCodes.map((ct, i) => (
                      <span key={ct} style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                        <span style={{ display: "inline-block", width: "10px", height: "10px", background: "var(--ink)", opacity: Math.max(0.25, 1 - i * 0.13), flexShrink: 0 }} />
                        <span style={{ fontFamily: MONO_FONT, fontSize: "10px", color: "var(--ink-soft)" }}>{abbreviateCT(ct)}</span>
                      </span>
                    ))}
                    {/* Totals block */}
                    <span style={{ marginLeft: "auto", display: "inline-flex", gap: "6px", alignItems: "center", fontFamily: MONO_FONT, fontSize: "10px", color: "var(--ink-soft)" }}>
                      <span>Real: <strong style={{ fontWeight: 700, color: "var(--ink)" }}>{formatNumber(visibleProdTotal)} pç</strong></span>
                      <span style={{ color: "var(--hairline)" }}>·</span>
                      <span>Δ: <strong style={{ fontWeight: 700, color: (visibleProdTotal - visibleMetaTotal) >= 0 ? "var(--ok)" : "var(--danger)" }}>
                        {(visibleProdTotal - visibleMetaTotal) >= 0 ? "+" : ""}{formatNumber(visibleProdTotal - visibleMetaTotal)}
                      </strong></span>
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* ── Detail table ── */}
            {visibleProdChartData.length > 0 && (() => {
              const grandTotal = visibleProdTotal
              const grandMeta = visibleMetaTotal
              const grandDelta = grandTotal - grandMeta
              const tableMinWidth = Math.max(400, 44 + ctCodes.length * 80 + 120)
              return (
                <div style={{ borderTop: "1px solid var(--hairline)" }}>
                  <div className="overflow-x-auto scrollbar-soft">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: `${tableMinWidth}px` }}>
                      <thead>
                        <tr style={{ background: "oklch(0.96 0.005 250 / 0.5)" }}>
                          <th style={{ padding: "6px 8px 6px 18px", textAlign: "left", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)", width: "44px", whiteSpace: "nowrap" }}>HORA</th>
                          {ctCodes.map((ct) => (
                            <th key={ct} style={{ padding: "6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                              {abbreviateCT(ct)}
                            </th>
                          ))}
                          <th style={{ padding: "6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)", width: "60px" }}>REAL</th>
                          <th style={{ padding: "6px 8px 6px 8px", textAlign: "right", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", width: "60px" }}>Δ META</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleProdChartData.map((row) => {
                          const real = safeN(row.real, 0)
                          const diff = safeN(row.delta, 0)
                          return (
                            <tr key={row.hora_op_utc} style={{ borderTop: "1px solid var(--hairline)" }}>
                              <td style={{ padding: "6px 8px 6px 18px", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, color: "var(--ink)", borderRight: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums" }}>
                                {row.hora}
                              </td>
                              {ctCodes.map((ct) => (
                                <td key={ct} style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 400, color: "var(--ink-soft)", borderRight: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums" }}>
                                  {safeN(row[ct] as any, 0) > 0 ? formatNumber(safeN(row[ct] as any, 0)) : <span style={{ color: "var(--hairline)" }}>—</span>}
                                </td>
                              ))}
                              <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, color: "var(--ink)", borderRight: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums" }}>
                                {formatNumber(real)}
                              </td>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, color: diff >= 0 ? "var(--ok)" : "var(--danger)", fontVariantNumeric: "tabular-nums" }}>
                                {(diff >= 0 ? "+" : "") + formatNumber(diff)}
                              </td>
                            </tr>
                          )
                        })}
                        <tr style={{ borderTop: "2px solid var(--ink-mute)" }}>
                          <td style={{ padding: "6px 8px 6px 18px", fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-mute)", borderRight: "1px solid var(--hairline)" }}>TOTAL</td>
                          {ctCodes.map((ct) => <td key={ct} style={{ borderRight: "1px solid var(--hairline)" }} />)}
                          <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, color: "var(--ink)", borderRight: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums" }}>
                            {formatNumber(grandTotal)}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: grandDelta >= 0 ? "var(--ok)" : "var(--danger)" }}>
                            {(grandDelta >= 0 ? "+" : "") + formatNumber(grandDelta)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── FILTER BAR ───────────────────────────────────────────────────────────────
function FilterBar({
  query, setQuery, filter, setFilter, viewMode, setViewMode,
  count, grupos, selectedGrupo, setSelectedGrupo, loading, onRefresh, liveEnabled,
}: {
  query: string; setQuery: (v: string) => void
  filter: string; setFilter: (v: string) => void
  viewMode: string; setViewMode: (v: string) => void
  count: number
  grupos: Grupo[]; selectedGrupo: number | ""; setSelectedGrupo: (v: number | "") => void
  loading: boolean; onRefresh: () => void; liveEnabled: boolean
}) {
  return (
    <div
      className="sticky top-0 z-10"
      style={{
        background: "rgba(255, 255, 255, 0)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.05)",
      }}
    >
      <div className="max-w-[1600px] 2xl:max-w-none mx-auto px-4 sm:px-6 py-2">
        <div className="flex items-center gap-2 flex-wrap">

          {/* Busca */}
          <div className="relative flex-1 max-w-[220px] min-w-[140px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "#a0aab4" }} />
            <input
              id="mes-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar posto, código..."
              style={{
                width: "100%",
                height: "30px",
                paddingLeft: "30px",
                paddingRight: query ? "28px" : "10px",
                fontSize: "12px",
                color: "#0f1117",
                background: "#fff",
                border: "1px solid rgba(0,0,0,0.09)",
                borderRadius: "6px",
                outline: "none",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "#a0aab4" }}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Grupo */}
          {grupos.length > 0 && (
            <select
              value={selectedGrupo}
              onChange={(e) => setSelectedGrupo(e.target.value === "" ? "" : Number(e.target.value))}
              style={{
                height: "30px",
                fontSize: "12px",
                color: "#374151",
                background: "#fff",
                border: "1px solid rgba(0,0,0,0.09)",
                borderRadius: "6px",
                paddingLeft: "10px",
                paddingRight: "24px",
                outline: "none",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <option value="">Todos grupos</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
          )}

          {/* Status filter */}
          <div className="flex items-center gap-0.5 p-0.5" style={{ background: "rgba(0,0,0,0.06)", borderRadius: "7px" }}>
            {[["all", "Todos"], ["producing", "Produzindo"], ["stopped", "Parado"]].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                style={{
                  padding: "0 10px",
                  height: "24px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  letterSpacing: "0.005em",
                  transition: "all 0.12s",
                  background: filter === k
                    ? k === "producing" ? "#059669"
                    : k === "stopped" ? "#dc2626"
                    : "#fff"
                    : "transparent",
                  color: filter === k
                    ? k === "all" ? "#0f1117"
                    : "#fff"
                    : "#6b7280",
                  boxShadow: filter === k ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* View mode */}
          <div className="flex items-center gap-0.5 p-0.5" style={{ background: "rgba(0,0,0,0.06)", borderRadius: "7px" }}>
            {[["grid", Grid3X3, "Grade (Shift+G)"], ["list", List, "Lista (Shift+L)"]].map(([mode, Icon, title]: any) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                title={title}
                style={{
                  width: "26px",
                  height: "24px",
                  borderRadius: "5px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: viewMode === mode ? "#fff" : "transparent",
                  color: viewMode === mode ? "#0f1117" : "#9aa3af",
                  boxShadow: viewMode === mode ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                  transition: "all 0.12s",
                }}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Atualizar (Shift+R)"
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.09)",
              color: "#9aa3af",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.4 : 1,
              transition: "all 0.12s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <RefreshCcw className={cx("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>

          {/* Live indicator + count */}
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-1.5">
              <span
                className={liveEnabled ? "animate-pulse" : ""}
                style={{ width: "5px", height: "5px", borderRadius: "50%", background: liveEnabled ? "#059669" : "#9aa3af", display: "inline-block", flexShrink: 0 }}
              />
              <span style={{ fontSize: "10px", fontWeight: 600, color: "#a0aab4", letterSpacing: "0.04em", fontFamily: "'IBM Plex Mono', monospace" }}>
                {liveEnabled ? `ao vivo · ${POLL_CARDS_MS / 1000}s` : "pausado"}
              </span>
            </div>
            <span style={{ fontSize: "11px", color: "#9aa3af" }}>
              <span style={{ fontWeight: 700, color: "#374151" }}>{count}</span> postos
            </span>
          </div>

        </div>
      </div>
    </div>
  )
}

function StationCardCompact({
  station: s,
  onOpen,
  nowMs,
}: {
  station: CentroTrabalhoCardVM
  onOpen: (s: CentroTrabalhoCardVM) => void
  nowMs: number
}) {
  const stopped = s.status === "stopped"
  const isRework = String(s.modo_contagem ?? "").toUpperCase() === "REWORK"
  const reworkPecas = Array.isArray((s as any).retrabalho_pecas) ? ((s as any).retrabalho_pecas as string[]) : []
  const oeeVal = resolveOee(s)
  const produzidoTurno = Number(s.produzido_turno ?? 0)
  const ordemAtualTurno = Number(s.corrida_good ?? 0)

  const [baseSec, setBaseSec] = useState<number | null>(() => parseHmsToSeconds(s.tempo_status_hms))
  const [baseAtMs, setBaseAtMs] = useState(() => Date.now())

  useEffect(() => {
    setBaseSec(parseHmsToSeconds(s.tempo_status_hms))
    setBaseAtMs(Date.now())
  }, [s.tempo_status_hms, s.status])

  const tempoShow = useMemo(
    () => liveHmsFromBase(baseSec, baseAtMs, nowMs) ?? s.tempo_status_hms ?? "—",
    [baseSec, baseAtMs, nowMs, s.tempo_status_hms],
  )

  // Em retrabalho produzindo, o status vira laranja âmbar (identidade do modo).
  // Parado continua vermelho — retrabalho nunca pode esconder uma parada.
  const statusColor = stopped ? "#dc2626" : isRework ? RW_ACCENT : "#059669"
  const isSetup = !!(
    s.motivo_grupo_perda?.toLowerCase().includes("setup") ||
    s.motivo_descricao?.toLowerCase().includes("setup")
  )

  const totalColor = ordemAtualTurno > 0
    ? "#059669"
    : stopped
      ? "#dc2626"
      : undefined

  return (
    <button
      onClick={() => onOpen(s)}
      style={{
        // Longhand em todos os lados: misturar `border` com `borderTop`/`borderLeft`
        // dispara aviso do React ("don't mix shorthand and non-shorthand").
        borderTopWidth: "2px",
        borderTopStyle: "solid",
        borderTopColor: statusColor,
        borderRightWidth: "1px",
        borderRightStyle: "solid",
        borderRightColor: "#e4e8ed",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "#e4e8ed",
        // Em retrabalho, uma barra laranja âmbar à esquerda marca o card
        borderLeftWidth: isRework ? "4px" : "1px",
        borderLeftStyle: "solid",
        borderLeftColor: isRework ? RW_ACCENT : "#e4e8ed",
        background: "#ffffff",
        borderRadius: "0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
      }}
      className="w-full text-left overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-slate-400/30 hover:shadow-md transition-shadow duration-150"
    >
      {/* ── STATUS HEADER ── */}
      <div
        style={{
          background: isRework && !stopped
            ? "rgba(180,83,9,0.09)"
            : stopped
              ? "rgba(220,38,38,0.07)"
              : "rgba(5,150,105,0.07)",
          borderBottomWidth: "1px",
          borderBottomStyle: "solid",
          borderBottomColor: isRework ? RW_LINE : "#edf0f4",
          padding: "0 14px",
          minHeight: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
          <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
          <span style={{ fontFamily: UI_FONT, fontSize: "14px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: statusColor }}>
            {stopped ? "PARADO" : "PRODUZINDO"}
          </span>
          {isRework && (
            <span
              title="Posto em modo RETRABALHO — os apontamentos contam como retrabalho"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: UI_FONT, fontSize: "12px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.10em", color: "#fdf6ea", background: RW_DEEP, borderWidth: "1px", borderStyle: "solid", borderColor: RW_INK, padding: "2px 7px", borderRadius: 0, lineHeight: 1.3, flexShrink: 0 }}
            >
              <RefreshCcw className="w-2.5 h-2.5" />
              Retrabalho
            </span>
          )}
        </div>
        {/* Em retrabalho o selo ocupa a faixa: o tempo sai daqui (segue visível
            no modal do posto) para o cabeçalho não ficar espremido. */}
        {!isRework && (
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexShrink: 0 }}>
            <span style={{ fontFamily: UI_FONT, fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#8a98a8" }}>
              {stopped ? "PARADA" : "TEMPO"}
            </span>
            <span style={{ fontFamily: MONO_FONT, fontSize: "17px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: stopped ? "#e0282f" : "#020817" }}>
              {tempoShow}
            </span>
          </div>
        )}
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: "10px", flex: 1, }}>

        {/* CT code + OP */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: UI_FONT, fontSize: "22px", fontWeight: 600, color: "#0f1117", lineHeight: 1.15, letterSpacing: "-0.012em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.nome ?? s.codigo ?? "—"}
            </div>
            <div style={{ fontFamily: UI_FONT, fontSize: "15px", fontWeight: 500, color: "#64748b", marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
              {s.produto_descricao ?? "—"}
            </div>
            {/* Peças em retrabalho (rodízio) — só em modo RETRABALHO */}
            {isRework && reworkPecas.length > 0 && (
              <div
                title={`Retrabalho em rodízio: ${reworkPecas.join(" → ")}`}
                style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "5px", overflow: "hidden" }}
              >
                {reworkPecas.slice(0, 3).map((cod, i) => (
                  <span
                    key={`${cod}-${i}`}
                    style={{ fontFamily: MONO_FONT, fontSize: "13px", fontWeight: 700, color: RW_INK, background: RW_CHIP, borderWidth: "1px", borderStyle: "solid", borderColor: RW_LINE, padding: "1px 6px", lineHeight: 1.5, whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    {cod}
                  </span>
                ))}
                {reworkPecas.length > 3 && (
                  <span style={{ fontFamily: UI_FONT, fontSize: "12px", fontWeight: 700, color: RW_ACCENT, flexShrink: 0 }}>
                    +{reworkPecas.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          {s.produto_public_id && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: UI_FONT, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.14em", color: "#667085", fontWeight: 600 }}>PÇ</div>
              <div style={{ fontFamily: MONO_FONT, fontSize: "22px", fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                {s.produto_public_id}
              </div>
            </div>
          )}
        </div>

        {/* OEE gauge + Vertical metrics table */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Gauge + OEE label */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <OeeArc value={oeeVal} size={124} />
          </div>

          {/* Vertical metrics table */}
          <div style={{ flex: 1, minWidth: 0, borderWidth: "1px", borderStyle: "solid", borderColor: "#edf0f4", background: "#f9fafb", borderRadius: "0", overflow: "hidden" }}>
            {([
              { label: "ORDEM ATUAL", value: formatNumber(ordemAtualTurno), color: isRework ? RW_ACCENT : totalColor },
              // Em retrabalho o "produzido do turno" É o retrabalho do turno —
              // o rótulo deixa isso explícito para não ser lido como peça boa.
              { label: isRework ? "RETRAB. TURNO" : "TURNO", value: formatNumber(produzidoTurno), color: isRework ? RW_ACCENT : undefined },
            ] as { label: string; value: string; color?: string }[]).map(({ label, value, color }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 10px",
                  minHeight: "40px",
                  borderBottomWidth: "1px",
                  borderBottomStyle: "solid",
                  borderBottomColor: "#edf0f4",
                }}
              >
                <span style={{ fontFamily: UI_FONT, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.10em", color: "#8a98a8", fontWeight: 600 }}>
                  {label}
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: "17px", fontWeight: 700, color: color ?? "#020817", fontVariantNumeric: "tabular-nums" }}>
                    {value}
                  </span>
                </div>
              </div>
            ))}
            {/* Rebarbador row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 10px",
                minHeight: "40px",
              }}
            >
              <span style={{ fontFamily: UI_FONT, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.10em", color: "#8a98a8", fontWeight: 600, flexShrink: 0 }}>
                OP
              </span>
              <span style={{ fontFamily: UI_FONT, fontSize: "14px", fontWeight: 600, color: s.rebarbador?.nome ? "#0f172a" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "130px", textAlign: "right" }}>
                {s.rebarbador?.nome ?? "Indefinido"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── ANTERIOR strip — always visible ── */}
      <div
        style={{
          background: "#f9fafb",
          borderTopWidth: "1px",
          borderTopStyle: "solid",
          borderTopColor: "#edf0f4",
          padding: "0 14px",
          minHeight: "42px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: UI_FONT, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.14em", color: "#8a98a8", fontWeight: 700, flexShrink: 0 }}>
            ANTERIOR
          </span>
          <span style={{ fontFamily: MONO_FONT, fontSize: "15px", fontWeight: 700, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {s.ordem_anterior_codigo ?? "—"}
          </span>
        </div>
        {s.ordem_anterior_good != null && s.ordem_anterior_codigo && (
          <span style={{ fontFamily: MONO_FONT, fontSize: "18px", color: "#020817", fontWeight: 700, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {formatNumber(s.ordem_anterior_good)} pç
          </span>
        )}
      </div>

      {/* ── STOP REASON footer — only when stopped ── */}
      {stopped && (
        <div
          style={{
            background: isSetup ? "rgba(217,119,6,0.07)" : "rgba(220,38,38,0.07)",
            borderTop: "1px solid #edf0f4",
            borderLeft: `3px solid ${isSetup ? "#d97706" : "#dc2626"}`,
            padding: "6px 14px",
            minHeight: "30px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: isSetup ? "#d97706" : "#dc2626",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: UI_FONT,
              fontSize: "13px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: isSetup ? "#92400e" : "#991b1b",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.headline ?? (isSetup ? "Setup" : "Parada não justificada")}
          </span>
        </div>
      )}
    </button>
  )
}

// ─── STATION CARD (list) ──────────────────────────────────────────────────────
function StationCardList({
  station: s,
  onOpen,
  nowMs,
}: {
  station: CentroTrabalhoCardVM
  onOpen: (s: CentroTrabalhoCardVM) => void
  nowMs: number
}) {
  const stopped = s.status === "stopped"
  const isRework = String(s.modo_contagem ?? "").toUpperCase() === "REWORK"
  const reworkPecas = Array.isArray((s as any).retrabalho_pecas) ? ((s as any).retrabalho_pecas as string[]) : []
  const oeeVal = resolveOee(s)
  const produzido = Number(s.produzido_turno ?? 0)
  const paradasQtd = Number((s as any).paradas_turno_qtd ?? 0)

  const [baseSec, setBaseSec] = useState<number | null>(() => parseHmsToSeconds(s.tempo_status_hms))
  const [baseAtMs, setBaseAtMs] = useState(() => Date.now())

  useEffect(() => {
    setBaseSec(parseHmsToSeconds(s.tempo_status_hms))
    setBaseAtMs(Date.now())
  }, [s.tempo_status_hms, s.status])

  const tempoShow = useMemo(
    () => liveHmsFromBase(baseSec, baseAtMs, nowMs) ?? s.tempo_status_hms ?? "—",
    [baseSec, baseAtMs, nowMs, s.tempo_status_hms],
  )

  return (
    <button
      onClick={() => onOpen(s)}
      style={{
        // Longhand nos 4 lados (não misturar shorthand `border` com longhands)
        borderTopWidth: "2px",
        borderTopStyle: "solid",
        borderTopColor: stopped ? "#dc2626" : isRework ? RW_ACCENT : "#059669",
        borderRightWidth: "1px",
        borderRightStyle: "solid",
        borderRightColor: "#e4e8ed",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "#e4e8ed",
        borderLeftWidth: isRework ? "4px" : "1px",
        borderLeftStyle: "solid",
        borderLeftColor: isRework ? RW_ACCENT : "#e4e8ed",
        background: "#ffffff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
      }}
      className={cx(
        "group w-full text-left overflow-hidden",
        "hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40",
        "flex flex-col",
      )}
    >
      <div className="px-4 py-3 flex items-center gap-4 flex-1 min-w-0">
        <StatusPill status={s.status} />

        <div className="w-44 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[16px] font-extrabold truncate tracking-tight" style={{ color: "#020617" }}>
              {s.nome ?? "—"}
            </span>
            {isRework && (
              <span
                title="Posto em modo RETRABALHO — os apontamentos contam como retrabalho"
                className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.10em]"
                style={{ color: "#fdf6ea", background: RW_DEEP, borderWidth: "1px", borderStyle: "solid", borderColor: RW_INK, padding: "2px 5px", lineHeight: 1.3 }}
              >
                Retrab.
              </span>
            )}
          </div>
          <div className="text-[13px] font-mono" style={{ color: "#64748b" }}>
            {s.codigo ?? "—"} · {resolveTurnoNome(s)}
          </div>
        </div>

        <div className="flex-1 min-w-0 hidden md:block">
          <div className="text-[15px] font-semibold truncate" style={{ color: "#0f172a" }}>
            {(s as any).produto_public_id ?? "—"}
          </div>
          {isRework && reworkPecas.length > 0 ? (
            <div
              className="flex items-center gap-1 overflow-hidden"
              title={`Retrabalho em rodízio: ${reworkPecas.join(" → ")}`}
            >
              {reworkPecas.slice(0, 4).map((cod, i) => (
                <span
                  key={`${cod}-${i}`}
                  className="text-[13px] font-mono font-bold shrink-0"
                  style={{ color: RW_INK, background: RW_CHIP, borderWidth: "1px", borderStyle: "solid", borderColor: RW_LINE, padding: "0px 5px", lineHeight: 1.6 }}
                >
                  {cod}
                </span>
              ))}
              {reworkPecas.length > 4 && (
                <span className="text-[12px] font-bold shrink-0" style={{ color: RW_ACCENT }}>
                  +{reworkPecas.length - 4}
                </span>
              )}
            </div>
          ) : (
            <div className="text-[14px] truncate" style={{ color: "#64748b" }}>
              {(s as any).produto_descricao ?? "—"}
            </div>
          )}
        </div>

        <div className="shrink-0 hidden lg:block">
          <OeeRing value={oeeVal} size={64} />
        </div>

        <div className="w-28 shrink-0 text-right hidden sm:block">
          <div
            className="text-[18px] font-extrabold tabular-nums tracking-tight"
            style={{ color: isRework ? RW_ACCENT : "#020617" }}
          >
            {formatNumber(produzido)}
          </div>
          <div
            className="text-[12px] uppercase tracking-[0.14em] font-medium"
            style={{ color: isRework ? RW_ACCENT : "#94a3b8" }}
          >
            {isRework ? "retrabalho" : "produzido"}
          </div>
        </div>

        <div className="w-20 shrink-0 text-right hidden xl:block">
          <div className={cx("text-[16px] font-bold tabular-nums", paradasQtd > 0 ? "text-rose-700" : "text-slate-500")}>
            {formatNumber(paradasQtd)}
          </div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-slate-400 font-medium">paradas</div>
        </div>

        <div className="w-32 shrink-0 text-right hidden xl:block">
          <div className={cx("text-[15px] font-mono font-semibold tabular-nums", stopped ? "text-rose-700" : "text-slate-600")}>
            {tempoShow}
          </div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-slate-400 font-medium">
            {stopped ? "parado há" : "produzindo há"}
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 group-hover:text-slate-500 transition-colors" />
      </div>

      {stopped && s.headline && (
        <div className="px-4 pb-2.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#dc2626" }} />
          <span className="text-[13px] font-semibold truncate uppercase" style={{ color: "#991b1b", letterSpacing: "0.06em" }}>{s.headline}</span>
        </div>
      )}
    </button>
  )
}

function StationModal({
  station,
  isOpen,
  onClose,
  nowMs,
  liveEnabled,
}: {
  station: CentroTrabalhoCardVM | null
  isOpen: boolean
  onClose: () => void
  nowMs: number
  liveEnabled: boolean
}) {
  const router = useRouter()
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  const paradasTurno = useTotalParadasNoTurno({ centroTrabalhoId: station?.id ?? null })
  const cicloInst = useDashboardCicloInstantaneo(station?.id ?? null)
  const historicoDia = useDashboardHistoricoDia(station?.id ?? null)

  useLivePoll(() => {
    paradasTurno.mutate?.()
    cicloInst.mutate?.()
    historicoDia.mutate?.()
  }, POLL_MODAL_MS, liveEnabled && isOpen && !!station?.id)

  const [statusBaseSec, setStatusBaseSec] = useState<number | null>(null)
  const [baseAtMs, setBaseAtMs] = useState(() => Date.now())
  const [activeTab, setActiveTab] = useState<"detalhes" | "historico">("detalhes")

  useEffect(() => {
    if (!station) return
    setStatusBaseSec(parseHmsToSeconds(station.tempo_status_hms))
    setBaseAtMs(Date.now())
  }, [station?.id, station?.tempo_status_hms, station?.status])

  useEffect(() => {
    if (!isOpen) return
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) closeBtnRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (isOpen) setActiveTab("detalhes")
  }, [isOpen, station?.id])

  if (!isOpen || !station) return null

  const stopped = station.status === "stopped"
  const isSetup = !!(
    station.motivo_grupo_perda?.toLowerCase().includes("setup") ||
    station.motivo_descricao?.toLowerCase().includes("setup")
  )

  const oeeVal = resolveOee(station)
  const statusLive =
    liveHmsFromBase(statusBaseSec, baseAtMs, nowMs) ?? station.tempo_status_hms ?? "—"

  const produzidoTurno = Number(station.produzido_turno ?? 0)
  const pecaTotalGood = Number(station.peca_total_good ?? 0)
  const meta = Number(station.peca_meta_planejada ?? 0)
  const opAtualNoTurno = Number(station.corrida_good ?? 0)

  const paradasTurnoQtd = Number((station as any).paradas_turno_qtd ?? 0)
  const paradasTurnoHms = (station as any).paradas_turno_tempo_hms ?? "—"
  const paradasDiaQtd = Number((station as any).paradas_dia_qtd ?? 0)
  const paradasDiaHms = (station as any).paradas_dia_tempo_hms ?? "—"
  const produzindoDiaHms = (station as any).produzindo_dia_tempo_hms ?? "—"

  const tcIdeal =
    (station as any).ciclo_ideal_seg != null ? Number((station as any).ciclo_ideal_seg) : null
  const tcInst =
    cicloInst.data?.ciclo_instantaneo_seg != null
      ? Number(cicloInst.data.ciclo_instantaneo_seg)
      : null
  const tcMediaJanela =
    cicloInst.data?.ciclo_medio_janela_seg != null
      ? Number(cicloInst.data.ciclo_medio_janela_seg)
      : null

  const pecaTotal = Number(station.peca_total_good ?? 0)
  const pecaMeta = Number((station as any).peca_meta_planejada ?? 0)
  const pecaProg = Number((station as any).peca_progresso_pct ?? 0)
  const progressPct =
    pecaMeta > 0 ? Math.max(0, Math.min(100, pecaProg || (pecaTotal / pecaMeta) * 100)) : 0

  const naoJustificadas = paradasTurno.isLoading
    ? "…"
    : formatNumber(paradasTurno.data?.nao_justificadas_turno ?? 0)

  const turnoInicioFmt = (station as any).turno_inicio_utc
    ? new Date((station as any).turno_inicio_utc).toLocaleString("pt-BR")
    : "—"
  const turnoFimFmt = (station as any).turno_fim_utc
    ? new Date((station as any).turno_fim_utc).toLocaleString("pt-BR")
    : "—"

  const statusColor = stopped ? "#dc2626" : "#059669"
  const cardBg = "#ffffff"

  const metricBoxStyle = {
    background: "#f8fafc",
    border: "1px solid #edf0f4",
    borderRadius: "0",
  }

  const sectionCardStyle = {
    background: "#ffffff",
    border: "1px solid #edf0f4",
    borderRadius: "2px",
  }

  const subtleBoxStyle = {
    background: "#f8fafc",
    border: "1px solid #edf0f4",
    borderRadius: "2px",
  }

  const footerStyle = stopped
    ? {
      background: "#ffffff",
      borderTop: "1px solid #edf0f4",
      borderLeft: `3px solid ${isSetup ? "#d97706" : "#dc2626"}`,
    }
    : {
      background: "#f9fafb",
      borderTop: "1px solid #edf0f4",
    }

  const footerDotColor = stopped ? (isSetup ? "#d97706" : "#dc2626") : "#cbd5e1"
  const footerTextColor = stopped ? (isSetup ? "#92400e" : "#991b1b") : "#94a3b8"
  const footerText = stopped
    ? (station.headline ?? (isSetup ? "Setup" : "Parada não justificada"))
    : paradasTurnoQtd > 0
      ? "Paradas no turno"
      : "Sem paradas no turno"

  const totalColor =
    pecaTotalGood > 0 ? "#059669" : stopped ? "#dc2626" : "#0f172a"
  const turnoColor = "#0f172a"
  const metaColor = "#0f172a"

  function SectionTitle({
    icon: _icon,
    title,
  }: {
    icon: React.ReactNode
    title: string
  }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", paddingBottom: "8px", borderBottom: "1px solid #edf0f4" }}>
        <div style={{ width: "2px", height: "12px", background: statusColor, flexShrink: 0 }} />
        <span style={{ fontFamily: UI_FONT, fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#475569" }}>
          {title}
        </span>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 sm:pt-14 bg-black/50 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full sm:max-w-3xl max-h-[92dvh] sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
        style={{
          background: cardBg,
          border: "1px solid #e4e8ed",
          borderTop: `3px solid ${statusColor}`,
        }}
      >

        {/* HEADER */}
        <div
          className="shrink-0 border-b"
          style={{ padding: "14px 20px", borderColor: "#e4e8ed" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span
                  className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
                  style={{ background: statusColor }}
                />
                <span
                  className="text-[11px] font-semibold uppercase tracking-wide shrink-0"
                  style={{ color: statusColor }}
                >
                  {stopped ? "PARADO" : "PRODUZINDO"}
                </span>
                <span className="text-[11px] text-slate-400 shrink-0">·</span>
                <h2 className="text-[18px] font-semibold text-slate-900 truncate min-w-0">
                  {station.nome ?? "—"}
                </h2>
                <span style={{ display: "inline-flex", alignItems: "center", borderRadius: "2px", border: "1px solid #e4e8ed", background: "#f8fafc", padding: "1px 7px", fontFamily: MONO_FONT, fontSize: "11px", color: "#475569", fontWeight: 600 }}>
                  {station.codigo ?? "—"}
                </span>
                {String(station.modo_contagem ?? "").toUpperCase() === "REWORK" && (
                  <span
                    title="Posto em modo RETRABALHO — apontamentos contam como retrabalho"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: "2px", border: `1px solid ${RW_INK}`, background: RW_DEEP, padding: "2px 8px", fontFamily: UI_FONT, fontSize: "10px", color: "#fdf6ea", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" }}
                  >
                    <RefreshCcw className="w-3 h-3" />
                    Retrabalho
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  style={{ display: "inline-flex", alignItems: "center", gap: "5px", borderRadius: "2px", border: "1px solid #e4e8ed", background: "#f8fafc", padding: "3px 8px", color: statusColor }}
                >
                  <Clock className="w-3 h-3" />
                  <span style={{ fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {statusLive}
                  </span>
                </div>

                <div
                  style={{ display: "inline-flex", alignItems: "center", gap: "5px", borderRadius: "2px", border: "1px solid #e4e8ed", background: "#f8fafc", padding: "3px 8px", color: oeeVal >= 85 ? "#059669" : oeeVal >= 50 ? "#d97706" : "#dc2626" }}
                >
                  <Sparkles className="w-3 h-3" />
                  <span style={{ fontFamily: UI_FONT, fontSize: "11px", fontWeight: 600 }}>OEE {oeeVal.toFixed(1)}%</span>
                </div>

                {liveEnabled && (
                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    ao vivo
                  </span>
                )}
              </div>
            </div>

            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              style={{ borderRadius: "2px" }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* TOP METRICS */}
        <div className="shrink-0 px-4 sm:px-5 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 border border-[#edf0f4]">
            {[
              { label: "OP Atual", display: formatNumber(opAtualNoTurno), color: totalColor, unit: "pç" },
              { label: "Turno", display: formatNumber(produzidoTurno), color: "#0f172a", unit: "pç" },
              { label: "Meta", display: formatCompact(meta), color: "#0f172a", unit: "pç" },
              { label: "Paradas", display: formatNumber(paradasTurnoQtd), color: stopped ? "#dc2626" : paradasTurnoQtd > 0 ? "#d97706" : "#475569", unit: "qtd" },
            ].map(({ label, display, color, unit }, i) => {
              // Mobile 2-col: right border on col 0 (i=0,2), bottom border on row 1 (i=0,1)
              // sm+ 4-col: right border on i=0,1,2; no bottom border
              const cls = cx(
                "flex flex-col items-center bg-[#f8fafc]",
                "border-r border-[#edf0f4]",
                i === 1 ? "border-r-0 sm:border-r" : "",
                i === 3 ? "border-r-0" : "",
                i < 2 ? "border-b border-[#edf0f4] sm:border-b-0" : "",
              )
              return (
                <div key={label} className={cls} style={{ padding: "10px 8px" }}>
                  <span style={{ fontFamily: UI_FONT, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "#94a3b8", lineHeight: 1 }}>
                    {label}
                  </span>
                  <span style={{ fontFamily: MONO_FONT, fontSize: "20px", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, marginTop: "4px" }}>
                    {display}
                  </span>
                  <span style={{ fontFamily: UI_FONT, fontSize: "10px", color: "#94a3b8", marginTop: "1px" }}>{unit}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* TABS */}
        <div className="shrink-0 px-4 sm:px-5 pt-3 border-b border-slate-200/80">
          <div className="flex items-center gap-0.5">
            {(["detalhes", "historico"] as const).map((tab) => {
              const active = activeTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-4 py-2 text-[11px] font-semibold transition-colors"
                  style={{
                    color: active ? "#0f172a" : "#94a3b8",
                    background: active ? "transparent" : "transparent",
                    borderBottom: active ? `2px solid ${statusColor}` : "2px solid transparent",
                  }}
                >
                  {tab === "detalhes" ? "Detalhes" : "Histórico do Dia"}
                </button>
              )
            })}
          </div>
        </div>

        {/* BODY */}
        <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-5">
          {activeTab === "detalhes" && (
            <>
              <section>
                <SectionTitle
                  icon={<Package className="w-4 h-4 text-slate-600" />}
                  title="Identificação"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4" style={sectionCardStyle}>
                    <DataRow label="Código CT" value={station.codigo ?? "—"} />
                    <DataRow
                      label="Ordem"
                      value={(station as any).ordem_codigo ?? station.produto_public_id ?? "—"}
                    />
                    <DataRow label="Produto" value={station.produto_public_id ?? "—"} />
                    <DataRow
                      label="Descrição"
                      value={
                        <span className="block truncate max-w-[220px]">
                          {station.produto_descricao ?? "—"}
                        </span>
                      }
                    />
                  </div>

                  <div className="p-4" style={sectionCardStyle}>
                    <DataRow label="Turno" value={resolveTurnoNome(station)} />
                    <DataRow label="Início turno" value={turnoInicioFmt} />
                    <DataRow label="Fim turno" value={turnoFimFmt} />
                    <DataRow
                      label="Motivo parada"
                      value={
                        stopped ? (
                          <span
                            style={{ color: isSetup ? "#9a3412" : "#991b1b" }}
                            className="block truncate max-w-[220px]"
                          >
                            {(station as any).motivo_descricao ??
                              (station as any).motivo_codigo ??
                              "Não justificada"}
                          </span>
                        ) : (
                          "—"
                        )
                      }
                    />
                  </div>
                </div>

                {/* Rebarbador — caixa de largura total abaixo das duas colunas */}
                <div className="mt-3 p-4" style={sectionCardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: UI_FONT, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#94a3b8", marginBottom: "4px" }}>
                        Rebarbador
                      </div>
                      {station.rebarbador?.nome ? (
                        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontFamily: UI_FONT, fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                            {station.rebarbador.nome}
                          </span>
                          {station.rebarbador.registro && (
                            <span style={{ fontFamily: MONO_FONT, fontSize: "12px", color: "#64748b" }}>
                              Reg. {station.rebarbador.registro}
                            </span>
                          )}
                          {station.rebarbador.cargo && (
                            <span style={{ fontFamily: UI_FONT, fontSize: "12px", color: "#64748b" }}>
                              · {station.rebarbador.cargo}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontFamily: UI_FONT, fontSize: "14px", fontWeight: 500, color: "#94a3b8" }}>
                          Indefinido
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle
                  icon={<BarChart3 className="w-4 h-4 text-slate-600" />}
                  title="Performance OEE"
                />

                <div className="p-4" style={sectionCardStyle}>
                  <div className="flex flex-col sm:flex-row items-center gap-5">
                    <div className="shrink-0 flex items-center justify-center">
                      <OeeArc value={oeeVal} size={96} />
                    </div>

                    <div className="flex-1 w-full space-y-3">
                      <MetricBar
                        value={pct((station as any).availability)}
                        label="Disponibilidade"
                        color={
                          pct((station as any).availability) >= 80
                            ? "#059669"
                            : pct((station as any).availability) >= 50
                              ? "#d97706"
                              : "#dc2626"
                        }
                      />
                      <MetricBar
                        value={pct((station as any).performance)}
                        label="Performance"
                        color={
                          pct((station as any).performance) >= 80
                            ? "#0284c7"
                            : pct((station as any).performance) >= 50
                              ? "#d97706"
                              : "#dc2626"
                        }
                      />
                      <MetricBar
                        value={pct((station as any).quality)}
                        label="Qualidade"
                        color={
                          pct((station as any).quality) >= 95
                            ? "#7c3aed"
                            : pct((station as any).quality) >= 80
                              ? "#d97706"
                              : "#dc2626"
                        }
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle
                  icon={<Activity className="w-4 h-4 text-slate-600" />}
                  title="Produção"
                />

                <div className="p-4 space-y-4" style={sectionCardStyle}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      {
                        label: "Prod-Global Peça ",
                        val: formatNumber(pecaTotalGood),
                      },
                      {
                        label: "Meta (corrida)",
                        val:
                          Number((station as any).meta_corrida ?? 0) > 0
                            ? formatNumber((station as any).meta_corrida)
                            : "—",
                      },
                      {
                        label: "Cap./hora",
                        val:
                          Number((station as any).capacidade_hora ?? 0) > 0
                            ? formatNumber((station as any).capacidade_hora)
                            : "—",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="p-3 text-center"
                        style={subtleBoxStyle}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                          {item.label}
                        </div>
                        <div className="text-[22px] font-semibold tabular-nums text-slate-900">
                          {item.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 text-center" style={subtleBoxStyle}>
                      <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: "#94a3b8" }}>
                        Refugo (turno)
                      </div>
                      <div className="text-[18px] font-semibold tabular-nums" style={{ color: "#0f172a" }}>
                        {formatNumber((station as any).scrap_turno ?? 0)}
                      </div>
                    </div>

                    <div
                      className="p-3 text-center"
                      style={
                        String(station.modo_contagem ?? "").toUpperCase() === "REWORK"
                          ? { border: `1px solid ${RW_LINE}`, background: RW_TINT }
                          : subtleBoxStyle
                      }
                    >
                      <div
                        className="text-[10px] uppercase tracking-[0.14em] mb-1"
                        style={{ color: String(station.modo_contagem ?? "").toUpperCase() === "REWORK" ? RW_ACCENT : "#94a3b8" }}
                      >
                        Retrabalho (turno)
                      </div>
                      <div
                        className="text-[18px] font-semibold tabular-nums"
                        style={{ color: String(station.modo_contagem ?? "").toUpperCase() === "REWORK" ? RW_INK : "#0f172a" }}
                      >
                        {formatNumber((station as any).rework_turno ?? 0)}
                      </div>
                    </div>
                  </div>

                  {/* Peças em retrabalho (rodízio) — posto em modo RETRABALHO */}
                  {String(station.modo_contagem ?? "").toUpperCase() === "REWORK" &&
                    Array.isArray((station as any).retrabalho_pecas) &&
                    ((station as any).retrabalho_pecas as string[]).length > 0 && (
                      <div
                        className="p-3"
                        style={{
                          borderTopWidth: "1px",
                          borderTopStyle: "solid",
                          borderTopColor: RW_LINE,
                          borderRightWidth: "1px",
                          borderRightStyle: "solid",
                          borderRightColor: RW_LINE,
                          borderBottomWidth: "1px",
                          borderBottomStyle: "solid",
                          borderBottomColor: RW_LINE,
                          borderLeftWidth: "3px",
                          borderLeftStyle: "solid",
                          borderLeftColor: RW_ACCENT,
                          background: RW_TINT,
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.14em] mb-1.5 font-bold" style={{ color: RW_ACCENT }}>
                          Peças em retrabalho (rodízio)
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {((station as any).retrabalho_pecas as string[]).map((cod, i) => (
                            <span
                              key={`${cod}-${i}`}
                              style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${RW_LINE}`, background: RW_CHIP, padding: "2px 8px", fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 700, color: RW_INK }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "13px", height: "13px", background: RW_DEEP, color: "#fdf6ea", fontFamily: UI_FONT, fontSize: "9px", fontWeight: 800 }}>
                                {i + 1}
                              </span>
                              {cod}
                            </span>
                          ))}
                        </div>
                        <div className="text-[10px] mt-1.5" style={{ color: "#9c7b52" }}>
                          Cada peça contada vai para a próxima da fila — o total do turno é o valor correto.
                        </div>
                      </div>
                    )}

                  <div>
                    <div className="flex items-center justify-between text-xs mb-2 gap-2">
                      <span className="text-slate-500 uppercase tracking-[0.14em]">
                        Progresso global da peça
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {formatNumber(pecaTotal)} / {formatNumber(pecaMeta)}
                        {pecaMeta > 0 && (
                          <span className="text-slate-500 ml-1">
                            ({progressPct.toFixed(1)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden" style={{ background: "#edf0f4" }}>
                      <div
                        className="h-full transition-all duration-700"
                        style={{
                          width: `${progressPct}%`,
                          background:
                            progressPct >= 90
                              ? "#16a34a"
                              : progressPct >= 60
                                ? "#f59e0b"
                                : "#0f172a",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle
                  icon={<Clock className="w-4 h-4 text-slate-600" />}
                  title="Tempos"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4" style={sectionCardStyle}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-3">
                      Status atual
                    </div>
                    <DataRow
                      label="Produzindo"
                      value={
                        <span className={station.status === "producing" ? "text-emerald-800" : ""}>
                          {station.status === "producing" ? statusLive : "—"}
                        </span>
                      }
                    />
                    <DataRow
                      label="Parado"
                      value={
                        <span className={stopped ? "text-rose-800" : ""}>
                          {stopped ? statusLive : "—"}
                        </span>
                      }
                    />
                  </div>

                  <div className="p-4" style={sectionCardStyle}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-3">
                      No dia
                    </div>
                    <DataRow label="Produzindo" value={produzindoDiaHms} />
                    <DataRow label="Parado" value={paradasDiaHms} />
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle
                  icon={<AlertTriangle className="w-4 h-4 text-slate-600" />}
                  title="Paradas"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4" style={sectionCardStyle}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-3">
                      Turno atual
                    </div>
                    <DataRow
                      label="Quantidade"
                      value={
                        <span className={paradasTurnoQtd > 0 ? "text-rose-800" : ""}>
                          {formatNumber(paradasTurnoQtd)}
                        </span>
                      }
                    />
                    <DataRow label="Tempo parado" value={paradasTurnoHms} />
                    <DataRow label="Não justificadas" value={naoJustificadas} />
                  </div>

                  <div className="p-4" style={sectionCardStyle}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-3">
                      No dia
                    </div>
                    <DataRow
                      label="Quantidade"
                      value={
                        <span className={paradasDiaQtd > 0 ? "text-rose-800" : ""}>
                          {formatNumber(paradasDiaQtd)}
                        </span>
                      }
                    />
                    <DataRow label="Tempo parado" value={paradasDiaHms} />
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle
                  icon={<Zap className="w-4 h-4 text-slate-600" />}
                  title="Tempo de Ciclo"
                />

                <div className="p-4" style={sectionCardStyle}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      {
                        label: "Ideal",
                        value: tcIdeal != null ? `${tcIdeal}s` : "—",
                        sub: tcIdeal != null ? `${(3600 / tcIdeal).toFixed(0)} pç/h` : "",
                        color: "text-slate-950",
                      },
                      {
                        label: "Instantâneo",
                        value: cicloInst.isLoading ? "…" : tcInst != null ? `${tcInst}s` : "—",
                        sub:
                          tcInst != null && tcIdeal != null
                            ? `${((tcIdeal / tcInst) * 100).toFixed(0)}% do ideal`
                            : "",
                        color:
                          tcInst != null && tcIdeal != null
                            ? tcInst <= tcIdeal * 1.1
                              ? "text-emerald-800"
                              : "text-rose-800"
                            : "text-slate-950",
                      },
                      {
                        label: "Médio (janela)",
                        value:
                          cicloInst.isLoading ? "…" : tcMediaJanela != null ? `${tcMediaJanela}s` : "—",
                        sub: "",
                        color: "text-slate-950",
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg p-3 text-center" style={subtleBoxStyle}>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                          {item.label}
                        </div>
                        <div className={cx("text-[22px] font-semibold tabular-nums", item.color)}>
                          {item.value}
                        </div>
                        {item.sub && <div className="text-[10px] text-slate-500 mt-1">{item.sub}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === "historico" && (
            <section>
              {(() => {
                const ant = historicoDia.data?.ordem_anterior
                const codigo = ant?.ordem_codigo ?? station.ordem_anterior_codigo
                const good = ant?.total_good ?? station.ordem_anterior_good
                if (!codigo) return null

                return (
                  <div
                    className="mb-3 flex items-center gap-2 px-3 py-2"
                    style={subtleBoxStyle}
                  >
                    <span className="text-[9px] uppercase tracking-[0.18em] text-slate-400 shrink-0">
                      OP anterior
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-slate-700 truncate">
                      {codigo}
                    </span>
                    {good != null && (
                      <span className="ml-auto font-mono text-[11px] font-semibold text-slate-500 tabular-nums shrink-0">
                        {formatNumber(good)} pç
                      </span>
                    )}
                  </div>
                )
              })()}

              {historicoDia.isLoading ? (
                <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando histórico…
                </div>
              ) : historicoDia.data?.historico_turnos?.length ? (
                <div className="space-y-3">
                  {historicoDia.data.historico_turnos.map((t: HistoricoTurnoVM) => {
                    const currentNowMs = Date.now()
                    const tIniMs = new Date(t.inicio_utc).getTime()
                    const tFimMs = new Date(t.fim_utc).getTime()
                    const isActive = currentNowMs >= tIniMs && currentNowMs < tFimMs
                    const isPast = currentNowMs >= tFimMs
                    const isFuture = currentNowMs < tIniMs

                    const oeeTurno = t.oee != null ? Math.round(t.oee * 100) : null
                    const availVal = t.availability != null ? Math.round(t.availability * 100) : null
                    const perfVal = t.performance != null ? Math.round(t.performance * 100) : null

                    const hhmm = (iso: string) =>
                      new Date(iso).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })

                    return (
                      <div
                        key={t.turno_id ?? t.turno_nome}
                        className="rounded-xl border overflow-hidden"
                        style={{
                          borderColor: isActive ? "#bbf7d0" : "#e2e8f0",
                          background: isActive ? "#f8fffa" : "#ffffff",
                          opacity: isFuture ? 0.55 : 1,
                        }}
                      >
                        <div
                          className="flex items-center justify-between gap-2 px-3 py-2 border-b"
                          style={{
                            background: isActive ? "#f0fdf4" : "#f8fafc",
                            borderColor: "#e2e8f0",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[11px] font-semibold uppercase tracking-[0.16em]"
                              style={{ color: isActive ? "#15803d" : "#64748b" }}
                            >
                              {t.turno_nome ?? "Turno"}
                            </span>

                            {isActive && (
                              <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-600">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                ao vivo
                              </span>
                            )}

                            {isFuture && (
                              <span className="text-[9px] text-slate-400 font-medium italic">
                                aguardando
                              </span>
                            )}
                          </div>

                          <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                            {hhmm(t.inicio_utc)} – {hhmm(t.fim_utc)}
                          </span>
                        </div>

                        {(isPast || isActive) && (
                          <div className="grid grid-cols-4 border-b border-slate-200">
                            {[
                              { lbl: "Total pçs", val: formatNumber(t.turno_good) },
                              { lbl: "OEE", val: oeeTurno != null ? `${oeeTurno}%` : "—" },
                              { lbl: "Disp", val: availVal != null ? `${availVal}%` : "—" },
                              { lbl: "Perf", val: perfVal != null ? `${perfVal}%` : "—" },
                            ].map((k) => (
                              <div key={k.lbl} className="text-center py-2 px-1 border-r last:border-r-0 border-slate-200 bg-slate-50/70">
                                <div className="text-[8px] uppercase tracking-[0.18em] text-slate-400 mb-0.5">
                                  {k.lbl}
                                </div>
                                <div className="font-mono text-[12px] font-semibold text-slate-800 tabular-nums leading-none">
                                  {k.val}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {t.corridas.length > 0 ? (
                          <div className="divide-y divide-slate-100">
                            {t.corridas.map((c, ci) => {
                              const cAvail =
                                c.availability != null ? Math.round(c.availability * 100) : null
                              const cPerf =
                                c.performance != null ? Math.round(c.performance * 100) : null
                              const label = c.ordem_codigo ?? c.ordem_public_id ?? "—"
                              const ini = hhmm(c.clip_ini_utc)
                              const fim = c.clip_fim_utc ? hhmm(c.clip_fim_utc) : "—"

                              return (
                                <div
                                  key={c.corrida_id ?? ci}
                                  className="flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 transition-colors"
                                >
                                  <span
                                    className={cx(
                                      "shrink-0 w-1.5 h-1.5 rounded-full",
                                      c.em_curso ? "bg-emerald-500 animate-pulse" : "bg-slate-300",
                                    )}
                                  />

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="font-mono text-[11px] font-semibold text-slate-800 truncate">
                                        {label}
                                      </span>
                                      {c.em_curso && (
                                        <span className="text-[9px] text-emerald-600 font-semibold shrink-0">
                                          em curso
                                        </span>
                                      )}
                                    </div>

                                    <div className="font-mono text-[9px] text-slate-400 tabular-nums mt-0.5">
                                      {ini}
                                      <span className="mx-0.5 text-slate-300">→</span>
                                      {c.em_curso ? <span className="text-emerald-500">agora</span> : fim}
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0 w-14">
                                    <div className="font-mono text-[12px] font-semibold text-slate-900 tabular-nums leading-none">
                                      {formatNumber(c.total_good_clipped)}
                                    </div>
                                    <div className="text-[8px] text-slate-400 uppercase tracking-[0.14em]">
                                      pç
                                    </div>
                                  </div>

                                  <div className="shrink-0 w-20 text-right space-y-0.5">
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-[8px] text-slate-400 uppercase tracking-[0.12em]">
                                        Disp
                                      </span>
                                      <span
                                        className={cx(
                                          "font-mono text-[10px] font-semibold tabular-nums",
                                          cAvail == null
                                            ? "text-slate-400"
                                            : cAvail >= 80
                                              ? "text-emerald-700"
                                              : cAvail >= 50
                                                ? "text-amber-700"
                                                : "text-rose-700",
                                        )}
                                      >
                                        {cAvail != null ? `${cAvail}%` : "—"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-[8px] text-slate-400 uppercase tracking-[0.12em]">
                                        Perf
                                      </span>
                                      <span
                                        className={cx(
                                          "font-mono text-[10px] font-semibold tabular-nums",
                                          cPerf == null
                                            ? "text-slate-400"
                                            : cPerf >= 80
                                              ? "text-blue-700"
                                              : cPerf >= 50
                                                ? "text-amber-700"
                                                : "text-rose-700",
                                        )}
                                      >
                                        {cPerf != null ? `${cPerf}%` : "—"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (isPast || isActive) && (
                          <div className="px-3 py-4 text-center text-[10px] text-slate-400 bg-white">
                            Sem produção registrada neste turno
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 text-center py-6">
                  Sem dados de histórico disponíveis
                </div>
              )}
            </section>
          )}
        </div>

        {/* FOOTER */}
        <div
          className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3"
          style={footerStyle}
        >
          <div className="min-w-0 flex items-center gap-2">
            <span
              className="inline-block rounded-full shrink-0"
              style={{ width: "6px", height: "6px", background: footerDotColor }}
            />
            <span
              className="truncate"
              style={{ fontSize: "11px", fontWeight: 600, color: footerTextColor }}
            >
              {footerText}
            </span>

            {paradasTurnoQtd > 0 && (
              <div
                className="shrink-0 flex items-center gap-1.5 rounded-full px-2 py-1"
                style={{
                  background: stopped && !isSetup ? "#fee2e2" : isSetup ? "#ffedd5" : "#f1f5f9",
                  color: stopped && !isSetup ? "#991b1b" : isSetup ? "#92400e" : "#475569",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0 }}>
                  <rect x="1" y="1" width="10" height="10" rx="2" />
                </svg>
                <span className="font-mono tabular-nums text-[10px] font-semibold">
                  {paradasTurnoQtd} · {paradasTurnoHms}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => router.push(`/posto/${(station as any).id}`)}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors"
            style={{ background: statusColor }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Ver posto completo
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedStation, setSelectedStation] = useState<CentroTrabalhoCardVM | null>(null)
  const [selectedGrupo, setSelectedGrupo] = useState<number | "">("")
  const [statusFilter, setStatusFilter] = useState<"all" | "producing" | "stopped">("all")
  const [query, setQuery] = useState("")
  const [filtersLoaded, setFiltersLoaded] = useState(false)

  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const persisted = safeLoadFilters() as {
      viewMode?: unknown
      selectedGrupo?: unknown
      statusFilter?: unknown
      query?: unknown
    }

    if (persisted.viewMode === "grid" || persisted.viewMode === "list") setViewMode(persisted.viewMode)
    if (typeof persisted.selectedGrupo === "number" || persisted.selectedGrupo === "") setSelectedGrupo(persisted.selectedGrupo)
    if (persisted.statusFilter === "all" || persisted.statusFilter === "producing" || persisted.statusFilter === "stopped") setStatusFilter(persisted.statusFilter)
    if (typeof persisted.query === "string") setQuery(persisted.query)
    setFiltersLoaded(true)
  }, [])

  useEffect(() => {
    if (!filtersLoaded) return
    saveFilters({ viewMode, selectedGrupo, statusFilter, query })
  }, [filtersLoaded, viewMode, selectedGrupo, statusFilter, query])

  const centros = useCentrosTrabalhoCards()
  const grupos = useGrupos()
  const stats = useDashboardStatsFromCards()

  const loading = !!(centros.isLoading || grupos.isLoading)
  const error = centros.error || grupos.error
  const reconnecting = useIsReconnecting()

  const pageVisible = usePageVisibility()
  const liveEnabled = pageVisible

  useLivePoll(() => centros.mutate?.(), POLL_CARDS_MS, liveEnabled)
  useLivePoll(() => stats.mutate?.(), POLL_STATS_MS, liveEnabled)
  useLivePoll(() => grupos.mutate?.(), POLL_GRUPOS_MS, liveEnabled)

  useEffect(() => {
    const fn = () => { centros.mutate?.(); stats.mutate?.(); grupos.mutate?.() }
    window.addEventListener("focus", fn)
    window.addEventListener("online", fn)
    return () => { window.removeEventListener("focus", fn); window.removeEventListener("online", fn) }
  }, [centros.mutate, stats.mutate, grupos.mutate])

  const handleRefresh = useCallback(() => {
    centros.mutate?.(); grupos.mutate?.(); stats.mutate?.()
  }, [centros.mutate, grupos.mutate, stats.mutate])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") return
      if (e.key === "/" && !modalOpen) {
        ; (document.getElementById("mes-search") as HTMLInputElement | null)?.focus()
        e.preventDefault()
      }
      if (e.key.toLowerCase() === "g" && e.shiftKey) setViewMode("grid")
      if (e.key.toLowerCase() === "l" && e.shiftKey) setViewMode("list")
      if (e.key.toLowerCase() === "r" && e.shiftKey) handleRefresh()
    }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [modalOpen, handleRefresh])

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query])

  const filteredCentros = useMemo(() => {
    let list = centros.data || []
    if (selectedGrupo !== "") list = list.filter((c) => Number((c as any).grupo_id) === Number(selectedGrupo))
    if (statusFilter !== "all") list = list.filter((c) => (c as any).status === statusFilter)
    if (normalizedQuery) {
      list = list.filter((c) => {
        const blob = [(c as any).nome, (c as any).codigo, (c as any).headline, (c as any).grupo_nome, (c as any).produto_public_id, (c as any).produto_descricao]
          .filter(Boolean).join(" ").toLowerCase()
        return blob.includes(normalizedQuery)
      })
    }
    return list
  }, [centros.data, selectedGrupo, statusFilter, normalizedQuery])

  const openModal = useCallback((s: CentroTrabalhoCardVM) => {
    setSelectedStation(s)
    setModalOpen(true)
  }, [])

  const selectedSigRef = useRef("")
  useEffect(() => {
    if (!modalOpen || !selectedStation?.id) return
    const latest = (centros.data || []).find((s) => (s as any).id === (selectedStation as any).id)
    if (!latest) return
    const sig = stationSignature(latest)
    if (sig === selectedSigRef.current) return
    setSelectedStation((prev) =>
      !prev || (prev as any).id !== (latest as any).id ? latest : stationSignature(prev) === sig ? prev : latest,
    )
    selectedSigRef.current = sig
  }, [modalOpen, selectedStation?.id, centros.data])

  return (
    <>
      <style>{`
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/plus-jakarta-sans/plus-jakarta-sans-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/plus-jakarta-sans/plus-jakarta-sans-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/plus-jakarta-sans/plus-jakarta-sans-600.woff2') format('woff2'); font-weight: 600; font-style: normal; font-display: swap; }
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/plus-jakarta-sans/plus-jakarta-sans-700.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/plus-jakarta-sans/plus-jakarta-sans-800.woff2') format('woff2'); font-weight: 800; font-style: normal; font-display: swap; }
        @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/jetbrains-mono/jetbrains-mono-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
        @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/jetbrains-mono/jetbrains-mono-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
        @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/jetbrains-mono/jetbrains-mono-600.woff2') format('woff2'); font-weight: 600; font-style: normal; font-display: swap; }
        .mes-root { font-family: Geist, 'Plus Jakarta Sans', Inter, system-ui, sans-serif; }
        .mes-root .font-mono,
        .mes-root .tnum,
        .mes-root .tabular-nums { font-family: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace !important; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="mes-root min-h-screen flex" style={{ background: "#f0ede83a" }}>
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex-1 flex flex-col min-w-0">
          <Header onMenuClick={() => setSidebarOpen(true)} />

          <main className="flex-1 overflow-auto flex flex-col">
            <ManagerPanel stations={centros.data ?? []} stats={stats.data} liveEnabled={liveEnabled} />

            <div className="max-w-[1600px] 2xl:max-w-none mx-auto w-full px-4 sm:px-6 pt-5 pb-2">
              <h1 style={{ fontSize: "clamp(15px, 1.3vw, 30px)", fontWeight: 600, color: "#0f1117", letterSpacing: "-0.022em", lineHeight: 1.25 }}>Centros de Trabalho</h1>
              <p className="mt-0.5" style={{ fontSize: "11.5px", color: "#9aa3af", letterSpacing: "0.01em" }}>{stats.data?.produzindo ?? 0} produzindo · {stats.data?.parados ?? 0} parados · {stats.data?.total_centros ?? 0} postos</p>
            </div>

            <FilterBar
              query={query} setQuery={setQuery}
              filter={statusFilter} setFilter={(v) => setStatusFilter(v as "all" | "producing" | "stopped")}
              viewMode={viewMode} setViewMode={(v) => setViewMode(v as "grid" | "list")}
              count={filteredCentros.length}
              grupos={grupos.data || []} selectedGrupo={selectedGrupo} setSelectedGrupo={setSelectedGrupo}
              loading={loading} onRefresh={handleRefresh} liveEnabled={liveEnabled}
            />

            {/* COM dados carregados: nunca exibe erro vermelho fatal — mantém os
                cards visíveis e apenas sinaliza instabilidade (timeout/rede/poll
                falho). Mensagem em pt-BR, sem termos técnicos. */}
            {(centros.data?.length ?? 0) > 0 && (reconnecting || !!error) && (
              <div className="max-w-[1600px] 2xl:max-w-none mx-auto w-full px-4 sm:px-6 pt-3">
                <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  <p className="text-sm font-medium">Conexão instável. Mantendo os últimos dados enquanto tentamos reconectar.</p>
                </div>
              </div>
            )}
            {/* SEM nenhum dado carregado (cold start falhou): aviso claro em
                pt-BR. Vermelho só quando o erro é realmente fatal; instabilidade
                transitória (timeout/rede) usa o tom âmbar de "tentando". */}
            {(centros.data?.length ?? 0) === 0 && !!error && (
              <div className="max-w-[1600px] 2xl:max-w-none mx-auto w-full px-4 sm:px-6 pt-3">
                <div className={cx(
                  "flex items-center gap-3 rounded-xl border p-3.5",
                  isFatalApiError(error)
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-amber-200 bg-amber-50 text-amber-900",
                )}>
                  {isFatalApiError(error)
                    ? <AlertCircle className="w-4 h-4 shrink-0" />
                    : <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
                  <p className="text-sm font-medium">Não foi possível carregar os centros de trabalho agora. Tentaremos novamente automaticamente.</p>
                </div>
              </div>
            )}

            <div className="max-w-[1600px] 2xl:max-w-none mx-auto w-full px-4 sm:px-6 py-4 pb-12 flex-1">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  <span className="text-sm text-slate-600">Carregando postos…</span>
                </div>
              ) : filteredCentros.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4">
                    <SlidersHorizontal className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-base font-bold text-slate-900 mb-1">Nenhum posto encontrado</p>
                  <p className="text-sm text-slate-600">Ajuste os filtros ou refine a busca.</p>
                </div>
              ) : (
                <>
                  {viewMode === "grid" ? (
                    <div className="grid items-start" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "14px" }}>
                      {filteredCentros.map((s) => (
                        <StationCardCompact key={(s as any).id} station={s} onOpen={openModal} nowMs={nowMs} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {filteredCentros.map((s) => (
                        <StationCardList key={(s as any).id} station={s} onOpen={openModal} nowMs={nowMs} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </main>
        </div>

        <StationModal
          station={selectedStation} isOpen={modalOpen}
          onClose={() => setModalOpen(false)} nowMs={nowMs} liveEnabled={liveEnabled}
        />
      </div>
    </>
  )
}

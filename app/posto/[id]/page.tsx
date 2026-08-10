// app/posto/[id]/page.tsx
"use client"

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, RefreshCcw, Hand, Play,
  Plus, MoreVertical, AlertTriangle, ChevronRight,
  Timer, AlertCircle, Zap, BarChart3,
} from "lucide-react"

import {
  usePostoStationDetail,
  usePostoParadasPendentes,
  revalidatePostoApontadorHistorico,
  type ParadaTurnoRow,
  type UiPendingStop,
  type MotivoParadaRow,
} from "@/hooks/posto/use-api"
import { Tooltip } from "@/components/posto/charts"
import { ProductionModal, RefugoModal } from "@/components/posto/modals-production"
import { ParadaModal, PlayMenuModal } from "@/components/posto/modals-parada"
import TimelinePanel from "@/components/posto/timeline"
import { ChartType, TooltipData, fmtHHMMfromMinutes, pct } from "@/components/posto/utils"
import { InteractiveChart } from "@/components/posto/charts"
import OrdemPostoPanel from "@/components/posto/ordem"
import { RebarbadorModal } from "@/components/posto/modal-rebarbador"
import { ApontadorModal } from "@/components/posto/modal-apontador"

// ─── Types ───────────────────────────────────────────────────────────────────

type StartStopArgs = {
  motivo_id?: string | number | null
  observacao?: string | null
  event_time_utc?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0") }

function formatSecHHMMSS(totalSec: number): string {
  try {
    const s = Math.max(0, Math.floor(Number(totalSec) || 0))
    const hh = Math.floor(s / 3600)
    const mm = Math.floor((s % 3600) / 60)
    const ss = s % 60
    if (hh > 0) return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
    return `${pad2(mm)}:${pad2(ss)}`
  } catch { return "00:00" }
}

function formatWallClock(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function toDateSafe(isoOrTime?: string | null): Date | null {
  if (!isoOrTime) return null
  const raw = String(isoOrTime).trim()
  if (!raw) return null
  const d1 = new Date(raw)
  if (!Number.isNaN(d1.getTime())) return d1
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m) {
    const hh = Math.min(23, Math.max(0, Number(m[1])))
    const mm2 = Math.min(59, Math.max(0, Number(m[2])))
    const ss = m[3] ? Math.min(59, Math.max(0, Number(m[3]))) : 0
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm2, ss, 0)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function minutesBetween(a: Date, b: Date) { return Math.max(0, (b.getTime() - a.getTime()) / 60000) }
function clampDate(d: Date, min: Date, max: Date) {
  return new Date(Math.min(Math.max(d.getTime(), min.getTime()), max.getTime()))
}
function overlapMin(aS: Date, aE: Date, bS: Date, bE: Date) {
  return Math.max(0, (Math.min(aE.getTime(), bE.getTime()) - Math.max(aS.getTime(), bS.getTime())) / 60000)
}

function normalizeShift(start: Date, end: Date) {
  const s = new Date(start), e = new Date(end)
  if (e.getTime() <= s.getTime()) e.setTime(e.getTime() + 86400000)
  return { start: s, end: e }
}

function getParadaTimes(p: ParadaTurnoRow): { start: Date | null; end: Date | null } {
  const a = p as any
  return {
    start: toDateSafe(a?.inicio_utc ?? a?.inicioUtc ?? a?.inicio ?? a?.start_utc ?? a?.start ?? null),
    end: toDateSafe(a?.fim_utc ?? a?.fimUtc ?? a?.fim ?? a?.end_utc ?? a?.end ?? null),
  }
}

function paradaToUiPendingStop(p: ParadaTurnoRow, index: number, nowMs: number): UiPendingStop {
  const d = p.inicio_utc ? new Date(p.inicio_utc) : null
  const date = d
    ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
    : "--/--/----"
  const time = d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "--:--"

  let durSec = 0
  if (typeof p.duracao_seg === "number" && p.duracao_seg >= 0) {
    durSec = p.duracao_seg
    if (!p.fim_utc && d) {
      durSec = Math.max(0, Math.floor((nowMs - d.getTime()) / 1000))
    }
  } else if (p.fim_utc && p.inicio_utc) {
    const fim = new Date(p.fim_utc)
    const ini = new Date(p.inicio_utc)
    durSec = Math.max(0, Math.floor((fim.getTime() - ini.getTime()) / 1000))
  } else if (d) {
    durSec = Math.max(0, Math.floor((nowMs - d.getTime()) / 1000))
  }

  const hh = Math.floor(durSec / 3600)
  const mm = Math.floor((durSec % 3600) / 60)
  const ss = durSec % 60
  const duration = `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`

  return { date, time, duration, status: index === 0 ? "Atual" : null, row: p }
}

// ─── Force light theme ────────────────────────────────────────────────────────

function useForceLightTheme() {
  useLayoutEffect(() => {
    if (typeof document === "undefined") return
    const html = document.documentElement, body = document.body
    const apply = () => {
      html.classList.remove("dark", "theme-dark"); body.classList.remove("dark", "theme-dark")
      html.classList.add("light"); body.classList.add("light")
      html.dataset.theme = "light"; body.dataset.theme = "light"
      html.style.colorScheme = "light"; body.style.colorScheme = "light"
    }
    apply()
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)")
    try { mql?.addEventListener?.("change", apply) } catch { ; (mql as any)?.addListener?.(apply) }
    try {
      localStorage.setItem("theme", "light")
      localStorage.setItem("resolvedTheme", "light")
      localStorage.setItem("darkMode", "false")
    } catch { }
    const mo = new MutationObserver(() => {
      if (html.classList.contains("dark") || html.dataset.theme === "dark") apply()
    })
    mo.observe(html, { attributes: true, attributeFilter: ["class", "data-theme", "style"] })
    mo.observe(body, { attributes: true, attributeFilter: ["class", "data-theme", "style"] })
    return () => {
      try { mql?.removeEventListener?.("change", apply) } catch { ; (mql as any)?.removeListener?.(apply) }
      mo.disconnect()
    }
  }, [])
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const UI_FONT = "Geist, 'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const MONO    = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace"

const C_STOP  = "#dc2626"
const C_RUN   = "#059669"
const C_REWORK= "#d97706"
const C_CARD  = "#ffffff"
const C_BORDER= "#e4e8ed"
const C_BG    = "#f0f2f5"
const C_INK   = "#0f1117"
const C_MUTE  = "#64748b"
const C_SOFT  = "#94a3b8"
const C_FAINT = "#f8fafc"

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color, mono = false, variant,
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
  mono?: boolean
  variant?: "turno"
}) {
  const isTurno = variant === "turno"
  return (
    <div style={{
      background: C_CARD,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      height: "100%",
      boxSizing: "border-box",
    }}>
      <span style={{
        fontFamily: UI_FONT,
        fontSize: "12px",
        fontWeight: 700,
        textTransform: "uppercase" as const,
        letterSpacing: "0.16em",
        color: C_MUTE,
      }}>{label}</span>
      {isTurno ? (
        <span style={{
          fontFamily: UI_FONT,
          fontSize: "22px",
          fontWeight: 600,
          color: color ?? C_INK,
          lineHeight: 1.1,
          letterSpacing: "-0.015em",
        }}>{String(value)}</span>
      ) : (
        <span style={{
          fontFamily: MONO,
          fontSize: "34px",
          fontWeight: 700,
          color: color ?? C_INK,
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}>{String(value)}</span>
      )}
      {sub && (isTurno ? (
        <span style={{
          fontFamily: MONO,
          fontSize: "12px",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: C_SOFT,
          lineHeight: 1.2,
        }}>{sub}</span>
      ) : (
        <span style={{
          fontFamily: UI_FONT,
          fontSize: "12px",
          fontWeight: 400,
          color: C_MUTE,
          lineHeight: 1.2,
        }}>{sub}</span>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StationDetailPage() {
  useForceLightTheme()

  const router = useRouter()
  const params = useParams()
  const stationId = (params?.id as string) || null

  const [showProduction, setShowProduction] = useState(false)
  const [showRefugo, setShowRefugo] = useState(false)
  const [showParada, setShowParada] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showOrder, setShowOrder] = useState(false)
  const [showRebarbador, setShowRebarbador] = useState(false)
  const [showApontador, setShowApontador] = useState(false)
  const [showPlayMenu, setShowPlayMenu] = useState(false)
  const [paradaModalTab, setParadaModalTab] = useState<"apontar" | "pendentes" | "nova">("apontar")
  const [paradaModalPendenteId, setParadaModalPendenteId] = useState<string | number | null>(null)
  const [isBusyRetomar, setIsBusyRetomar] = useState(false)
  const [chartType, setChartType] = useState<ChartType>("producao")
  const [tooltip, setTooltip] = useState<TooltipData>(null)

  // 1s tick
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Main hook
  const posto = usePostoStationDetail({ stationId })
  const {
    stationHeader, stationName, statusText, isStopped, statusTime,
    ordemCodigo, produtoCodigo, produtoNome,
    metaCorrida, progressNow, progressMax, progressPercent,
    producedTurno, rejectedTurno,
    modoContagem, isRework,
    productionPoints, cyclePoints, lossBars,
    turnoNome, turnoInicioIso, turnoFimIso,
    oee, availability, performance, quality,
    isLoadingHeader, hasAnyError, refreshAll,
    paradasDoTurno, motivosParada, empresaId: postoEmpresaId,
    actions,
  } = posto

  const paradasPendentesHook = usePostoParadasPendentes({
    centroTrabalhoId: stationId,
    empresaId: postoEmpresaId || undefined,
  })

  const refreshAllComplete = useCallback(() => {
    refreshAll?.()
    paradasPendentesHook.mutate?.()
    revalidatePostoApontadorHistorico()
  }, [refreshAll, paradasPendentesHook])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAllComplete()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [refreshAllComplete])

  const allPendingStops = useMemo<UiPendingStop[]>(() => {
    const rows = (paradasPendentesHook.data || []) as ParadaTurnoRow[]
    if (!rows.length) return []
    return rows
      .slice()
      .sort((a, b) => {
        const ta = toDateSafe((a as any).inicio_utc)?.getTime() ?? 0
        const tb = toDateSafe((b as any).inicio_utc)?.getTime() ?? 0
        return tb - ta
      })
      .map((p, idx) => paradaToUiPendingStop(p, idx, nowTs))
  }, [paradasPendentesHook.data, nowTs])

  const pendingCount = allPendingStops.length

  const activeStopInfo = useMemo(() => {
    try {
      const stops = (paradasDoTurno || []) as any[]
      const active = stops
        .filter((p) => !p.fim_utc && p.inicio_utc)
        .sort((a, b) =>
          (toDateSafe(b.inicio_utc)?.getTime() || 0) -
          (toDateSafe(a.inicio_utc)?.getTime() || 0)
        )[0]
      if (!active) return null
      const isUnjustified = !active.motivo_id
      return {
        motivo:
          active.motivo_descricao ||
          (active.motivo_codigo ? `Código ${active.motivo_codigo}` : null) ||
          (isUnjustified ? "Parada não justificada" : "Motivo não informado"),
        isUnjustified,
        paradaId: active.parada_id,
      }
    } catch { return null }
  }, [paradasDoTurno])

  const liveElapsedSec = useMemo<number | null>(() => {
    try {
      const stops = (paradasDoTurno || []) as any[]
      if (isStopped) {
        const active = stops
          .filter((p) => !p.fim_utc && p.inicio_utc)
          .sort((a, b) =>
            (toDateSafe(b.inicio_utc)?.getTime() || 0) -
            (toDateSafe(a.inicio_utc)?.getTime() || 0)
          )[0]
        // Fallback: usa parada_inicio_utc do header (mesma fonte da view do dashboard)
        // em vez de turnoInicioIso (que daria tempo desde o início do turno, não da parada)
        const headerParadaInicio = (stationHeader as any)?.parada_inicio_utc
        const ref = toDateSafe(active?.inicio_utc) || toDateSafe(headerParadaInicio)
        return ref ? Math.max(0, Math.floor((nowTs - ref.getTime()) / 1000)) : null
      } else {
        const finished = stops
          .filter((p) => !!p.fim_utc)
          .sort((a, b) =>
            (toDateSafe(b.fim_utc)?.getTime() || 0) -
            (toDateSafe(a.fim_utc)?.getTime() || 0)
          )
        const ref = toDateSafe(finished[0]?.fim_utc) || toDateSafe(turnoInicioIso)
        return ref ? Math.max(0, Math.floor((nowTs - ref.getTime()) / 1000)) : null
      }
    } catch { return null }
  }, [nowTs, isStopped, paradasDoTurno, stationHeader, turnoInicioIso])

  const shiftBar = useMemo(() => {
    const empty = {
      hasShift: false as const,
      badgeLabel: "—",
      runMin: 0, stopMin: 0, remainingMin: 0,
      runPct: 0, stopPct: 0, remainingPct: 0,
      shiftTotalMin: 0,
    }
    try {
      const startRaw = toDateSafe(turnoInicioIso), endRaw = toDateSafe(turnoFimIso)
      if (!startRaw || !endRaw) return empty
      const { start, end } = normalizeShift(startRaw, endRaw)
      const totalMin = Math.max(1, Math.round(minutesBetween(start, end)))
      const nowC = clampDate(new Date(nowTs), start, end)
      const elapsed = Math.round(minutesBetween(start, nowC))
      let stopMin = 0
      for (const p of (paradasDoTurno || []) as ParadaTurnoRow[]) {
        const { start: ps, end: pe } = getParadaTimes(p)
        if (!ps) continue
        stopMin += overlapMin(start, nowC, ps, pe ?? nowC)
      }
      stopMin = Math.min(Math.max(0, Math.round(stopMin)), elapsed)
      const runMin = Math.max(0, elapsed - stopMin)
      const remainingMin = Math.max(0, totalMin - elapsed)
      return {
        hasShift: true as const,
        badgeLabel: fmtHHMMfromMinutes(totalMin),
        shiftTotalMin: totalMin, runMin, stopMin, remainingMin,
        runPct: pct((runMin / totalMin) * 100),
        stopPct: pct((stopMin / totalMin) * 100),
        remainingPct: pct((remainingMin / totalMin) * 100),
      }
    } catch { return empty }
  }, [nowTs, turnoInicioIso, turnoFimIso, paradasDoTurno])

  const handleRetomar = useCallback(async () => {
    if (!stationId || isBusyRetomar) return
    try {
      setIsBusyRetomar(true)
      const fn = (actions as any)?.retomarProducao
      if (typeof fn !== "function") throw new Error("actions.retomarProducao não disponível.")
      await fn()
      setShowPlayMenu(false)
      await refreshAllComplete()
    } catch (e: any) { alert(e?.message || "Falha ao retomar produção") }
    finally { setIsBusyRetomar(false) }
  }, [stationId, isBusyRetomar, actions, refreshAllComplete])

  const handleJustificarParada = useCallback(async (args: {
    parada_id: string | number
    motivo_id?: string | number | null
    justificativa_texto?: string | null
  }) => {
    const fn = (actions as any)?.justificarParada
    if (typeof fn !== "function") throw new Error("actions.justificarParada não disponível.")
    await fn({ ...args, motivo_id: args.motivo_id ?? null, justificativa_texto: args.justificativa_texto ?? null })
    await refreshAllComplete()
  }, [actions, refreshAllComplete])

  const handleIniciarNovaParada = useCallback(async (args: StartStopArgs) => {
    const fn = (actions as any)?.iniciarParada
    if (typeof fn !== "function") throw new Error("actions.iniciarParada não disponível.")
    const res = await fn({ motivo_id: args.motivo_id ?? null, observacao: args.observacao ?? null, event_time_utc: args.event_time_utc ?? null })
    await refreshAllComplete()
    return res
  }, [actions, refreshAllComplete])

  const handleTrocarOrdem = useCallback(async (ordemIdOrCodigo: string) => {
    try {
      const fn =
        (actions as any)?.trocarOrdem ??
        (actions as any)?.changeOrder ??
        (actions as any)?.setOrdemAtual ??
        (actions as any)?.selecionarOrdem
      if (typeof fn === "function") {
        await fn({ ordem_id: ordemIdOrCodigo, centro_trabalho_id: stationId })
        await refreshAllComplete()
        return true
      }
      return false
    } catch (e: any) { alert(e?.message || "Falha ao trocar ordem"); return false }
  }, [actions, refreshAllComplete, stationId])

  // Derived
  const progressNowNum = Number(progressNow || 0)
  const progressMaxNum = Math.max(1, Number(progressMax || 0))
  const progressPct    = pct(progressPercent)
  const headerTitle    = isLoadingHeader ? "Carregando..." : (stationName || "Centro de Trabalho")
  const timerDisplay   = liveElapsedSec != null ? formatSecHHMMSS(liveElapsedSec) : (statusTime || "--:--")
  const statusColor    = isStopped ? C_STOP : C_RUN

  const turnoRange = (() => {
    const s = toDateSafe(turnoInicioIso), e = toDateSafe(turnoFimIso)
    if (!s) return null
    const fmt = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    return e ? `${fmt(s)} → ${fmt(e)}` : fmt(s)
  })()

  const chartTabs: { key: ChartType; label: string }[] = [
    { key: "producao", label: "Produção" },
    { key: "ciclo",    label: "Ciclo" },
    { key: "oee",      label: "OEE" },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: C_BG, fontFamily: UI_FONT }}>

      {/* ══ HEADER — grafite ════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-30" style={{ background: "#0f1117", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="h-13 px-3 sm:px-4 flex items-center justify-between gap-3" style={{ height: 52 }}>

          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => router.back()}
              className="w-8 h-8 flex items-center justify-center transition-colors"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div
              className="w-7 h-7 flex items-center justify-center text-white flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.12)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.1em" }}
            >
              CT
            </div>

            <div className="min-w-0">
              <div className="truncate leading-none" style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff", letterSpacing: "-0.018em" }}>
                {headerTitle}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
                {ordemCodigo && <span>Ordem {ordemCodigo}</span>}
                {turnoNome && <><span style={{ color: "rgba(255,255,255,0.2)" }}>·</span><span>{turnoNome}</span></>}
                <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
                <span style={{ fontWeight: 700, color: statusColor }}>{isStopped ? "PARADO" : "PRODUZINDO"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span suppressHydrationWarning className="hidden sm:block" style={{ fontFamily: MONO, fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>
              {formatWallClock(nowTs)}
            </span>
            <button
              onClick={refreshAllComplete}
              className="flex items-center gap-1.5 px-2.5 transition-colors"
              style={{ height: 30, border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 600 }}
            >
              <RefreshCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ══ STATUS STRIP ════════════════════════════════════════════════════ */}
      <div
        className="sticky z-20 flex items-center gap-3 px-3 sm:px-4 flex-wrap"
        style={{
          top: 52,
          background: C_CARD,
          borderBottom: `1px solid ${C_BORDER}`,
          borderLeft: `3px solid ${statusColor}`,
          minHeight: 48,
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        {/* Status pill */}
        <span
          className="inline-flex items-center gap-1.5 flex-shrink-0"
          style={{
            background: statusColor,
            color: "#fff",
            fontSize: "10px",
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            padding: "4px 10px",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
          {isStopped ? "Parado" : "Produzindo"}
        </span>

        {/* Rework mode badge — abre o modal de Ordem, onde fica o controle
            do modo de contagem e das peças em retrabalho */}
        {isRework && (
          <button
            onClick={() => setShowOrder(true)}
            className="inline-flex items-center gap-1 flex-shrink-0"
            style={{ background: "#fffbeb", border: `1px solid ${C_REWORK}`, color: C_REWORK, fontSize: "10px", fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", padding: "3px 8px", cursor: "pointer" }}
            title="As peças apontadas neste posto contam como RETRABALHO — clique para ver/alterar as peças em retrabalho"
          >
            <RefreshCcw className="w-3 h-3" />
            Retrabalho
          </button>
        )}

        {/* Pending badge */}
        {pendingCount > 0 && (
          <span
            className="inline-flex items-center gap-1 flex-shrink-0"
            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c", fontSize: "10px", fontWeight: 700, padding: "3px 8px" }}
          >
            <AlertTriangle className="w-3 h-3" />
            {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
          </span>
        )}

        {/* Divider */}
        <span className="hidden sm:block w-px h-5 flex-shrink-0" style={{ background: C_BORDER }} />

        {/* Timer */}
        <div className="flex items-baseline gap-2 flex-shrink-0">
          <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: C_MUTE }}>
            {isStopped ? "Parado há" : "Produzindo há"}
          </span>
          <span style={{ fontFamily: MONO, fontSize: "22px", fontWeight: 800, color: statusColor, letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" }}>
            {timerDisplay}
          </span>
        </div>

        {/* Motivo */}
        {isStopped && (
          <>
            <span className="hidden sm:block w-px h-5 flex-shrink-0" style={{ background: C_BORDER }} />
            <div className="flex items-baseline gap-2 min-w-0 flex-1">
              <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: C_MUTE, flexShrink: 0 }}>Motivo</span>
              <span className="truncate" style={{ fontSize: "13px", fontWeight: 600, color: activeStopInfo?.isUnjustified ? C_STOP : C_INK }}>
                {activeStopInfo?.motivo || statusText || "—"}
              </span>
            </div>
          </>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <button
            onClick={() => setShowParada(true)}
            className="flex items-center gap-1.5 transition-colors"
            style={{
              background: isStopped ? C_STOP : C_FAINT,
              color: isStopped ? "#fff" : C_MUTE,
              border: `1px solid ${isStopped ? C_STOP : C_BORDER}`,
              fontSize: "11px",
              fontWeight: 700,
              padding: "6px 12px",
              letterSpacing: "0.06em",
            }}
          >
            <Hand className="w-3.5 h-3.5" />
            <span>Paradas</span>
          </button>
          <button
            onClick={() => setShowPlayMenu(true)}
            className="flex items-center gap-1.5 transition-colors"
            style={{
              background: isStopped ? C_RUN : C_FAINT,
              color: isStopped ? "#fff" : C_MUTE,
              border: `1px solid ${isStopped ? C_RUN : C_BORDER}`,
              fontSize: "11px",
              fontWeight: 700,
              padding: "6px 12px",
              letterSpacing: "0.06em",
            }}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Play</span>
          </button>
        </div>
      </div>

      {/* ══ MAIN ════════════════════════════════════════════════════════════ */}
      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-3 sm:px-4 pt-3 pb-28 space-y-3">

        {hasAnyError && (
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm" style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Falha ao carregar dados. Verifique a API.
          </div>
        )}

        {/* ── ORDEM + KPI GRID ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">

          {/* Left: Ordem card */}
          <div className="lg:col-span-3" style={{ background: C_CARD, border: `1px solid ${C_BORDER}` }}>
            {/* Accent top line */}
            <div style={{ height: 2, background: C_INK }} />

            {/* Header label */}
            <div className="px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${C_BORDER}` }}>
              <div style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: C_MUTE }}>Ordem</div>
            </div>

            {/* Content */}
            <div className="px-4 py-3 space-y-3">
              {/* Ordem + Produto */}
              <div>
                <button onClick={() => setShowOrder(true)} className="flex items-baseline gap-3 w-full text-left group">
                  <span style={{ fontFamily: MONO, fontSize: "26px", fontWeight: 700, color: C_INK, letterSpacing: "-0.02em" }}>
                    {ordemCodigo || "--"}
                  </span>
                  {produtoCodigo && (
                    <span style={{ fontSize: "12px", color: C_MUTE, fontWeight: 500 }}>
                      {produtoCodigo}{produtoNome ? ` — ${produtoNome}` : ""}
                    </span>
                  )}
                </button>
              </div>

              {/* REBARBADOR + APONTADOR + UN inline */}
              <div className="flex items-center gap-4 flex-wrap">
                <button onClick={() => setShowRebarbador(true)} className="text-left group" title="Atribuir rebarbador">
                  <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>Rebarbador</div>
                  {stationHeader?.rebarbador?.nome ? (
                    <div
                      className="group-hover:underline"
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: C_INK,
                        marginTop: 2,
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {stationHeader.rebarbador.nome}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "#2563eb",
                        textDecoration: "underline",
                        textUnderlineOffset: "3px",
                        cursor: "pointer",
                        marginTop: 2,
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Indefinido
                    </div>
                  )}
                </button>
                <div style={{ width: 1, height: 28, background: C_BORDER }} />
                <button onClick={() => setShowApontador(true)} className="text-left group" title="Atribuir apontador">
                  <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>Apontador</div>
                  {stationHeader?.apontador?.nome ? (
                    <div
                      className="group-hover:underline"
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: C_INK,
                        marginTop: 2,
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {stationHeader.apontador.nome}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "#2563eb",
                        textDecoration: "underline",
                        textUnderlineOffset: "3px",
                        cursor: "pointer",
                        marginTop: 2,
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Indefinido
                    </div>
                  )}
                </button>
                <div style={{ width: 1, height: 28, background: C_BORDER }} />
                <div>
                  <div style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>UN</div>
                  <div style={{ fontFamily: MONO, fontSize: "18px", fontWeight: 700, color: C_INK, marginTop: 2 }}>1,00</div>
                </div>
              </div>

              {/* Modo de contagem (peça boa vs retrabalho): o controle vive no
                  modal de Ordem — abra pela OP acima. Aqui fica só o badge de
                  estado no topo da tela. */}

              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  {/* A barra acompanha o programa da PEÇA (acumulado de todos os
                      postos), por isso o denominador é a meta do programa e não
                      a meta da corrida — que é uma escala muito menor. */}
                  <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>Programa da peça</span>
                  <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 700, color: C_INK }}>
                    {progressNowNum.toLocaleString("pt-BR")} / {progressMaxNum.toLocaleString("pt-BR")}
                  </span>
                </div>
                <div style={{ height: 6, background: "#edf0f4", position: "relative" }}>
                  <div style={{
                    position: "absolute", inset: "0 auto 0 0",
                    width: `${Math.min(100, progressPct)}%`,
                    background: progressPct > 100 ? C_RUN : C_INK,
                    transition: "width 0.7s ease",
                  }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span style={{ fontFamily: MONO, fontSize: "10px", color: C_MUTE }}>0</span>
                  <span style={{ fontFamily: MONO, fontSize: "10px", color: C_MUTE }}>
                    {progressMaxNum.toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: 2×2 KPI grid */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-0" style={{ border: `1px solid ${C_BORDER}` }}>
            <KpiCard
              label="Produzido"
              value={Number(producedTurno || 0).toLocaleString("pt-BR")}
              sub="peças no turno"
              color={C_RUN}
              mono
            />
            <div style={{ borderLeft: `1px solid ${C_BORDER}`, height: "100%" }}>
              <KpiCard
                label="Retrabalho"
                value={Number(rejectedTurno || 0).toLocaleString("pt-BR")}
                sub=" Qtd peças de retrabalho"
                color={C_STOP}
                mono
              />
            </div>
            <div style={{ borderTop: `1px solid ${C_BORDER}`, height: "100%" }}>
              <KpiCard
                label="Turno"
                value={turnoNome || "—"}
                sub={turnoRange || undefined}
                color={C_INK}
                variant="turno"
              />
            </div>
            <div style={{ borderTop: `1px solid ${C_BORDER}`, borderLeft: `1px solid ${C_BORDER}`, height: "100%" }}>
              <KpiCard
                label="OEE"
                value={oee != null ? `${Number(oee).toFixed(1)}%` : "—"}
                sub="global do turno"
                color="#000000"
                mono
              />
            </div>
          </div>
        </div>

        {/* ── CHART ───────────────────────────────────────────────────────── */}
        <div style={{ background: C_CARD, border: `1px solid ${C_BORDER}` }}>
          {/* Header */}
          <div
            className="flex items-center justify-between flex-wrap gap-2 px-4 py-3"
            style={{ borderBottom: `1px solid ${C_BORDER}` }}
          >
            <div className="flex items-center gap-2.5">
              <div style={{ width: 2, height: 16, background: C_INK }} />
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>Gráfico</span>
              <span style={{ fontSize: "13px", fontWeight: 700, color: C_INK }}>
                {chartType === "producao" ? "Produção por Hora" : chartType === "ciclo" ? "Tempo de Ciclo" : "Indicadores OEE — Perdas"}
              </span>
            </div>

            {/* Tab switcher */}
            <div className="flex" style={{ border: `1px solid ${C_BORDER}` }}>
              {chartTabs.map((tab, i) => (
                <button
                  key={tab.key}
                  onClick={() => setChartType(tab.key)}
                  style={{
                    padding: "5px 12px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    background: chartType === tab.key ? C_INK : C_FAINT,
                    color: chartType === tab.key ? "#fff" : C_MUTE,
                    borderLeft: i > 0 ? `1px solid ${C_BORDER}` : "none",
                    textTransform: "uppercase",
                  }}
                >
                  <span className="sm:hidden">{tab.key[0].toUpperCase()}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-[270px] lg:h-[330px] p-2">
            <InteractiveChart
              chartType={chartType}
              onTooltip={setTooltip}
              stationHeader={stationHeader}
              productionPoints={productionPoints || []}
              cyclePoints={cyclePoints || []}
              lossBars={lossBars || []}
            />
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderTop: `1px solid ${C_BORDER}` }}>
            {(chartType !== "oee"
              ? [
                { label: "Qtd. Peça", val: `${Math.round(progressNowNum / 1000)}K / ${Math.max(1, Math.round(progressMaxNum / 1000))}K`, color: C_INK },
                { label: "Prod. Turno", val: String(Number(producedTurno || 0)), color: C_RUN },
                { label: "Retrabalho", val: String(Number(rejectedTurno || 0)), color: C_STOP },
                { label: "Ciclo Ideal", val: stationHeader?.produto_ciclo_ideal_seg ? `${stationHeader.produto_ciclo_ideal_seg}s` : "—", color: C_INK },
              ]
              : [
                { label: "OEE",            val: oee          != null ? `${Number(oee).toFixed(1)}%`          : "—", color: C_INK },
                { label: "Disponibilidade",val: availability != null ? `${Number(availability).toFixed(1)}%` : "—", color: C_INK },
                { label: "Performance",    val: performance  != null ? `${Number(performance).toFixed(1)}%`  : "—", color: C_INK },
                { label: "Qualidade",      val: quality      != null ? `${Number(quality).toFixed(1)}%`      : "—", color: C_RUN },
              ]
            ).map(({ label, val, color }, i) => (
              <div
                key={label}
                className="px-3 sm:px-5 py-4"
                style={{ borderRight: i < 3 ? `1px solid ${C_BORDER}` : "none" }}
              >
                <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C_MUTE, marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontFamily: MONO, fontSize: "28px", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {val}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── TIMELINE STRIP ──────────────────────────────────────────────── */}
        <button
          onClick={() => setShowTimeline(true)}
          className="w-full text-left transition-colors"
          style={{ background: C_CARD, border: `1px solid ${C_BORDER}` }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C_BORDER}` }}>
            <div className="flex items-center gap-2.5">
              <div style={{ width: 2, height: 16, background: C_INK }} />
              <div>
                <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>Timeline</div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: C_INK }}>Tempo do Turno</div>
              </div>
              <span style={{ fontSize: "10px", color: C_MUTE }}>— toque para ver detalhes das paradas</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 700, color: C_MUTE, background: C_FAINT, border: `1px solid ${C_BORDER}`, padding: "3px 8px" }}>
                {shiftBar.badgeLabel}
              </span>
              <ChevronRight className="w-4 h-4" style={{ color: C_MUTE }} />
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-4 py-2">
            <div className="flex overflow-hidden" style={{ height: 28 }}>
              {shiftBar.stopPct > 0 && (
                <div
                  className="relative overflow-hidden flex items-center justify-center text-white tabular-nums transition-all duration-1000"
                  style={{ width: `${shiftBar.stopPct}%`, background: "#991b1b", fontSize: "10px", fontWeight: 800 }}
                >
                  {shiftBar.stopPct > 9 && `${Math.round(shiftBar.stopPct)}%`}
                  <span className="tl-shimmer" />
                </div>
              )}
              {shiftBar.runPct > 0 && (
                <div
                  className="relative overflow-hidden flex items-center justify-center text-white tabular-nums transition-all duration-1000"
                  style={{ width: `${shiftBar.runPct}%`, background: "#065f46", fontSize: "10px", fontWeight: 800 }}
                >
                  {shiftBar.runPct > 9 && `${Math.round(shiftBar.runPct)}%`}
                  <span className="tl-shimmer" />
                </div>
              )}
              {shiftBar.remainingPct > 0 && (
                <div
                  className="flex items-center justify-center tabular-nums transition-all duration-1000"
                  style={{ width: `${shiftBar.remainingPct}%`, background: "#e4e8ed", fontSize: "10px", fontWeight: 700, color: C_MUTE }}
                >
                  {shiftBar.remainingPct > 12 && `${Math.round(shiftBar.remainingPct)}%`}
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3" style={{ borderTop: `1px solid ${C_BORDER}` }}>
            {[
              { dot: "#991b1b", label: "Paradas",  min: shiftBar.stopMin },
              { dot: "#065f46", label: "Produção", min: shiftBar.runMin },
              { dot: "#94a3b8", label: "Restante", min: shiftBar.remainingMin },
            ].map(({ dot, label, min }, i) => (
              <div
                key={label}
                className="flex items-center gap-2 px-2 sm:px-4 py-3"
                style={{ borderRight: i < 2 ? `1px solid ${C_BORDER}` : "none" }}
              >
                <span className="w-2 h-2 flex-shrink-0" style={{ background: dot }} />
                <div>
                  <div style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: C_MUTE }}>{label}</div>
                  <div style={{ fontFamily: MONO, fontSize: "20px", fontWeight: 700, color: C_INK, fontVariantNumeric: "tabular-nums" }}>
                    {fmtHHMMfromMinutes(min)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </button>

      </main>

      {/* ══ BOTTOM DOCK ═════════════════════════════════════════════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <div
          className="px-4 py-2"
          style={{
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(16px)",
            borderTop: `1px solid ${C_BORDER}`,
            boxShadow: "0 -2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <div className="mx-auto max-w-md flex items-center justify-around">
            {[
              { icon: Plus,        label: "Prod.",  color: "#334155", fn: () => setShowProduction(true) },
              { icon: RefreshCcw,  label: "Retrabalho", color: "#334155", fn: () => setShowRefugo(true) },
              { icon: Hand,        label: "Parada", color: "#334155", fn: () => setShowParada(true), badge: pendingCount },
              { icon: Play,        label: "Play",   color: "#334155", fn: () => setShowPlayMenu(true) },
              { icon: MoreVertical,label: "Ordens", color: "#334155", fn: () => setShowOrder(true) },
            ].map(({ icon: Icon, label, color, fn, badge }) => (
              <button
                key={label}
                onClick={fn}
                className="relative flex flex-col items-center justify-center w-12 h-14 active:scale-95 transition-all"
              >
                <Icon className="w-5 h-5" style={{ color }} />
                <span className="mt-0.5" style={{ fontSize: "10px", fontWeight: 700, color: C_MUTE }}>{label}</span>
                {badge != null && badge > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white"
                    style={{ background: C_STOP, minWidth: 18, height: 18, padding: "0 3px", fontSize: "9px", fontWeight: 800 }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ══ TOOLTIP + MODALS ════════════════════════════════════════════════ */}
      <Tooltip data={tooltip} />

      <ProductionModal
        isOpen={showProduction}
        onClose={() => setShowProduction(false)}
        stationId={stationId}
        stationName={stationName || "CT"}
      />

      <RefugoModal
        isOpen={showRefugo}
        onClose={() => setShowRefugo(false)}
        stationName={stationName || "CT"}
      />

      <ParadaModal
        isOpen={showParada}
        onClose={() => {
          setShowParada(false)
          setParadaModalTab("apontar")
          setParadaModalPendenteId(null)
        }}
        stationName={stationName || "CT"}
        pendingStops={allPendingStops}
        onJustificar={handleJustificarParada}
        onIniciarNovaParada={handleIniciarNovaParada}
        initialTab={paradaModalTab}
        initialPendenteId={paradaModalPendenteId}
        stopReasons={motivosParada || null}
        empresaId={postoEmpresaId || null}
        onRefreshMotivos={() => refreshAll?.()}
      />

      <PlayMenuModal
        isOpen={showPlayMenu}
        onClose={() => setShowPlayMenu(false)}
        stationName={stationName || "CT"}
        isStopped={!!isStopped}
        onRetomar={handleRetomar}
        isBusy={isBusyRetomar}
      />

      <TimelinePanel
        isOpen={showTimeline}
        onClose={() => setShowTimeline(false)}
        stationName={stationName || "CT"}
        centroTrabalhoId={stationId}
        empresaId={postoEmpresaId || null}
        initialFromIsoUtc={turnoInicioIso || null}
        initialToIsoUtc={turnoFimIso || null}
        paradas={(paradasDoTurno || []) as ParadaTurnoRow[]}
        produced={Number(producedTurno || 0)}
        rejected={Number(rejectedTurno || 0)}
        ordemCodigo={ordemCodigo || "--"}
        produtoCodigo={produtoCodigo || "--"}
        produtoNome={produtoNome || "--"}
        onParadaUpdated={refreshAllComplete}
      />

      <OrdemPostoPanel
        isOpen={showOrder}
        onClose={() => setShowOrder(false)}
        centroTrabalhoId={stationId || ""}
        centroTrabalhoNome={stationName || headerTitle || "CT"}
        ordemAtualCodigo={ordemCodigo || null}
        produtoAtualCodigo={produtoCodigo || null}
        produtoAtualNome={produtoNome || null}
        produtoAtualId={(stationHeader as any)?.produto_atual_id ?? null}
        progressNow={Number(progressNow || 0)}
        progressMax={Number(progressMax || 0)}
        isStopped={!!isStopped}
        modoContagem={modoContagem}
        empresaId={postoEmpresaId || null}
        onTrocarOrdemPreferHook={handleTrocarOrdem}
        onAfterMutation={async () => { await refreshAllComplete() }}
      />

      <RebarbadorModal
        isOpen={showRebarbador}
        onClose={() => setShowRebarbador(false)}
        centroTrabalhoId={stationId || ""}
        stationName={stationName || "CT"}
        empresaId={postoEmpresaId || null}
        assigned={stationHeader?.rebarbador ?? null}
        onChanged={() => { refreshAllComplete() }}
      />

      <ApontadorModal
        isOpen={showApontador}
        onClose={() => setShowApontador(false)}
        centroTrabalhoId={stationId || ""}
        stationName={stationName || "CT"}
        empresaId={postoEmpresaId || null}
        assigned={stationHeader?.apontador ?? null}
        onChanged={() => { refreshAllComplete() }}
      />
    </div>
  )
}

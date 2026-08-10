"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import {
    ArrowUp, Filter, X, ChevronDown, ChevronUp,
    AlertCircle, CheckCircle2, Clock, ArrowRightLeft,
    PackageCheck, Calendar, Activity, Zap, Timer,
    FileCheck, TrendingDown, Sun, Sunset, Moon, Factory,
    Square, CheckSquare, Loader2, Pencil, Search, ListChecks,
    User,
} from "lucide-react"

import type { ParadaTurnoRow, OeePorPeriodoRow, MotivoParadaRow, ApontadorLogRow } from "@/hooks/posto/use-api"
import {
    useDashboardParadasDoTurno, useDashboardOeePorPeriodo, usePostoMotivosParada,
    postoJustificarParada, postoEditarParadaMotivo, postoJustificarParadasEmMassa,
    getUsuarioIdFallback, usePostoApontadorHistorico,
} from "@/hooks/posto/use-api"
import { isoToDate } from "./utils"

// ─── Design tokens ────────────────────────────────────────────────────────────

const UI  = "Geist, 'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace"
// #0f1117 blended through rgba(0,0,0,0.45) overlay ≈ #08090d — matches posto header visually
const C_HEADER = "#08090d"
const C_BG     = "#ffffff"
const C_FAINT  = "#f8fafc"
const C_BASE   = "#f0f2f5"
const C_BORDER = "#e4e8ed"
const C_INK    = "#0f1117"
const C_MUTE   = "#64748b"
const C_SOFT   = "#94a3b8"
const C_STOP   = "#dc2626"
const C_RUN    = "#059669"
const C_PLAN   = "#d97706"

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
    isOpen: boolean
    onClose: () => void
    stationName: string
    centroTrabalhoId: string | null | undefined
    empresaId?: string | null | undefined
    initialFromIsoUtc?: string | null
    initialToIsoUtc?: string | null
    paradas?: ParadaTurnoRow[] | null
    produced?: number
    rejected?: number
    ordemCodigo?: string
    produtoCodigo?: string
    produtoNome?: string
    /** chamado após justificar/editar/justificar em massa com sucesso, para o pai também atualizar suas próprias views (status strip, badges etc.) */
    onParadaUpdated?: () => void
    refreshToken?: number
}

type Segment = {
    key: string
    turnoId: string | null
    turnoNome: string
    ordemId: string | null
    ordemCodigo: string | null
    inicioMs: number
    fimMs: number
    inicioIso: string
    fimIso: string | null
    produced: number
    scrap: number
    rework: number
    rejected: number
    runSeg: number
    totalSeg: number
    stops: ParadaTurnoRow[]
    stoppedSeg: number
    plannedSeg: number
    producingSeg: number
}

type TurnoGroup = {
    turnoId: string | null
    turnoNome: string
    inicioMs: number
    fimMs: number
    totalProduced: number
    totalRejected: number
    segments: Segment[]
}

type DayGroup = {
    dayKey: string
    dayDate: Date | null
    totalProduced: number
    totalRejected: number
    turnoGroups: TurnoGroup[]
}

type OrderSummary = {
    ordemCodigo: string | null
    totalProduced: number
    totalScrap: number
    totalRework: number
    producingSeg: number
    stoppedSeg: number
    plannedSeg: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0") }

function safeNum(v: unknown, fallback = 0): number {
    const n = typeof v === "string" ? Number(v) : (v as number)
    return Number.isFinite(n) ? n : fallback
}

function clampInt(v: number) { return !Number.isFinite(v) ? 0 : Math.max(0, Math.floor(v)) }

function toLocalYmd(d: Date) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toLocalHm(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

function fmtShortDate(d: Date) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}` }

function fmtHHMM(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

function fmtQty(v: unknown) {
    const n = safeNum(v, 0)
    if (n === 0) return "0"
    return n % 1 === 0 ? String(n) : n.toFixed(2).replace(".", ",")
}

function formatHMS(sec: number) {
    const s = Math.max(0, Math.floor(sec))
    const hh = Math.floor(s / 3600)
    const mm = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return hh > 0 ? `${pad2(hh)}h${pad2(mm)}m` : `${pad2(mm)}m${pad2(ss)}s`
}

function formatHHMMSS(totalSec: number) {
    const s = Math.max(0, Math.floor(totalSec))
    const hh = Math.floor(s / 3600)
    const mm = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`
}

function getOpDay(d: Date) {
    const copy = new Date(d.getTime())
    copy.setHours(copy.getHours() - 6)
    return copy
}

function localDayKeyFromIsoUtc(isoUtc?: string | null) {
    const d = isoToDate(isoUtc)
    if (!d) return "----/--/--"
    const opDay = getOpDay(d)
    return `${opDay.getFullYear()}-${pad2(opDay.getMonth() + 1)}-${pad2(opDay.getDate())}`
}

function ymdFromIsoUtc(isoUtc?: string | null): string | null {
    const d = isoToDate(isoUtc)
    if (!d) return null
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function isExcludedPlannedStop(row: ParadaTurnoRow) {
    const txt = `${row.motivo_descricao || ""} ${row.motivo_codigo || ""} ${row.grupo_perda || ""}`.toLowerCase()
    const needles = ["troca de turno","troca turno","almoço","almoco","intervalo","refeição","refeicao","jantar","café","cafe","break","pausa","descanso"]
    return needles.some(k => txt.includes(k))
}

function pct(seg: number, total: number) {
    if (!total) return 0
    return Math.max(0, Math.min(100, (seg / total) * 100))
}

function getShiftAnchorStartLocal(now: Date) {
    const hm = now.getHours() * 60 + now.getMinutes()
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
    if (hm >= 360 && hm < 735)  return new Date(y, m, d, 6, 0, 0, 0)
    if (hm >= 735 && hm < 1290) return new Date(y, m, d, 12, 15, 0, 0)
    if (hm >= 1290)              return new Date(y, m, d, 21, 30, 0, 0)
    return new Date(y, m, d - 1, 21, 30, 0, 0)
}

function localDateTimeToUtcIso(dateYmd: string, timeHm: string) {
    const isoLike = `${dateYmd}T${timeHm.length === 5 ? `${timeHm}:00` : timeHm}`
    const d = new Date(isoLike)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function isOrderChange(older: Segment, newer: Segment): boolean {
    if (!newer.ordemCodigo) return false
    if (older.ordemCodigo && older.ordemCodigo === newer.ordemCodigo) return false
    if (!older.ordemCodigo) return false
    return true
}

function getShiftInfo(d: Date) {
    const hm = d.getHours() * 60 + d.getMinutes()
    if (hm >= 360 && hm < 735)  return { nome: "Manhã" }
    if (hm >= 735 && hm < 1290) return { nome: "Tarde" }
    return { nome: "Noite" }
}

function getNextShiftBoundary(d: Date): number {
    const y = d.getFullYear(), m = d.getMonth(), dt = d.getDate()
    const hm = d.getHours() * 60 + d.getMinutes()
    if (hm < 360)  return new Date(y, m, dt, 6, 0, 0, 0).getTime()
    if (hm < 735)  return new Date(y, m, dt, 12, 15, 0, 0).getTime()
    if (hm < 1290) return new Date(y, m, dt, 21, 30, 0, 0).getTime()
    return new Date(y, m, dt + 1, 6, 0, 0, 0).getTime()
}

function getShiftIcon(turnoNome: string) {
    const n = turnoNome.toLowerCase()
    if (n.includes("manhã") || n.includes("manha")) return Sun
    if (n.includes("tarde"))                          return Sunset
    if (n.includes("noite"))                          return Moon
    return Clock
}

function makeSyntheticGapSegment(startMs: number, endMs: number, refSeg: Segment | null): Segment {
    const safeEnd = Math.min(endMs, Date.now())
    return {
        key: `synthetic_gap_${startMs}_${safeEnd}`,
        turnoId: null,
        turnoNome: getShiftInfo(new Date(startMs)).nome,
        ordemId: refSeg?.ordemId ?? null,
        ordemCodigo: refSeg?.ordemCodigo ?? null,
        inicioMs: startMs,
        fimMs: safeEnd,
        inicioIso: new Date(startMs).toISOString(),
        fimIso: new Date(safeEnd).toISOString(),
        produced: 0, scrap: 0, rework: 0, rejected: 0,
        runSeg: 0,
        totalSeg: Math.max(0, Math.floor((safeEnd - startMs) / 1000)),
        stops: [], stoppedSeg: 0, plannedSeg: 0, producingSeg: 0,
    }
}

// ─── Visual sub-components ────────────────────────────────────────────────────

function TimeBar({ totalSeg, producingSeg, stoppedSeg, plannedSeg }: {
    totalSeg: number; producingSeg: number; stoppedSeg: number; plannedSeg: number
}) {
    const denom = Math.max(totalSeg, producingSeg + stoppedSeg + plannedSeg, 1)
    const p1 = pct(producingSeg, denom)
    const p2 = pct(stoppedSeg, denom)
    const p3 = pct(plannedSeg, denom)

    return (
        <div>
            <div style={{ height: 4, background: C_BORDER, display: "flex", overflow: "hidden" }}>
                <div style={{ width: `${p1}%`, background: C_RUN,  height: "100%", transition: "width 0.5s" }} />
                <div style={{ width: `${p2}%`, background: C_STOP, height: "100%", transition: "width 0.5s" }} />
                <div style={{ width: `${p3}%`, background: C_PLAN, height: "100%", transition: "width 0.5s" }} />
            </div>
            {/* Legend row below the bar */}
            <div style={{ display: "flex", gap: 14, padding: "6px 14px", flexWrap: "wrap" as const }}>
                {[
                    { color: C_RUN,  label: "Produzindo", val: producingSeg },
                    { color: C_STOP, label: "Parado",     val: stoppedSeg },
                    { color: C_PLAN, label: "Programada", val: plannedSeg },
                ].filter(x => x.val > 0).map(({ color, label, val }) => (
                    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, background: color, display: "block", flexShrink: 0 }} />
                        <span style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE }}>{label}</span>
                        <span style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 600, color: C_INK }}>{formatHMS(val)}</span>
                    </span>
                ))}
            </div>
        </div>
    )
}

// ─── StopCard ─────────────────────────────────────────────────────────────────

const MOTIVO_AJUSTE_PENDENTE_ID = "F578E15D-A7AA-4A93-BA22-232D9E19B6A3"

function isMotivoEdited(p: ParadaTurnoRow): boolean {
    if (!p.is_justificada || !p.updated_at || !p.justificativa_time_utc) return false
    const updated = isoToDate(p.updated_at)?.getTime()
    const justified = isoToDate(p.justificativa_time_utc)?.getTime()
    if (!updated || !justified) return false
    return updated - justified > 1000
}

function StopCard({ p, selecting, selected, onToggleSelect, onOpenJustify, onOpenEdit }: {
    p: ParadaTurnoRow
    selecting?: boolean
    selected?: boolean
    onToggleSelect?: (parada: ParadaTurnoRow) => void
    onOpenJustify?: (parada: ParadaTurnoRow) => void
    onOpenEdit?: (parada: ParadaTurnoRow) => void
}) {
    const [open, setOpen] = useState(false)
    const [now, setNow] = useState(() => Date.now())

    const dIni = isoToDate(p.inicio_utc)
    const dFim = isoToDate(p.fim_utc || null)
    const active = !dFim

    useEffect(() => {
        if (!active) return
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [active])

    const durSec = p.duracao_seg != null && !active
        ? p.duracao_seg
        : (active && dIni ? (now - dIni.getTime()) / 1000 : (p.duracao_seg ?? 0))

    const isAjustePendente = String(p.motivo_id || "").toUpperCase() === MOTIVO_AJUSTE_PENDENTE_ID.toUpperCase()
        || p.motivo_codigo === "AJUSTE_PENDENTE"

    const title = p.motivo_descricao || (p.motivo_codigo ? `Motivo ${p.motivo_codigo}` : "Sem motivo registrado")

    const isJustificada = !!p.is_justificada
    const needsJustify  = (p.motivo_id == null) || (!!p.exige_justificativa && !isJustificada)
    const planned       = !!p.is_planejada
    const excluded      = planned && isExcludedPlannedStop(p)
    const edited        = isMotivoEdited(p)
    const editedAt      = edited ? isoToDate(p.updated_at) : null
    const hasDetails    = !!(p.justificativa_texto || p.grupo_perda || p.motivo_codigo || edited)
    const canSelect     = !!selecting && needsJustify
    const canEditMotivo = isJustificada && !isAjustePendente

    let accentColor = C_SOFT
    if (needsJustify || active)    accentColor = C_STOP
    else if (planned && !excluded) accentColor = C_PLAN
    else if (isJustificada)        accentColor = C_RUN

    const startStr = dIni ? fmtHHMM(dIni) : "--:--"
    const endStr   = active ? null : (dFim ? fmtHHMM(dFim) : "--:--")

    // Status tag: text only (no background pill)
    let statusLabel = ""
    let statusColor = C_SOFT
    if (needsJustify)              { statusLabel = "Pendente";    statusColor = C_STOP }
    else if (isJustificada)        { statusLabel = "Justificada"; statusColor = C_RUN  }
    else if (planned && !excluded) { statusLabel = "Programada";  statusColor = C_PLAN }
    else if (excluded)             { statusLabel = "Programada";  statusColor = C_SOFT }

    return (
        <div style={{
            borderLeft: `3px solid ${accentColor}`,
            background: selected ? "rgba(15,17,23,0.03)" : C_BG,
            borderBottom: `1px solid ${C_BORDER}`,
        }}>
            <div
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px 12px 13px", cursor: hasDetails ? "pointer" : "default" }}
                onClick={() => hasDetails && setOpen(v => !v)}
            >
                {/* Bulk-select checkbox */}
                {canSelect && (
                    <button
                        onClick={e => { e.stopPropagation(); onToggleSelect?.(p) }}
                        aria-label={selected ? "Desmarcar parada" : "Selecionar parada"}
                        style={{ background: "none", border: "none", padding: 0, marginTop: 1, cursor: "pointer", color: selected ? C_INK : C_SOFT, flexShrink: 0, display: "flex" }}
                    >
                        {selected ? <CheckSquare style={{ width: 16, height: 16 }} /> : <Square style={{ width: 16, height: 16 }} />}
                    </button>
                )}

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Meta row: time + duration + status */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" as const }}>
                        <span style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 500, color: C_MUTE }}>
                            {startStr}{endStr ? ` → ${endStr}` : ""}
                        </span>
                        {active && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                <span style={{ width: 5, height: 5, borderRadius: "50%", background: C_STOP, display: "block", animation: "tlPulse 1.8s ease-in-out infinite" }} />
                                <span style={{ fontFamily: MONO, fontSize: "14px", color: C_STOP, fontWeight: 600 }}>em aberto</span>
                            </span>
                        )}
                        <span style={{ fontFamily: MONO, fontSize: "14px", color: C_SOFT, background: C_BASE, padding: "1px 6px" }}>
                            {formatHHMMSS(durSec)}
                        </span>
                        {statusLabel && (
                            <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: statusColor }}>
                                {statusLabel}
                            </span>
                        )}
                        {edited && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                <Pencil style={{ width: 10, height: 10, color: C_SOFT }} />
                                <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: C_SOFT }}>Editado</span>
                            </span>
                        )}
                    </div>

                    {/* Title — main content, should be readable */}
                    <span style={{ fontFamily: UI, fontSize: "16px", fontWeight: 500, color: C_INK, lineHeight: 1.35 }}>
                        {title}
                    </span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingTop: 2 }}>
                    {(isAjustePendente || canEditMotivo) && !selecting && (
                        <button
                            onClick={e => { e.stopPropagation(); isAjustePendente ? onOpenJustify?.(p) : onOpenEdit?.(p) }}
                            style={{
                                fontFamily: UI, fontSize: "14px", fontWeight: 600,
                                background: "transparent", color: C_MUTE,
                                border: `1px solid ${C_BORDER}`, padding: "5px 11px", cursor: "pointer",
                                letterSpacing: "0.02em",
                            }}
                        >
                            Editar motivo
                        </button>
                    )}
                    {needsJustify && !selecting && (
                        <button
                            onClick={e => { e.stopPropagation(); onOpenJustify?.(p) }}
                            style={{
                                fontFamily: UI, fontSize: "14px", fontWeight: 700,
                                background: C_INK, color: "#fff",
                                border: "none", padding: "6px 12px", cursor: "pointer",
                                letterSpacing: "0.02em",
                            }}
                        >
                            Justificar
                        </button>
                    )}
                    {hasDetails && (
                        <span style={{ color: C_SOFT, display: "flex", alignItems: "center" }}>
                            {open ? <ChevronUp style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded detail */}
            {open && hasDetails && (
                <div style={{ padding: "10px 14px 12px 16px", background: C_FAINT, borderTop: `1px solid ${C_BORDER}` }}>
                    {[
                        { label: "Grupo de perda", val: p.grupo_perda },
                        { label: "Código motivo",  val: p.motivo_codigo, mono: true },
                        { label: "Observação",     val: p.justificativa_texto },
                        { label: "Motivo editado", val: editedAt ? `em ${fmtShortDate(editedAt)} ${fmtHHMM(editedAt)}` : null },
                    ].filter(r => r.val).map(({ label, val, mono }) => (
                        <div key={label} style={{ display: "flex", gap: 14, marginBottom: 6 }}>
                            <span style={{ fontFamily: UI, fontSize: "14px", color: C_SOFT, width: 110, flexShrink: 0 }}>{label}</span>
                            <span style={{ fontFamily: mono ? MONO : UI, fontSize: "14px", color: C_INK, lineHeight: 1.4 }}>{val}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── SegmentBlock ─────────────────────────────────────────────────────────────

function SegmentBlock({ seg, isNewest, selecting, selectedIds, onToggleSelect, onOpenJustify, onOpenEdit }: {
    seg: Segment
    isNewest: boolean
    selecting?: boolean
    selectedIds?: Set<string>
    onToggleSelect?: (parada: ParadaTurnoRow) => void
    onOpenJustify?: (parada: ParadaTurnoRow) => void
    onOpenEdit?: (parada: ParadaTurnoRow) => void
}) {
    const tIni = isoToDate(seg.inicioIso)
    const tFim = seg.fimIso ? isoToDate(seg.fimIso) : null
    const ongoing = !tFim

    return (
        <div style={{ background: C_BG }}>
            {/* OP header row */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 14px", background: C_FAINT,
                borderBottom: `1px solid ${C_BORDER}`, gap: 12,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 700, color: C_INK }}>
                        {seg.ordemCodigo || "—"}
                    </span>
                    {isNewest && ongoing && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C_RUN, display: "block" }} />
                            <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: C_RUN }}>Em execução</span>
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ fontFamily: MONO, fontSize: "14px", color: C_MUTE }}>
                        {tIni ? fmtHHMM(tIni) : "--:--"} →{" "}
                        {ongoing ? <span style={{ color: C_RUN, fontWeight: 700 }}>agora</span> : (tFim ? fmtHHMM(tFim) : "--:--")}
                    </span>
                    {seg.produced > 0 && (
                        <span style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 700, color: C_RUN }}>
                            {fmtQty(seg.produced)} pcs
                        </span>
                    )}
                </div>
            </div>

            {/* Stops */}
            {seg.stops.length === 0 ? (
                <div style={{ padding: "10px 14px 10px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C_BORDER}` }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: C_RUN, flexShrink: 0 }} />
                    <span style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE }}>Produção contínua — sem paradas registradas</span>
                </div>
            ) : (
                <div>
                    {seg.stops.map((p) => (
                        <StopCard
                            key={String(p.parada_id)}
                            p={p}
                            selecting={selecting}
                            selected={!!selectedIds?.has(String(p.parada_id))}
                            onToggleSelect={onToggleSelect}
                            onOpenJustify={onOpenJustify}
                            onOpenEdit={onOpenEdit}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── OrderCompletionReport ────────────────────────────────────────────────────

function OrderCompletionReport({ summary, fromOrder, toOrder }: {
    summary: OrderSummary | undefined
    fromOrder: string | null
    toOrder: string | null
}) {
    return (
        <div style={{ background: C_FAINT, border: `1px solid ${C_BORDER}`, borderLeft: `3px solid ${C_INK}`, margin: "8px 0" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: summary ? `1px solid ${C_BORDER}` : "none" }}>
                <ArrowRightLeft style={{ width: 13, height: 13, color: C_MUTE, flexShrink: 0 }} />
                <span style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE }}>Troca de ordem</span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: C_SOFT, textDecoration: "line-through" }}>{fromOrder || "—"}</span>
                <span style={{ color: C_SOFT }}>→</span>
                <span style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 700, color: C_INK }}>{toOrder || "—"}</span>
            </div>

            {/* Stats */}
            {summary && (
                <div style={{ display: "flex", padding: "10px 14px", gap: 20, flexWrap: "wrap" as const, alignItems: "flex-start" }}>
                    {[
                        { l: "Produzido",  v: fmtQty(summary.totalProduced),  c: C_RUN },
                        { l: "Refugo",     v: fmtQty(summary.totalScrap),     c: C_STOP },
                        { l: "Retrabalho", v: fmtQty(summary.totalRework),    c: C_PLAN },
                        { l: "Produção",   v: formatHMS(summary.producingSeg), c: C_INK },
                        { l: "Paradas",    v: formatHMS(summary.stoppedSeg + summary.plannedSeg), c: C_MUTE },
                    ].map(({ l, v, c }) => (
                        <div key={l} style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                            <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: C_SOFT, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>{l}</span>
                            <span style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 700, color: c }}>{v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── buildSegments ────────────────────────────────────────────────────────────

function buildSegments(rows: OeePorPeriodoRow[], rangeToIsoUtc: string): Segment[] {
    if (!rows.length) return []
    const _nowMs = Date.now()

    const sorted = rows
        .filter(r => !!r.inicio_utc)
        .slice()
        .sort((a, b) => {
            const at = isoToDate(a.inicio_utc)?.getTime() || 0
            const bt = isoToDate(b.inicio_utc)?.getTime() || 0
            return at - bt
        })

    return sorted.map((r, idx) => {
        const inicioMs = isoToDate(r.inicio_utc)?.getTime() || 0
        let fimIso: string | null = r.fim_utc || null
        let fimMs = fimIso ? (isoToDate(fimIso)?.getTime() || 0) : 0

        if (!fimMs) {
            const nextSameTurno = sorted.slice(idx + 1).find(nx => nx.turno_id === r.turno_id && !!nx.inicio_utc)
            if (nextSameTurno?.inicio_utc) {
                fimIso = nextSameTurno.inicio_utc
                fimMs  = isoToDate(nextSameTurno.inicio_utc)?.getTime() || 0
            } else {
                const nextAny = sorted[idx + 1]
                if (nextAny?.inicio_utc) {
                    fimIso = nextAny.inicio_utc
                    fimMs  = isoToDate(nextAny.inicio_utc)?.getTime() || 0
                } else {
                    fimIso = rangeToIsoUtc
                    fimMs  = isoToDate(rangeToIsoUtc)?.getTime() || 0
                }
            }
        }

        if (fimMs > _nowMs) { fimMs = _nowMs; fimIso = new Date(_nowMs).toISOString() }

        const totalSeg = inicioMs && fimMs && fimMs > inicioMs ? Math.floor((fimMs - inicioMs) / 1000) : 0

        return {
            key: `seg_${r.turno_id || "t"}_${r.ordem_id || "o"}_${inicioMs}`,
            turnoId:    r.turno_id || null,
            turnoNome:  r.turno_nome || "Turno",
            ordemId:    r.ordem_id || null,
            ordemCodigo: r.ordem_codigo || null,
            inicioMs, fimMs,
            inicioIso:  r.inicio_utc!,
            fimIso,
            produced: safeNum(r.total_good, 0),
            scrap:    safeNum(r.total_scrap, 0),
            rework:   safeNum(r.total_rework, 0),
            rejected: safeNum(r.total_scrap, 0) + safeNum(r.total_rework, 0),
            runSeg:   clampInt(safeNum(r.run_time_seg, 0)),
            totalSeg,
            stops: [], stoppedSeg: 0, plannedSeg: 0, producingSeg: 0,
        }
    })
}

function sliceSegmentsByShift(segments: Segment[]): Segment[] {
    const sliced: Segment[] = []
    const _nowMs = Date.now()

    for (const seg of segments) {
        let currentStartMs = seg.inicioMs
        const finalEndMs   = Math.min(seg.fimMs || _nowMs, _nowMs)
        if (finalEndMs <= currentStartMs) continue

        const segmentTotalDurationSec = Math.max(1, (finalEndMs - seg.inicioMs) / 1000)

        while (currentStartMs < finalEndMs) {
            const currentStartDate = new Date(currentStartMs)
            const nextBoundaryMs   = getNextShiftBoundary(currentStartDate)
            const sliceEndMs       = Math.min(finalEndMs, nextBoundaryMs)
            if (sliceEndMs <= currentStartMs) break

            const realShiftInfo      = getShiftInfo(currentStartDate)
            const sliceDurationSec   = (sliceEndMs - currentStartMs) / 1000
            const ratio              = sliceDurationSec / segmentTotalDurationSec

            sliced.push({
                ...seg,
                key: `${seg.key}_${currentStartMs}`,
                turnoNome: realShiftInfo.nome,
                turnoId:   seg.turnoId || `T${realShiftInfo.nome === "Manhã" ? 1 : realShiftInfo.nome === "Tarde" ? 2 : 3}`,
                inicioMs: currentStartMs, fimMs: sliceEndMs,
                inicioIso: new Date(currentStartMs).toISOString(),
                fimIso:    new Date(sliceEndMs).toISOString(),
                produced: Math.floor(seg.produced * ratio), scrap:    Math.floor(seg.scrap * ratio),
                rework:   Math.floor(seg.rework * ratio),   rejected: Math.floor(seg.rejected * ratio),
                runSeg: sliceDurationSec, totalSeg: sliceDurationSec,
                stops: [], stoppedSeg: 0, plannedSeg: 0, producingSeg: 0,
            })

            currentStartMs = sliceEndMs
        }
    }

    return sliced
}

function allocateStopsToSegments(
    segments: Segment[],
    stops: ParadaTurnoRow[],
    rangeFromMs: number,
    rangeToMs: number
): Segment[] {
    if (!segments.length) return segments

    const _nowMs = Date.now()
    const segs   = segments.map(s => ({ ...s, stops: [] as ParadaTurnoRow[] }))
    const segsAsc = [...segs].sort((a, b) => a.inicioMs - b.inicioMs)

    for (const p of stops) {
        const ps = isoToDate(p.inicio_utc)?.getTime()
        if (!ps) continue
        const fimTimeMs = p.fim_utc ? isoToDate(p.fim_utc)?.getTime() : undefined
        const pe = fimTimeMs ?? _nowMs

        for (const seg of segsAsc) {
            const segStart = seg.inicioMs
            const segEnd   = Math.min(seg.fimMs || _nowMs, _nowMs)
            const hasOverlap = ps < segEnd && pe > segStart
            if (!hasOverlap) continue

            const overlapStart  = Math.max(ps, segStart)
            const overlapEnd    = Math.min(pe, segEnd)
            const overlapDurSec = Math.max(0, Math.floor((overlapEnd - overlapStart) / 1000))
            if (overlapDurSec > 0) seg.stops.push({ ...p, duracao_seg: overlapDurSec })
        }
    }

    for (const seg of segs) {
        let stoppedSeg = 0, plannedSeg = 0
        for (const p of seg.stops) {
            const dur = clampInt(safeNum(p.duracao_seg, 0))
            if (p.is_planejada) plannedSeg += dur
            else stoppedSeg += dur
        }

        const effectiveEndMs = seg.fimMs ? Math.min(seg.fimMs, _nowMs) : _nowMs
        const segTotalTime   = Math.max(0, Math.floor((effectiveEndMs - seg.inicioMs) / 1000))
        seg.totalSeg = segTotalTime

        const rawTotal = stoppedSeg + plannedSeg
        if (rawTotal > seg.totalSeg && rawTotal > 0) {
            const capRatio = seg.totalSeg / rawTotal
            stoppedSeg = Math.floor(stoppedSeg * capRatio)
            plannedSeg = Math.floor(plannedSeg * capRatio)
        }

        seg.stoppedSeg  = stoppedSeg
        seg.plannedSeg  = plannedSeg
        seg.producingSeg = Math.max(0, seg.totalSeg - stoppedSeg - plannedSeg)
        seg.stops.sort((a, b) => (isoToDate(b.inicio_utc)?.getTime() || 0) - (isoToDate(a.inicio_utc)?.getTime() || 0))
    }

    return segs
}

function groupSegmentsByDayAndTurno(segments: Segment[]): DayGroup[] {
    if (!segments.length) return []

    const segsDesc = [...segments].sort((a, b) => b.inicioMs - a.inicioMs)
    const daysMap  = new Map<string, DayGroup>()

    for (const seg of segsDesc) {
        const dayKey = localDayKeyFromIsoUtc(seg.inicioIso)
        let day = daysMap.get(dayKey)
        if (!day) {
            day = { dayKey, dayDate: isoToDate(seg.inicioIso), totalProduced: 0, totalRejected: 0, turnoGroups: [] }
            daysMap.set(dayKey, day)
        }

        day.totalProduced += seg.produced
        day.totalRejected += seg.rejected

        let tg = day.turnoGroups.find(g => g.turnoNome === seg.turnoNome)
        if (!tg) {
            tg = { turnoId: seg.turnoId, turnoNome: seg.turnoNome, inicioMs: seg.inicioMs, fimMs: seg.fimMs, totalProduced: 0, totalRejected: 0, segments: [] }
            day.turnoGroups.push(tg)
        }

        if (seg.inicioMs < tg.inicioMs || !tg.inicioMs) tg.inicioMs = seg.inicioMs
        if (seg.fimMs > tg.fimMs) tg.fimMs = seg.fimMs
        tg.totalProduced += seg.produced
        tg.totalRejected += seg.rejected
        tg.segments.push(seg)
    }

    for (const day of daysMap.values()) {
        day.turnoGroups.sort((a, b) => b.inicioMs - a.inicioMs)
        for (const tg of day.turnoGroups) tg.segments.sort((a, b) => b.inicioMs - a.inicioMs)
    }

    return Array.from(daysMap.values()).sort(
        (a, b) => (b.dayDate?.getTime() || 0) - (a.dayDate?.getTime() || 0)
    )
}

function isSyntheticGap(key: string) { return key.startsWith("synthetic_gap_") }

// ─── Apontador por turno (histórico, subtil no cabeçalho do turno) ───────────

type ApontadorSegment = { nome: string | null; deMs: number; ateMs: number }

/**
 * Recorta/mescla o log de apontador (janela ampla, já buscada uma vez para
 * a timeline inteira) para o intervalo exato de um turno específico.
 * Sempre robusto: sem dados (migração não rodada, sem histórico ainda,
 * ou log fora da janela) => devolve um único segmento "Indefinido" cobrindo
 * o turno inteiro. Nunca lança erro, nunca deixa buraco sem cobertura.
 */
function buildApontadorSegments(rows: ApontadorLogRow[], startMs: number, endMs: number): ApontadorSegment[] {
    const nowMs = Date.now()
    const safeEnd = Math.min(endMs, nowMs)
    if (!Number.isFinite(startMs) || !Number.isFinite(safeEnd) || safeEnd <= startMs) return []

    // Apontador é global por empresa: o mesmo registro é gravado em TODOS os
    // CTs (ver logApontadorChangeAllCts no backend). Isso deixou para trás,
    // em vários CTs, registros "abertos" (fim_utc null) órfãos/duplicados de
    // fan-outs antigos que não fecharam corretamente o período anterior —
    // um registro aberto órfão tem fim = agora e "engole" toda a timeline
    // por cima dos registros reais mais recentes. Por isso a sequência é
    // normalizada por início cronológico ANTES de recortar: cada registro
    // dura só até o início do PRÓXIMO (não até seu próprio fim_utc, que pode
    // estar ausente/incorreto por causa da duplicidade) — só o último da
    // sequência inteira permanece "aberto" (até agora). Registros com
    // fim_utc <= inicio_utc (corrompidos) são descartados. Quando dois
    // registros começam exatamente no mesmo instante (duplicata), prioriza o
    // que tem um nome definido sobre "Indefinido".
    const parsed = (rows || [])
        .map(r => {
            const s = isoToDate(r.inicio_utc)?.getTime() ?? null
            const fimRaw = r.fim_utc ? (isoToDate(r.fim_utc)?.getTime() ?? null) : null
            return { nome: r.nome ?? null, s, fimRaw }
        })
        .filter((r): r is { nome: string | null; s: number; fimRaw: number | null } =>
            r.s != null && (r.fimRaw == null || r.fimRaw > r.s))
        .sort((a, b) => a.s - b.s)

    const byStart = new Map<number, { nome: string | null; fimRaw: number | null }>()
    for (const r of parsed) {
        const existing = byStart.get(r.s)
        if (!existing || (existing.nome == null && r.nome != null)) {
            byStart.set(r.s, { nome: r.nome, fimRaw: r.fimRaw })
        }
    }
    const uniqueSorted = Array.from(byStart.entries())
        .map(([s, v]) => ({ s, nome: v.nome, fimRaw: v.fimRaw }))
        .sort((a, b) => a.s - b.s)

    const overlapping: { nome: string | null; s: number; e: number }[] = []
    for (let i = 0; i < uniqueSorted.length; i++) {
        const cur = uniqueSorted[i]
        const next = uniqueSorted[i + 1]
        const naturalEnd = cur.fimRaw ?? nowMs
        const cappedEnd = Math.min(naturalEnd, next ? next.s : Infinity, nowMs)
        if (cappedEnd > cur.s && cur.s < safeEnd && cappedEnd > startMs) {
            overlapping.push({ nome: cur.nome, s: cur.s, e: cappedEnd })
        }
    }

    if (!overlapping.length) return [{ nome: null, deMs: startMs, ateMs: safeEnd }]

    const raw: ApontadorSegment[] = []
    let cursor = startMs
    for (const r of overlapping) {
        const s = Math.max(r.s, startMs)
        const e = Math.min(r.e, safeEnd)
        if (e <= cursor) continue
        if (s > cursor) raw.push({ nome: null, deMs: cursor, ateMs: s })
        raw.push({ nome: r.nome, deMs: Math.max(s, cursor), ateMs: e })
        cursor = e
    }
    if (cursor < safeEnd) raw.push({ nome: null, deMs: cursor, ateMs: safeEnd })

    // Mescla segmentos consecutivos do mesmo apontador (defensivo — não deve
    // ocorrer no dado normal, mas evita "João → João" caso haja sobreposição).
    const merged: ApontadorSegment[] = []
    for (const s of raw) {
        if (s.ateMs <= s.deMs) continue
        const last = merged[merged.length - 1]
        if (last && last.nome === s.nome) last.ateMs = s.ateMs
        else merged.push({ ...s })
    }
    return merged
}

function ApontadorTurnoLine({ segments }: { segments: ApontadorSegment[] }) {
    if (!segments.length) return null
    const multi = segments.length > 1
    // Exibe do mais recente para o mais antigo (o array vem em ordem cronológica ascendente).
    const displaySegments = multi ? [...segments].reverse() : segments

    return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 5, flexWrap: "wrap" as const, marginTop: 4 }}>
            <User style={{ width: 11, height: 11, color: C_SOFT, flexShrink: 0, marginTop: 1 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {displaySegments.map((s, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                        <span
                            style={{
                                fontFamily: UI, fontSize: "14px", fontWeight: 600, lineHeight: 1.3,
                                color: s.nome ? C_MUTE : C_SOFT,
                                fontStyle: s.nome ? "normal" : "italic" as const,
                            }}
                        >
                            {s.nome || "Indefinido"}
                        </span>
                        {multi && (
                            <span style={{ fontFamily: MONO, fontSize: "14px", color: C_SOFT }}>
                                {fmtHHMM(new Date(s.deMs))}–{fmtHHMM(new Date(s.ateMs))}
                            </span>
                        )}
                    </span>
                ))}
            </div>
        </div>
    )
}

// ─── JustifyPanel (justificar / editar motivo / justificar em massa) ─────────

type JustifyPanelState =
    | { type: "justify"; parada: ParadaTurnoRow }
    | { type: "edit"; parada: ParadaTurnoRow }
    | { type: "bulk"; paradas: ParadaTurnoRow[] }

function JustifyPanel({
    panel, motivos, motivoId, onMotivoId, obs, onObs, search, onSearch,
    submitting, error, onSubmit, onClose,
}: {
    panel: JustifyPanelState
    motivos: MotivoParadaRow[]
    motivoId: string | null
    onMotivoId: (id: string) => void
    obs: string
    onObs: (v: string) => void
    search: string
    onSearch: (v: string) => void
    submitting: boolean
    error: string | null
    onSubmit: () => void
    onClose: () => void
}) {
    const title = panel.type === "justify" ? "Justificar parada"
        : panel.type === "edit" ? "Editar motivo"
        : `Justificar ${panel.paradas.length} parada${panel.paradas.length > 1 ? "s" : ""}`

    const filteredMotivos = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return motivos
        return motivos.filter(m =>
            String(m.descricao || "").toLowerCase().includes(term) ||
            String(m.codigo || "").toLowerCase().includes(term)
        )
    }, [motivos, search])

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 65 }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} onClick={onClose} />
            <div style={{
                position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                width: "100%", maxWidth: 640, maxHeight: "82vh", display: "flex", flexDirection: "column" as const,
                background: C_BG, borderTop: `1px solid ${C_BORDER}`,
                boxShadow: "0 -8px 32px rgba(0,0,0,0.16)",
            }}>
                {/* Handle */}
                <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px", flexShrink: 0 }}>
                    <div style={{ width: 32, height: 3, background: C_BORDER }} />
                </div>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px 10px", flexShrink: 0 }}>
                    <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, color: C_INK }}>{title}</span>
                    <button onClick={onClose} disabled={submitting} style={{ background: "none", border: "none", cursor: submitting ? "default" : "pointer", color: C_MUTE, display: "flex", opacity: submitting ? 0.4 : 1 }}>
                        <X style={{ width: 15, height: 15 }} />
                    </button>
                </div>

                {panel.type === "bulk" && (
                    <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
                        <div style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE, marginBottom: 8 }}>
                            O motivo e a observação escolhidos abaixo serão aplicados a todas as {panel.paradas.length} paradas selecionadas.
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
                            {panel.paradas.slice(0, 12).map(p => {
                                const d = isoToDate(p.inicio_utc)
                                return (
                                    <span key={String(p.parada_id)} style={{ fontFamily: MONO, fontSize: "14px", color: C_MUTE, background: C_FAINT, border: `1px solid ${C_BORDER}`, padding: "2px 7px" }}>
                                        {d ? fmtHHMM(d) : "--:--"}
                                    </span>
                                )
                            })}
                            {panel.paradas.length > 12 && (
                                <span style={{ fontFamily: UI, fontSize: "14px", color: C_SOFT, padding: "2px 4px" }}>
                                    +{panel.paradas.length - 12}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Motivo search */}
                <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
                    <div style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.14em", color: C_MUTE, marginBottom: 6 }}>
                        Motivo
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C_BORDER}`, padding: "7px 10px" }}>
                        <Search style={{ width: 13, height: 13, color: C_SOFT, flexShrink: 0 }} />
                        <input
                            value={search}
                            onChange={e => onSearch(e.target.value)}
                            placeholder="Buscar motivo..."
                            style={{ border: "none", outline: "none", fontFamily: UI, fontSize: "14px", color: C_INK, width: "100%", background: "transparent" }}
                        />
                    </div>
                </div>

                {/* Motivo list */}
                <div className="tl-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "0 16px" }}>
                    {filteredMotivos.length === 0 ? (
                        <div style={{ padding: "16px 0", fontFamily: UI, fontSize: "14px", color: C_MUTE, textAlign: "center" as const }}>
                            Nenhum motivo encontrado.
                        </div>
                    ) : (
                        filteredMotivos.map(m => {
                            const active = motivoId === m.motivo_id
                            return (
                                <button
                                    key={m.motivo_id}
                                    onClick={() => onMotivoId(m.motivo_id)}
                                    style={{
                                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                                        width: "100%", textAlign: "left" as const, cursor: "pointer",
                                        padding: "9px 10px", marginBottom: 4,
                                        background: active ? C_INK : C_FAINT,
                                        border: `1px solid ${active ? C_INK : C_BORDER}`,
                                    }}
                                >
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: "block", fontFamily: UI, fontSize: "14px", fontWeight: 600, color: active ? "#fff" : C_INK }}>
                                            {m.descricao || m.codigo}
                                        </span>
                                        {m.grupo_perda && (
                                            <span style={{ display: "block", fontFamily: UI, fontSize: "14px", color: active ? "rgba(255,255,255,0.6)" : C_SOFT, marginTop: 1 }}>
                                                {m.grupo_perda}
                                            </span>
                                        )}
                                    </span>
                                    {active && <CheckCircle2 style={{ width: 15, height: 15, color: "#fff", flexShrink: 0 }} />}
                                </button>
                            )
                        })
                    )}
                </div>

                {/* Observação */}
                <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
                    <div style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, color: C_INK, marginBottom: 6 }}>
                        Observação <span style={{ fontWeight: 500, color: C_MUTE }}>(opcional)</span>
                    </div>
                    <textarea
                        value={obs}
                        onChange={e => onObs(e.target.value)}
                        placeholder="Detalhes adicionais sobre a parada..."
                        rows={2}
                        style={{
                            width: "100%", resize: "none" as const, border: `1px solid ${C_BORDER}`,
                            padding: "8px 10px", fontFamily: UI, fontSize: "14px", color: C_INK,
                            outline: "none", boxSizing: "border-box" as const,
                        }}
                    />
                </div>

                {error && (
                    <div style={{ margin: "8px 16px 0", padding: "8px 10px", background: "rgba(220,38,38,0.06)", borderLeft: `3px solid ${C_STOP}`, flexShrink: 0 }}>
                        <span style={{ fontFamily: UI, fontSize: "14px", color: "#7f1d1d" }}>{error}</span>
                    </div>
                )}

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 16px 16px", borderTop: `1px solid ${C_BORDER}`, background: C_FAINT, flexShrink: 0 }}>
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, border: `1px solid ${C_BORDER}`, background: C_BG, color: C_INK, padding: "7px 16px", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1 }}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onSubmit}
                        disabled={submitting || !motivoId}
                        style={{
                            display: "flex", alignItems: "center", gap: 6,
                            fontFamily: UI, fontSize: "14px", fontWeight: 700, border: "none",
                            background: (submitting || !motivoId) ? C_SOFT : C_INK,
                            color: "#ffffff", padding: "7px 16px",
                            cursor: (submitting || !motivoId) ? "default" : "pointer",
                        }}
                    >
                        {submitting && <Loader2 style={{ width: 13, height: 13, animation: "spin 0.7s linear infinite" }} />}
                        {submitting ? "Salvando..." : panel.type === "edit" ? "Salvar" : "Justificar"}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimelinePanel({
    isOpen, onClose, stationName, centroTrabalhoId, empresaId,
    initialFromIsoUtc, initialToIsoUtc,
    paradas: paradasProp, produced = 0, rejected = 0,
    onParadaUpdated, refreshToken,
}: Props) {
    void initialFromIsoUtc; void initialToIsoUtc

    const panelRef  = useRef<HTMLDivElement | null>(null)
    const headerRef = useRef<HTMLDivElement | null>(null)
    const [headerH, setHeaderH] = useState(76)

    useEffect(() => {
        const el = headerRef.current
        if (!el) return
        const obs = new ResizeObserver(entries => {
            for (const e of entries) setHeaderH(Math.ceil(e.contentRect.height))
        })
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    const defaultTo   = useMemo(() => new Date(), [])
    const defaultFrom = useMemo(() => new Date(defaultTo.getTime() - 7 * 24 * 60 * 60 * 1000), [defaultTo])

    const [fromDate, setFromDate] = useState<string>(() => toLocalYmd(defaultFrom))
    const [fromTime, setFromTime] = useState<string>(() => toLocalHm(defaultFrom))
    const [toDate,   setToDate]   = useState<string>(() => toLocalYmd(defaultTo))
    const [toTime,   setToTime]   = useState<string>(() => toLocalHm(defaultTo))

    const [rangeFromIsoUtc, setRangeFromIsoUtc] = useState<string>(() => defaultFrom.toISOString())
    const [rangeToIsoUtc,   setRangeToIsoUtc]   = useState<string>(() => defaultTo.toISOString())
    const [filterOpen, setFilterOpen] = useState(false)

    const paradasHook = useDashboardParadasDoTurno({ centroTrabalhoId, turnoInicio: rangeFromIsoUtc, turnoFim: rangeToIsoUtc, empresaId })

    // Histórico de apontador (mesma janela visível da timeline) — busca uma vez
    // e cada turno recorta/mescla localmente o trecho que lhe cabe (buildApontadorSegments).
    const apontadorHistoricoHook = usePostoApontadorHistorico({
        centroTrabalhoId, empresaId, fromIsoUtc: rangeFromIsoUtc, toIsoUtc: rangeToIsoUtc,
    })
    const apontadorHistoricoRows: ApontadorLogRow[] = useMemo(
        () => (apontadorHistoricoHook.data || []) as ApontadorLogRow[],
        [apontadorHistoricoHook.data],
    )

    const paradasData: ParadaTurnoRow[] = useMemo(() => {
        const hookRows = (paradasHook.data || []) as ParadaTurnoRow[]
        const propRows = (paradasProp || []) as ParadaTurnoRow[]
        return hookRows.length ? hookRows : propRows
    }, [paradasHook.data, paradasProp])

    // ─── Justificar / editar motivo / justificar em massa ─────────────────────
    const motivosHook = usePostoMotivosParada({ empresaId })
    const motivos = (motivosHook.data || []) as MotivoParadaRow[]

    const [bulkMode, setBulkMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    const [panel, setPanel] = useState<JustifyPanelState | null>(null)
    const [panelMotivoId, setPanelMotivoId] = useState<string | null>(null)
    const [panelObs, setPanelObs] = useState("")
    const [panelSearch, setPanelSearch] = useState("")
    const [panelSubmitting, setPanelSubmitting] = useState(false)
    const [panelError, setPanelError] = useState<string | null>(null)
    const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null)

    useEffect(() => {
        if (!toast) return
        const id = setTimeout(() => setToast(null), 4000)
        return () => clearTimeout(id)
    }, [toast])

    function toggleSelected(p: ParadaTurnoRow) {
        const id = String(p.parada_id)
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }

    function toggleBulkMode() {
        setBulkMode(v => {
            if (v) setSelectedIds(new Set())
            return !v
        })
    }

    function openJustifyPanel(p: ParadaTurnoRow) {
        setPanel({ type: "justify", parada: p })
        setPanelMotivoId(null)
        setPanelObs("")
        setPanelSearch("")
        setPanelError(null)
    }

    function openEditPanel(p: ParadaTurnoRow) {
        setPanel({ type: "edit", parada: p })
        setPanelMotivoId(p.motivo_id ?? null)
        setPanelObs(p.justificativa_texto ?? "")
        setPanelSearch("")
        setPanelError(null)
    }

    function openBulkPanel() {
        if (selectedIds.size === 0) return
        const list = paradasData.filter(p => selectedIds.has(String(p.parada_id)))
        if (!list.length) return
        setPanel({ type: "bulk", paradas: list })
        setPanelMotivoId(null)
        setPanelObs("")
        setPanelSearch("")
        setPanelError(null)
    }

    function closePanel() {
        if (panelSubmitting) return
        setPanel(null)
    }

    async function refreshAfterMutation() {
        await Promise.all([paradasHook.mutate?.(), oeeHook.mutate?.()])
        onParadaUpdated?.()
    }

    async function submitPanel() {
        if (!panel || panelSubmitting) return
        if (!panelMotivoId) { setPanelError("Selecione um motivo."); return }

        setPanelSubmitting(true)
        setPanelError(null)
        const usuario_id = getUsuarioIdFallback()
        const justificativa_texto = panelObs.trim() || null

        try {
            if (panel.type === "justify") {
                await postoJustificarParada({
                    empresa_id: empresaId ?? undefined,
                    parada_id: panel.parada.parada_id,
                    motivo_id: panelMotivoId,
                    justificativa_texto,
                    usuario_id,
                })
                setToast({ kind: "success", msg: "Parada justificada com sucesso." })
                setPanel(null)
            } else if (panel.type === "edit") {
                await postoEditarParadaMotivo({
                    empresa_id: empresaId ?? undefined,
                    parada_id: panel.parada.parada_id,
                    motivo_id: panelMotivoId,
                    justificativa_texto,
                    usuario_id,
                })
                setToast({ kind: "success", msg: "Motivo atualizado com sucesso." })
                setPanel(null)
            } else if (panel.type === "bulk") {
                const ids = panel.paradas.map(p => p.parada_id)
                const res = await postoJustificarParadasEmMassa({
                    empresa_id: empresaId ?? undefined,
                    parada_ids: ids,
                    motivo_id: panelMotivoId,
                    justificativa_texto,
                    usuario_id,
                })
                setSelectedIds(prev => {
                    const next = new Set(prev)
                    for (const id of res.succeeded) next.delete(String(id))
                    return next
                })
                if (res.failed.length === 0) {
                    setToast({ kind: "success", msg: `${res.succeeded.length} parada${res.succeeded.length === 1 ? "" : "s"} justificada${res.succeeded.length === 1 ? "" : "s"}.` })
                    setBulkMode(false)
                    setPanel(null)
                } else {
                    setToast({
                        kind: "error",
                        msg: `${res.succeeded.length} justificada(s), ${res.failed.length} falharam. Tente novamente as restantes.`,
                    })
                    setPanel(null)
                }
            }
            await refreshAfterMutation()
        } catch (e: any) {
            setPanelError(e?.message || "Falha ao salvar. Tente novamente.")
        } finally {
            setPanelSubmitting(false)
        }
    }

    const dataInicio = useMemo(() => ymdFromIsoUtc(rangeFromIsoUtc), [rangeFromIsoUtc])
    const dataFim    = useMemo(() => ymdFromIsoUtc(rangeToIsoUtc),   [rangeToIsoUtc])

    const oeeHook   = useDashboardOeePorPeriodo({ centroTrabalhoId, dataInicio, dataFim, empresaId })
    const rawOeeRows: OeePorPeriodoRow[] = useMemo(
        () => ((oeeHook.data || []) as OeePorPeriodoRow[]).filter(r => !!r.inicio_utc),
        [oeeHook.data]
    )

    const prevTokenRef = useRef<number | undefined>(undefined)
    useEffect(() => {
        if (refreshToken === undefined) return
        if (prevTokenRef.current === refreshToken) return
        prevTokenRef.current = refreshToken
        paradasHook.mutate?.()
        oeeHook.mutate?.()
    }, [refreshToken]) // eslint-disable-line react-hooks/exhaustive-deps

    const rangeFromMs = useMemo(() => isoToDate(rangeFromIsoUtc)?.getTime() || 0, [rangeFromIsoUtc])
    const rangeToMs   = useMemo(() => isoToDate(rangeToIsoUtc)?.getTime()   || 0, [rangeToIsoUtc])

    const paradasInRange = useMemo(() =>
        (paradasData || []).filter(p => {
            const t = isoToDate(p.inicio_utc)?.getTime()
            return t != null && t >= rangeFromMs && t <= rangeToMs
        }),
        [paradasData, rangeFromMs, rangeToMs]
    )

    const dayGroups: DayGroup[] = useMemo(() => {
        const nowMs = Math.min(rangeToMs, Date.now())

        if (rawOeeRows.length > 0) {
            const baseSegs = buildSegments(rawOeeRows, rangeToIsoUtc)
            const sortedBaseSegs = [...baseSegs].sort((a, b) => a.inicioMs - b.inicioMs)
            const segsWithGaps: Segment[] = []

            for (let i = 0; i < sortedBaseSegs.length; i++) {
                const seg = sortedBaseSegs[i]
                if (segsWithGaps.length > 0) {
                    const prevEndMs = segsWithGaps[segsWithGaps.length - 1].fimMs
                    if (prevEndMs > 0 && seg.inicioMs - prevEndMs > 60_000)
                        segsWithGaps.push(makeSyntheticGapSegment(prevEndMs, seg.inicioMs, sortedBaseSegs[i - 1]))
                }
                segsWithGaps.push(seg)
            }

            if (sortedBaseSegs.length > 0) {
                const lastEndMs = sortedBaseSegs[sortedBaseSegs.length - 1].fimMs || 0
                if (nowMs - lastEndMs > 60_000)
                    segsWithGaps.push(makeSyntheticGapSegment(lastEndMs, nowMs, sortedBaseSegs[sortedBaseSegs.length - 1]))
            }

            const slicedSegs  = sliceSegmentsByShift(segsWithGaps)
            const segsWithStops = allocateStopsToSegments(slicedSegs, paradasInRange, rangeFromMs, rangeToMs)
            const segsInRange = segsWithStops.filter(seg => {
                if (!seg.inicioMs) return false
                const endMs = seg.fimMs || rangeToMs
                if (endMs < rangeFromMs || seg.inicioMs > rangeToMs) return false
                if (isSyntheticGap(seg.key) && seg.stops.length === 0 && seg.produced === 0) return false
                return true
            })

            if (segsInRange.length > 0) return groupSegmentsByDayAndTurno(segsInRange)
        }

        if (!paradasInRange.length) return []
        const fullRangeSeg   = makeSyntheticGapSegment(rangeFromMs, nowMs, null)
        const slicedFallback = sliceSegmentsByShift([fullRangeSeg])
        const fbWithStops    = allocateStopsToSegments(slicedFallback, paradasInRange, rangeFromMs, rangeToMs)
        const fbInRange      = fbWithStops.filter(seg => {
            if (!seg.inicioMs) return false
            const endMs = seg.fimMs || rangeToMs
            if (endMs < rangeFromMs || seg.inicioMs > rangeToMs) return false
            if (seg.stops.length === 0 && seg.produced === 0) return false
            return true
        })

        return fbInRange.length > 0 ? groupSegmentsByDayAndTurno(fbInRange) : []
    }, [rawOeeRows, paradasInRange, rangeFromMs, rangeToMs, rangeToIsoUtc])

    const globalOrderAggregates = useMemo<Map<string, OrderSummary>>(() => {
        const map = new Map<string, OrderSummary>()
        for (const day of dayGroups) {
            for (const tg of day.turnoGroups) {
                for (const seg of tg.segments) {
                    if (!seg.ordemCodigo) continue
                    if (!map.has(seg.ordemCodigo)) {
                        map.set(seg.ordemCodigo, { ordemCodigo: seg.ordemCodigo, totalProduced: 0, totalScrap: 0, totalRework: 0, producingSeg: 0, stoppedSeg: 0, plannedSeg: 0 })
                    }
                    const agg = map.get(seg.ordemCodigo)!
                    agg.totalProduced += seg.produced; agg.totalScrap += seg.scrap
                    agg.totalRework   += seg.rework;   agg.producingSeg += seg.producingSeg
                    agg.stoppedSeg    += seg.stoppedSeg; agg.plannedSeg += seg.plannedSeg
                }
            }
        }
        return map
    }, [dayGroups])

    const totalsGeral = useMemo(() => {
        if (rawOeeRows.length) return {
            produced: rawOeeRows.reduce((acc, r) => acc + safeNum(r.total_good, 0), 0),
            rejected: rawOeeRows.reduce((acc, r) => acc + safeNum(r.total_scrap, 0) + safeNum(r.total_rework, 0), 0),
        }
        return { produced: safeNum(produced, 0), rejected: safeNum(rejected, 0) }
    }, [rawOeeRows, produced, rejected])

    const totalParadas  = useMemo(() => paradasInRange.length, [paradasInRange])
    const totalPendentes = useMemo(
        () => paradasInRange.filter(p => p.motivo_id == null || (p.exige_justificativa && !p.is_justificada)).length,
        [paradasInRange]
    )

    useEffect(() => {
        if (!isOpen) return
        requestAnimationFrame(() => panelRef.current?.scrollTo({ top: 0 }))
    }, [isOpen])

    useEffect(() => {
        if (isOpen) return
        setPanel(null)
        setBulkMode(false)
        setSelectedIds(new Set())
        setToast(null)
    }, [isOpen])

    function applyFilter() {
        const fromIso = localDateTimeToUtcIso(fromDate, fromTime)
        const toIso   = localDateTimeToUtcIso(toDate, toTime)
        if (!fromIso || !toIso) return
        if (new Date(toIso).getTime() <= new Date(fromIso).getTime()) return
        setRangeFromIsoUtc(fromIso)
        setRangeToIsoUtc(toIso)
        setFilterOpen(false)
        requestAnimationFrame(() => panelRef.current?.scrollTo({ top: 0, behavior: "smooth" }))
    }

    function setRange(from: Date, to: Date) {
        setFromDate(toLocalYmd(from)); setFromTime(toLocalHm(from))
        setToDate(toLocalYmd(to));     setToTime(toLocalHm(to))
        setRangeFromIsoUtc(from.toISOString()); setRangeToIsoUtc(to.toISOString())
        setFilterOpen(false)
    }

    const resetToCurrentShift = () => { const to = new Date(); setRange(getShiftAnchorStartLocal(to), to) }
    const resetToLast24h   = () => { const to = new Date(); setRange(new Date(to.getTime() - 24 * 60 * 60 * 1000), to) }
    const resetToLast48h   = () => { const to = new Date(); setRange(new Date(to.getTime() - 48 * 60 * 60 * 1000), to) }
    const resetToLast7Days = () => { const to = new Date(); setRange(new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), to) }
    const resetToLast15Days = () => { const to = new Date(); setRange(new Date(to.getTime() - 15 * 24 * 60 * 60 * 1000), to) }
    const resetToLastMonth = () => { const to = new Date(); setRange(new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to) }

    if (!isOpen) return null

    const dFrom = isoToDate(rangeFromIsoUtc)
    const dTo   = isoToDate(rangeToIsoUtc)
    const showLoading = paradasHook.isLoading || oeeHook.isLoading
    const showError   = !!(paradasHook.error || oeeHook.error)

    const tzOffset = new Date().getTimezoneOffset()
    const tzLabel  = `UTC${tzOffset > 0 ? "-" : "+"}${Math.abs(Math.floor(tzOffset / 60))}`

    return (
        <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <style>{`
                @keyframes tlSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
                @keyframes tlPulse   { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
                .tl-scroll::-webkit-scrollbar { width: 4px; }
                .tl-scroll::-webkit-scrollbar-track { background: transparent; }
                .tl-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.25); border-radius: 2px; }
                .tl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.45); }
            `}</style>

            <div
                ref={panelRef}
                className="tl-scroll"
                style={{
                    width: "100%", maxWidth: 640, height: "100%",
                    overflowY: "auto", overflowX: "hidden",
                    background: C_BG,
                    boxShadow: "-8px 0 40px rgba(0,0,0,0.18), -2px 0 8px rgba(0,0,0,0.08)",
                    animation: "tlSlideIn 0.22s cubic-bezier(0.22,0.61,0.36,1)",
                    position: "relative",
                    scrollBehavior: "smooth",
                }}
            >

                {/* ── HEADER — grafite escuro (matches posto header through overlay) ── */}
                <div ref={headerRef} style={{ background: C_HEADER, position: "sticky", top: 0, zIndex: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div style={{ width: 32, height: 32, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <Factory style={{ width: 16, height: 16, color: "rgba(255,255,255,0.6)" }} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                    <span style={{ fontFamily: UI, fontSize: "14px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.04em" }}>
                                        Timeline de Produção
                                    </span>
                                </div>
                                <div style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                    {stationName}
                                </div>
                                <div style={{ fontFamily: MONO, fontSize: "14px", color: "rgba(255,255,255,0.32)", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                                    <Calendar style={{ width: 10, height: 10 }} />
                                    <span>{dFrom ? `${fmtShortDate(dFrom)} ${fmtHHMM(dFrom)}` : "--"}</span>
                                    <span style={{ color: "rgba(255,255,255,0.18)" }}>→</span>
                                    <span>{dTo ? `${fmtShortDate(dTo)} ${fmtHHMM(dTo)}` : "--"}</span>
                                    <span style={{ marginLeft: 4, background: "rgba(255,255,255,0.07)", padding: "0 5px", fontSize: "14px", color: "rgba(255,255,255,0.25)" }}>{tzLabel}</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                width: 32, height: 32, background: "rgba(255,255,255,0.06)",
                                border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.45)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: "pointer", flexShrink: 0,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fff" }}
                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.45)" }}
                        >
                            <X style={{ width: 15, height: 15 }} />
                        </button>
                    </div>
                </div>

                {/* ── METRICS STRIP ──────────────────────────────────────────── */}
                <div style={{ display: "flex", background: C_BG, borderBottom: `1px solid ${C_BORDER}` }}>
                    {[
                        { label: "Produzido", val: fmtQty(totalsGeral.produced), color: C_RUN,  Icon: Zap },
                        { label: "Refugo",    val: fmtQty(totalsGeral.rejected), color: C_STOP, Icon: TrendingDown },
                        { label: "Paradas",   val: String(totalParadas),          color: C_INK,  Icon: Timer },
                        { label: "Pendentes", val: String(totalPendentes),        color: totalPendentes > 0 ? C_STOP : C_MUTE, Icon: AlertCircle },
                    ].map(({ label, val, color, Icon }, i) => (
                        <div key={label} style={{
                            flex: 1, padding: "12px 12px 12px 14px",
                            borderRight: i < 3 ? `1px solid ${C_BORDER}` : "none",
                            display: "flex", flexDirection: "column" as const, gap: 4,
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <Icon style={{ width: 11, height: 11, color: C_SOFT, flexShrink: 0 }} />
                                <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 500, color: C_MUTE }}>
                                    {label}
                                </span>
                            </div>
                            <span style={{ fontFamily: MONO, fontSize: "26px", fontWeight: 700, color, lineHeight: 1 }}>{val}</span>
                        </div>
                    ))}
                </div>

                {/* ── LEGEND ─────────────────────────────────────────────────── */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 16px", borderBottom: `1px solid ${C_BORDER}`, background: C_FAINT, flexWrap: "wrap" as const }}>
                    <span style={{ fontFamily: UI, fontSize: "14px", color: C_SOFT }}>Legenda:</span>
                    {[
                        { c: C_STOP, l: "Não justificada" },
                        { c: C_PLAN, l: "Programada" },
                        { c: C_RUN,  l: "Justificada" },
                    ].map(({ c, l }) => (
                        <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 7, height: 7, background: c, display: "block", flexShrink: 0 }} />
                            <span style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE }}>{l}</span>
                        </span>
                    ))}
                    {totalPendentes > 0 && (
                        <button
                            onClick={toggleBulkMode}
                            title="Selecione várias paradas pendentes e aplique o mesmo motivo a todas de uma vez"
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                marginLeft: "auto", fontFamily: UI, fontSize: "14px", fontWeight: 700,
                                background: bulkMode ? C_INK : C_BG,
                                color: bulkMode ? "#fff" : C_INK,
                                border: `1.5px solid ${C_INK}`,
                                borderRadius: 3,
                                padding: "7px 14px", cursor: "pointer", letterSpacing: "0.01em",
                                boxShadow: bulkMode ? "none" : "0 1px 2px rgba(15,17,23,0.06)",
                            }}
                        >
                            <ListChecks style={{ width: 14, height: 14 }} />
                            {bulkMode ? "Cancelar seleção" : "Justificar em massa"}
                        </button>
                    )}
                </div>
                {bulkMode && (
                    <div style={{ padding: "6px 16px", borderBottom: `1px solid ${C_BORDER}`, background: C_FAINT }}>
                        <span style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE }}>
                            Marque as paradas pendentes desejadas — o mesmo motivo e observação serão aplicados a todas de uma vez.
                        </span>
                    </div>
                )}

                {/* ── LOADING / ERROR ────────────────────────────────────────── */}
                {showLoading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${C_BORDER}` }}>
                        <div style={{ width: 16, height: 16, border: `2px solid ${C_BORDER}`, borderTopColor: C_INK, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                        <span style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE }}>Carregando histórico...</span>
                    </div>
                )}
                {showError && !showLoading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", background: "rgba(220,38,38,0.04)", borderBottom: `1px solid ${C_BORDER}`, borderLeft: `3px solid ${C_STOP}` }}>
                        <AlertCircle style={{ width: 15, height: 15, color: C_STOP }} />
                        <span style={{ fontFamily: UI, fontSize: "14px", color: "#7f1d1d" }}>Falha na conexão. Tente ajustar o filtro.</span>
                    </div>
                )}

                {/* ── TIMELINE CONTENT ───────────────────────────────────────── */}
                <div style={{ paddingBottom: 80 }}>
                    {!showLoading && dayGroups.length === 0 ? (
                        <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                            <div style={{ width: 48, height: 48, background: C_FAINT, border: `1px solid ${C_BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                                <Activity style={{ width: 20, height: 20, color: C_SOFT }} />
                            </div>
                            <div style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: C_INK }}>Nenhum evento neste período</div>
                            <div style={{ fontFamily: UI, fontSize: "14px", color: C_MUTE, marginTop: 6 }}>Ajuste o filtro para buscar registros.</div>
                        </div>
                    ) : (
                        dayGroups.map(day => {
                            const d = day.dayDate
                            const dayLabel = d
                                ? `${pad2(d.getDate())} ${d.toLocaleDateString("pt-BR", { month: "short" }).toUpperCase().replace(".", "")} ${d.getFullYear()}`
                                : "--/--/----"

                            return (
                                <div key={day.dayKey}>
                                    {/* Day header */}
                                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 10px", position: "sticky" as const, top: headerH, zIndex: 5, background: C_BG }}>
                                        <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, color: C_INK, flexShrink: 0, letterSpacing: "-0.01em" }}>
                                            {dayLabel}
                                        </span>
                                        <div style={{ flex: 1, height: 1, background: C_BORDER }} />
                                        <span style={{ fontFamily: MONO, fontSize: "14px", color: C_MUTE, flexShrink: 0 }}>
                                            {fmtQty(day.totalProduced)} pcs
                                        </span>
                                    </div>

                                    {/* Shift groups */}
                                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, padding: "0 16px 8px" }}>
                                        {day.turnoGroups.map((tg, tgIdx) => {
                                            const ShiftIcon = getShiftIcon(tg.turnoNome)
                                            const tgIni = isoToDate(tg.segments[tg.segments.length - 1]?.inicioIso)
                                            const tgFim = isoToDate(tg.segments[0]?.fimIso || null)
                                            const tgTotalSeg    = tg.segments.reduce((acc, s) => acc + s.totalSeg, 0)
                                            const tgProducingSeg = tg.segments.reduce((acc, s) => acc + s.producingSeg, 0)
                                            const tgStoppedSeg  = tg.segments.reduce((acc, s) => acc + s.stoppedSeg, 0)
                                            const tgPlannedSeg  = tg.segments.reduce((acc, s) => acc + s.plannedSeg, 0)
                                            const tgUrgentCount = tg.segments.reduce((acc, s) =>
                                                acc + s.stops.filter(p => p.motivo_id == null || (p.exige_justificativa && !p.is_justificada)).length, 0)

                                            // Histórico de apontador recortado para a janela exata deste turno.
                                            // tgFim vem dos segmentos de produção (memoizados) e só se move quando
                                            // chega produção nova — por isso, para o turno AINDA EM ANDAMENTO, ele
                                            // fica "preso" no passado e um apontador trocado depois desse instante
                                            // ficaria fora da janela. Se ainda estamos dentro do turno oficial de
                                            // tgIni (comparando com o horário real "agora"), estende o fim da janela
                                            // até agora; turnos já encerrados continuam usando o tgFim histórico,
                                            // sem qualquer mudança de comportamento.
                                            const tgOngoingBoundaryMs = tgIni ? getNextShiftBoundary(tgIni) : null
                                            const tgIsOngoing = !!tgIni &&
                                                Date.now() >= tgIni.getTime() &&
                                                (tgOngoingBoundaryMs == null || Date.now() < tgOngoingBoundaryMs)
                                            const apontadorWindowEndMs = tgIsOngoing
                                                ? Date.now()
                                                : (tgFim ? tgFim.getTime() : null)
                                            // Robusto: sem segments (turno vazio) ou sem histórico => [] / "Indefinido",
                                            // nunca lança erro nem afeta o restante do cabeçalho/timeline.
                                            const apontadorSegsForTg = (tgIni && apontadorWindowEndMs)
                                                ? buildApontadorSegments(apontadorHistoricoRows, tgIni.getTime(), apontadorWindowEndMs)
                                                : []

                                            const nextTg            = day.turnoGroups[tgIdx + 1]
                                            const tgOldestSeg       = tg.segments[tg.segments.length - 1]
                                            const nextTgNewestSeg   = nextTg?.segments[0]
                                            const hasCrossTurnoOrderChange =
                                                !!tgOldestSeg && !!nextTgNewestSeg && isOrderChange(nextTgNewestSeg, tgOldestSeg)
                                            const crossTurnoOrderSummary = hasCrossTurnoOrderChange && nextTgNewestSeg?.ordemCodigo
                                                ? globalOrderAggregates.get(nextTgNewestSeg.ordemCodigo)
                                                : undefined

                                            return (
                                                <React.Fragment key={`${day.dayKey}_${tg.turnoNome}`}>
                                                    <div style={{ border: `1px solid ${C_BORDER}`, overflow: "hidden" }}>

                                                        {/* Shift header */}
                                                        <div style={{ background: C_FAINT, borderBottom: `1px solid ${C_BORDER}` }}>
                                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 10px", gap: 12 }}>
                                                                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                                                                    <ShiftIcon style={{ width: 15, height: 15, color: C_MUTE, flexShrink: 0 }} />
                                                                    <div style={{ minWidth: 0 }}>
                                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                                                                            <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, color: C_INK }}>
                                                                                {tg.turnoNome}
                                                                            </span>
                                                                            <span style={{ fontFamily: MONO, fontSize: "14px", color: C_MUTE }}>
                                                                                {tgIni ? fmtHHMM(tgIni) : "--:--"} → {tgFim ? fmtHHMM(tgFim) : "--:--"}
                                                                                {tgTotalSeg > 0 && (
                                                                                    <span style={{ color: C_SOFT, marginLeft: 6 }}>({formatHMS(tgTotalSeg)})</span>
                                                                                )}
                                                                            </span>
                                                                            {tgUrgentCount > 0 && (
                                                                                <span style={{
                                                                                    fontFamily: UI, fontSize: "14px", fontWeight: 700,
                                                                                    background: "rgba(220,38,38,0.10)", color: C_STOP,
                                                                                    padding: "2px 8px", flexShrink: 0,
                                                                                }}>
                                                                                    {tgUrgentCount} pendente{tgUrgentCount > 1 ? "s" : ""}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <ApontadorTurnoLine segments={apontadorSegsForTg} />
                                                                    </div>
                                                                </div>
                                                                <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
                                                                    <div style={{ fontFamily: MONO, fontSize: "26px", fontWeight: 700, color: C_INK, lineHeight: 1 }}>
                                                                        {fmtQty(tg.totalProduced)}
                                                                    </div>
                                                                    <div style={{ fontFamily: UI, fontSize: "14px", color: C_SOFT, marginTop: 2 }}>peças</div>
                                                                    {tg.totalRejected > 0 && (
                                                                        <div style={{ fontFamily: MONO, fontSize: "14px", color: C_STOP, fontWeight: 600, marginTop: 2 }}>
                                                                            -{fmtQty(tg.totalRejected)} refugo
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Time bar with legend */}
                                                            {tgTotalSeg > 0 && (
                                                                <TimeBar
                                                                    totalSeg={tgTotalSeg}
                                                                    producingSeg={tgProducingSeg}
                                                                    stoppedSeg={tgStoppedSeg}
                                                                    plannedSeg={tgPlannedSeg}
                                                                />
                                                            )}
                                                        </div>

                                                        {/* Segments */}
                                                        {tg.segments.length === 0 ? (
                                                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", color: C_MUTE }}>
                                                                <CheckCircle2 style={{ width: 14, height: 14, color: C_RUN }} />
                                                                <span style={{ fontFamily: UI, fontSize: "14px" }}>Nenhum evento registrado neste turno.</span>
                                                            </div>
                                                        ) : (
                                                            tg.segments.map((seg, segIdx) => {
                                                                const isNewestSeg = segIdx === 0
                                                                const nextSeg = tg.segments[segIdx + 1]
                                                                const hasOrderChange = nextSeg ? isOrderChange(nextSeg, seg) : false
                                                                const orderSummary = hasOrderChange && nextSeg?.ordemCodigo
                                                                    ? globalOrderAggregates.get(nextSeg.ordemCodigo)
                                                                    : undefined

                                                                return (
                                                                    <React.Fragment key={seg.key}>
                                                                        <SegmentBlock
                                                                            seg={seg}
                                                                            isNewest={isNewestSeg}
                                                                            selecting={bulkMode}
                                                                            selectedIds={selectedIds}
                                                                            onToggleSelect={toggleSelected}
                                                                            onOpenJustify={openJustifyPanel}
                                                                            onOpenEdit={openEditPanel}
                                                                        />
                                                                        {hasOrderChange && nextSeg && (
                                                                            <div style={{ padding: "4px 14px" }}>
                                                                                <OrderCompletionReport
                                                                                    summary={orderSummary}
                                                                                    fromOrder={nextSeg.ordemCodigo}
                                                                                    toOrder={seg.ordemCodigo}
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </React.Fragment>
                                                                )
                                                            })
                                                        )}
                                                    </div>

                                                    {hasCrossTurnoOrderChange && nextTgNewestSeg && (
                                                        <OrderCompletionReport
                                                            summary={crossTurnoOrderSummary}
                                                            fromOrder={nextTgNewestSeg.ordemCodigo}
                                                            toOrder={tgOldestSeg?.ordemCodigo ?? null}
                                                        />
                                                    )}
                                                </React.Fragment>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>

                {/* ── FILTER PANEL (inline, slides from bottom of content) ─────── */}
                {filterOpen && (
                    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
                        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} onClick={() => setFilterOpen(false)} />
                        <div style={{
                            position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                            width: "100%", maxWidth: 640, background: C_BG,
                            borderTop: `1px solid ${C_BORDER}`,
                            boxShadow: "0 -8px 32px rgba(0,0,0,0.12)",
                        }}>
                            {/* Handle */}
                            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                                <div style={{ width: 32, height: 3, background: C_BORDER }} />
                            </div>

                            {/* Filter header */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px 10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <Filter style={{ width: 13, height: 13, color: C_MUTE }} />
                                    <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, color: C_INK }}>Período de Consulta</span>
                                </div>
                                <button
                                    onClick={() => setFilterOpen(false)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: C_MUTE, display: "flex" }}
                                >
                                    <X style={{ width: 15, height: 15 }} />
                                </button>
                            </div>

                            {/* Quick presets */}
                            <div style={{ padding: "0 16px 10px" }}>
                                <div style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.14em", color: C_MUTE, marginBottom: 6 }}>
                                    Atalhos
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                                    {[
                                        { label: "Turno Atual",  fn: resetToCurrentShift },
                                        { label: "24h",          fn: resetToLast24h },
                                        { label: "48h",          fn: resetToLast48h },
                                        { label: "7 Dias",       fn: resetToLast7Days },
                                        { label: "15 Dias",      fn: resetToLast15Days },
                                        { label: "30 Dias",      fn: resetToLastMonth },
                                    ].map(({ label, fn }) => (
                                        <button
                                            key={label}
                                            onClick={fn}
                                            style={{
                                                fontFamily: UI, fontSize: "14px", fontWeight: 600,
                                                border: `1px solid ${C_BORDER}`, background: C_FAINT, color: C_INK,
                                                padding: "5px 10px", cursor: "pointer",
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = C_BASE }}
                                            onMouseLeave={e => { e.currentTarget.style.background = C_FAINT }}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Date inputs */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px 10px" }}>
                                {[
                                    { label: "Início", date: fromDate, time: fromTime, onDate: setFromDate, onTime: setFromTime },
                                    { label: "Fim",    date: toDate,   time: toTime,   onDate: setToDate,   onTime: setToTime },
                                ].map(({ label, date, time, onDate, onTime }) => (
                                    <div key={label}>
                                        <div style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.14em", color: C_MUTE, marginBottom: 5 }}>
                                            {label}
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 5 }}>
                                            <input
                                                type="date" value={date} onChange={e => onDate(e.target.value)}
                                                style={{ border: `1px solid ${C_BORDER}`, padding: "6px 10px", fontSize: "14px", fontFamily: UI, color: C_INK, background: C_BG, outline: "none", width: "100%", boxSizing: "border-box" as const }}
                                            />
                                            <input
                                                type="time" value={time} onChange={e => onTime(e.target.value)}
                                                style={{ border: `1px solid ${C_BORDER}`, padding: "6px 10px", fontSize: "14px", fontFamily: MONO, color: C_INK, background: C_BG, outline: "none", width: "100%", boxSizing: "border-box" as const }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Footer actions */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 16px", borderTop: `1px solid ${C_BORDER}`, background: C_FAINT }}>
                                <span style={{ fontFamily: MONO, fontSize: "14px", color: C_MUTE }}>{tzLabel}</span>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                        onClick={() => setFilterOpen(false)}
                                        style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, border: `1px solid ${C_BORDER}`, background: C_BG, color: C_INK, padding: "7px 16px", cursor: "pointer" }}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={applyFilter}
                                        style={{ fontFamily: UI, fontSize: "14px", fontWeight: 700, border: "none", background: C_INK, color: "#ffffff", padding: "7px 16px", cursor: "pointer" }}
                                    >
                                        Aplicar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── BOTTOM BAR ─────────────────────────────────────────────── */}
                <div style={{ position: "fixed", bottom: 0, right: 0, width: "100%", maxWidth: 640, zIndex: 20, pointerEvents: "none" }}>
                    {bulkMode ? (
                        <div style={{ pointerEvents: "auto", background: C_INK, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                                {selectedIds.size === 0
                                    ? "Selecione paradas não justificadas"
                                    : `${selectedIds.size} parada${selectedIds.size > 1 ? "s" : ""} selecionada${selectedIds.size > 1 ? "s" : ""}`}
                            </span>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button
                                    onClick={toggleBulkMode}
                                    style={{ fontFamily: UI, fontSize: "14px", fontWeight: 600, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "#fff", padding: "7px 14px", cursor: "pointer" }}
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={openBulkPanel}
                                    disabled={selectedIds.size === 0}
                                    style={{
                                        fontFamily: UI, fontSize: "14px", fontWeight: 700, border: "none",
                                        background: selectedIds.size === 0 ? "rgba(255,255,255,0.15)" : "#fff",
                                        color: selectedIds.size === 0 ? "rgba(255,255,255,0.4)" : C_INK,
                                        padding: "7px 14px", cursor: selectedIds.size === 0 ? "default" : "pointer",
                                    }}
                                >
                                    Justificar selecionadas
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ pointerEvents: "auto", background: C_BG, borderTop: `1px solid ${C_BORDER}`, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontFamily: MONO, fontSize: "14px", color: C_MUTE }}>
                                {dFrom && dTo ? `${fmtShortDate(dFrom)} ${fmtHHMM(dFrom)} → ${fmtShortDate(dTo)} ${fmtHHMM(dTo)}` : ""}
                            </span>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button
                                    onClick={() => setFilterOpen(v => !v)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        height: 34, padding: "0 14px",
                                        fontFamily: UI, fontSize: "14px", fontWeight: 700,
                                        background: filterOpen ? C_INK : C_FAINT,
                                        color: filterOpen ? "#ffffff" : C_INK,
                                        border: `1px solid ${filterOpen ? C_INK : C_BORDER}`,
                                        cursor: "pointer", letterSpacing: "0.04em",
                                        textTransform: "uppercase" as const,
                                    }}
                                >
                                    <Filter style={{ width: 12, height: 12 }} />
                                    Filtrar
                                </button>
                                <button
                                    onClick={() => panelRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
                                    style={{
                                        width: 34, height: 34, background: C_INK, color: "#fff",
                                        border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                                        cursor: "pointer",
                                    }}
                                >
                                    <ArrowUp style={{ width: 14, height: 14 }} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── JUSTIFICAR / EDITAR MOTIVO (bottom sheet) ─────────────────── */}
                {panel && (
                    <JustifyPanel
                        panel={panel}
                        motivos={motivos}
                        motivoId={panelMotivoId}
                        onMotivoId={setPanelMotivoId}
                        obs={panelObs}
                        onObs={setPanelObs}
                        search={panelSearch}
                        onSearch={setPanelSearch}
                        submitting={panelSubmitting}
                        error={panelError}
                        onSubmit={submitPanel}
                        onClose={closePanel}
                    />
                )}

                {/* ── TOAST ──────────────────────────────────────────────────── */}
                {toast && (
                    <div style={{
                        position: "fixed", left: "50%", transform: "translateX(-50%)",
                        bottom: bulkMode || panel ? 90 : 60, width: "calc(100% - 32px)", maxWidth: 608,
                        zIndex: 70, pointerEvents: "none",
                    }}>
                        <div style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                            background: toast.kind === "success" ? "#0f1117" : "#7f1d1d",
                            color: "#fff", fontFamily: UI, fontSize: "14px", fontWeight: 600,
                            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                        }}>
                            {toast.kind === "success" ? <CheckCircle2 style={{ width: 14, height: 14, flexShrink: 0 }} /> : <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />}
                            <span>{toast.msg}</span>
                        </div>
                    </div>
                )}

            </div>
        </div>
    )
}

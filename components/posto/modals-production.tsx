// components/posto/modals-production.tsx
"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Minus, Plus, X } from "lucide-react"

import { usePostoStationDetail } from "@/hooks/posto/use-api"

type UnitKey = "UN" | "KG" | "M"

function cn(...c: Array<string | false | null | undefined>) {
    return c.filter(Boolean).join(" ")
}

function clampInt(n: number, min: number, max: number) {
    if (!Number.isFinite(n)) return min
    return Math.max(min, Math.min(max, Math.trunc(n)))
}

function safeNum(v: unknown, fallback = 0) {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
}

function fmtInt(n: number) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.max(0, Math.trunc(n)))
}

function isoUtcNow() {
    return new Date().toISOString()
}

function useEscapeToClose(isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isOpen, onClose])
}

function useLockBodyScroll(isOpen: boolean) {
    useEffect(() => {
        if (!isOpen) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prev
        }
    }, [isOpen])
}

/** fallback robusto: pega stationId do props OU do /posto/[id] via useParams */
function useStationIdFallback(passedStationId: string | null | undefined) {
    const params = useParams()
    const paramId = (params?.id as string) || null
    return passedStationId || paramId || null
}

function Backdrop({
    isOpen,
    onClose,
    children,
}: {
    isOpen: boolean
    onClose: () => void
    children: React.ReactNode
}) {
    useEscapeToClose(isOpen, onClose)
    useLockBodyScroll(isOpen)

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 bg-black/45 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
            role="dialog"
            aria-modal="true"
        >
            {children}
        </div>
    )
}

/** =========================================================
 * ProductionModal (GOOD) — conectado ao route.ts via hook.actions
 * Compatível com seu page.tsx:
 * <ProductionModal isOpen onClose stationId stationName />
 * ========================================================= */
export function ProductionModal({
    isOpen,
    onClose,
    stationId: stationIdProp,

    empresaId,
    usuarioId,
    sourceSystem,

    stationName: stationNameOverride,
}: {
    isOpen: boolean
    onClose: () => void
    stationId: string | null | undefined

    empresaId?: string | null
    usuarioId?: string | number | null
    sourceSystem?: string | null

    stationName?: string
}) {
    const stationId = useStationIdFallback(stationIdProp)

    const [quantity, setQuantity] = useState(1)
    const [unit, setUnit] = useState<UnitKey>("UN")
    const [showObs, setShowObs] = useState(false)
    const [obs, setObs] = useState("")
    const [uiError, setUiError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const quantityMax = 1_000_000_000

    const posto = usePostoStationDetail({
        stationId,
        empresaId,
        usuarioId,
        sourceSystem,
    })

    const stationName = stationNameOverride || posto.stationName

    const baseTotalGood = useMemo(() => safeNum(posto.stationHeader?.total_good, 0), [posto.stationHeader?.total_good])
    const baseTurnoGood = useMemo(() => safeNum(posto.stationHeader?.turno_good, 0), [posto.stationHeader?.turno_good])

    const [deltaTotal, setDeltaTotal] = useState(0)
    const [deltaTurno, setDeltaTurno] = useState(0)

    useEffect(() => {
        if (!isOpen) return
        setUiError(null)
        setIsSubmitting(false)
        setQuantity(1)
        setUnit("UN")
        setShowObs(false)
        setObs("")
        setDeltaTotal(0)
        setDeltaTurno(0)
    }, [isOpen, baseTotalGood, baseTurnoGood])

    const displayTotalGood = baseTotalGood + deltaTotal
    const displayTurnoGood = baseTurnoGood + deltaTurno

    const closeAndReset = () => {
        setUiError(null)
        setIsSubmitting(false)
        setDeltaTotal(0)
        setDeltaTurno(0)
        setQuantity(1)
        setUnit("UN")
        setShowObs(false)
        setObs("")
        onClose()
    }

    async function handleSubmit() {
        setUiError(null)

        if (!stationId) {
            setUiError("stationId inválido (não encontrado na rota /posto/[id]).")
            return
        }

        const q = clampInt(quantity, 0, quantityMax)
        if (q <= 0) {
            setUiError("Informe uma quantidade maior que zero.")
            return
        }

        try {
            setIsSubmitting(true)

            // optimistic local (não pisca)
            setDeltaTotal((d) => d + q)
            setDeltaTurno((d) => d + q)

            await posto.actions.apontarProducao({
                good: q,
                event_time_utc: isoUtcNow(),
                observacao: showObs ? (obs || "").trim() || null : null,
            })

            closeAndReset()
        } catch (e: any) {
            // rollback
            setDeltaTotal((d) => d - q)
            setDeltaTurno((d) => d - q)
            setUiError(e?.message || "Falha ao apontar produção.")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Backdrop isOpen={isOpen} onClose={closeAndReset}>
            <div className="bg-white rounded-t-2xl sm:rounded-sm w-full sm:max-w-md shadow-2xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "#0f1117" }}>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Apontar</p>
                        <h2 className="text-sm font-semibold text-white leading-tight">Produção — {stationName}</h2>
                    </div>
                    <button onClick={closeAndReset} className="p-1.5 rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors" aria-label="Fechar" disabled={isSubmitting}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Contadores */}
                <div className="px-5 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="border border-slate-200 rounded p-3 bg-slate-50">
                            <p className="text-[11px] text-slate-600">Total (geral)</p>
                            <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmtInt(displayTotalGood)}</p>
                            <p className="text-[11px] text-slate-500">total_good</p>
                        </div>
                        <div className="border border-slate-200 rounded p-3 bg-slate-50">
                            <p className="text-[11px] text-slate-600">Turno (atual)</p>
                            <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmtInt(displayTurnoGood)}</p>
                            <p className="text-[11px] text-slate-500">turno_good</p>
                        </div>
                    </div>
                </div>

                <div className="p-5 space-y-5">
                    {!!uiError && (
                        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{uiError}</div>
                    )}

                    <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as UnitKey)}
                        className="w-full px-4 py-3 border border-slate-200 rounded text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                        disabled={isSubmitting}
                    >
                        <option value="UN">UN</option>
                        <option value="KG">KG</option>
                        <option value="M">M</option>
                    </select>

                    <div className="flex items-center justify-center gap-4">
                        <button
                            onClick={() => setQuantity((q) => clampInt(q - 1, 0, quantityMax))}
                            className="w-14 h-14 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-full transition-colors border border-slate-200"
                            disabled={isSubmitting}
                            aria-label="Diminuir"
                        >
                            <Minus className="w-6 h-6" />
                        </button>

                        <input
                            type="number"
                            min={0}
                            max={quantityMax}
                            step={1}
                            value={quantity}
                            onChange={(e) => {
                                const n = parseInt(e.target.value, 10)
                                setQuantity(clampInt(Number.isFinite(n) ? n : 0, 0, quantityMax))
                            }}
                            className="text-4xl font-extrabold tracking-tight text-slate-900 w-28 text-center tabular-nums border border-slate-200 rounded py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                            disabled={isSubmitting}
                            aria-label="Quantidade"
                        />

                        <button
                            onClick={() => setQuantity((q) => clampInt(q + 1, 0, quantityMax))}
                            className="w-14 h-14 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-full transition-colors border border-slate-200"
                            disabled={isSubmitting}
                            aria-label="Aumentar"
                        >
                            <Plus className="w-6 h-6" />
                        </button>
                    </div>

                    <button
                        onClick={() => setShowObs((v) => !v)}
                        className="w-full py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                        disabled={isSubmitting}
                    >
                        {showObs ? "Ocultar detalhes" : "Quer dar mais detalhes?"}
                    </button>

                    {showObs && (
                        <div className="space-y-2">
                            <label className="text-xs text-slate-600 block">Observação (opcional)</label>
                            <textarea
                                value={obs}
                                onChange={(e) => setObs(e.target.value)}
                                className="w-full min-h-[90px] px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                placeholder="Ex.: ajuste, contagem manual, batelada..."
                                disabled={isSubmitting}
                            />
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={closeAndReset}
                            className="flex-1 py-3 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                            disabled={isSubmitting}
                        >
                            Cancelar
                        </button>

                        <button
                            onClick={handleSubmit}
                            className={cn(
                                "flex-1 py-3 text-sm font-semibold rounded transition-colors",
                                isSubmitting ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "text-white bg-slate-900 hover:bg-slate-800"
                            )}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Apontando..." : "Apontar"}
                        </button>
                    </div>

                    {/* Mantido por UI (sem ação específica) */}
                    <button
                        className="w-full py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                        disabled={isSubmitting}
                        title="Se você quiser apontamento unitário via endpoint específico, eu ligo aqui."
                    >
                        Apontamento Unitário...
                    </button>
                </div>
            </div>
        </Backdrop>
    )
}

/** =========================================================
 * RefugoModal (SCRAP / REWORK) — conectado ao hook.actions
 * Compatível com seu page.tsx atual:
 * <RefugoModal isOpen onClose stationName />
 * (stationId é opcional; pega /posto/[id] via useParams)
 * ========================================================= */
export function RefugoModal({
    isOpen,
    onClose,

    stationId: stationIdProp,

    empresaId,
    usuarioId,
    sourceSystem,

    stationName: stationNameOverride,
}: {
    isOpen: boolean
    onClose: () => void

    /** ✅ opcional (page.tsx atual não passa) */
    stationId?: string | null | undefined

    empresaId?: string | null
    usuarioId?: string | number | null
    sourceSystem?: string | null

    stationName?: string
}) {
    const stationId = useStationIdFallback(stationIdProp)

    const [activeTab, setActiveTab] = useState<"refugo" | "pendentes" | "retrabalho">("refugo")
    const [quantity, setQuantity] = useState(1)
    const [unit, setUnit] = useState<UnitKey>("UN")

    const [searchTerm, setSearchTerm] = useState("")
    const [showObs, setShowObs] = useState(false)
    const [obs, setObs] = useState("")
    const [uiError, setUiError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const quantityMax = 1_000_000_000

    const posto = usePostoStationDetail({
        stationId,
        empresaId,
        usuarioId,
        sourceSystem,
    })

    const stationName = stationNameOverride || posto.stationName

    const baseTotalScrap = useMemo(() => safeNum(posto.stationHeader?.total_scrap, 0), [posto.stationHeader?.total_scrap])
    const baseTotalRework = useMemo(() => safeNum(posto.stationHeader?.total_rework, 0), [posto.stationHeader?.total_rework])
    const baseTurnoScrap = useMemo(() => safeNum(posto.stationHeader?.turno_scrap, 0), [posto.stationHeader?.turno_scrap])
    const baseTurnoRework = useMemo(() => safeNum(posto.stationHeader?.turno_rework, 0), [posto.stationHeader?.turno_rework])

    const [deltaTotalScrap, setDeltaTotalScrap] = useState(0)
    const [deltaTotalRework, setDeltaTotalRework] = useState(0)
    const [deltaTurnoScrap, setDeltaTurnoScrap] = useState(0)
    const [deltaTurnoRework, setDeltaTurnoRework] = useState(0)

    useEffect(() => {
        if (!isOpen) return
        setUiError(null)
        setIsSubmitting(false)
        setQuantity(1)
        setUnit("UN")
        setShowObs(false)
        setObs("")
        setSearchTerm("")
        setActiveTab("refugo")
        setDeltaTotalScrap(0)
        setDeltaTotalRework(0)
        setDeltaTurnoScrap(0)
        setDeltaTurnoRework(0)
    }, [isOpen, baseTotalScrap, baseTotalRework, baseTurnoScrap, baseTurnoRework])

    const displayTotalScrap = baseTotalScrap + deltaTotalScrap
    const displayTotalRework = baseTotalRework + deltaTotalRework
    const displayTurnoScrap = baseTurnoScrap + deltaTurnoScrap
    const displayTurnoRework = baseTurnoRework + deltaTurnoRework

    const closeAndReset = () => {
        setUiError(null)
        setIsSubmitting(false)
        setSearchTerm("")
        setShowObs(false)
        setObs("")
        setQuantity(1)
        setUnit("UN")
        setActiveTab("refugo")
        setDeltaTotalScrap(0)
        setDeltaTotalRework(0)
        setDeltaTurnoScrap(0)
        setDeltaTurnoRework(0)
        onClose()
    }

    async function handleSubmitScrapOrRework() {
        setUiError(null)

        if (!stationId) {
            setUiError("stationId inválido (não encontrado na rota /posto/[id]).")
            return
        }

        if (activeTab !== "refugo" && activeTab !== "retrabalho") {
            setUiError("Selecione Refugo ou Retrabalho para apontar.")
            return
        }

        const q = clampInt(quantity, 0, quantityMax)
        if (q <= 0) {
            setUiError("Informe uma quantidade maior que zero.")
            return
        }

        const isScrap = activeTab === "refugo"
        const scrap = isScrap ? q : 0
        const rework = isScrap ? 0 : q

        try {
            setIsSubmitting(true)

            // optimistic local
            if (scrap > 0) {
                setDeltaTotalScrap((d) => d + scrap)
                setDeltaTurnoScrap((d) => d + scrap)
            }
            if (rework > 0) {
                setDeltaTotalRework((d) => d + rework)
                setDeltaTurnoRework((d) => d + rework)
            }

            await posto.actions.apontarRefugoRetrabalho({
                scrap: scrap > 0 ? scrap : undefined,
                rework: rework > 0 ? rework : undefined,
                motivo_id: null, // compat (se quiser, pluga seleção de motivo depois)
                event_time_utc: isoUtcNow(),
                observacao: showObs ? (obs || "").trim() || null : null,
            })

            closeAndReset()
        } catch (e: any) {
            // rollback local
            if (scrap > 0) {
                setDeltaTotalScrap((d) => d - scrap)
                setDeltaTurnoScrap((d) => d - scrap)
            }
            if (rework > 0) {
                setDeltaTotalRework((d) => d - rework)
                setDeltaTurnoRework((d) => d - rework)
            }
            setUiError(e?.message || "Falha ao apontar refugo/retrabalho.")
        } finally {
            setIsSubmitting(false)
        }
    }

    const tabs = [
        { id: "refugo" as const, label: "Refugo" },
        { id: "pendentes" as const, label: "Pendentes" },
        { id: "retrabalho" as const, label: "Retrabalho" },
    ]

    const isApontamentoTab = activeTab === "refugo" || activeTab === "retrabalho"

    return (
        <Backdrop isOpen={isOpen} onClose={closeAndReset}>
            <div className="bg-white rounded-t-2xl sm:rounded-sm w-full sm:max-w-lg shadow-2xl max-h-[90dvh] sm:max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "#0f1117" }}>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Apontar</p>
                        <h2 className="text-sm font-semibold text-white leading-tight">Refugo / Retrabalho — {stationName}</h2>
                    </div>
                    <button onClick={closeAndReset} className="p-1.5 rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors" aria-label="Fechar" disabled={isSubmitting}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Contadores */}
                <div className="px-5 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="border border-slate-200 rounded p-3 bg-slate-50">
                            <p className="text-[11px] text-slate-600">Turno (Scrap)</p>
                            <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmtInt(displayTurnoScrap)}</p>
                            <p className="text-[11px] text-slate-500">turno_scrap</p>
                        </div>
                        <div className="border border-slate-200 rounded p-3 bg-slate-50">
                            <p className="text-[11px] text-slate-600">Turno (Retrabalho)</p>
                            <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmtInt(displayTurnoRework)}</p>
                            <p className="text-[11px] text-slate-500">turno_rework</p>
                        </div>

                        <div className="border border-slate-200 rounded p-3 bg-slate-50">
                            <p className="text-[11px] text-slate-600">Total (Scrap)</p>
                            <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmtInt(displayTotalScrap)}</p>
                            <p className="text-[11px] text-slate-500">total_scrap</p>
                        </div>
                        <div className="border border-slate-200 rounded p-3 bg-slate-50">
                            <p className="text-[11px] text-slate-600">Total (Retrabalho)</p>
                            <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmtInt(displayTotalRework)}</p>
                            <p className="text-[11px] text-slate-500">total_rework</p>
                        </div>
                    </div>
                </div>

                <div className="flex border-b border-slate-200 mt-4">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            disabled={isSubmitting}
                            className={cn(
                                "flex-1 py-3 text-sm font-semibold transition-colors",
                                activeTab === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
                                isSubmitting && "opacity-60 cursor-not-allowed"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="p-5 overflow-y-auto flex-1 scrollbar-soft space-y-4">
                    {!!uiError && (
                        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{uiError}</div>
                    )}

                    {activeTab === "pendentes" ? (
                        <div className="space-y-4">
                            <div className="bg-amber-600 text-white text-center py-2 rounded font-semibold text-sm">Pendentes</div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Procurar"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="flex-1 px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                    disabled={isSubmitting}
                                />
                                <button
                                    className="px-3 py-2 border border-slate-200 rounded text-slate-400 hover:bg-slate-50"
                                    onClick={() => setSearchTerm("")}
                                    aria-label="Limpar"
                                    disabled={isSubmitting}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="text-center py-8 text-slate-500 text-sm border border-slate-200 rounded bg-slate-50">
                                Sem refugos ou retrabalhos pendentes
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="bg-slate-50 border border-slate-200 text-slate-700 text-center py-2 rounded text-sm">
                                Tipo:{" "}
                                <span className="font-semibold">{activeTab === "refugo" ? "Refugo (scrap)" : "Retrabalho (rework)"}</span>
                            </div>

                            <div className="bg-amber-600 text-white text-center py-2 rounded font-semibold text-sm">
                                Quantidade: <span className="tabular-nums">{fmtInt(quantity)}</span>
                            </div>

                            <select
                                value={unit}
                                onChange={(e) => setUnit(e.target.value as UnitKey)}
                                className="w-full px-4 py-3 border border-slate-200 rounded text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                disabled={isSubmitting}
                            >
                                <option value="UN">UN</option>
                                <option value="KG">KG</option>
                                <option value="M">M</option>
                            </select>

                            <div className="flex items-center justify-center gap-4">
                                <button
                                    onClick={() => setQuantity((q) => clampInt(q - 1, 0, quantityMax))}
                                    className="w-14 h-14 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-full transition-colors border border-slate-200"
                                    aria-label="Diminuir"
                                    disabled={isSubmitting}
                                >
                                    <Minus className="w-6 h-6" />
                                </button>

                                <input
                                    type="number"
                                    min={0}
                                    max={quantityMax}
                                    step={1}
                                    value={quantity}
                                    onChange={(e) => {
                                        const n = parseInt(e.target.value, 10)
                                        setQuantity(clampInt(Number.isFinite(n) ? n : 0, 0, quantityMax))
                                    }}
                                    className="text-4xl font-extrabold tracking-tight text-slate-900 w-28 text-center tabular-nums border border-slate-200 rounded py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                    disabled={isSubmitting}
                                    aria-label="Quantidade"
                                />

                                <button
                                    onClick={() => setQuantity((q) => clampInt(q + 1, 0, quantityMax))}
                                    className="w-14 h-14 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-full transition-colors border border-slate-200"
                                    aria-label="Aumentar"
                                    disabled={isSubmitting}
                                >
                                    <Plus className="w-6 h-6" />
                                </button>
                            </div>

                            <button
                                onClick={() => setShowObs((v) => !v)}
                                className="w-full py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                disabled={isSubmitting}
                            >
                                {showObs ? "Ocultar detalhes" : "Quer dar mais detalhes?"}
                            </button>

                            {showObs && (
                                <div className="space-y-2">
                                    <label className="text-xs text-slate-600 block">Observação (opcional)</label>
                                    <textarea
                                        value={obs}
                                        onChange={(e) => setObs(e.target.value)}
                                        className="w-full min-h-[90px] px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                        placeholder="Ex.: motivo, lote, inspeção, retrabalho..."
                                        disabled={isSubmitting}
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={closeAndReset}
                                    className="py-3 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                    disabled={isSubmitting}
                                >
                                    Cancelar
                                </button>

                                <button
                                    onClick={handleSubmitScrapOrRework}
                                    className={cn(
                                        "py-3 text-sm font-semibold rounded transition-colors",
                                        isSubmitting ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "text-white bg-slate-900 hover:bg-slate-800"
                                    )}
                                    disabled={isSubmitting || !isApontamentoTab}
                                >
                                    {isSubmitting ? "Apontando..." : "Apontar e Fechar"}
                                </button>
                            </div>

                            {/* Mantido por compat UI (desabilitado) */}
                            <button
                                className="w-full py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                disabled
                                title="Mantido por compat (se quiser, adapto para apontar e manter aberto)."
                            >
                                Apontar e Continuar
                            </button>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={closeAndReset}
                        className="px-6 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </Backdrop>
    )
}

/** =========================================================
 * OrderModal (UI-only mantido) — 100% compatível com page.tsx
 * ========================================================= */
export function OrderModal({
    isOpen,
    onClose,
    stationName,
}: {
    isOpen: boolean
    onClose: () => void
    stationName: string
}) {
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedFilter] = useState("A-120")

    useEscapeToClose(isOpen, onClose)
    useLockBodyScroll(isOpen)

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 bg-black/45 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
            role="dialog"
            aria-modal="true"
        >
            <div className="bg-white rounded-t-2xl sm:rounded w-full sm:max-w-lg shadow-2xl max-h-[90dvh] sm:max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">Selecione a Ordem</h2>
                        <p className="text-xs text-slate-600">
                            Centro de Trabalho: <span className="font-medium">{stationName}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="icon-btn" aria-label="Fechar">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 border-b border-slate-200">
                    <input
                        type="text"
                        placeholder="Procurar"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                    />
                    <div className="flex gap-2 mt-3">
                        <button className="px-4 py-2 bg-teal-700 text-white text-sm font-semibold rounded">{selectedFilter}</button>
                    </div>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-4 scrollbar-soft">
                    <div className="text-center py-8 text-slate-600 text-sm border border-slate-200 rounded bg-slate-50">
                        Ainda não há endpoint de lista de ordens no <span className="font-semibold">use-api.ts</span>. (Modal mantido como UI)
                    </div>

                    <button className="w-full py-3 border border-slate-200 rounded text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors">
                        Adicionar Ordem
                    </button>
                </div>
            </div>
        </div>
    )
}
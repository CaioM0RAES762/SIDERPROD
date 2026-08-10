// components/posto/modals-parada.tsx
"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Calendar, Pencil, Trash2, X } from "lucide-react"
import type { UiPendingStop, MotivoParadaRow } from "@/hooks/posto/use-api"
import { postoCriarMotivo, postoEditarMotivo, postoExcluirMotivo } from "@/hooks/posto/use-api"
import { pad2, formatBRDate, stopReasonCodes } from "@/components/posto/utils"

type DurationState = { horas: number; minutos: number; segundos: number }

// Aceita GUID/UUID padrão (SQL Server uniqueidentifier)
const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function isUuid(v: unknown): v is string {
    return typeof v === "string" && UUID_RE.test(v.trim())
}

function clampInt(n: number, min: number, max: number) {
    if (!Number.isFinite(n)) return min
    return Math.max(min, Math.min(max, Math.trunc(n)))
}

function safeParseInt(v: string) {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
}

function durationToSeconds(d: DurationState) {
    const h = clampInt(d.horas, 0, 9999)
    const m = clampInt(d.minutos, 0, 59)
    const s = clampInt(d.segundos, 0, 59)
    return h * 3600 + m * 60 + s
}

function secondsToDuration(totalSec: number): DurationState {
    const sec = Math.max(0, Math.trunc(totalSec))
    const horas = Math.floor(sec / 3600)
    const minutos = Math.floor((sec % 3600) / 60)
    const segundos = sec % 60
    return { horas, minutos, segundos }
}

function formatHmsLabel(totalSec: number) {
    const d = secondsToDuration(totalSec)
    return `${pad2(d.horas)}h${pad2(d.minutos)}m${pad2(d.segundos)}s`
}

function formatIsoUtc(d: Date) {
    return d.toISOString()
}

function dateTimeStrBR(d: Date) {
    const dateStr = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
    const timeStr = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    return { dateStr, timeStr }
}

/** Tipo normalizado interno para exibição e resolução */
type NormalizedReason = {
    code: string
    name: string
    description: string | null
    motivo_id: string | null
}

/**
 * Resolve o motivo_id (GUID) a partir do "code" exibido na UI.
 * Recebe a lista normalizada para buscar — funciona com motivos do banco e com o fallback hardcoded.
 *
 * 🔒 IMPORTANTE:
 * - O SQL Server espera UNIQUEIDENTIFIER (GUID).
 * - NÃO fazemos fallback para "code" numérico pois quebra a constraint uniqueidentifier.
 */
function resolveMotivoUuidFromList(
    motivoCodigo: string | null,
    reasons: NormalizedReason[]
): string | null {
    if (!motivoCodigo) return null
    const hit = reasons.find((c) => String(c.code) === String(motivoCodigo))
    if (!hit) return null
    if (isUuid(hit.motivo_id)) return hit.motivo_id!.trim()
    return null
}

function resolveMotivoLabelFromList(
    code: string | null,
    reasons: NormalizedReason[]
): string | null {
    if (!code) return null
    const hit = reasons.find((c) => String(c.code) === String(code))
    return hit ? `${hit.code}.${hit.name}` : String(code)
}

// ─── Helpers legados (fallback quando stopReasons não passado) ────────────────

type StopReasonAny = {
    code?: string | number
    name?: string
    description?: string
    motivo_id?: string | number
    motivoId?: string | number
    id?: string | number
    value?: string | number
    key?: string | number
}

/** Converte o array legado de stopReasonCodes para NormalizedReason[] */
function normalizeLegacyCodes(arr: StopReasonAny[]): NormalizedReason[] {
    return arr.map((c) => {
        const rawId =
            c?.motivo_id ??
            c?.motivoId ??
            c?.id ??
            c?.value ??
            c?.key ??
            null

        let motivo_id: string | null = null
        if (isUuid(rawId)) motivo_id = String(rawId).trim()
        else if (typeof rawId === "object" && rawId && isUuid((rawId as any).value))
            motivo_id = String((rawId as any).value).trim()

        return {
            code: String(c?.code ?? ""),
            name: String(c?.name ?? ""),
            description: c?.description ? String(c.description) : null,
            motivo_id,
        }
    })
}

/** Converte MotivoParadaRow[] (do banco) para NormalizedReason[] */
function normalizeDbReasons(arr: MotivoParadaRow[]): NormalizedReason[] {
    return arr.map((m) => ({
        code: m.codigo ? String(m.codigo) : String(m.motivo_id),
        name: m.descricao ? String(m.descricao) : (m.codigo ? String(m.codigo) : ""),
        description: null,
        motivo_id: isUuid(m.motivo_id) ? m.motivo_id : null,
    }))
}

// ─── ParadaModal ─────────────────────────────────────────────────────────────

export function ParadaModal({
    isOpen,
    onClose,
    stationName,
    pendingStops,
    onJustificar,
    onIniciarNovaParada,
    initialTab = "apontar",
    initialPendenteId,
    stopReasons,
    empresaId,
    onRefreshMotivos,
}: {
    isOpen: boolean
    onClose: () => void
    stationName: string
    pendingStops: UiPendingStop[]
    onJustificar: (args: {
        parada_id: string | number
        motivo_id?: string | number | null
        justificativa_texto?: string | null
    }) => Promise<void> | void
    onIniciarNovaParada: (args: {
        motivo_id?: string | number | null
        observacao?: string | null
        event_time_utc?: string | null
    }) =>
        | Promise<{ parada_id?: string | number } | void>
        | { parada_id?: string | number }
        | void
    initialTab?: "apontar" | "pendentes" | "nova"
    initialPendenteId?: string | number | null
    stopReasons?: MotivoParadaRow[] | null
    empresaId?: string | null
    onRefreshMotivos?: () => void
}) {
    type Tab = "apontar" | "pendentes" | "nova"

    const [activeTab, setActiveTab] = useState<Tab>(initialTab)

    // relógio / tick
    const [nowTs, setNowTs] = useState<number>(() => Date.now())
    const tickRef = useRef<number | null>(null)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [uiError, setUiError] = useState<string | null>(null)

    // ─── Lista normalizada de motivos ─────────────────────────────────────────
    // Prioridade: banco (stopReasons) > hardcoded (stopReasonCodes)
    const normalizedReasons = useMemo<NormalizedReason[]>(() => {
        if (stopReasons && stopReasons.length > 0) {
            return normalizeDbReasons(stopReasons)
        }
        return normalizeLegacyCodes(stopReasonCodes as StopReasonAny[])
    }, [stopReasons])

    // Wrappers de conveniência que capturam normalizedReasons
    const resolveUuid = (code: string | null) =>
        resolveMotivoUuidFromList(code, normalizedReasons)
    const resolveLabel = (code: string | null) =>
        resolveMotivoLabelFromList(code, normalizedReasons)

    // ==============
    // (1) APONTAR (RETROATIVO)
    // ==============
    const [apontarSelectedCode, setApontarSelectedCode] = useState<string | null>(null)
    const [apontarSearch, setApontarSearch] = useState("")
    const [apontarDuration, setApontarDuration] = useState<DurationState>({ horas: 0, minutos: 0, segundos: 0 })
    const [apontarShowObs, setApontarShowObs] = useState(false)
    const [apontarObs, setApontarObs] = useState("")
    const [apontarInteractionBaseTs, setApontarInteractionBaseTs] = useState<number | null>(null)

    // ==============
    // (2) PENDENTES (JUSTIFICAR)
    // ==============
    const [pendenteIndex, setPendenteIndex] = useState<number | null>(null)
    const [pendenteSelectedCode, setPendenteSelectedCode] = useState<string | null>(null)
    const [pendenteSearch, setPendenteSearch] = useState("")
    const [pendenteShowObs, setPendenteShowObs] = useState(true)
    const [pendenteObs, setPendenteObs] = useState("")

    // ─── FIX: Guard que impede o useEffect de re-inicializar o modal enquanto
    // ele já está aberto. Sem esse guard, qualquer mudança em `pendingStops`
    // (que é recalculado a cada segundo pelo tick do pai) disparava o efeito
    // novamente, chamando setActiveTab(initialTab) e voltando para a aba
    // "apontar" enquanto o usuário estava em "pendentes" ou "nova".
    // ─────────────────────────────────────────────────────────────────────────
    const isOpenRef = useRef(false)

    // Mantém uma ref atualizada de pendingStops para uso no efeito sem
    // colocá-lo como dependência reativa.
    const pendingStopsRef = useRef(pendingStops)
    useEffect(() => {
        pendingStopsRef.current = pendingStops
    })

    useEffect(() => {
        const justOpened = isOpen && !isOpenRef.current
        const justClosed = !isOpen && isOpenRef.current
        isOpenRef.current = isOpen

        if (justOpened) {
            // Inicializa estado SOMENTE na transição fechado → aberto
            setActiveTab(initialTab)

            if (initialTab === "pendentes" && initialPendenteId != null) {
                const foundIndex = pendingStopsRef.current.findIndex(
                    (stop) => String(stop.row.parada_id) === String(initialPendenteId)
                )
                if (foundIndex !== -1) {
                    setPendenteIndex(foundIndex)
                }
            }
        }

        if (justClosed) {
            setPendenteIndex(null)
        }
        // NÃO incluímos pendingStops nem pendingStopsRef como dependências —
        // usamos a ref para ler o valor atual sem criar reatividade.
    }, [isOpen, initialTab, initialPendenteId])

    // ==============
    // (3) NOVA (TEMPO REAL)
    // ==============
    const [novaSelectedCode, setNovaSelectedCode] = useState<string | null>(null)

    // ==============
    // (4) MOTIVOS (CRUD)
    // ==============
    type MotivoSubView = "list" | "form"
    type MotivoFormData = {
        codigo: string; descricao: string; grupo_perda: string
        is_planejada: "0" | "1"; exige_justificativa: boolean
    }
    const [motivosSubView, setMotivosSubView] = useState<MotivoSubView>("list")
    const [editingMotivo, setEditingMotivo] = useState<MotivoParadaRow | null>(null)
    const [motivoForm, setMotivoForm] = useState<MotivoFormData>({
        codigo: "", descricao: "", grupo_perda: "", is_planejada: "1", exige_justificativa: false,
    })
    const [motivoFormError, setMotivoFormError] = useState<string | null>(null)
    const [motivoFormSubmitting, setMotivoFormSubmitting] = useState(false)
    const [excluindoMotivoId, setExcluindoMotivoId] = useState<string | null>(null)
    const [novaSearch, setNovaSearch] = useState("")
    const [novaShowObs, setNovaShowObs] = useState(false)
    const [novaObs, setNovaObs] = useState("")
    const [novaCreatedStopId, setNovaCreatedStopId] = useState<string | number | null>(null)
    const [novaCreatedStartTs, setNovaCreatedStartTs] = useState<number | null>(null)

    const selectedGroup = "Principais Paradas"

    // tick do modal
    useEffect(() => {
        if (!isOpen) return
        setNowTs(Date.now())
        tickRef.current = window.setInterval(() => setNowTs(Date.now()), 1000) as any
        return () => {
            if (tickRef.current) window.clearInterval(tickRef.current)
            tickRef.current = null
        }
    }, [isOpen])

    function hardResetAll() {
        setActiveTab("apontar")
        setUiError(null)
        setIsSubmitting(false)

        setApontarSelectedCode(null)
        setApontarSearch("")
        setApontarDuration({ horas: 0, minutos: 0, segundos: 0 })
        setApontarShowObs(false)
        setApontarObs("")
        setApontarInteractionBaseTs(null)

        setPendenteIndex(null)
        setPendenteSelectedCode(null)
        setPendenteSearch("")
        setPendenteShowObs(true)
        setPendenteObs("")

        setNovaSelectedCode(null)
        setNovaSearch("")
        setNovaShowObs(false)
        setNovaObs("")
        setNovaCreatedStopId(null)
        setNovaCreatedStartTs(null)

        setMotivosSubView("list")
        setEditingMotivo(null)
        setMotivoForm({ codigo: "", descricao: "", grupo_perda: "", is_planejada: "1", exige_justificativa: false })
        setMotivoFormError(null)
        setExcluindoMotivoId(null)
    }

    const handleClose = () => {
        hardResetAll()
        onClose()
    }

    const tabs = useMemo(
        () => [
            { id: "apontar" as const, label: "Apontar parada" },
            { id: "pendentes" as const, label: "Paradas pendentes", badge: pendingStops.length },
            { id: "nova" as const, label: "Iniciar nova" },
        ],
        [pendingStops.length]
    )

    // ─── Filtragem de motivos ─────────────────────────────────────────────────

    const filteredCodesApontar = useMemo(() => {
        const term = apontarSearch.trim().toLowerCase()
        if (!term) return normalizedReasons
        return normalizedReasons.filter(
            (c) =>
                String(c.name).toLowerCase().includes(term) ||
                String(c.code).toLowerCase().includes(term)
        )
    }, [apontarSearch, normalizedReasons])

    const filteredCodesPendente = useMemo(() => {
        const term = pendenteSearch.trim().toLowerCase()
        if (!term) return normalizedReasons
        return normalizedReasons.filter(
            (c) =>
                String(c.name).toLowerCase().includes(term) ||
                String(c.code).toLowerCase().includes(term)
        )
    }, [pendenteSearch, normalizedReasons])

    const filteredCodesNova = useMemo(() => {
        const term = novaSearch.trim().toLowerCase()
        if (!term) return normalizedReasons
        return normalizedReasons.filter(
            (c) =>
                String(c.name).toLowerCase().includes(term) ||
                String(c.code).toLowerCase().includes(term)
        )
    }, [novaSearch, normalizedReasons])

    // ─── APONTAR: duração / início calculado ──────────────────────────────────

    const apontarTypedSec = useMemo(() => durationToSeconds(apontarDuration), [apontarDuration])

    const apontarComputedStartTs = useMemo(() => {
        const base = apontarTypedSec > 0 ? (apontarInteractionBaseTs ?? nowTs) : nowTs
        return base - apontarTypedSec * 1000
    }, [apontarTypedSec, apontarInteractionBaseTs, nowTs])

    const apontarStartDate = useMemo(() => new Date(apontarComputedStartTs), [apontarComputedStartTs])
    const apontarEndDate = useMemo(() => new Date(nowTs), [nowTs])
    const apontarStartBR = useMemo(() => dateTimeStrBR(apontarStartDate), [apontarStartDate])
    const apontarEndBR = useMemo(() => dateTimeStrBR(apontarEndDate), [apontarEndDate])

    // ─── NOVA: cronômetro ao vivo ─────────────────────────────────────────────

    const novaLiveElapsedSec = useMemo(() => {
        if (novaCreatedStartTs == null) return 0
        return Math.max(0, Math.floor((nowTs - novaCreatedStartTs) / 1000))
    }, [novaCreatedStartTs, nowTs])

    const selectedPendingStop = useMemo(() => {
        if (pendenteIndex == null) return null
        return pendingStops[pendenteIndex] || null
    }, [pendingStops, pendenteIndex])

    // ─── Helpers de erro amigável ──────────────────────────────────────────────

    function explainMotivoMissing(code: string | null) {
        const label = resolveLabel(code) ?? "(motivo)"
        return `Não foi possível resolver o ID (GUID) para "${label}". Verifique se o motivo possui um UUID válido no banco.`
    }

    // ─── Ações de submit ──────────────────────────────────────────────────────

    async function doJustificarParada(args: {
        paradaId: string | number
        motivoId?: string | number | null
        texto?: string | null
    }) {
        setUiError(null)
        try {
            setIsSubmitting(true)
            await onJustificar({
                parada_id: args.paradaId,
                motivo_id: args.motivoId ?? null,
                justificativa_texto: (args.texto || "").trim() || null,
            })
        } catch (e: any) {
            setUiError(e?.message || "Falha ao justificar parada")
            throw e
        } finally {
            setIsSubmitting(false)
        }
    }

    async function doIniciarParada(args: {
        motivoId?: string | number | null
        observacao?: string | null
        eventTimeUtc?: string | null
    }) {
        setUiError(null)
        try {
            setIsSubmitting(true)
            const res = await onIniciarNovaParada({
                motivo_id: args.motivoId ?? null,
                observacao: (args.observacao || "").trim() || null,
                event_time_utc: args.eventTimeUtc || null,
            })
            const paradaId = (res as any)?.parada_id ?? (res as any)?.paradaId ?? null
            return paradaId as string | number | null
        } catch (e: any) {
            setUiError(e?.message || "Falha ao iniciar parada")
            throw e
        } finally {
            setIsSubmitting(false)
        }
    }

    function switchTab(tab: Tab) {
        setActiveTab(tab)
        setUiError(null)

        if (tab === "apontar") {
            setPendenteIndex(null)
            setPendenteSelectedCode(null)
            setPendenteSearch("")
            setPendenteObs("")
            setNovaSelectedCode(null)
            setNovaSearch("")
            setNovaObs("")
            setNovaCreatedStopId(null)
            setNovaCreatedStartTs(null)
        }

        if (tab === "pendentes") {
            setApontarSelectedCode(null)
            setApontarSearch("")
            setApontarDuration({ horas: 0, minutos: 0, segundos: 0 })
            setApontarShowObs(false)
            setApontarObs("")
            setApontarInteractionBaseTs(null)
            setNovaSelectedCode(null)
            setNovaSearch("")
            setNovaObs("")
            setNovaCreatedStopId(null)
            setNovaCreatedStartTs(null)
        }

        if (tab === "nova") {
            setApontarSelectedCode(null)
            setApontarSearch("")
            setApontarDuration({ horas: 0, minutos: 0, segundos: 0 })
            setApontarShowObs(false)
            setApontarObs("")
            setApontarInteractionBaseTs(null)
            setPendenteIndex(null)
            setPendenteSelectedCode(null)
            setPendenteSearch("")
            setPendenteObs("")
        }

    }

    function openCreateForm() {
        const codes = normalizedReasons
            .map(r => parseInt(r.code, 10))
            .filter(n => Number.isFinite(n))
        const nextCode = String(codes.length > 0 ? Math.max(...codes) + 1 : 1)
        setEditingMotivo(null)
        setMotivoForm({ codigo: nextCode, descricao: "", grupo_perda: "Principais Paradas", is_planejada: "1", exige_justificativa: true })
        setMotivoFormError(null)
        setMotivosSubView("form")
    }

    function openEditForm(code: NormalizedReason) {
        const original = stopReasons?.find((m) => m.motivo_id === code.motivo_id) ?? null
        setEditingMotivo(original ?? { motivo_id: code.motivo_id!, empresa_id: empresaId || "" })
        setMotivoForm({
            codigo: String(code.code || ""),
            descricao: String(code.name || ""),
            grupo_perda: original?.grupo_perda || "",
            is_planejada: original?.is_planejada ? "1" : "0",
            exige_justificativa: !!original?.exige_justificativa,
        })
        setMotivoFormError(null)
        setMotivosSubView("form")
    }

    async function doExcluirMotivo(motivo_id: string) {
        if (!empresaId) return
        try {
            await postoExcluirMotivo({ empresa_id: empresaId, motivo_id })
            onRefreshMotivos?.()
        } catch {
            // silent
        }
        setExcluindoMotivoId(null)
    }

    const handleDurationChangeApontar = (tipo: keyof DurationState, valor: string, max: number) => {
        if (isSubmitting) return
        setApontarInteractionBaseTs(Date.now())
        setApontarDuration((prev) => ({
            ...prev,
            [tipo]: clampInt(safeParseInt(valor), 0, max),
        }))
    }

    async function submitApontarRetroativo() {
        if (!apontarSelectedCode) {
            setUiError("Selecione um motivo para apontar a parada.")
            return
        }

        const motivoUuid = resolveUuid(apontarSelectedCode)
        if (!motivoUuid) {
            setUiError(explainMotivoMissing(apontarSelectedCode))
            return
        }

        const base = apontarTypedSec > 0 ? (apontarInteractionBaseTs ?? Date.now()) : Date.now()
        const startUtc = apontarTypedSec > 0 ? formatIsoUtc(new Date(base - apontarTypedSec * 1000)) : null

        const paradaId = await doIniciarParada({
            motivoId: motivoUuid,
            observacao: apontarShowObs ? apontarObs : null,
            eventTimeUtc: startUtc,
        })

        if (paradaId != null) {
            try {
                await doJustificarParada({
                    paradaId,
                    motivoId: motivoUuid,
                    texto: apontarShowObs ? apontarObs : null,
                })
            } catch {
                // não bloqueia o fluxo
            }
        }

        handleClose()
    }

    async function submitPendenteJustificar() {
        if (!selectedPendingStop?.row?.parada_id) {
            setUiError("Selecione uma parada pendente.")
            return
        }
        if (!pendenteSelectedCode) {
            setUiError("Selecione um motivo para justificar.")
            return
        }

        const motivoUuid = resolveUuid(pendenteSelectedCode)
        if (!motivoUuid) {
            setUiError(explainMotivoMissing(pendenteSelectedCode))
            return
        }

        await doJustificarParada({
            paradaId: selectedPendingStop.row.parada_id,
            motivoId: motivoUuid,
            texto: pendenteShowObs ? pendenteObs : null,
        })

        setPendenteIndex(null)
        setPendenteSelectedCode(null)
        setPendenteSearch("")
        setPendenteObs("")
    }

    async function submitNovaIniciarAgora() {
        if (!novaSelectedCode) {
            setUiError("Selecione um motivo para iniciar a parada.")
            return
        }

        const motivoUuid = resolveUuid(novaSelectedCode)
        if (!motivoUuid) {
            setUiError(explainMotivoMissing(novaSelectedCode))
            return
        }

        const paradaId = await doIniciarParada({
            motivoId: motivoUuid,
            observacao: novaShowObs ? novaObs : null,
            eventTimeUtc: null,
        })

        setNovaCreatedStopId(paradaId)
        setNovaCreatedStartTs(Date.now())

        if (paradaId != null && novaShowObs && (novaObs || "").trim().length > 0) {
            try {
                await doJustificarParada({
                    paradaId,
                    motivoId: motivoUuid,
                    texto: novaObs,
                })
            } catch {
                // não bloqueia
            }
        }
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
            <div className="bg-white rounded-t-2xl sm:rounded w-full sm:max-w-lg shadow-2xl max-h-[90dvh] sm:max-h-[90vh] overflow-hidden flex flex-col border border-slate-200/80">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "#0f1117" }}>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Parada</p>
                        <h2 className="text-sm font-semibold text-white leading-tight">Parada — {stationName}</h2>
                    </div>
                    <button className="p-1.5 rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors" onClick={handleClose} aria-label="Fechar">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200/80">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => switchTab(tab.id)}
                            className={`flex-1 py-2.5 text-xs font-bold transition-all relative ${activeTab === tab.id
                                ? "bg-slate-900 text-white"
                                : "text-slate-600 hover:bg-slate-50"
                                }`}
                        >
                            {tab.label}
                            {!!tab.badge && tab.badge > 0 && (
                                <span className="absolute top-1 right-2 w-4 h-4 bg-rose-600 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="p-5 overflow-y-auto flex-1 scrollbar-soft">
                    {!!uiError && (
                        <div className="mb-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">
                            {uiError}
                        </div>
                    )}

                    {/* =========================================================
              (1) APONTAR PARADA (RETROATIVO / MANUAL)
              ========================================================= */}
                    {activeTab === "apontar" && (
                        <div className="space-y-4">
                            <div className="bg-slate-50 border border-slate-200 text-slate-700 text-center py-2 rounded text-sm">
                                Grupo do Motivo: <span className="font-semibold">{selectedGroup}</span>
                            </div>

                            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
                                <p className="font-semibold text-slate-800 mb-1">Objetivo: registro manual / retroativo</p>
                                <p>
                                    Use quando a parada <span className="font-semibold">já aconteceu</span> ou você{" "}
                                    <span className="font-semibold">já sabe o tempo exato</span>. Você informa o motivo e a duração; o
                                    sistema calcula o início no passado.
                                </p>
                            </div>

                            {!apontarSelectedCode ? (
                                <>
                                    <div className="bg-slate-900 text-white text-center py-2 rounded font-semibold text-sm">
                                        Selecione o motivo
                                    </div>

                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Procurar"
                                            value={apontarSearch}
                                            onChange={(e) => setApontarSearch(e.target.value)}
                                            className="flex-1 px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                        />
                                        <button
                                            onClick={() => setApontarSearch("")}
                                            className="px-3 py-2 border border-slate-200 rounded text-slate-400 hover:bg-slate-50"
                                            aria-label="Limpar"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={openCreateForm}
                                            className="px-3 py-2 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap"
                                        >
                                            + Cadastrar
                                        </button>
                                    </div>

                                    {filteredCodesApontar.length === 0 ? (
                                        <div className="text-center py-6 text-slate-400 text-sm">
                                            Nenhum motivo encontrado
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3 max-h-56 overflow-y-auto scrollbar-soft">
                                            {filteredCodesApontar.map((code) => (
                                                <div
                                                    key={String(code.code)}
                                                    className="relative group p-3 border border-slate-200 rounded hover:border-slate-400 hover:bg-slate-50 transition-colors"
                                                >
                                                    <button
                                                        className="w-full text-left"
                                                        onClick={() => {
                                                            setApontarSelectedCode(String(code.code))
                                                            setUiError(null)
                                                            setApontarShowObs(false)
                                                            setApontarObs("")
                                                            setApontarInteractionBaseTs(null)
                                                        }}
                                                    >
                                                        <p className="text-sm font-semibold text-slate-900 pr-10">
                                                            {code.code}.{code.name}
                                                        </p>
                                                        {code.description && (
                                                            <p className="text-xs text-slate-500">{code.description}</p>
                                                        )}
                                                    </button>
                                                    {empresaId && code.motivo_id && (
                                                        <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {excluindoMotivoId === code.motivo_id ? (
                                                                <>
                                                                    <button
                                                                        onClick={async (e) => { e.stopPropagation(); await doExcluirMotivo(code.motivo_id!) }}
                                                                        className="text-[10px] px-1.5 py-0.5 bg-slate-900 text-white rounded font-semibold"
                                                                    >Sim</button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setExcluindoMotivoId(null) }}
                                                                        className="text-[10px] px-1.5 py-0.5 border border-slate-200 bg-white rounded text-slate-600"
                                                                    >Não</button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openEditForm(code) }}
                                                                        className="p-1 rounded hover:bg-slate-200 transition-colors"
                                                                        aria-label="Editar"
                                                                    ><Pencil className="w-3 h-3 text-slate-400" /></button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setExcluindoMotivoId(code.motivo_id!) }}
                                                                        className="p-1 rounded hover:bg-slate-100 transition-colors"
                                                                        aria-label="Excluir"
                                                                    ><Trash2 className="w-3 h-3 text-slate-400" /></button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="bg-slate-50 border border-slate-200 text-slate-700 text-center py-2 rounded text-sm">
                                        Motivo selecionado:{" "}
                                        <span className="font-semibold">{resolveLabel(apontarSelectedCode)}</span>
                                    </div>

                                    <div className="bg-slate-900 text-white text-center py-2 rounded font-semibold text-sm">
                                        Duração informada: {formatHmsLabel(apontarTypedSec)}
                                    </div>

                                    <div>
                                        <label className="text-xs text-slate-600 mb-2 block">Duração (manual)</label>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <input
                                                    type="number"
                                                    disabled={isSubmitting}
                                                    value={apontarDuration.horas}
                                                    onChange={(e) => handleDurationChangeApontar("horas", e.target.value, 9999)}
                                                    className="w-full px-4 py-2 border border-slate-200 rounded text-center text-slate-800"
                                                />
                                                <p className="text-[11px] text-slate-500 text-center mt-1">horas</p>
                                            </div>
                                            <div>
                                                <input
                                                    type="number"
                                                    disabled={isSubmitting}
                                                    value={apontarDuration.minutos}
                                                    onChange={(e) => handleDurationChangeApontar("minutos", e.target.value, 59)}
                                                    className="w-full px-4 py-2 border border-slate-200 rounded text-center text-slate-800"
                                                />
                                                <p className="text-[11px] text-slate-500 text-center mt-1">minutos</p>
                                            </div>
                                            <div>
                                                <input
                                                    type="number"
                                                    disabled={isSubmitting}
                                                    value={apontarDuration.segundos}
                                                    onChange={(e) => handleDurationChangeApontar("segundos", e.target.value, 59)}
                                                    className="w-full px-4 py-2 border border-slate-200 rounded text-center text-slate-800"
                                                />
                                                <p className="text-[11px] text-slate-500 text-center mt-1">segundos</p>
                                            </div>
                                        </div>

                                        <div className="mt-3 space-y-2">
                                            <div>
                                                <label className="text-xs text-slate-600 mb-1 block">Início calculado</label>
                                                <div className="flex items-center border border-slate-200 rounded px-4 py-2 bg-white">
                                                    <span className="flex-1 text-slate-800 text-sm tabular-nums">
                                                        {apontarStartBR.dateStr} {apontarStartBR.timeStr}
                                                    </span>
                                                    <Calendar className="w-4 h-4 text-slate-400" />
                                                </div>
                                            </div>

                                            <p className="text-xs text-slate-600 text-right">
                                                Fim (agora):{" "}
                                                <span className="font-semibold tabular-nums">
                                                    {apontarEndBR.dateStr} {apontarEndBR.timeStr}
                                                </span>
                                            </p>
                                        </div>

                                        <p className="text-[11px] text-slate-500 mt-2">
                                            Dica: se você não preencher a duração, o sistema registra a parada a partir de agora.
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => setApontarShowObs((v) => !v)}
                                        className="w-full py-2.5 text-sm font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors"
                                    >
                                        {apontarShowObs ? "Ocultar detalhes" : "Adicionar detalhes (opcional)"}
                                    </button>

                                    {apontarShowObs && (
                                        <div className="space-y-2">
                                            <label className="text-xs text-slate-600 block">Detalhes / Observação</label>
                                            <textarea
                                                value={apontarObs}
                                                onChange={(e) => setApontarObs(e.target.value)}
                                                className="w-full min-h-[90px] px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                                placeholder="Ex.: lançamento retroativo por queda de internet..."
                                                disabled={isSubmitting}
                                            />
                                        </div>
                                    )}

                                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
                                        <p className="font-semibold text-slate-800 mb-1">Atenção</p>
                                        <p>
                                            Este lançamento cria a parada e pode deixar o CT em{" "}
                                            <span className="font-semibold">STOPPED</span>{" "}
                                            até você usar o <span className="font-semibold">Play</span> na tela principal para retomar.
                                        </p>
                                    </div>

                                    <button
                                        disabled={isSubmitting}
                                        onClick={submitApontarRetroativo}
                                        className={`w-full py-3 text-sm font-semibold rounded transition-colors ${isSubmitting
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                            : "bg-slate-900 text-white hover:bg-slate-800"
                                            }`}
                                    >
                                        {isSubmitting ? "Registrando..." : "Registrar parada (retroativo)"}
                                    </button>

                                    <button
                                        disabled={isSubmitting}
                                        onClick={() => {
                                            setApontarSelectedCode(null)
                                            setApontarDuration({ horas: 0, minutos: 0, segundos: 0 })
                                            setApontarShowObs(false)
                                            setApontarObs("")
                                            setUiError(null)
                                            setApontarInteractionBaseTs(null)
                                        }}
                                        className="w-full py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                    >
                                        Trocar motivo
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* =========================================================
              (2) PENDENTES (JUSTIFICAR)
              ========================================================= */}
                    {activeTab === "pendentes" && pendenteIndex === null && (
                        <div className="space-y-4">
                            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
                                <p className="font-semibold text-slate-800 mb-1">Objetivo: limpar pendências</p>
                                <p>O sistema já sabe o tempo. Você só escolhe o motivo e salva (não altera duração).</p>
                            </div>

                            <div className="bg-slate-900 text-white text-center py-2 rounded font-semibold text-sm">
                                Paradas pendentes
                            </div>

                            {pendingStops.length === 0 ? (
                                <div className="text-center py-8 text-slate-500 text-sm border border-slate-200 rounded bg-slate-50">
                                    Sem paradas pendentes
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    {pendingStops.map((stop, index) => (
                                        <button
                                            key={`${stop.row.parada_id}-${index}`}
                                            onClick={() => {
                                                setPendenteIndex(index)
                                                setPendenteSelectedCode(null)
                                                setPendenteSearch("")
                                                setPendenteObs("")
                                                setUiError(null)
                                            }}
                                            className="p-3 border border-slate-200 rounded text-left hover:border-slate-400 hover:bg-slate-50/40 transition-colors relative"
                                        >
                                            {!!stop.status && (
                                                <span className="absolute top-2 right-2 px-2 py-0.5 bg-teal-600 text-white text-[10px] rounded-full font-semibold">
                                                    {stop.status}
                                                </span>
                                            )}

                                            <p className="text-sm font-semibold text-slate-900 tabular-nums">
                                                {stop.date} {stop.time}
                                            </p>
                                            <p className="text-lg font-extrabold tracking-tight text-slate-800 tabular-nums">
                                                {stop.duration}
                                            </p>

                                            <p className="text-xs text-slate-500">
                                                {stop.row?.motivo_id == null
                                                    ? "Motivo não informado"
                                                    : "Parada não justificada"}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "pendentes" && pendenteIndex !== null && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-600">Justificar pendência</span>
                                <button
                                    onClick={() => {
                                        setPendenteIndex(null)
                                        setPendenteSelectedCode(null)
                                        setPendenteSearch("")
                                        setPendenteObs("")
                                        setUiError(null)
                                    }}
                                    className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                                >
                                    Voltar
                                </button>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 text-slate-700 rounded p-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-600">Parada</span>
                                    <span className="font-semibold tabular-nums">
                                        {selectedPendingStop?.date} {selectedPendingStop?.time}
                                    </span>
                                </div>
                                <div className="flex justify-between mt-1">
                                    <span className="text-slate-600">Duração</span>
                                    <span className="font-extrabold tabular-nums">{selectedPendingStop?.duration}</span>
                                </div>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 text-slate-700 text-center py-2 rounded text-sm">
                                Grupo do Motivo: <span className="font-semibold">{selectedGroup}</span>
                            </div>

                            <div className="bg-slate-900 text-white text-center py-2 rounded font-semibold text-sm">
                                Selecione o motivo
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Procurar"
                                    value={pendenteSearch}
                                    onChange={(e) => setPendenteSearch(e.target.value)}
                                    className="flex-1 px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                />
                                <button
                                    onClick={() => setPendenteSearch("")}
                                    className="px-3 py-2 border border-slate-200 rounded text-slate-400 hover:bg-slate-50"
                                    aria-label="Limpar"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={openCreateForm}
                                    className="px-3 py-2 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap"
                                >
                                    + Cadastrar
                                </button>
                            </div>

                            {filteredCodesPendente.length === 0 ? (
                                <div className="text-center py-6 text-slate-400 text-sm">
                                    Nenhum motivo encontrado
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 max-h-56 overflow-y-auto scrollbar-soft">
                                    {filteredCodesPendente.map((code) => (
                                        <div
                                            key={String(code.code)}
                                            className={`relative group p-3 border rounded transition-colors ${pendenteSelectedCode === String(code.code)
                                                ? "border-slate-900 bg-slate-100"
                                                : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                                                }`}
                                        >
                                            <button
                                                className="w-full text-left"
                                                onClick={() => setPendenteSelectedCode(String(code.code))}
                                            >
                                                <p className="text-sm font-semibold text-slate-900 pr-10">
                                                    {code.code}.{code.name}
                                                </p>
                                                {code.description && (
                                                    <p className="text-xs text-slate-500">{code.description}</p>
                                                )}
                                            </button>
                                            {empresaId && code.motivo_id && (
                                                <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {excluindoMotivoId === code.motivo_id ? (
                                                        <>
                                                            <button
                                                                onClick={async (e) => { e.stopPropagation(); await doExcluirMotivo(code.motivo_id!) }}
                                                                className="text-[10px] px-1.5 py-0.5 bg-slate-900 text-white rounded font-semibold"
                                                            >Sim</button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setExcluindoMotivoId(null) }}
                                                                className="text-[10px] px-1.5 py-0.5 border border-slate-200 bg-white rounded text-slate-600"
                                                            >Não</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); openEditForm(code) }}
                                                                className="p-1 rounded hover:bg-slate-200 transition-colors"
                                                                aria-label="Editar"
                                                            ><Pencil className="w-3 h-3 text-slate-400" /></button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setExcluindoMotivoId(code.motivo_id!) }}
                                                                className="p-1 rounded hover:bg-slate-100 transition-colors"
                                                                aria-label="Excluir"
                                                            ><Trash2 className="w-3 h-3 text-slate-400" /></button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button
                                onClick={() => setPendenteShowObs((v) => !v)}
                                className="w-full py-2.5 text-sm font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors"
                            >
                                {pendenteShowObs ? "Ocultar detalhes" : "Adicionar detalhes (opcional)"}
                            </button>

                            {pendenteShowObs && (
                                <div>
                                    <label className="text-xs text-slate-600 mb-1 block">
                                        Justificativa / Detalhes (opcional)
                                    </label>
                                    <textarea
                                        value={pendenteObs}
                                        onChange={(e) => setPendenteObs(e.target.value)}
                                        className="w-full min-h-[90px] px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                        placeholder="Ex.: emergência acionada, ajuste, falta de operador..."
                                        disabled={isSubmitting}
                                    />
                                </div>
                            )}

                            <button
                                disabled={isSubmitting}
                                onClick={submitPendenteJustificar}
                                className={`w-full py-3 rounded text-sm font-semibold transition-colors ${isSubmitting
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "bg-slate-900 text-white hover:bg-slate-800"
                                    }`}
                            >
                                {isSubmitting ? "Salvando..." : "Justificar parada"}
                            </button>
                        </div>
                    )}

                    {/* =========================================================
              (3) NOVA PARADA (TEMPO REAL)
              ========================================================= */}
                    {activeTab === "nova" && (
                        <div className="space-y-4">
                            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
                                <p className="font-semibold text-slate-800 mb-1">Objetivo: iniciar agora (tempo real)</p>
                                <p>
                                    Você escolhe o motivo e clica em{" "}
                                    <span className="font-semibold">Iniciar agora</span>. O sistema começa a contar o tempo ao
                                    vivo. Para encerrar e retomar RUNNING, use o{" "}
                                    <span className="font-semibold">Play</span>.
                                </p>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 text-slate-700 text-center py-2 rounded text-sm">
                                Grupo do Motivo: <span className="font-semibold">{selectedGroup}</span>
                            </div>

                            {!novaSelectedCode ? (
                                <>
                                    <div className="bg-slate-900 text-white text-center py-2 rounded font-semibold text-sm">
                                        Selecione o motivo
                                    </div>

                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Procurar"
                                            value={novaSearch}
                                            onChange={(e) => setNovaSearch(e.target.value)}
                                            className="flex-1 px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                        />
                                        <button
                                            onClick={() => setNovaSearch("")}
                                            className="px-3 py-2 border border-slate-200 rounded text-slate-400 hover:bg-slate-50"
                                            aria-label="Limpar"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={openCreateForm}
                                            className="px-3 py-2 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap"
                                        >
                                            + Cadastrar
                                        </button>
                                    </div>

                                    {filteredCodesNova.length === 0 ? (
                                        <div className="text-center py-6 text-slate-400 text-sm">
                                            Nenhum motivo encontrado
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3 max-h-56 overflow-y-auto scrollbar-soft">
                                            {filteredCodesNova.map((code) => (
                                                <div
                                                    key={String(code.code)}
                                                    className="relative group p-3 border border-slate-200 rounded hover:border-slate-400 hover:bg-slate-50 transition-colors"
                                                >
                                                    <button
                                                        className="w-full text-left"
                                                        onClick={() => {
                                                            setNovaSelectedCode(String(code.code))
                                                            setUiError(null)
                                                            setNovaShowObs(false)
                                                            setNovaObs("")
                                                            setNovaCreatedStopId(null)
                                                            setNovaCreatedStartTs(null)
                                                        }}
                                                    >
                                                        <p className="text-sm font-semibold text-slate-900 pr-10">
                                                            {code.code}.{code.name}
                                                        </p>
                                                        {code.description && (
                                                            <p className="text-xs text-slate-500">{code.description}</p>
                                                        )}
                                                    </button>
                                                    {empresaId && code.motivo_id && (
                                                        <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {excluindoMotivoId === code.motivo_id ? (
                                                                <>
                                                                    <button
                                                                        onClick={async (e) => { e.stopPropagation(); await doExcluirMotivo(code.motivo_id!) }}
                                                                        className="text-[10px] px-1.5 py-0.5 bg-slate-900 text-white rounded font-semibold"
                                                                    >Sim</button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setExcluindoMotivoId(null) }}
                                                                        className="text-[10px] px-1.5 py-0.5 border border-slate-200 bg-white rounded text-slate-600"
                                                                    >Não</button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openEditForm(code) }}
                                                                        className="p-1 rounded hover:bg-slate-200 transition-colors"
                                                                        aria-label="Editar"
                                                                    ><Pencil className="w-3 h-3 text-slate-400" /></button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setExcluindoMotivoId(code.motivo_id!) }}
                                                                        className="p-1 rounded hover:bg-slate-100 transition-colors"
                                                                        aria-label="Excluir"
                                                                    ><Trash2 className="w-3 h-3 text-slate-400" /></button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="bg-slate-50 border border-slate-200 text-slate-700 text-center py-2 rounded text-sm">
                                        Motivo selecionado:{" "}
                                        <span className="font-semibold">{resolveLabel(novaSelectedCode)}</span>
                                    </div>

                                    <div>
                                        <label className="text-xs text-slate-600 mb-1 block">Hora atual</label>
                                        <input
                                            type="text"
                                            readOnly
                                            value={`${formatBRDate(new Date(nowTs))} ${pad2(new Date(nowTs).getHours())}:${pad2(
                                                new Date(nowTs).getMinutes()
                                            )}:${pad2(new Date(nowTs).getSeconds())}`}
                                            className="w-full px-4 py-2 border border-slate-200 rounded text-slate-600 bg-slate-50 tabular-nums"
                                        />
                                    </div>

                                    {novaCreatedStartTs != null && (
                                        <div className="bg-slate-900 text-white text-center py-2 rounded font-semibold text-sm">
                                            Cronômetro ao vivo: {formatHmsLabel(novaLiveElapsedSec)}
                                        </div>
                                    )}

                                    <button
                                        onClick={() => setNovaShowObs((v) => !v)}
                                        className="w-full py-2.5 text-sm font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors"
                                    >
                                        {novaShowObs ? "Ocultar observação" : "Adicionar observação (opcional)"}
                                    </button>

                                    {novaShowObs && (
                                        <div>
                                            <label className="text-xs text-slate-600 mb-1 block">Observação</label>
                                            <textarea
                                                value={novaObs}
                                                onChange={(e) => setNovaObs(e.target.value)}
                                                className="w-full min-h-[90px] px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                                placeholder="Ex.: quebrou correia, ajuste de ferramenta..."
                                                disabled={isSubmitting}
                                            />
                                        </div>
                                    )}

                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        Ao iniciar, o backend coloca o CT em{" "}
                                        <span className="font-semibold">STOPPED</span>. Para retomar{" "}
                                        <span className="font-semibold">RUNNING</span>, use o{" "}
                                        <span className="font-semibold">Play</span>.
                                    </p>

                                    <button
                                        disabled={isSubmitting || novaCreatedStartTs != null}
                                        onClick={submitNovaIniciarAgora}
                                        className={`w-full py-3 rounded text-sm font-semibold transition-colors ${isSubmitting || novaCreatedStartTs != null
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                            : "bg-slate-900 text-white hover:bg-slate-800"
                                            }`}
                                    >
                                        {isSubmitting
                                            ? "Iniciando..."
                                            : novaCreatedStartTs != null
                                                ? "Parada já iniciada"
                                                : "Iniciar agora"}
                                    </button>

                                    <button
                                        disabled={isSubmitting}
                                        onClick={() => {
                                            setNovaSelectedCode(null)
                                            setNovaSearch("")
                                            setNovaShowObs(false)
                                            setNovaObs("")
                                            setNovaCreatedStopId(null)
                                            setNovaCreatedStartTs(null)
                                            setUiError(null)
                                        }}
                                        className="w-full py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                    >
                                        Trocar motivo
                                    </button>

                                    {novaCreatedStopId != null && (
                                        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
                                            Parada iniciada (ID:{" "}
                                            <span className="font-semibold">{String(novaCreatedStopId)}</span>).
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                </div>

                {/* ── Sub-dialog: Cadastrar / Editar Motivo ──────────────────── */}
                {motivosSubView === "form" && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4"
                        onClick={(e) => { if (e.target === e.currentTarget) { setMotivosSubView("list"); setEditingMotivo(null); setMotivoFormError(null) } }}
                    >
                        <div className="bg-white rounded-t-2xl sm:rounded w-full sm:max-w-sm shadow-2xl border border-slate-200 overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <h3 className="text-sm font-bold text-slate-900">
                                    {editingMotivo ? "Editar motivo" : "Cadastrar motivo"}
                                </h3>
                                <button
                                    onClick={() => { setMotivosSubView("list"); setEditingMotivo(null); setMotivoFormError(null) }}
                                    className="icon-btn"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                {!!motivoFormError && (
                                    <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">{motivoFormError}</div>
                                )}
                                <div>
                                    <label className="text-xs text-slate-600 mb-1 block">Código</label>
                                    <input type="text" value={motivoForm.codigo} readOnly className="w-full px-4 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-500 cursor-default" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-600 mb-1 block">Descrição</label>
                                    <input type="text" value={motivoForm.descricao} onChange={(e) => setMotivoForm((f) => ({ ...f, descricao: e.target.value }))} placeholder="Ex.: Janta/Almoço" className="w-full px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400" disabled={motivoFormSubmitting} />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-600 mb-1 block">Tipo de parada</label>
                                    <select value={motivoForm.is_planejada} onChange={(e) => setMotivoForm((f) => ({ ...f, is_planejada: e.target.value as "0" | "1" }))} className="w-full px-4 py-2 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400" disabled={motivoFormSubmitting}>
                                        <option value="1">Planejada</option>
                                        <option value="0">Não planejada</option>
                                    </select>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => { setMotivosSubView("list"); setEditingMotivo(null); setMotivoFormError(null) }} className="flex-1 py-3 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors" disabled={motivoFormSubmitting}>Cancelar</button>
                                    <button
                                        disabled={motivoFormSubmitting || !empresaId}
                                        onClick={async () => {
                                            const codigo = motivoForm.codigo.trim()
                                            const descricao = motivoForm.descricao.trim()
                                            if (!codigo) { setMotivoFormError("Informe o código."); return }
                                            if (!descricao) { setMotivoFormError("Informe a descrição."); return }
                                            if (!empresaId) { setMotivoFormError("empresaId não disponível."); return }
                                            setMotivoFormError(null)
                                            setMotivoFormSubmitting(true)
                                            try {
                                                if (editingMotivo) {
                                                    await postoEditarMotivo({ empresa_id: empresaId, motivo_id: editingMotivo.motivo_id, codigo, descricao, grupo_perda: "Principais Paradas", is_planejada: Number(motivoForm.is_planejada) as 0 | 1, exige_justificativa: 1 })
                                                } else {
                                                    await postoCriarMotivo({ empresa_id: empresaId, codigo, descricao, grupo_perda: "Principais Paradas", is_planejada: Number(motivoForm.is_planejada) as 0 | 1, exige_justificativa: 1 })
                                                }
                                                onRefreshMotivos?.()
                                                setMotivosSubView("list")
                                                setEditingMotivo(null)
                                                setMotivoForm({ codigo: "", descricao: "", grupo_perda: "", is_planejada: "1", exige_justificativa: false })
                                            } catch (e: any) {
                                                setMotivoFormError(e?.message || "Falha ao salvar motivo.")
                                            } finally {
                                                setMotivoFormSubmitting(false)
                                            }
                                        }}
                                        className={`flex-1 py-3 text-sm font-semibold rounded transition-colors ${motivoFormSubmitting || !empresaId ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"}`}
                                    >
                                        {motivoFormSubmitting ? "Salvando..." : editingMotivo ? "Salvar" : "Cadastrar"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="p-4 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={handleClose}
                        className="px-6 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── PlayMenuModal ────────────────────────────────────────────────────────────

export function PlayMenuModal({
    isOpen,
    onClose,
    stationName,
    isStopped,
    onRetomar,
    isBusy,
}: {
    isOpen: boolean
    onClose: () => void
    stationName: string
    isStopped: boolean
    onRetomar: () => void
    isBusy: boolean
}) {
    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-end justify-center z-50 p-0 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white rounded-t-2xl sm:rounded w-full sm:max-w-md shadow-2xl overflow-hidden border border-slate-200/80">
                <div className="p-4 border-b border-slate-200/80">
                    <p className="text-sm font-bold text-slate-900">{stationName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Use o Play para retomar RUNNING quando o centro estiver parado.
                    </p>
                </div>

                <div className="p-4 space-y-3">
                    <button
                        disabled={!isStopped || isBusy}
                        onClick={onRetomar}
                        className={`w-full py-3 rounded text-sm font-bold transition-all ${!isStopped || isBusy
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] shadow-sm shadow-emerald-600/20"
                            }`}
                    >
                        {isBusy ? "Retomando..." : "Retomar Produção"}
                    </button>

                    {!isStopped && (
                        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
                            O centro já está em produção. O Play só fica ativo quando estiver parado.
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200/80 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    )
}
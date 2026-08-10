"use client"

/**
 * components/posto/ordem.tsx
 * OrdemPostoPanel — Clean UX rewrite (integrado ao hooks/posto/use-api.ts)
 *
 * ✅ Integração:
 * - Usa usePostoQueueDetail (SWR) para carregar: availableOrders + queue/current
 * - Usa actions do hook: addToQueue, reorderQueue, updateFinishRule, removeFromQueue, clearQueue, setCurrentOrder
 * - Mantém compat com props existentes (ordemAtual/produtoAtual/progress/isStopped/etc.)
 *
 * Observações importantes:
 * - Backend (FinishRule) tem { tipo, qtd?, fim_utc? }. Não depende de "inicio".
 * - UI mantém datetime-local para "HORARIO", salvando apenas "fim_utc".
 *
 * ✅ Fix DnD (scrollbar / "barra embaixo" / arrasto lateral):
 * - Força overflow-x-hidden nos containers roláveis e overlay
 * - Durante drag, o item original fica opacity: 0 (quem flutua é o DragOverlay)
 * - Drag handlers ficam APENAS no Grip (handle), reduz pan/scroll acidental
 * - collisionDetection: closestCenter (melhor p/ lista vertical)
 * - Bloqueia scroll do body quando modal overlay está aberto
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    ArrowLeft,
    Search,
    RefreshCcw,
    Plus,
    Trash2,
    Play,
    CheckCircle2,
    Clock,
    Ban,
    AlertTriangle,
    Layers,
    Settings2,
    X,
    Wrench,
    Sparkles,
    Info,
    Zap,
    GripVertical,
    MoreVertical,
    ListOrdered,
    PackagePlus,
    Pencil,
    GitFork,
    CheckSquare,
    Square,
    Rocket,
    ChevronDown,
    XCircle,
    Users,
} from "lucide-react"

import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    closestCenter,
    useDroppable,
    useDraggable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from "@dnd-kit/core"

import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
    arrayMove,
    sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"

import { CSS } from "@dnd-kit/utilities"

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import {
    usePostoQueueDetail,
    usePostoCentrosTrabalhoList,
    usePostoCTsComFila,
    usePostoProdutos,
    postoBroadcastQueue,
    postoExecuteOrders,
    type AvailableOrderRow,
    type QueueItemRow,
    type QueueState,
    type FinishRule,
    type FinishRuleTipo,
    type CTBroadcastRow,
    type CTComFilaRow,
    type RetrabalhoPecaRow,
} from "@/hooks/posto/use-api"

/* ─────────── Types ─────────── */

type FinishRuleType = "QTD" | "HORARIO" | "SEM"

export type OrdemCatalogItem = {
    ordem_id: string
    ordem_codigo: string
    produto_codigo?: string | null
    produto_nome?: string | null
    status?: string | null
    produzido?: number | null
    meta?: number | null
}

/* ─────────── Paleta RETRABALHO (âmbar escuro / amarronzado) ───────────
   Mesmos tons usados nos cards do dashboard, para o operador reconhecer
   o estado "retrabalho" na tela do posto e no painel de gestão. */
const RW_INK = "#6b3410"
const RW_DEEP = "#7c3f12"
const RW_ACCENT = "#a5620f"
const RW_LINE = "#e3cfae"
const RW_TINT = "#fbf4e9"
const RW_CHIP = "#f6e8d3"
const RW_SOFT = "#9c7b52"

/** Peça enviada ao backend na configuração do rodízio de retrabalho. */
export type PecaRetrabalhoInput = {
    produto_codigo: string
    produto_id?: string | null
    produto_descricao?: string | null
}

export type FilaItem = {
    fila_item_id: string
    ordem_id: string
    ordem_codigo: string
    produto_codigo?: string | null
    produto_nome?: string | null
    posicao: number
    status_item?: "READY" | "RUNNING" | "PAUSED" | "FINISHED" | "SKIPPED" | "PLANNED"
    produzido?: number | null
    meta?: number | null

    condicao_fim_tipo: FinishRuleType
    condicao_fim_qtd?: number | null
    condicao_fim_fim_utc?: string | null
}

/* ─────────── Helpers ─────────── */

function cn(...parts: Array<string | false | null | undefined>) {
    return parts.filter(Boolean).join(" ")
}

function fmtInt(n?: number | null) {
    const v = Number(n ?? 0)
    return Number.isFinite(v) ? v.toLocaleString("pt-BR") : "0"
}

function pct(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(100, value))
}

function safeNumber(n: unknown, fallback = 0) {
    const v = Number(n)
    return Number.isFinite(v) ? v : fallback
}

function parseISOToLocal(iso?: string | null) {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
}

function toInputLocalValue(d: Date) {
    const pad = (x: number) => String(x).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromInputLocalValue(v: string) {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return d
}

function samePiece(a?: string | null, b?: string | null) {
    const aa = (a || "").trim().toLowerCase()
    const bb = (b || "").trim().toLowerCase()
    if (!aa || !bb) return false
    return aa === bb
}

function isAllowedOrderCode(code?: string | null) {
    return /^(MS|MR)/i.test((code || "").trim())
}

function fmtTimeHHMM(d: Date) {
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${hh}:${mm}`
}

function addMinutes(d: Date, minutes: number) {
    return new Date(d.getTime() + minutes * 60_000)
}

/* ─────────── Neutral status pills ─────────── */

function statusPill(status?: string | null) {
    const s = (status || "").toUpperCase()
    if (s.includes("EXECU") || s.includes("RUN")) return "border-emerald-200 bg-emerald-50 text-emerald-700"
    if (s.includes("INTER") || s.includes("STOP") || s.includes("PAR")) return "border-rose-200 bg-rose-50 text-rose-600"
    return "border-border bg-muted text-muted-foreground"
}

/* ─────────── Mapping: hook rows → UI types ─────────── */

function mapAvailableOrderRow(row: AvailableOrderRow): OrdemCatalogItem | null {
    const ordem_id_raw = row?.ordem_id ?? row?.ordem_public_id ?? row?.id
    const ordem_codigo = String(row?.ordem_codigo ?? row?.ordem_public_id ?? row?.ordem_id ?? "").trim()
    if (!ordem_id_raw || !ordem_codigo) return null

    const ordem_id = String(ordem_id_raw)
    // produto_descricao é o campo mais comum no hook
    const produto_nome = (row as any)?.produto_descricao ?? (row as any)?.produto_nome ?? null
    const produto_codigo = (row as any)?.produto_public_id ?? (row as any)?.produto_codigo ?? null

    // meta/saldo podem variar — tentamos saldo/meta/meta_corrida se existir
    const meta =
        row?.saldo != null
            ? safeNumber(row.saldo, 0)
            : (row as any)?.meta != null
                ? safeNumber((row as any).meta, 0)
                : (row as any)?.meta_corrida != null
                    ? safeNumber((row as any).meta_corrida, 0)
                    : null

    const produzido =
        (row as any)?.produzido != null
            ? safeNumber((row as any).produzido, 0)
            : (row as any)?.total_good != null
                ? safeNumber((row as any).total_good, 0)
                : null

    const status = (row as any)?.status ?? (row as any)?.status_ordem ?? null

    return {
        ordem_id,
        ordem_codigo,
        produto_codigo: produto_codigo ? String(produto_codigo) : null,
        produto_nome: produto_nome ? String(produto_nome) : null,
        status: status ? String(status) : null,
        produzido,
        meta,
    }
}

function mapQueueItemRow(row: QueueItemRow, index: number): FilaItem | null {
    const fila_item_id_raw = row?.fila_item_id ?? row?.id
    const ordem_id_raw = row?.ordem_id ?? row?.ordem_public_id
    const ordem_codigo = String(row?.ordem_codigo ?? row?.ordem_public_id ?? row?.ordem_id ?? "").trim()

    if (!fila_item_id_raw || !ordem_id_raw || !ordem_codigo) return null

    const finish_rule = (row as any)?.finish_rule as FinishRule | null | undefined
    const tipo = String(finish_rule?.tipo ?? "SEM").toUpperCase() as FinishRuleTipo

    const condicao_fim_tipo: FinishRuleType = (tipo === "QTD" || tipo === "HORARIO") ? (tipo as FinishRuleType) : "SEM"
    const condicao_fim_qtd = finish_rule?.qtd != null ? safeNumber(finish_rule.qtd, 0) : null
    const condicao_fim_fim_utc = finish_rule?.fim_utc ? String(finish_rule.fim_utc) : null

    const posicao = row?.posicao != null ? Math.max(1, safeNumber(row.posicao, index + 1)) : index + 1

    const produto_nome = (row as any)?.produto_descricao ?? (row as any)?.produto_nome ?? null
    const produto_codigo = (row as any)?.produto_public_id ?? (row as any)?.produto_codigo ?? null

    const meta =
        (row as any)?.meta != null
            ? safeNumber((row as any).meta, 0)
            : (row as any)?.meta_corrida != null
                ? safeNumber((row as any).meta_corrida, 0)
                : null

    const produzido =
        (row as any)?.produzido != null
            ? safeNumber((row as any).produzido, 0)
            : (row as any)?.total_good != null
                ? safeNumber((row as any).total_good, 0)
                : null

    const status_item = ((row as any)?.status_item ?? (row as any)?.status ?? "READY") as FilaItem["status_item"]

    return {
        fila_item_id: String(fila_item_id_raw),
        ordem_id: String(ordem_id_raw),
        ordem_codigo,
        produto_codigo: produto_codigo ? String(produto_codigo) : null,
        produto_nome: produto_nome ? String(produto_nome) : null,
        posicao,
        status_item,
        produzido,
        meta,
        condicao_fim_tipo,
        condicao_fim_qtd,
        condicao_fim_fim_utc,
    }
}

function mapQueueCurrentFromState(qs: QueueState | null | undefined): FilaItem | null {
    const cur = qs?.current
    if (!cur) return null
    if (!cur.ordem_atual_id && !cur.ordem_codigo) return null

    const condTipo = String(cur.condicao_fim_tipo ?? "SEM").toUpperCase()
    const condicao_fim_tipo: FinishRuleType = (condTipo === "QTD" || condTipo === "HORARIO") ? (condTipo as FinishRuleType) : "SEM"

    return {
        fila_item_id: "current",
        ordem_id: String(cur.ordem_atual_id ?? cur.ordem_codigo ?? "current"),
        ordem_codigo: String(cur.ordem_codigo ?? "--"),
        produto_codigo: null,
        produto_nome: cur.produto_descricao ? String(cur.produto_descricao) : null,
        posicao: 0,
        status_item: "RUNNING",
        produzido: safeNumber(cur.total_good, 0),
        meta: null,
        condicao_fim_tipo,
        condicao_fim_qtd: cur.condicao_fim_qtd != null ? safeNumber(cur.condicao_fim_qtd, 0) : null,
        condicao_fim_fim_utc: cur.condicao_fim_fim_utc ? String(cur.condicao_fim_fim_utc) : null,
    }
}

/* ─────────── DnD IDs ─────────── */

type DragItem = { kind: "avail"; ordem: OrdemCatalogItem } | { kind: "queue"; item: FilaItem } | null
const DROPPABLE_QUEUE = "droppable-queue"

function useQueueDroppable() {
    const { setNodeRef, isOver } = useDroppable({ id: DROPPABLE_QUEUE })
    return { setNodeRef, isOver }
}

function sortableIdQueue(item: FilaItem) {
    return `queue:${item.fila_item_id}`
}
function sortableIdAvail(ord: OrdemCatalogItem) {
    return `avail:${ord.ordem_id}`
}
function parseDragId(id: string): { kind: "queue" | "avail"; key: string } | null {
    if (!id) return null
    if (id.startsWith("queue:")) return { kind: "queue", key: id.replace("queue:", "") }
    if (id.startsWith("avail:")) return { kind: "avail", key: id.replace("avail:", "") }
    return null
}

/* ═══════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════ */

export default function OrdemPostoPanel(props: {
    isOpen: boolean
    onClose: () => void
    centroTrabalhoId: string
    centroTrabalhoNome: string
    ordemAtualCodigo?: string | null
    produtoAtualCodigo?: string | null
    produtoAtualNome?: string | null
    /** produto_atual_id do CT — usado ao semear a peça atual no retrabalho */
    produtoAtualId?: string | null
    progressNow?: number
    progressMax?: number
    isStopped?: boolean

    /** Modo de contagem conhecido pelo pai (fallback até o hook responder). */
    modoContagem?: "GOOD" | "REWORK" | null

    /** se você quiser interceptar a troca (ex.: validações no pai) */
    onTrocarOrdemPreferHook?: (ordemIdOrCodigo: string) => Promise<boolean>

    /** chamando após mutações */
    onAfterMutation?: () => Promise<void> | void

    /** passa empresa/usuario/source se quiser (senão hook resolve fallback) */
    empresaId?: string | null
    usuarioId?: string | number | null
    sourceSystem?: string | null

    displayMode?: "overlay" | "inline"
}) {
    const {
        isOpen,
        onClose,
        centroTrabalhoId,
        centroTrabalhoNome,
        ordemAtualCodigo,
        produtoAtualCodigo,
        produtoAtualNome,
        produtoAtualId,
        progressNow = 0,
        progressMax = 0,
        isStopped = false,
        modoContagem: modoContagemProp,
        onTrocarOrdemPreferHook,
        onAfterMutation,
        empresaId,
        usuarioId,
        sourceSystem,
        displayMode = "overlay",
    } = props

    const [mobileTab, setMobileTab] = useState<"DISP" | "FILA">("DISP")
    const [activeDrag, setActiveDrag] = useState<DragItem>(null)
    const [ruleSheetOpen, setRuleSheetOpen] = useState(false)
    const [broadcastOpen, setBroadcastOpen] = useState(false)
    const [executeOpen, setExecuteOpen] = useState(false)

    const [q, setQ] = useState("")
    const [selectedFilaItemId, setSelectedFilaItemId] = useState<string | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [isMutating, setIsMutating] = useState(false)

    /** peça form modal */
    const [pecaModalOpen, setPecaModalOpen] = useState(false)
    const [pecaModalMode, setPecaModalMode] = useState<"create" | "edit">("create")
    const [pecaEditData, setPecaEditData] = useState<{ produto_codigo: string } | null>(null)

    const openCadastrarPeca = useCallback(() => {
        setPecaEditData(null)
        setPecaModalMode("create")
        setPecaModalOpen(true)
    }, [])

    const openEditarPeca = useCallback((produto_codigo: string) => {
        setPecaEditData({ produto_codigo })
        setPecaModalMode("edit")
        setPecaModalOpen(true)
    }, [])

    /** rate estimation */
    const lastSampleRef = useRef<{ t: number; v: number } | null>(null)
    const [ratePerHour, setRatePerHour] = useState<number | null>(null)

    /** auto advance */
    const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true)
    const [autoAdvanceInfo, setAutoAdvanceInfo] = useState<string | null>(null)

    /** data hook (SWR) */
    const posto = usePostoQueueDetail({
        stationId: centroTrabalhoId,
        empresaId: empresaId ?? null,
        usuarioId: usuarioId ?? null,
        sourceSystem: sourceSystem ?? "APP",
        q,
    })

    const isLoading = useMemo(() => {
        const aLoading = !posto.availableOrdersHook.data && !posto.availableOrdersHook.error
        const qLoading = !posto.queueHook.data && !posto.queueHook.error
        return aLoading || qLoading
    }, [posto.availableOrdersHook.data, posto.availableOrdersHook.error, posto.queueHook.data, posto.queueHook.error])

    const refreshAll = useCallback(() => {
        posto.refreshAll()
    }, [posto])

    const handlePecaSaved = useCallback(() => {
        setPecaModalOpen(false)
        posto.refreshAll()
    }, [posto])

    const tryAfterMutation = useCallback(async () => {
        try {
            await onAfterMutation?.()
        } catch {
            // noop
        }
    }, [onAfterMutation])

    /** map data */
    const queueCurrent = useMemo(() => mapQueueCurrentFromState(posto.queueHook.data), [posto.queueHook.data])

    const queue = useMemo(() => {
        const rows = (posto.queueHook.data?.queue || []) as QueueItemRow[]
        const mapped = rows
            .map((r, idx) => mapQueueItemRow(r, idx))
            .filter(Boolean) as FilaItem[]
        return mapped.slice().sort((a, b) => a.posicao - b.posicao)
    }, [posto.queueHook.data?.queue])

    const queueHasLocal = useMemo(() => queue.some((x) => x.fila_item_id.startsWith("local-")), [queue])

    const availableSorted = useMemo(() => {
        const rows = (posto.availableOrdersHook.data || []) as AvailableOrderRow[]
        const list = rows.map(mapAvailableOrderRow).filter(Boolean) as OrdemCatalogItem[]

        const currentPiece = (produtoAtualCodigo || "").trim()
        const rankStatus = (s?: string | null) => {
            const x = (s || "").toUpperCase()
            if (x.includes("EXECU") || x.includes("RUN")) return 0
            if (x.includes("INTER") || x.includes("STOP")) return 1
            if (x.includes("PLAN")) return 2
            return 3
        }

        list.sort((a, b) => {
            const aSame = samePiece(a.produto_codigo, currentPiece) ? 0 : 1
            const bSame = samePiece(b.produto_codigo, currentPiece) ? 0 : 1
            if (aSame !== bSame) return aSame - bSame
            return rankStatus(a.status) - rankStatus(b.status)
        })

        return list
    }, [posto.availableOrdersHook.data, produtoAtualCodigo])

    const selectedFilaItem = useMemo(
        () => queue.find((x) => x.fila_item_id === selectedFilaItemId) || null,
        [queue, selectedFilaItemId]
    )

    /** setup breaks */
    const setupBreaks = useMemo(() => {
        const breaks = new Set<string>()
        for (let i = 0; i < queue.length; i++) {
            const prev = queue[i - 1]
            const cur = queue[i]
            if (!prev) continue
            const prevPiece = prev.produto_codigo || prev.ordem_codigo
            const curPiece = cur.produto_codigo || cur.ordem_codigo
            if (prevPiece && curPiece && prevPiece !== curPiece) breaks.add(cur.fila_item_id)
        }
        return breaks
    }, [queue])

    /** progress pct */
    const progressPct = useMemo(() => {
        const max = Math.max(1, Number(progressMax || 0))
        return pct((Number(progressNow || 0) / max) * 100)
    }, [progressNow, progressMax])

    /** current display */
    const currentTitle = useMemo(() => {
        const oc = ordemAtualCodigo || queueCurrent?.ordem_codigo || "--"
        const pc = produtoAtualCodigo || queueCurrent?.produto_codigo || "--"
        const pn = produtoAtualNome || queueCurrent?.produto_nome || "--"
        return { oc, pc, pn }
    }, [ordemAtualCodigo, produtoAtualCodigo, produtoAtualNome, queueCurrent])

    /** forecast */
    const forecastFor = useCallback(
        (produzido?: number | null, meta?: number | null) => {
            const prod = safeNumber(produzido, 0)
            const m = safeNumber(meta, 0)
            if (!ratePerHour || ratePerHour <= 0) return null
            if (m <= 0) return null
            const remaining = Math.max(0, m - prod)
            const hours = remaining / ratePerHour
            const minutes = Math.round(hours * 60)
            const end = addMinutes(new Date(), minutes)
            return { minutes, end, label: fmtTimeHHMM(end), ratePerHour }
        },
        [ratePerHour]
    )

    const currentForecast = useMemo(() => forecastFor(Number(progressNow || 0), Number(progressMax || 0)), [forecastFor, progressNow, progressMax])

    /** rate estimation from progressNow */
    useEffect(() => {
        if (!isOpen) return
        const now = Date.now()
        const v = safeNumber(progressNow, 0)
        const prev = lastSampleRef.current
        lastSampleRef.current = { t: now, v }
        if (!prev) return
        const dtMin = (now - prev.t) / 60000
        if (dtMin < 0.25) return
        const dv = v - prev.v
        if (dv <= 0) return
        const perMin = dv / dtMin
        const perHour = perMin * 60
        setRatePerHour((old) => {
            if (!old) return perHour
            return old * 0.65 + perHour * 0.35
        })
    }, [progressNow, isOpen])

    /** errors from hook */
    useEffect(() => {
        const e = posto.queueHook.error || posto.availableOrdersHook.error
        if (!e) return
        setErrorMsg(e instanceof Error ? e.message : "Falha ao carregar fila/ordens.")
    }, [posto.queueHook.error, posto.availableOrdersHook.error])

    /** reset on open */
    useEffect(() => {
        if (!isOpen) return
        setSelectedFilaItemId(null)
        setErrorMsg(null)
        // não zera q automaticamente (melhor UX), mas se quiser:
        // setQ("")
    }, [isOpen])

    const closeAndReset = useCallback(() => {
        setErrorMsg(null)
        setSelectedFilaItemId(null)
        onClose()
    }, [onClose])

    useEffect(() => {
        if (!isOpen || displayMode !== "overlay") return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeAndReset()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isOpen, displayMode, closeAndReset])

    // ✅ trava scroll do body enquanto o overlay estiver aberto
    useEffect(() => {
        if (displayMode !== "overlay") return
        if (!isOpen) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prev
        }
    }, [isOpen, displayMode])

    /** Mutations */
    const handleSetCurrentOrder = useCallback(
        async (ordemId: string) => {
            if (!centroTrabalhoId) return
            setIsMutating(true)
            setErrorMsg(null)
            try {
                const ok = onTrocarOrdemPreferHook ? await onTrocarOrdemPreferHook(ordemId) : false
                if (!ok) {
                    await posto.actions.setCurrentOrder({ ordem_id: ordemId, rule: null })
                }
                await tryAfterMutation()
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : "Falha ao definir ordem atual")
            } finally {
                setIsMutating(false)
            }
        },
        [centroTrabalhoId, posto.actions, onTrocarOrdemPreferHook, tryAfterMutation]
    )

    const handleAddToQueue = useCallback(
        async (ordem: OrdemCatalogItem) => {
            if (!centroTrabalhoId) return
            setIsMutating(true)
            setErrorMsg(null)
            try {
                // regra default: se tiver meta > 0, QTD(meta); senão SEM
                const meta = safeNumber(ordem.meta, 0)
                const rule: FinishRule =
                    meta > 0
                        ? { tipo: "QTD", qtd: meta, fim_utc: null }
                        : { tipo: "SEM", qtd: null, fim_utc: null }

                await posto.actions.addToQueue({ ordem_id: ordem.ordem_id, rule })
                await tryAfterMutation()
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : "Falha ao adicionar na fila")
            } finally {
                setIsMutating(false)
            }
        },
        [centroTrabalhoId, posto.actions, tryAfterMutation]
    )

    const handleRemoveFilaItem = useCallback(
        async (filaItemId: string) => {
            if (!centroTrabalhoId) return
            setIsMutating(true)
            setErrorMsg(null)
            try {
                await posto.actions.removeFromQueue(filaItemId)
                setSelectedFilaItemId((cur) => (cur === filaItemId ? null : cur))
                await tryAfterMutation()
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : "Falha ao remover item")
            } finally {
                setIsMutating(false)
            }
        },
        [centroTrabalhoId, posto.actions, tryAfterMutation]
    )

    const handleClearQueue = useCallback(async () => {
        if (!centroTrabalhoId) return
        if (!window.confirm("Limpar a fila deste CT?")) return
        setIsMutating(true)
        setErrorMsg(null)
        try {
            await posto.actions.clearQueue()
            setSelectedFilaItemId(null)
            await tryAfterMutation()
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : "Falha ao limpar fila")
        } finally {
            setIsMutating(false)
        }
    }, [centroTrabalhoId, posto.actions, tryAfterMutation])

    const commitReorder = useCallback(
        async (next: FilaItem[]) => {
            if (!centroTrabalhoId) return
            setIsMutating(true)
            setErrorMsg(null)
            try {
                // backend espera ids (fila_item_id) na ordem
                await posto.actions.reorderQueue(next.map((x) => x.fila_item_id))
                await tryAfterMutation()
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : "Falha ao reordenar fila")
            } finally {
                setIsMutating(false)
            }
        },
        [centroTrabalhoId, posto.actions, tryAfterMutation]
    )

    /** Modo de contagem (peça boa vs retrabalho) + peças do rodízio.
     *  Fonte da verdade é o backend (hook); a prop do pai serve de fallback
     *  enquanto o SWR não respondeu, para o toggle não "piscar". */
    const modoContagem: "GOOD" | "REWORK" =
        posto.modoContagem ?? modoContagemProp ?? "GOOD"
    const retrabalhoPecas = posto.retrabalhoPecas ?? []
    const isRework = modoContagem === "REWORK"

    const handleSetModoContagem = useCallback(
        async (modo: "GOOD" | "REWORK") => {
            if (!centroTrabalhoId) return
            setErrorMsg(null)
            await posto.actions.setModoContagem(modo)
            await tryAfterMutation()
        },
        [centroTrabalhoId, posto.actions, tryAfterMutation]
    )

    const handleSetRetrabalhoPecas = useCallback(
        async (pecas: PecaRetrabalhoInput[]) => {
            if (!centroTrabalhoId) return
            setErrorMsg(null)
            await posto.actions.setRetrabalhoPecas(pecas)
            await tryAfterMutation()
        },
        [centroTrabalhoId, posto.actions, tryAfterMutation]
    )

    const handleUpdateRule = useCallback(
        async (filaItemId: string, patch: Partial<FilaItem>) => {
            setIsMutating(true)
            setErrorMsg(null)
            try {
                const tipo = (patch.condicao_fim_tipo || "SEM").toUpperCase() as FinishRuleTipo
                const rule: FinishRule = {
                    tipo: (tipo === "QTD" || tipo === "HORARIO") ? tipo : "SEM",
                    qtd: tipo === "QTD" ? (patch.condicao_fim_qtd != null ? safeNumber(patch.condicao_fim_qtd, 0) : null) : null,
                    fim_utc: tipo === "HORARIO" ? (patch.condicao_fim_fim_utc ? String(patch.condicao_fim_fim_utc) : null) : null,
                }
                await posto.actions.updateFinishRule({ fila_item_id: filaItemId, rule })
                await tryAfterMutation()
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : "Falha ao atualizar regra")
            } finally {
                setIsMutating(false)
            }
        },
        [posto.actions, tryAfterMutation]
    )

    /** Auto-advance */
    useEffect(() => {
        if (!isOpen || !autoAdvanceEnabled) return
        const current = queueCurrent
        if (!current) return
        const now = new Date()

        let reached = false
        if (current.condicao_fim_tipo === "QTD") {
            const prod = safeNumber(current.produzido, 0)
            const qtd = safeNumber(current.condicao_fim_qtd, 0)
            if (qtd > 0 && prod >= qtd) reached = true
        } else if (current.condicao_fim_tipo === "HORARIO") {
            const fim = parseISOToLocal(current.condicao_fim_fim_utc || null)
            if (fim && now.getTime() >= fim.getTime()) reached = true
        }

        if (!reached || isMutating) return

        const next = queue.slice().sort((a, b) => a.posicao - b.posicao)[0]
        if (!next) {
            setAutoAdvanceInfo("Condição atingida, mas a fila está vazia.")
            return
        }

        setAutoAdvanceInfo(`Condição atingida. Iniciando: ${next.ordem_codigo}…`)
        void (async () => {
            try {
                await handleSetCurrentOrder(next.ordem_id)
                setAutoAdvanceInfo(null)
            } catch (e: unknown) {
                setAutoAdvanceInfo(e instanceof Error ? e.message : "Falha ao avançar")
            }
        })()
    }, [isOpen, autoAdvanceEnabled, queueCurrent, queue, isMutating, handleSetCurrentOrder])

    /** DnD */
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const { setNodeRef: queueDropRef, isOver: queueIsOver } = useQueueDroppable()

    const handleDragStart = useCallback(
        (e: DragStartEvent) => {
            const parsed = parseDragId(String(e.active.id))
            if (!parsed) return
            if (parsed.kind === "avail") {
                const ord = availableSorted.find((x) => x.ordem_id === parsed.key)
                if (ord) setActiveDrag({ kind: "avail", ordem: ord })
            } else {
                const it = queue.find((x) => x.fila_item_id === parsed.key)
                if (it) setActiveDrag({ kind: "queue", item: it })
            }
        },
        [availableSorted, queue]
    )

    const handleDragEnd = useCallback(
        async (e: DragEndEvent) => {
            const { active, over } = e
            setActiveDrag(null)
            if (!over) return

            const a = parseDragId(String(active.id))
            const oId = String(over.id)
            if (!a) return

            if (a.kind === "avail" && (oId === DROPPABLE_QUEUE || oId.startsWith("queue:"))) {
                const ord = availableSorted.find((x) => x.ordem_id === a.key || x.ordem_codigo === a.key)
                if (ord) await handleAddToQueue(ord)
                return
            }

            if (a.kind === "queue" && oId.startsWith("queue:")) {
                const overParsed = parseDragId(oId)
                if (!overParsed || overParsed.kind !== "queue") return
                const oldIndex = queue.findIndex((x) => x.fila_item_id === a.key)
                const newIndex = queue.findIndex((x) => x.fila_item_id === overParsed.key)
                if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
                const moved = arrayMove(queue, oldIndex, newIndex).map((it, i) => ({ ...it, posicao: i + 1 }))
                await commitReorder(moved)
            }
        },
        [availableSorted, queue, handleAddToQueue, commitReorder]
    )

    const openRuleSheet = useCallback(
        (filaItemId: string) => {
            setSelectedFilaItemId(filaItemId)
            setRuleSheetOpen(true)
        },
        [setSelectedFilaItemId]
    )

    if (!isOpen && displayMode === "overlay") return null

    const overlayRootClass =
        displayMode === "inline"
            ? "w-full overflow-x-hidden"
            : cn(
                "fixed inset-0 z-[40] bg-foreground/40 backdrop-blur-sm overflow-x-hidden",
                isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )

    const panelClass =
        displayMode === "inline"
            ? "w-full overflow-x-hidden"
            : "absolute inset-2 sm:inset-4 lg:inset-6 rounded-2xl bg-white shadow-2xl border border-border overflow-hidden flex flex-col"

    return (
        <div className={overlayRootClass} onMouseDown={displayMode === "overlay" ? closeAndReset : undefined}>
            <div className={cn(panelClass, displayMode === "inline" ? "" : "flex flex-col")} onMouseDown={(e) => e.stopPropagation()}>
                {/* ─── Top Header ─── */}
                <div className="border-b border-border bg-white">
                    <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                onClick={closeAndReset}
                                className="rounded-lg p-1.5 border border-border bg-white hover:bg-muted transition"
                                title="Voltar"
                                aria-label="Voltar"
                            >
                                <ArrowLeft className="w-4 h-4 text-foreground" />
                            </button>
                            <div className="min-w-0">
                                <div className="text-sm font-bold text-foreground truncate flex items-center gap-2">
                                    <Layers className="w-4 h-4 text-muted-foreground" />
                                    <span className="truncate">{centroTrabalhoNome}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {isRework && (
                                <span
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
                                    style={{ background: RW_DEEP, border: `1px solid ${RW_INK}`, color: "#fdf6ea" }}
                                    title="As peças apontadas neste posto contam como RETRABALHO"
                                >
                                    <RefreshCcw className="w-3 h-3" />
                                    Retrabalho
                                </span>
                            )}

                            <span
                                className={cn(
                                    "hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border",
                                    isStopped ? "border-rose-200 bg-rose-50 text-rose-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                )}
                            >
                                <span className={cn("w-1.5 h-1.5 rounded-full", isStopped ? "bg-rose-500" : "bg-emerald-500")} />
                                {isStopped ? "Parado" : "Produzindo"}
                            </span>

                            <button
                                onClick={() => refreshAll()}
                                className="rounded-lg p-1.5 border border-border bg-white hover:bg-muted transition"
                                title="Atualizar"
                                disabled={isLoading || isMutating}
                            >
                                <RefreshCcw className={cn("w-4 h-4 text-muted-foreground", (isLoading || isMutating) && "animate-spin")} />
                            </button>

                            <button
                                onClick={closeAndReset}
                                className="rounded-lg p-1.5 border border-border bg-white hover:bg-muted transition"
                                title="Fechar"
                                aria-label="Fechar"
                            >
                                <X className="w-4 h-4 text-muted-foreground" />
                            </button>
                        </div>
                    </div>

                    {/* ─── OP Atual ─── */}
                    <div className="px-4 sm:px-5 pb-3">
                        <div className="rounded-xl border border-border bg-muted/50 p-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700">
                                            <Play className="w-3 h-3" /> OP Atual
                                        </span>
                                        <span className="text-sm font-bold text-foreground tabular-nums">{currentTitle.oc}</span>
                                        <span className="text-muted-foreground text-xs truncate">
                                            {currentTitle.pc} — {currentTitle.pn}
                                        </span>
                                    </div>

                                    {/* Progress bar */}
                                    <div className="mt-2">
                                        <div className="h-7 rounded-lg bg-secondary overflow-hidden relative">
                                            <div
                                                className="absolute inset-y-0 left-0 bg-foreground transition-all duration-500 rounded-lg"
                                                style={{ width: `${progressPct}%` }}
                                            />
                                            <div className="absolute inset-0 flex items-center justify-center px-2">
                                                <span className={cn("text-xs font-bold tabular-nums", progressPct > 45 ? "text-background" : "text-foreground")}>
                                                    {fmtInt(progressNow)} / {fmtInt(progressMax)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        {ratePerHour ? (
                                            <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                                                <Zap className="w-3 h-3 text-amber-500" />
                                                {Math.round(ratePerHour).toLocaleString("pt-BR")} pç/h
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <Info className="w-3 h-3" /> estimando...
                                            </span>
                                        )}

                                        {currentForecast ? (
                                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                                <Clock className="w-3 h-3" />
                                                término {currentForecast.label}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <Clock className="w-3 h-3" /> sem previsão
                                            </span>
                                        )}

                                        {queueHasLocal && (
                                            <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                                                <AlertTriangle className="w-3 h-3" /> fila local
                                            </span>
                                        )}

                                        {produtoAtualCodigo && (
                                            <span className="inline-flex items-center gap-1 text-sky-600 font-semibold">
                                                <Sparkles className="w-3 h-3" /> otimizar: {produtoAtualCodigo}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => setAutoAdvanceEnabled((v) => !v)}
                                        className={cn(
                                            "rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition",
                                            autoAdvanceEnabled
                                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                : "border-border bg-white text-muted-foreground"
                                        )}
                                        title="Auto-avançar fila quando condição atingida"
                                    >
                                        Auto {autoAdvanceEnabled ? "ON" : "OFF"}
                                    </button>
                                </div>
                            </div>

                            {autoAdvanceInfo && (
                                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 flex items-center justify-between gap-2">
                                    <span>{autoAdvanceInfo}</span>
                                    <button onClick={() => setAutoAdvanceInfo(null)} className="text-amber-500 hover:text-amber-700">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* ─── Modo de contagem + peças em retrabalho ─── */}
                        <div className="mt-2">
                            <ModoContagemPanel
                                modo={modoContagem}
                                pecas={retrabalhoPecas}
                                proximaPosicao={posto.retrabalhoProximaPosicao}
                                migracaoPendente={posto.retrabalhoMigracaoPendente}
                                empresaId={posto.empresaId}
                                produtoAtualCodigo={produtoAtualCodigo ?? queueCurrent?.produto_codigo ?? null}
                                produtoAtualNome={produtoAtualNome ?? queueCurrent?.produto_nome ?? null}
                                produtoAtualId={produtoAtualId ?? null}
                                busy={isMutating}
                                onSetModo={handleSetModoContagem}
                                onSetPecas={handleSetRetrabalhoPecas}
                            />
                        </div>

                        {errorMsg && (
                            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                <span className="font-bold">Erro: </span>
                                {errorMsg}
                            </div>
                        )}
                    </div>

                    {/* Mobile tabs */}
                    <div className="lg:hidden px-4 sm:px-5 pb-3 flex gap-1">
                        <button
                            onClick={() => setMobileTab("DISP")}
                            className={cn(
                                "flex-1 rounded-lg px-3 py-2 text-xs font-semibold border transition text-center",
                                mobileTab === "DISP" ? "border-foreground bg-foreground text-background" : "border-border bg-white text-muted-foreground"
                            )}
                        >
                            Disponíveis
                        </button>
                        <button
                            onClick={() => setMobileTab("FILA")}
                            className={cn(
                                "flex-1 rounded-lg px-3 py-2 text-xs font-semibold border transition text-center",
                                mobileTab === "FILA" ? "border-foreground bg-foreground text-background" : "border-border bg-white text-muted-foreground"
                            )}
                        >
                            Fila ({queue.length})
                        </button>
                    </div>
                </div>

                {/* ─── Body ─── */}
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex-1 overflow-hidden overflow-x-hidden">
                        <div className="h-full grid grid-cols-1 lg:grid-cols-2">
                            {/* LEFT: Disponíveis */}
                            <div className={cn("border-r border-border overflow-hidden overflow-x-hidden flex flex-col", mobileTab === "DISP" ? "flex" : "hidden lg:flex")}>
                                <div className="px-4 sm:px-5 py-3 border-b border-border bg-white">
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <input
                                                value={q}
                                                onChange={(e) => setQ(e.target.value)}
                                                placeholder="Buscar ordem, peça..."
                                                className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                                            />
                                        </div>
                                        <button
                                            onClick={openCadastrarPeca}
                                            className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold border border-border bg-white hover:bg-muted transition inline-flex items-center gap-1.5"
                                            title="Cadastrar nova peça"
                                        >
                                            <PackagePlus className="w-4 h-4" />
                                            <span className="hidden sm:inline">Cadastrar peça</span>
                                        </button>
                                    </div>
                                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                                        Arraste para a fila ou use o menu <MoreVertical className="w-3 h-3 inline" /> do cartão.
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto overflow-x-hidden px-4 sm:px-5 pb-4">
                                    <div className="pt-3 space-y-2">
                                        {availableSorted
                                            .filter((x) => isAllowedOrderCode(x.ordem_codigo))
                                            .filter((x) => {
                                                const qq = (q || "").trim().toLowerCase()
                                                if (!qq) return true
                                                return (
                                                    x.ordem_codigo.toLowerCase().includes(qq) ||
                                                    (x.produto_codigo || "").toLowerCase().includes(qq) ||
                                                    (x.produto_nome || "").toLowerCase().includes(qq)
                                                )
                                            })
                                            .map((ord) => (
                                                <OrderCardClean
                                                    key={ord.ordem_id}
                                                    ord={ord}
                                                    isMutating={isMutating}
                                                    currentPiece={produtoAtualCodigo || null}
                                                    onSetCurrent={() => handleSetCurrentOrder(ord.ordem_id)}
                                                    onAddQueue={() => handleAddToQueue(ord)}
                                                    onEditPeca={() => openEditarPeca(ord.produto_codigo || ord.ordem_codigo)}
                                                />
                                            ))}

                                        {availableSorted.filter((x) => isAllowedOrderCode(x.ordem_codigo)).length === 0 && (
                                            <div className="pt-10 text-center text-sm text-muted-foreground">
                                                {isLoading ? "Carregando..." : "Nenhuma ordem encontrada."}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* RIGHT: Fila */}
                            <div className={cn("overflow-hidden overflow-x-hidden flex flex-col", mobileTab === "FILA" ? "flex" : "hidden lg:flex")}>
                                <div className="px-4 sm:px-5 py-3 border-b border-border bg-white flex items-center justify-between gap-2">
                                    <div className="text-sm font-bold text-foreground flex items-center gap-2">
                                        <ListOrdered className="w-4 h-4 text-muted-foreground" />
                                        Fila
                                        <span className="text-muted-foreground font-normal text-xs">({queue.length})</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => setExecuteOpen(true)}
                                            disabled={isMutating}
                                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition inline-flex items-center gap-1.5 disabled:opacity-40"
                                            title="Executar a 1ª ordem da fila dos CTs"
                                        >
                                            <Rocket className="w-3.5 h-3.5" />
                                            <span className="hidden sm:inline">Executar 1ª ordem</span>
                                        </button>
                                        <button
                                            onClick={() => setBroadcastOpen(true)}
                                            disabled={isMutating || queue.length === 0}
                                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition inline-flex items-center gap-1.5 disabled:opacity-40"
                                            title="Enviar esta fila para outros CTs"
                                        >
                                            <GitFork className="w-3.5 h-3.5" />
                                            <span className="hidden sm:inline">Enviar para CTs</span>
                                        </button>
                                        <button
                                            onClick={handleClearQueue}
                                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition inline-flex items-center gap-1.5"
                                            disabled={isMutating || queue.length === 0}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> Limpar
                                        </button>
                                    </div>
                                </div>

                                {setupBreaks.size > 0 && (
                                    <div className="mx-4 sm:mx-5 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 flex items-center gap-2">
                                        <Wrench className="w-3.5 h-3.5 shrink-0" />
                                        <span>Setup detectado: há trocas de peça na fila.</span>
                                    </div>
                                )}

                                <div
                                    ref={queueDropRef}
                                    className={cn(
                                        "flex-1 overflow-auto overflow-x-hidden px-4 sm:px-5 pb-4 min-h-[300px] transition-colors rounded-b-lg",
                                        queueIsOver ? "bg-emerald-50/70 border-2 border-dashed border-emerald-300" : ""
                                    )}
                                >
                                    <div className="pt-3">
                                        <SortableContext items={queue.map(sortableIdQueue)} strategy={verticalListSortingStrategy}>
                                            <div className="space-y-2">
                                                {queue.map((item) => {
                                                    const isSetupBreak = setupBreaks.has(item.fila_item_id)
                                                    return (
                                                        <div key={item.fila_item_id}>
                                                            {isSetupBreak && (
                                                                <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 flex items-center gap-2">
                                                                    <Wrench className="w-3.5 h-3.5" /> Setup necessário
                                                                </div>
                                                            )}
                                                            <QueueItemClean
                                                                item={item}
                                                                isMutating={isMutating}
                                                                currentPiece={produtoAtualCodigo || null}
                                                                forecast={forecastFor(item.produzido ?? 0, item.meta ?? 0)}
                                                                onExecuteNow={() => handleSetCurrentOrder(item.ordem_id)}
                                                                onRemove={() => handleRemoveFilaItem(item.fila_item_id)}
                                                                onOpenRules={() => openRuleSheet(item.fila_item_id)}
                                                            />
                                                        </div>
                                                    )
                                                })}

                                                {queue.length === 0 && (
                                                    <div className="pt-10 text-center text-sm text-muted-foreground">
                                                        {isLoading ? "Carregando..." : "Fila vazia. Arraste ordens da esquerda."}
                                                    </div>
                                                )}
                                            </div>
                                        </SortableContext>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Drag overlay */}
                    <DragOverlay>
                        {activeDrag ? (
                            <div className="rounded-xl border border-border bg-white shadow-xl p-3 w-[280px]">
                                {activeDrag.kind === "avail" ? (
                                    <div>
                                        <div className="text-sm font-bold text-foreground tabular-nums">{activeDrag.ordem.ordem_codigo}</div>
                                        <div className="text-xs text-muted-foreground truncate">{activeDrag.ordem.produto_nome || "--"}</div>
                                        <div className="mt-1.5 text-[11px] text-emerald-600 font-semibold">Solte na fila</div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="text-sm font-bold text-foreground tabular-nums">{activeDrag.item.ordem_codigo}</div>
                                        <div className="text-xs text-muted-foreground truncate">{activeDrag.item.produto_nome || "--"}</div>
                                        <div className="mt-1.5 text-[11px] text-muted-foreground">Reordenando...</div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>

                {/* ─── Rule Sheet ─── */}
                <Sheet open={ruleSheetOpen} onOpenChange={setRuleSheetOpen}>
                    <SheetContent side="right" className="w-full sm:max-w-md">
                        <SheetHeader>
                            <SheetTitle>Regras de Fim {selectedFilaItem ? `— ${selectedFilaItem.ordem_codigo}` : ""}</SheetTitle>
                            <SheetDescription>Configure a condição de encerramento desta OP na fila.</SheetDescription>
                        </SheetHeader>
                        <div className="flex-1 overflow-auto overflow-x-hidden px-4 pb-4">
                            {selectedFilaItem ? (
                                <div>
                                    <div className="rounded-lg border border-border bg-muted/50 p-3 mb-4">
                                        <div className="text-xs text-muted-foreground font-semibold">Ordem</div>
                                        <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{selectedFilaItem.ordem_codigo}</div>
                                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                                            {selectedFilaItem.produto_codigo || "--"} — {selectedFilaItem.produto_nome || "--"}
                                        </div>
                                    </div>

                                    <RuleEditor
                                        item={selectedFilaItem}
                                        busy={isMutating}
                                        onUpdate={(patch) => {
                                            handleUpdateRule(selectedFilaItem.fila_item_id, patch)
                                            setRuleSheetOpen(false)
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="pt-6 text-sm text-muted-foreground">Nenhum item selecionado.</div>
                            )}
                        </div>
                    </SheetContent>
                </Sheet>

                {/* ─── Peça Form Modal ─── */}
                <PecaFormModal
                    isOpen={pecaModalOpen}
                    mode={pecaModalMode}
                    produtoCodigo={pecaEditData?.produto_codigo ?? null}
                    empresaId={empresaId ?? null}
                    onClose={() => setPecaModalOpen(false)}
                    onSaved={handlePecaSaved}
                />

                {/* ─── Broadcast Modal ─── */}
                <BroadcastQueueDialog
                    open={broadcastOpen}
                    onOpenChange={setBroadcastOpen}
                    centroTrabalhoId={centroTrabalhoId}
                    empresaId={empresaId ?? null}
                    queue={queue}
                />

                {/* ─── Executar 1ª ordem dos CTs ─── */}
                <ExecuteFirstOrdersDialog
                    open={executeOpen}
                    onOpenChange={setExecuteOpen}
                    empresaId={empresaId ?? null}
                    usuarioId={usuarioId ?? null}
                    sourceSystem={sourceSystem ?? null}
                    onExecuted={() => posto.refreshAll()}
                />
            </div>
        </div>
    )
}

/* ═══════════════════════════════════════════════════
   OrderCardClean
   ═══════════════════════════════════════════════════ */

function OrderCardClean(props: {
    ord: OrdemCatalogItem
    isMutating: boolean
    currentPiece: string | null
    onSetCurrent: () => void
    onAddQueue: () => void
    onEditPeca: () => void
}) {
    const { ord, isMutating, currentPiece, onSetCurrent, onAddQueue, onEditPeca } = props
    const meta = safeNumber(ord.meta, 0)
    const prod = safeNumber(ord.produzido, 0)
    const p = meta > 0 ? pct((prod / meta) * 100) : 0
    const isSame = samePiece(ord.produto_codigo, currentPiece)
    const isRunning = (ord.status || "").toUpperCase().includes("EXECU") || (ord.status || "").toUpperCase().includes("RUN")
    const dragId = sortableIdAvail(ord)

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: dragId })

    // ✅ durante drag o item original some: quem "flutua" é o DragOverlay
    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : 1,
    }

    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!menuOpen) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [menuOpen])

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "rounded-xl border bg-white p-3 transition-all select-none",
                isSame ? "border-sky-200 bg-sky-50/40" : "border-border",
                "cursor-default"
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    {/* ✅ HANDLE: drag só no grip (evita arrasto lateral/scroll) */}
                    <span
                        {...attributes}
                        {...listeners}
                        className={cn(
                            "shrink-0 inline-flex items-center justify-center rounded-md p-1 -m-1",
                            "cursor-grab active:cursor-grabbing hover:bg-muted",
                            "touch-none"
                        )}
                        title="Arrastar"
                        aria-label="Arrastar"
                    >
                        <GripVertical className="w-4 h-4 text-muted-foreground/50" />
                    </span>

                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-foreground tabular-nums">{ord.ordem_codigo}</span>
                            <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold border", statusPill(ord.status))}>
                                {(ord.status || "PLANEJADA").replaceAll("_", " ")}
                            </span>
                            {isSame && (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border border-sky-200 bg-sky-50 text-sky-700">
                                    <Sparkles className="w-3 h-3" /> mesma peça
                                </span>
                            )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground truncate">
                            {ord.produto_codigo || "--"} — {ord.produto_nome || "--"}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {isRunning && meta > 0 ? (
                        <MiniProgress value={p} />
                    ) : meta > 0 ? (
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{Math.round(p)}%</span>
                    ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                    )}

                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                setMenuOpen(!menuOpen)
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="rounded-lg p-1.5 hover:bg-muted transition"
                            title="Ações"
                        >
                            <MoreVertical className="w-4 h-4 text-muted-foreground" />
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border bg-white shadow-lg min-w-[160px] py-1">
                                <button
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onSetCurrent()
                                        setMenuOpen(false)
                                    }}
                                    disabled={isMutating}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Play className="w-3.5 h-3.5" /> Definir atual
                                </button>

                                <button
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onAddQueue()
                                        setMenuOpen(false)
                                    }}
                                    disabled={isMutating}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Enfileirar
                                </button>

                                <button
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onEditPeca()
                                        setMenuOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition flex items-center gap-2"
                                >
                                    <Pencil className="w-3.5 h-3.5" /> Editar peça
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function MiniProgress({ value }: { value: number }) {
    const radius = 12
    const stroke = 3
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (value / 100) * circumference
    const size = (radius + stroke) * 2

    return (
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-border" />
                <circle
                    cx={radius + stroke}
                    cy={radius + stroke}
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={stroke}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className="text-foreground"
                />
            </svg>
            <span className="absolute text-[8px] font-bold text-foreground tabular-nums">{Math.round(value)}</span>
        </div>
    )
}

/* ═══════════════════════════════════════════════════
   QueueItemClean
   ═══════════════════════════════════════════════════ */

function QueueItemClean(props: {
    item: FilaItem
    isMutating: boolean
    currentPiece: string | null
    forecast: { minutes: number; end: Date; label: string; ratePerHour: number } | null
    onExecuteNow: () => void
    onRemove: () => void
    onOpenRules: () => void
}) {
    const { item, isMutating, currentPiece, forecast, onExecuteNow, onRemove, onOpenRules } = props
    const id = sortableIdQueue(item)
    const sortable = useSortable({ id })

    // ✅ durante drag o item original some: overlay flutua sem gerar scrollbar
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0 : 1,
    }

    const meta = safeNumber(item.meta, 0)
    const prod = safeNumber(item.produzido, 0)
    const p = meta > 0 ? pct((prod / meta) * 100) : 0

    const ruleLabel =
        item.condicao_fim_tipo === "QTD"
            ? `QTD: ${fmtInt(item.condicao_fim_qtd || meta)}`
            : item.condicao_fim_tipo === "HORARIO"
                ? (() => {
                    const d = parseISOToLocal(item.condicao_fim_fim_utc || null)
                    return d ? `Horário: até ${fmtTimeHHMM(d)}` : "Horário"
                })()
                : "Sem condição"

    const statusIcon =
        item.status_item === "RUNNING" ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        ) : item.status_item === "PAUSED" ? (
            <Ban className="w-3.5 h-3.5 text-rose-500" />
        ) : (
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        )

    const isSame = samePiece(item.produto_codigo, currentPiece)

    return (
        <div
            ref={sortable.setNodeRef}
            style={style}
            className={cn(
                "rounded-xl border bg-white p-3 transition-all select-none",
                isSame ? "border-sky-200 bg-sky-50/30" : "border-border"
            )}
        >
            <div className="flex items-start gap-2.5">
                <div className="flex items-center gap-2 shrink-0">
                    {/* ✅ HANDLE: drag só no grip */}
                    <span
                        {...sortable.attributes}
                        {...sortable.listeners}
                        className={cn(
                            "inline-flex items-center justify-center rounded-md p-1 -m-1",
                            "cursor-grab active:cursor-grabbing hover:bg-muted",
                            "touch-none"
                        )}
                        title="Reordenar"
                        aria-label="Reordenar"
                    >
                        <GripVertical className="w-4 h-4 text-muted-foreground/50" />
                    </span>

                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-foreground text-background font-bold text-xs tabular-nums">
                        {item.posicao}
                    </span>
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground tabular-nums">{item.ordem_codigo}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                            {statusIcon} {item.status_item || "READY"}
                        </span>
                        {isSame && (
                            <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border border-sky-200 bg-sky-50 text-sky-700">
                                <Sparkles className="w-3 h-3" /> mesma peça
                            </span>
                        )}
                    </div>

                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                        {item.produto_codigo || "--"} — {item.produto_nome || "--"}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <Settings2 className="w-3 h-3" /> {ruleLabel}
                        </span>
                        {meta > 0 && <span className="font-semibold tabular-nums">{Math.round(p)}%</span>}
                        {forecast && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <Clock className="w-3 h-3" /> {forecast.label}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation()
                            onOpenRules()
                        }}
                        className="rounded-lg p-1.5 hover:bg-muted transition"
                        title="Editar regras"
                    >
                        <Settings2 className="w-4 h-4 text-muted-foreground" />
                    </button>

                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation()
                            onExecuteNow()
                        }}
                        className="rounded-lg p-1.5 hover:bg-emerald-50 transition"
                        title="Executar agora"
                        disabled={isMutating}
                    >
                        <Play className="w-4 h-4 text-emerald-600" />
                    </button>

                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        className="rounded-lg p-1.5 hover:bg-rose-50 transition"
                        title="Remover"
                        disabled={isMutating}
                    >
                        <Trash2 className="w-4 h-4 text-rose-500" />
                    </button>
                </div>
            </div>
        </div>
    )
}

/* ═══════════════════════════════════════════════════
   RuleEditor (alinhado ao FinishRule do backend)
   - QTD: usa qtd
   - HORARIO: salva apenas fim_utc (sem início)
   - SEM: limpa tudo
   ═══════════════════════════════════════════════════ */

function RuleEditor(props: {
    item: FilaItem
    onUpdate: (patch: Partial<FilaItem>) => void
    busy?: boolean
}) {
    const { item, onUpdate, busy = false } = props
    const meta = safeNumber(item.meta, 0)

    const [tipo, setTipo] = useState<FinishRuleType>(item.condicao_fim_tipo)
    const [qtd, setQtd] = useState<string>(item.condicao_fim_qtd != null ? String(item.condicao_fim_qtd) : "")
    const [fimLocal, setFimLocal] = useState<string>(() => {
        const d = parseISOToLocal(item.condicao_fim_fim_utc || null)
        return d ? toInputLocalValue(d) : ""
    })
    const [warnQtd, setWarnQtd] = useState<string | null>(null)

    useEffect(() => {
        setTipo(item.condicao_fim_tipo)
        setQtd(item.condicao_fim_qtd != null ? String(item.condicao_fim_qtd) : "")
        const d2 = parseISOToLocal(item.condicao_fim_fim_utc || null)
        setFimLocal(d2 ? toInputLocalValue(d2) : "")
        setWarnQtd(null)
    }, [item.fila_item_id, item.condicao_fim_tipo, item.condicao_fim_qtd, item.condicao_fim_fim_utc])

    const canSave = useMemo(() => {
        if (tipo === "QTD") {
            const n = Number(qtd)
            return Number.isFinite(n) && n > 0
        }
        if (tipo === "HORARIO") {
            const df = fimLocal ? fromInputLocalValue(fimLocal) : null
            return !!df
        }
        return true
    }, [tipo, qtd, fimLocal])

    useEffect(() => {
        if (tipo !== "QTD") {
            setWarnQtd(null)
            return
        }
        const n = Number(qtd || "0")
        if (!Number.isFinite(n) || n <= 0) {
            setWarnQtd(null)
            return
        }
        if (meta > 0 && n > meta) setWarnQtd(`QTD maior que a meta (${fmtInt(meta)}). Será ajustado ao salvar.`)
        else setWarnQtd(null)
    }, [tipo, qtd, meta])

    const doSave = useCallback(() => {
        if (!canSave) return

        if (tipo === "SEM") {
            onUpdate({ condicao_fim_tipo: "SEM", condicao_fim_qtd: null, condicao_fim_fim_utc: null })
            return
        }

        if (tipo === "QTD") {
            let n = Math.floor(Number(qtd))
            if (meta > 0 && n > meta) n = meta
            onUpdate({ condicao_fim_tipo: "QTD", condicao_fim_qtd: n, condicao_fim_fim_utc: null })
            return
        }

        const df = fimLocal ? fromInputLocalValue(fimLocal) : null
        onUpdate({
            condicao_fim_tipo: "HORARIO",
            condicao_fim_qtd: null,
            condicao_fim_fim_utc: df ? df.toISOString() : null,
        })
    }, [tipo, qtd, fimLocal, canSave, onUpdate, meta])

    return (
        <div className="space-y-4">
            <div>
                <label className="text-xs font-semibold text-muted-foreground">Condição de fim</label>
                <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as FinishRuleType)}
                    className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                >
                    <option value="QTD">Por Quantidade</option>
                    <option value="HORARIO">Por Horário</option>
                    <option value="SEM">Sem Condição</option>
                </select>
            </div>

            {tipo === "QTD" && (
                <div>
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-muted-foreground">Quantidade alvo (un)</label>
                        <span className="text-[11px] text-muted-foreground tabular-nums">Meta: {meta > 0 ? fmtInt(meta) : "—"}</span>
                    </div>
                    <input
                        value={qtd}
                        onChange={(e) => setQtd(e.target.value.replace(/[^\d]/g, ""))}
                        placeholder={meta > 0 ? `Máx ${fmtInt(meta)}` : "Ex.: 100000"}
                        className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring/20 tabular-nums"
                    />
                    {warnQtd && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">{warnQtd}</div>
                    )}
                </div>
            )}

            {tipo === "HORARIO" && (
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-semibold text-muted-foreground">Fim</label>
                        <input
                            type="datetime-local"
                            value={fimLocal}
                            onChange={(e) => setFimLocal(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                        />
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
                        Use Horário para encerrar automaticamente em um momento específico (ex: fim de turno).
                    </div>
                </div>
            )}

            <button
                onClick={doSave}
                disabled={!canSave || busy}
                className={cn(
                    "w-full rounded-lg px-3 py-2.5 text-sm font-semibold border transition inline-flex items-center justify-center gap-2",
                    !canSave || busy ? "border-border bg-muted text-muted-foreground cursor-not-allowed" : "border-foreground bg-foreground text-background hover:opacity-90"
                )}
            >
                <CheckCircle2 className="w-4 h-4" />
                Salvar condição
            </button>
        </div>
    )
}

/* ═══════════════════════════════════════════════════
   ModoContagemPanel
   — Peça Boa vs Retrabalho (mesma regra do posto)
   — Em RETRABALHO: conjunto de 1..N peças em rodízio
     (fila cíclica). O sensor não diferencia a peça, então
     cada contagem vai para a próxima peça da fila; o TOTAL
     de retrabalho do posto é sempre a soma cheia.
   ═══════════════════════════════════════════════════ */

function ModoContagemPanel(props: {
    modo: "GOOD" | "REWORK"
    pecas: RetrabalhoPecaRow[]
    proximaPosicao: number | null
    migracaoPendente: boolean
    empresaId: string | null
    produtoAtualCodigo?: string | null
    produtoAtualNome?: string | null
    produtoAtualId?: string | null
    busy?: boolean
    onSetModo: (modo: "GOOD" | "REWORK") => Promise<void> | void
    onSetPecas: (pecas: PecaRetrabalhoInput[]) => Promise<void> | void
}) {
    const {
        modo,
        pecas,
        proximaPosicao,
        migracaoPendente,
        empresaId,
        produtoAtualCodigo,
        produtoAtualNome,
        produtoAtualId,
        busy = false,
        onSetModo,
        onSetPecas,
    } = props

    const isRework = modo === "REWORK"

    const [erro, setErro] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)
    const [buscaAberta, setBuscaAberta] = useState(false)
    const [busca, setBusca] = useState("")
    const [buscaDebounced, setBuscaDebounced] = useState("")

    // debounce da busca de peças (evita 1 request por tecla)
    useEffect(() => {
        const t = window.setTimeout(() => setBuscaDebounced(busca.trim()), 300)
        return () => window.clearTimeout(t)
    }, [busca])

    const produtos = usePostoProdutos({
        empresaId,
        q: buscaDebounced || null,
        limit: 30,
        enabled: isRework && buscaAberta,
    })

    const ativas = useMemo(() => pecas.filter((p) => p.ativo), [pecas])

    const codigosAtuais = useMemo(
        () => new Set(ativas.map((p) => p.produto_codigo.toUpperCase())),
        [ativas]
    )

    const totalTurno = useMemo(
        () => ativas.reduce((acc, p) => acc + safeNumber(p.turno_rework, 0), 0),
        [ativas]
    )

    const toInput = useCallback(
        (list: RetrabalhoPecaRow[]): PecaRetrabalhoInput[] =>
            list.map((p) => ({
                produto_codigo: p.produto_codigo,
                produto_id: p.produto_id,
                produto_descricao: p.produto_descricao,
            })),
        []
    )

    const commit = useCallback(
        async (next: PecaRetrabalhoInput[]) => {
            setSalvando(true)
            setErro(null)
            try {
                await onSetPecas(next)
            } catch (e: unknown) {
                setErro(e instanceof Error ? e.message : "Falha ao salvar as peças em retrabalho")
            } finally {
                setSalvando(false)
            }
        },
        [onSetPecas]
    )

    const handleToggleModo = useCallback(
        async (next: "GOOD" | "REWORK") => {
            if (next === modo) return
            setSalvando(true)
            setErro(null)
            try {
                await onSetModo(next)
                // Ao entrar em RETRABALHO sem conjunto definido, semeia com a peça
                // atual — é o caso "deixar a peça que já está e contar retrabalho".
                if (next === "REWORK" && !migracaoPendente && ativas.length === 0) {
                    const cod = String(produtoAtualCodigo || "").trim().toUpperCase()
                    if (cod) {
                        await onSetPecas([
                            {
                                produto_codigo: cod,
                                produto_id: produtoAtualId ?? null,
                                produto_descricao: produtoAtualNome ?? null,
                            },
                        ])
                    }
                }
            } catch (e: unknown) {
                setErro(e instanceof Error ? e.message : "Falha ao alterar o modo de contagem")
            } finally {
                setSalvando(false)
            }
        },
        [modo, onSetModo, onSetPecas, migracaoPendente, ativas.length, produtoAtualCodigo, produtoAtualId, produtoAtualNome]
    )

    const addPeca = useCallback(
        async (p: { produto_codigo: string; produto_id?: string | null; produto_descricao?: string | null }) => {
            const cod = String(p.produto_codigo || "").trim().toUpperCase()
            if (!cod) return
            if (codigosAtuais.has(cod)) {
                setErro(`A peça ${cod} já está na fila de retrabalho.`)
                return
            }
            setBusca("")
            setBuscaAberta(false)
            await commit([
                ...toInput(ativas),
                { produto_codigo: cod, produto_id: p.produto_id ?? null, produto_descricao: p.produto_descricao ?? null },
            ])
        },
        [ativas, codigosAtuais, commit, toInput]
    )

    const removePeca = useCallback(
        async (codigo: string) => {
            const next = toInput(ativas).filter(
                (p) => p.produto_codigo.toUpperCase() !== codigo.toUpperCase()
            )
            await commit(next)
        },
        [ativas, commit, toInput]
    )

    const movePeca = useCallback(
        async (index: number, dir: -1 | 1) => {
            const target = index + dir
            if (target < 0 || target >= ativas.length) return
            const arr = toInput(ativas)
            const tmp = arr[index]
            arr[index] = arr[target]
            arr[target] = tmp
            await commit(arr)
        },
        [ativas, commit, toInput]
    )

    const podeAdicionarLivre = useMemo(() => {
        const cod = busca.trim().toUpperCase()
        if (!cod) return false
        if (codigosAtuais.has(cod)) return false
        return isAllowedOrderCode(cod)
    }, [busca, codigosAtuais])

    const bloqueado = busy || salvando

    return (
        <div
            className="rounded-xl border p-3"
            style={
                isRework
                    ? {
                        borderTopColor: RW_LINE,
                        borderRightColor: RW_LINE,
                        borderBottomColor: RW_LINE,
                        borderLeftWidth: "4px",
                        borderLeftStyle: "solid",
                        borderLeftColor: RW_ACCENT,
                        background: RW_TINT,
                    }
                    : { borderColor: "hsl(var(--border))", background: "#fff" }
            }
        >
            {/* ─── Linha do toggle ─── */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <div
                        className="text-[10px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: isRework ? RW_ACCENT : undefined }}
                    >
                        <span className={isRework ? "" : "text-muted-foreground"}>Modo de contagem</span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: isRework ? RW_SOFT : undefined }}>
                        <span className={isRework ? "" : "text-muted-foreground"}>
                            {isRework
                                ? "Apontamentos deste posto contam como RETRABALHO"
                                : "Apontamentos deste posto contam como PEÇA BOA"}
                        </span>
                    </div>
                </div>

                <div
                    className={cn("flex rounded-lg border overflow-hidden", bloqueado && "opacity-60")}
                    style={{ borderColor: isRework ? RW_LINE : "hsl(var(--border))" }}
                >
                    <button
                        onClick={() => handleToggleModo("GOOD")}
                        disabled={bloqueado || !isRework}
                        aria-pressed={!isRework}
                        className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition",
                            !isRework ? "bg-emerald-600 text-white" : "text-muted-foreground hover:opacity-80"
                        )}
                        style={isRework ? { background: "#fffdf9" } : undefined}
                    >
                        <span className={cn("w-1.5 h-1.5 rounded-full", !isRework ? "bg-white" : "bg-muted-foreground/50")} />
                        Peça Boa
                    </button>
                    <button
                        onClick={() => handleToggleModo("REWORK")}
                        disabled={bloqueado || isRework}
                        aria-pressed={isRework}
                        className="inline-flex items-center gap-1.5 border-l px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition hover:opacity-90"
                        style={
                            isRework
                                ? { background: RW_DEEP, color: "#fdf6ea", borderLeftColor: RW_INK }
                                : { background: "#fff", color: "hsl(var(--muted-foreground))", borderLeftColor: "hsl(var(--border))" }
                        }
                    >
                        <RefreshCcw className="w-3 h-3" />
                        Retrabalho
                    </button>
                </div>
            </div>

            {erro && (
                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 flex items-start justify-between gap-2">
                    <span>{erro}</span>
                    <button onClick={() => setErro(null)} className="text-rose-500 hover:text-rose-700 shrink-0">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}

            {/* ─── Gestor de peças (só em RETRABALHO) ─── */}
            {isRework && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: RW_LINE }}>
                    {migracaoPendente ? (
                        <div
                            className="rounded-lg border px-3 py-2 text-[11px]"
                            style={{ borderColor: RW_ACCENT, background: RW_CHIP, color: RW_INK }}
                        >
                            <span className="font-bold">Retrabalho multi-peça indisponível: </span>
                            rode a migração <span className="font-mono">scripts/2026-07-30_retrabalho_multi_pecas.sql</span>.
                            O modo retrabalho continua funcionando com a peça atual do posto.
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div
                                    className="text-[10px] font-bold uppercase tracking-[0.14em] inline-flex items-center gap-1.5"
                                    style={{ color: RW_ACCENT }}
                                >
                                    <ListOrdered className="w-3.5 h-3.5" />
                                    Peças em retrabalho
                                    <span className="normal-case tracking-normal font-semibold" style={{ color: RW_SOFT }}>
                                        ({ativas.length})
                                    </span>
                                </div>
                                <div className="text-[11px] tabular-nums" style={{ color: RW_SOFT }}>
                                    Retrabalho no turno:{" "}
                                    <span className="font-bold" style={{ color: RW_INK }}>{fmtInt(totalTurno)}</span>
                                </div>
                            </div>

                            <p className="mt-1 text-[11px]" style={{ color: RW_SOFT }}>
                                Cada peça contada pelo sensor vai para a <span className="font-semibold">próxima</span> da
                                fila (rodízio). A divisão entre peças é uma estimativa — o <span className="font-semibold">total
                                de retrabalho do posto está sempre correto</span>.
                            </p>

                            {/* Lista */}
                            {ativas.length === 0 ? (
                                <div
                                    className="mt-2 rounded-lg border border-dashed px-3 py-2.5 text-[11px]"
                                    style={{ borderColor: RW_ACCENT, background: "#fffdf9", color: RW_SOFT }}
                                >
                                    Nenhuma peça definida — o retrabalho será atribuído à peça atual do posto
                                    {produtoAtualCodigo ? ` (${produtoAtualCodigo})` : ""}.
                                </div>
                            ) : (
                                <div className="mt-2 space-y-1.5">
                                    {ativas.map((p, idx) => {
                                        const isProxima = proximaPosicao != null && p.posicao === proximaPosicao
                                        return (
                                            <div
                                                key={p.retrabalho_peca_id}
                                                className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                                                style={
                                                    isProxima
                                                        ? { borderColor: RW_ACCENT, background: RW_CHIP }
                                                        : { borderColor: RW_LINE, background: "#fffdf9" }
                                                }
                                            >
                                                <span
                                                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums"
                                                    style={{
                                                        background: isProxima ? RW_DEEP : RW_LINE,
                                                        color: isProxima ? "#fdf6ea" : RW_INK,
                                                    }}
                                                >
                                                    {idx + 1}
                                                </span>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-bold tabular-nums" style={{ color: RW_INK }}>
                                                            {p.produto_codigo}
                                                        </span>
                                                        {isProxima && (
                                                            <span
                                                                className="text-[9px] font-bold uppercase tracking-wider"
                                                                style={{ color: RW_ACCENT }}
                                                            >
                                                                próxima
                                                            </span>
                                                        )}
                                                    </div>
                                                    {p.produto_descricao && (
                                                        <div className="truncate text-[11px]" style={{ color: RW_SOFT }}>
                                                            {p.produto_descricao}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="shrink-0 text-right">
                                                    <div
                                                        className="text-[9px] font-bold uppercase tracking-wider"
                                                        style={{ color: RW_SOFT }}
                                                    >
                                                        turno
                                                    </div>
                                                    <div className="text-xs font-bold tabular-nums" style={{ color: RW_INK }}>
                                                        {fmtInt(safeNumber(p.turno_rework, 0))}
                                                    </div>
                                                </div>

                                                <div className="flex shrink-0 items-center gap-0.5">
                                                    <button
                                                        onClick={() => void movePeca(idx, -1)}
                                                        disabled={bloqueado || idx === 0}
                                                        title="Subir na fila"
                                                        className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                                    >
                                                        <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                                                    </button>
                                                    <button
                                                        onClick={() => void movePeca(idx, 1)}
                                                        disabled={bloqueado || idx === ativas.length - 1}
                                                        title="Descer na fila"
                                                        className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                                    >
                                                        <ChevronDown className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => void removePeca(p.produto_codigo)}
                                                        disabled={bloqueado}
                                                        title="Remover da fila"
                                                        className="rounded-md p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Ações */}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {produtoAtualCodigo && !codigosAtuais.has(String(produtoAtualCodigo).toUpperCase()) && (
                                    <button
                                        onClick={() =>
                                            void addPeca({
                                                produto_codigo: String(produtoAtualCodigo),
                                                produto_id: produtoAtualId ?? null,
                                                produto_descricao: produtoAtualNome ?? null,
                                            })
                                        }
                                        disabled={bloqueado}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted transition disabled:opacity-50"
                                        title="Adicionar a peça que já está no posto"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Manter peça atual ({produtoAtualCodigo})
                                    </button>
                                )}

                                <button
                                    onClick={() => setBuscaAberta((v) => !v)}
                                    disabled={bloqueado}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50",
                                        buscaAberta
                                            ? "border-foreground bg-foreground text-background"
                                            : "border-border bg-white text-foreground hover:bg-muted"
                                    )}
                                >
                                    <PackagePlus className="w-3.5 h-3.5" />
                                    Adicionar peça
                                </button>

                                {salvando && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                                        <RefreshCcw className="w-3 h-3 animate-spin" /> salvando…
                                    </span>
                                )}
                            </div>

                            {/* Busca de peças */}
                            {buscaAberta && (
                                <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
                                    <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-1.5">
                                        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <input
                                            autoFocus
                                            value={busca}
                                            onChange={(e) => setBusca(e.target.value.toUpperCase())}
                                            placeholder="Código ou descrição (ex.: A-120)"
                                            className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                                        />
                                        {busca && (
                                            <button onClick={() => setBusca("")} className="text-muted-foreground hover:text-foreground shrink-0">
                                                <XCircle className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="mt-1.5 max-h-44 overflow-y-auto overflow-x-hidden">
                                        {produtos.error && (
                                            <div className="px-2 py-1.5 text-[11px] text-rose-600">
                                                Falha ao carregar peças.
                                            </div>
                                        )}
                                        {!produtos.data && !produtos.error && (
                                            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Carregando…</div>
                                        )}
                                        {produtos.data?.length === 0 && (
                                            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                                                Nenhuma peça encontrada.
                                            </div>
                                        )}
                                        {(produtos.data || []).map((pr) => {
                                            const jaTem = codigosAtuais.has(pr.produto_codigo.toUpperCase())
                                            return (
                                                <button
                                                    key={pr.produto_id}
                                                    onClick={() =>
                                                        void addPeca({
                                                            produto_codigo: pr.produto_codigo,
                                                            produto_id: pr.produto_id,
                                                            produto_descricao: pr.produto_descricao,
                                                        })
                                                    }
                                                    disabled={bloqueado || jaTem}
                                                    className={cn(
                                                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition",
                                                        jaTem ? "opacity-40 cursor-not-allowed" : "hover:bg-white"
                                                    )}
                                                >
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-bold text-foreground tabular-nums">
                                                            {pr.produto_codigo}
                                                        </div>
                                                        {pr.produto_descricao && (
                                                            <div className="truncate text-[11px] text-muted-foreground">
                                                                {pr.produto_descricao}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {jaTem ? (
                                                        <CheckSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                    ) : (
                                                        <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>

                                    {podeAdicionarLivre && (
                                        <button
                                            onClick={() => void addPeca({ produto_codigo: busca })}
                                            disabled={bloqueado}
                                            className="mt-1 w-full rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-white transition disabled:opacity-50"
                                        >
                                            Adicionar &quot;{busca.trim().toUpperCase()}&quot; (não cadastrada)
                                        </button>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

/* ═══════════════════════════════════════════════════
   PecaFormModal — Cadastrar / Editar peça
   ═══════════════════════════════════════════════════ */

function PecaFormModal(props: {
    isOpen: boolean
    mode: "create" | "edit"
    produtoCodigo: string | null
    empresaId: string | null
    onClose: () => void
    onSaved: () => void
}) {
    const { isOpen, mode, produtoCodigo, empresaId, onClose, onSaved } = props

    const [codigo, setCodigo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [familia, setFamilia] = useState("")
    const [unidade, setUnidade] = useState("UN")
    const [cicloIdeal, setCicloIdeal] = useState("")
    const [metaTurno, setMetaTurno] = useState("")
    const [producaoPlanejada, setProducaoPlanejada] = useState("")
    const [produtoId, setProdutoId] = useState<string | null>(null)

    const [busy, setBusy] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)

    // reset form on open
    useEffect(() => {
        if (!isOpen) return
        setSaveError(null)
        setFetchError(null)
        if (mode === "create") {
            setCodigo("")
            setDescricao("")
            setFamilia("")
            setUnidade("UN")
            setCicloIdeal("")
            setMetaTurno("")
            setProducaoPlanejada("")
            setProdutoId(null)
        }
    }, [isOpen, mode])

    // load existing data when editing
    useEffect(() => {
        if (!isOpen || mode !== "edit" || !produtoCodigo) return
        setBusy(true)
        setFetchError(null)
        const params = new URLSearchParams({ codigo: produtoCodigo })
        if (empresaId) params.set("empresaId", empresaId)
        fetch(`/api/db/pecas?${params}`)
            .then((r) => r.json())
            .then((json) => {
                if (!json.ok) { setFetchError(json.error || "Peça não encontrada"); return }
                const d = json.data
                setCodigo(d.codigo ?? d.public_id ?? produtoCodigo)
                setDescricao(d.descricao ?? "")
                setFamilia(d.familia ?? "")
                setUnidade(d.unidade ?? "UN")
                setCicloIdeal(d.ciclo_ideal_seg != null ? String(d.ciclo_ideal_seg) : "")
                setMetaTurno(d.meta_turno != null ? String(d.meta_turno) : "")
                setProducaoPlanejada(d.producao_planejada != null ? String(d.producao_planejada) : "")
                setProdutoId(d.produto_id ?? null)
            })
            .catch((e) => setFetchError(e?.message || "Erro ao carregar peça"))
            .finally(() => setBusy(false))
    }, [isOpen, mode, produtoCodigo, empresaId])

    const codigoError = useMemo(() => {
        if (!codigo.trim()) return null
        if (!isAllowedOrderCode(codigo)) return "Código deve começar com MS ou MR"
        return null
    }, [codigo])

    const canSave = useMemo(() => {
        if (!descricao.trim()) return false
        if (mode === "create") {
            if (!codigo.trim() || codigoError) return false
        }
        return true
    }, [mode, codigo, descricao, codigoError])

    const handleSave = useCallback(async () => {
        if (!canSave) return
        setBusy(true)
        setSaveError(null)
        try {
            if (mode === "create") {
                const body: Record<string, unknown> = {
                    empresaId,
                    codigo: codigo.trim().toUpperCase(),
                    descricao: descricao.trim(),
                    familia: familia.trim() || null,
                    unidade: unidade.trim() || "UN",
                }
                if (cicloIdeal) body.ciclo_ideal_seg = Number(cicloIdeal)
                if (metaTurno) body.meta_turno = Number(metaTurno)
                if (producaoPlanejada) body.producao_planejada = Number(producaoPlanejada)
                const r = await fetch("/api/db/pecas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
                const json = await r.json()
                if (!json.ok) throw new Error(json.error || "Erro ao cadastrar")
            } else {
                if (!produtoId) throw new Error("produto_id não encontrado")
                const body: Record<string, unknown> = {
                    produto_id: produtoId,
                    descricao: descricao.trim(),
                    familia: familia.trim() || null,
                    unidade: unidade.trim() || "UN",
                }
                if (cicloIdeal !== "") body.ciclo_ideal_seg = cicloIdeal ? Number(cicloIdeal) : null
                if (metaTurno !== "") body.meta_turno = metaTurno ? Number(metaTurno) : null
                const r = await fetch("/api/db/pecas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
                const json = await r.json()
                if (!json.ok) throw new Error(json.error || "Erro ao atualizar")
            }
            onSaved()
        } catch (e: unknown) {
            setSaveError(e instanceof Error ? e.message : "Erro ao salvar")
        } finally {
            setBusy(false)
        }
    }, [canSave, mode, empresaId, codigo, descricao, familia, unidade, cicloIdeal, metaTurno, producaoPlanejada, produtoId, onSaved])

    const fieldClass = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/20"
    const labelClass = "block text-xs font-semibold text-muted-foreground mb-1"

    return (
        <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="z-[60] max-w-md bg-white">
                <DialogHeader>
                    <DialogTitle>{mode === "create" ? "Cadastrar peça" : "Editar peça"}</DialogTitle>
                </DialogHeader>

                {fetchError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{fetchError}</div>
                )}

                <div className="space-y-3 pt-1">
                    {mode === "create" && (
                        <div>
                            <label className={labelClass}>Código <span className="text-rose-500">*</span></label>
                            <input
                                className={cn(fieldClass, codigoError ? "border-rose-400" : "")}
                                value={codigo}
                                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                                placeholder="A-120 ou C-310"
                                disabled={busy}
                            />
                            {codigoError && <p className="mt-0.5 text-[11px] text-rose-600">{codigoError}</p>}
                        </div>
                    )}

                    {mode === "edit" && (
                        <div>
                            <label className={labelClass}>Código</label>
                            <input className={cn(fieldClass, "bg-muted text-muted-foreground")} value={codigo} readOnly />
                        </div>
                    )}

                    <div>
                        <label className={labelClass}>Descrição <span className="text-rose-500">*</span></label>
                        <input
                            className={fieldClass}
                            value={descricao}
                            onChange={(e) => setDescricao(e.target.value)}
                            placeholder="Descrição da peça"
                            disabled={busy}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Família</label>
                        <input
                            className={fieldClass}
                            value={familia}
                            onChange={(e) => setFamilia(e.target.value)}
                            placeholder="Família da peça"
                            disabled={busy}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Unidade</label>
                            <input
                                className={fieldClass}
                                value={unidade}
                                onChange={(e) => setUnidade(e.target.value.toUpperCase())}
                                placeholder="UN"
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Ciclo ideal (seg)</label>
                            <input
                                className={fieldClass}
                                type="number"
                                min="0"
                                value={cicloIdeal}
                                onChange={(e) => setCicloIdeal(e.target.value)}
                                placeholder="40"
                                disabled={busy}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Meta turno</label>
                            <input
                                className={fieldClass}
                                type="number"
                                min="0"
                                value={metaTurno}
                                onChange={(e) => setMetaTurno(e.target.value)}
                                placeholder="1000"
                                disabled={busy}
                            />
                        </div>
                        {mode === "create" && (
                            <div>
                                <label className={labelClass}>Produção planejada</label>
                                <input
                                    className={fieldClass}
                                    type="number"
                                    min="0"
                                    value={producaoPlanejada}
                                    onChange={(e) => setProducaoPlanejada(e.target.value)}
                                    placeholder="5000000"
                                    disabled={busy}
                                />
                            </div>
                        )}
                    </div>

                    {saveError && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}</div>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={onClose}
                            disabled={busy}
                            className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold border border-border bg-white hover:bg-muted transition disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!canSave || busy}
                            className={cn(
                                "flex-1 rounded-lg px-3 py-2 text-sm font-semibold border transition inline-flex items-center justify-center gap-2",
                                !canSave || busy ? "border-border bg-muted text-muted-foreground cursor-not-allowed" : "border-foreground bg-foreground text-background hover:opacity-90"
                            )}
                        >
                            {busy ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            {mode === "create" ? "Cadastrar" : "Salvar"}
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

/* ═══════════════════════════════════════════════════
   BroadcastQueueDialog
   — Envia a fila (ou parte dela) para múltiplos CTs
   ═══════════════════════════════════════════════════ */

type BroadcastResult = {
    centro_trabalho_id: string
    inserted: number
    error?: string
    nome?: string
}

function BroadcastQueueDialog(props: {
    open: boolean
    onOpenChange: (v: boolean) => void
    centroTrabalhoId: string
    empresaId: string | null
    queue: FilaItem[]
}) {
    const { open, onOpenChange, centroTrabalhoId, empresaId, queue } = props

    const ctsHook = usePostoCentrosTrabalhoList({ empresaId })
    const cts = (ctsHook.data || []).filter((c) => c.centro_trabalho_id !== centroTrabalhoId)

    const [selectedOrdens, setSelectedOrdens] = useState<Set<string>>(() => new Set(queue.map((x) => x.ordem_id)))
    const [selectedCTs, setSelectedCTs] = useState<Set<string>>(new Set())
    const [substituir, setSubstituir] = useState(true)
    const [isSending, setIsSending] = useState(false)
    const [results, setResults] = useState<BroadcastResult[] | null>(null)
    const [sendError, setSendError] = useState<string | null>(null)

    // reseta ao abrir/fechar
    useEffect(() => {
        if (open) {
            setSelectedOrdens(new Set(queue.map((x) => x.ordem_id)))
            setSelectedCTs(new Set())
            setSubstituir(true)
            setResults(null)
            setSendError(null)
        }
    }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

    const toggleOrdem = (ordemId: string) => {
        setSelectedOrdens((prev) => {
            const next = new Set(prev)
            next.has(ordemId) ? next.delete(ordemId) : next.add(ordemId)
            return next
        })
    }

    const toggleCT = (ctId: string) => {
        setSelectedCTs((prev) => {
            const next = new Set(prev)
            next.has(ctId) ? next.delete(ctId) : next.add(ctId)
            return next
        })
    }

    const allOrdensSelected = queue.every((x) => selectedOrdens.has(x.ordem_id))
    const toggleAllOrdens = () => {
        setSelectedOrdens(allOrdensSelected ? new Set() : new Set(queue.map((x) => x.ordem_id)))
    }

    const allCTsSelected = cts.length > 0 && cts.every((c) => selectedCTs.has(c.centro_trabalho_id))
    const toggleAllCTs = () => {
        setSelectedCTs(allCTsSelected ? new Set() : new Set(cts.map((c) => c.centro_trabalho_id)))
    }

    const canSend = selectedOrdens.size > 0 && selectedCTs.size > 0 && !isSending

    const handleSend = async () => {
        if (!canSend) return
        setIsSending(true)
        setSendError(null)
        try {
            const res = await postoBroadcastQueue({
                empresa_id: empresaId ?? undefined,
                source_ct_id: centroTrabalhoId,
                target_ct_ids: Array.from(selectedCTs),
                ordem_ids: queue
                    .filter((x) => selectedOrdens.has(x.ordem_id))
                    .map((x) => x.ordem_id),
                substituir,
            })
            const ctMap = new Map(cts.map((c) => [c.centro_trabalho_id, c.nome || c.codigo]))
            setResults(
                (res.results || []).map((r) => ({
                    ...r,
                    nome: ctMap.get(r.centro_trabalho_id) || r.centro_trabalho_id,
                }))
            )
        } catch (e: unknown) {
            setSendError(e instanceof Error ? e.message : "Falha ao enviar fila")
        } finally {
            setIsSending(false)
        }
    }

    const successCount = results ? results.filter((r) => !r.error).length : 0

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!max-w-5xl w-full max-h-[88vh] overflow-hidden flex flex-col bg-white p-0 gap-0 shadow-2xl">
                <DialogHeader className="shrink-0 px-7 py-5 border-b border-border bg-gradient-to-br from-sky-50 via-sky-50/40 to-white">
                    <DialogTitle className="flex items-center gap-3.5">
                        <span className="flex items-center justify-center w-11 h-11 rounded-2xl bg-sky-100 text-sky-600 shrink-0 ring-1 ring-sky-200/60">
                            <GitFork className="w-5 h-5" />
                        </span>
                        <span className="flex flex-col gap-0.5">
                            <span className="text-lg font-semibold text-foreground leading-tight">Enviar fila para múltiplos CTs</span>
                            <span className="text-xs font-normal text-muted-foreground">Escolha as ordens e para quais centros de trabalho enviar</span>
                        </span>
                    </DialogTitle>
                </DialogHeader>

                {results ? (
                    /* ─── Resultado ─── */
                    <div className="flex-1 overflow-auto px-7 py-6">
                        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5 flex items-center gap-3">
                            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                                <CheckCircle2 className="w-5 h-5" />
                            </span>
                            <span className="text-sm text-foreground">
                                <span className="font-semibold">{successCount}</span> de <span className="font-semibold">{results.length}</span> CT{results.length !== 1 ? "s" : ""} atualizados com sucesso
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {results.map((r) => (
                                <div
                                    key={r.centro_trabalho_id}
                                    className={cn(
                                        "rounded-xl border px-4 py-3 text-sm flex items-center gap-3",
                                        r.error
                                            ? "border-rose-200 bg-rose-50"
                                            : "border-emerald-200 bg-emerald-50"
                                    )}
                                >
                                    {r.error
                                        ? <XCircle className="w-4.5 h-4.5 text-rose-500 shrink-0" />
                                        : <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
                                    }
                                    <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-foreground truncate">{r.nome}</div>
                                        {r.error ? (
                                            <div className="text-xs text-rose-700 truncate">{r.error}</div>
                                        ) : (
                                            <div className="text-xs font-medium text-emerald-700">{r.inserted} ordem(ns) adicionada(s)</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* ─── Seleção ─── */
                    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                        <div className="flex-1 overflow-auto grid grid-cols-1 sm:grid-cols-2 gap-5 min-h-0 px-7 py-6">
                            {/* Ordens */}
                            <div className="flex flex-col min-h-0">
                                <div className="flex items-center justify-between mb-2.5 shrink-0">
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1.5">
                                        <ListOrdered className="w-3.5 h-3.5" />
                                        Ordens <span className="text-foreground">{selectedOrdens.size}/{queue.length}</span>
                                    </span>
                                    <button
                                        onClick={toggleAllOrdens}
                                        className="text-xs font-medium text-sky-600 hover:text-sky-700 transition inline-flex items-center gap-1"
                                    >
                                        {allOrdensSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                        {allOrdensSelected ? "Desmarcar tudo" : "Marcar tudo"}
                                    </button>
                                </div>
                                <div className="flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-2 space-y-1.5">
                                    {queue.map((item) => {
                                        const checked = selectedOrdens.has(item.ordem_id)
                                        return (
                                            <button
                                                key={item.fila_item_id}
                                                onClick={() => toggleOrdem(item.ordem_id)}
                                                className={cn(
                                                    "w-full flex items-center gap-3 rounded-lg px-3.5 py-3 text-left transition border",
                                                    checked
                                                        ? "bg-sky-50 border-sky-200 shadow-sm"
                                                        : "bg-white border-transparent hover:border-border hover:bg-muted/40"
                                                )}
                                            >
                                                {checked
                                                    ? <CheckSquare className="w-4 h-4 text-sky-600 shrink-0" />
                                                    : <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                                }
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-foreground tabular-nums leading-tight">{item.ordem_codigo}</div>
                                                    {item.produto_nome && (
                                                        <div className="text-xs text-muted-foreground truncate">{item.produto_nome}</div>
                                                    )}
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* CTs */}
                            <div className="flex flex-col min-h-0">
                                <div className="flex items-center justify-between mb-2.5 shrink-0">
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1.5">
                                        <Layers className="w-3.5 h-3.5" />
                                        Centros de Trabalho <span className="text-foreground">{selectedCTs.size}/{cts.length}</span>
                                    </span>
                                    {cts.length > 0 && (
                                        <button
                                            onClick={toggleAllCTs}
                                            className="text-xs font-medium text-sky-600 hover:text-sky-700 transition inline-flex items-center gap-1"
                                        >
                                            {allCTsSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                            {allCTsSelected ? "Desmarcar tudo" : "Marcar tudo"}
                                        </button>
                                    )}
                                </div>
                                <div className="flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-2 space-y-1.5">
                                    {ctsHook.isLoading && (
                                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">Carregando CTs...</div>
                                    )}
                                    {!ctsHook.isLoading && cts.length === 0 && (
                                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">Nenhum outro CT encontrado.</div>
                                    )}
                                    {cts.map((ct) => {
                                        const checked = selectedCTs.has(ct.centro_trabalho_id)
                                        return (
                                            <button
                                                key={ct.centro_trabalho_id}
                                                onClick={() => toggleCT(ct.centro_trabalho_id)}
                                                className={cn(
                                                    "w-full flex items-center gap-3 rounded-lg px-3.5 py-3 text-left transition border",
                                                    checked
                                                        ? "bg-sky-50 border-sky-200 shadow-sm"
                                                        : "bg-white border-transparent hover:border-border hover:bg-muted/40"
                                                )}
                                            >
                                                {checked
                                                    ? <CheckSquare className="w-4 h-4 text-sky-600 shrink-0" />
                                                    : <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                                }
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-foreground leading-tight">{ct.nome || ct.codigo}</div>
                                                    <div className="text-xs text-muted-foreground">{ct.codigo}</div>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Opção substituir + botões */}
                        <div className="shrink-0 px-7 py-4 border-t border-border bg-muted/20 space-y-3">
                            <button
                                onClick={() => setSubstituir((v) => !v)}
                                className="flex items-center gap-2.5 text-sm text-foreground w-full rounded-lg px-2.5 py-2 -mx-2.5 hover:bg-muted/50 transition"
                            >
                                {substituir
                                    ? <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                                    : <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                }
                                <span className="font-medium">Substituir fila existente nos CTs selecionados</span>
                                <span className="text-xs text-muted-foreground ml-auto hidden sm:inline">(se desmarcado, adiciona ao fim)</span>
                            </button>

                            {sendError && (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                    {sendError}
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => onOpenChange(false)}
                                    className="rounded-lg px-4 py-2 text-sm font-semibold border border-border bg-white text-foreground hover:bg-muted transition"
                                    disabled={isSending}
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSend}
                                    disabled={!canSend}
                                    className={cn(
                                        "rounded-lg px-4 py-2 text-sm font-semibold border transition inline-flex items-center gap-2 shadow-sm",
                                        canSend
                                            ? "border-sky-600 bg-sky-600 text-white hover:bg-sky-700"
                                            : "border-border bg-muted text-muted-foreground cursor-not-allowed shadow-none"
                                    )}
                                >
                                    {isSending
                                        ? <><RefreshCcw className="w-4 h-4 animate-spin" /> Enviando...</>
                                        : <><GitFork className="w-4 h-4" /> Enviar para {selectedCTs.size} CT{selectedCTs.size !== 1 ? "s" : ""}</>
                                    }
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {results && (
                    <div className="shrink-0 px-7 py-4 border-t border-border bg-muted/20 flex justify-end">
                        <button
                            onClick={() => onOpenChange(false)}
                            className="rounded-lg px-4 py-2 text-sm font-semibold border border-foreground bg-foreground text-background hover:opacity-90 transition"
                        >
                            Fechar
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

/* ═══════════════════════════════════════════════════
   ExecuteFirstOrdersDialog
   — Executa a 1ª ordem da fila de vários CTs de uma vez.
     Pré-seleciona todos os CTs que têm fila e a 1ª ordem de
     cada um; o usuário pode trocar por outra ordem da fila
     daquele CT e desmarcar os CTs que não quer executar.
   ═══════════════════════════════════════════════════ */

type ExecOrderResult = {
    centro_trabalho_id: string
    ordem_id: string
    ok: boolean
    error?: string
    nome?: string
    ordem_codigo?: string | null
}

function ExecuteFirstOrdersDialog(props: {
    open: boolean
    onOpenChange: (v: boolean) => void
    empresaId: string | null
    usuarioId?: string | number | null
    sourceSystem?: string | null
    onExecuted?: () => void
}) {
    const { open, onOpenChange, empresaId, usuarioId, sourceSystem, onExecuted } = props

    const ctsHook = usePostoCTsComFila({ empresaId, enabled: open })
    const cts = useMemo(() => (ctsHook.data || []) as CTComFilaRow[], [ctsHook.data])
    const ctsComFila = useMemo(() => cts.filter((c) => (c.fila?.length ?? 0) > 0), [cts])

    const [selectedCTs, setSelectedCTs] = useState<Set<string>>(new Set())
    const [chosenOrder, setChosenOrder] = useState<Record<string, string>>({})
    const [isExecuting, setIsExecuting] = useState(false)
    const [results, setResults] = useState<ExecOrderResult[] | null>(null)
    const [execError, setExecError] = useState<string | null>(null)

    const initializedRef = useRef(false)

    // Reseta ao fechar
    useEffect(() => {
        if (!open) {
            initializedRef.current = false
            setResults(null)
            setExecError(null)
            setIsExecuting(false)
        }
    }, [open])

    // Inicializa seleção + ordens quando os dados chegam (1x por abertura).
    // Não re-inicializa em revalidações para não descartar escolhas do usuário.
    useEffect(() => {
        if (!open || initializedRef.current || ctsHook.isLoading) return
        const sel = new Set<string>()
        const chosen: Record<string, string> = {}
        for (const c of ctsComFila) {
            sel.add(c.centro_trabalho_id)
            const first = c.fila[0]
            if (first) chosen[c.centro_trabalho_id] = first.ordem_id
        }
        setSelectedCTs(sel)
        setChosenOrder(chosen)
        initializedRef.current = true
    }, [open, ctsHook.isLoading, ctsComFila])

    const toggleCT = (ctId: string) => {
        setSelectedCTs((prev) => {
            const next = new Set(prev)
            next.has(ctId) ? next.delete(ctId) : next.add(ctId)
            return next
        })
    }

    const setOrder = (ctId: string, ordemId: string) => {
        setChosenOrder((prev) => ({ ...prev, [ctId]: ordemId }))
    }

    // Ordem escolhida válida (sempre pertence à fila atual do CT)
    const resolveChosen = useCallback(
        (c: CTComFilaRow) => {
            const picked = chosenOrder[c.centro_trabalho_id]
            return c.fila.some((f) => f.ordem_id === picked) ? picked : (c.fila[0]?.ordem_id ?? "")
        },
        [chosenOrder]
    )

    const allSelected = ctsComFila.length > 0 && ctsComFila.every((c) => selectedCTs.has(c.centro_trabalho_id))
    const toggleAll = () => {
        setSelectedCTs(allSelected ? new Set() : new Set(ctsComFila.map((c) => c.centro_trabalho_id)))
    }

    const items = useMemo(() => {
        const out: Array<{ centro_trabalho_id: string; ordem_id: string }> = []
        for (const c of ctsComFila) {
            if (!selectedCTs.has(c.centro_trabalho_id)) continue
            const ordemId = resolveChosen(c)
            if (ordemId) out.push({ centro_trabalho_id: c.centro_trabalho_id, ordem_id: ordemId })
        }
        return out
    }, [ctsComFila, selectedCTs, resolveChosen])

    const canExecute = items.length > 0 && !isExecuting

    const handleExecute = async () => {
        if (!canExecute) return
        setIsExecuting(true)
        setExecError(null)
        try {
            const res = await postoExecuteOrders({
                empresa_id: empresaId ?? undefined,
                items,
                usuario_id: usuarioId != null ? String(usuarioId) : null,
                source_system: sourceSystem ?? "APP",
            })

            const nameMap = new Map(cts.map((c) => [c.centro_trabalho_id, c.nome || c.codigo]))
            const codeMap = new Map<string, string>()
            for (const c of cts) {
                for (const f of c.fila) {
                    if (f.ordem_codigo) codeMap.set(f.ordem_id, f.ordem_codigo)
                }
            }

            setResults(
                (res.results || []).map((r) => ({
                    ...r,
                    nome: nameMap.get(r.centro_trabalho_id) || r.centro_trabalho_id,
                    ordem_codigo: codeMap.get(r.ordem_id) ?? null,
                }))
            )
            // Revalida a lista (as ordens executadas saem da fila) e atualiza o posto atual
            try { await ctsHook.mutate?.() } catch { /* noop */ }
            onExecuted?.()
        } catch (e: unknown) {
            setExecError(e instanceof Error ? e.message : "Falha ao executar ordens")
        } finally {
            setIsExecuting(false)
        }
    }

    const successCount = results ? results.filter((r) => r.ok).length : 0

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!max-w-5xl w-full max-h-[88vh] overflow-hidden flex flex-col bg-white p-0 gap-0 shadow-2xl">
                <DialogHeader className="shrink-0 px-7 py-5 border-b border-border bg-gradient-to-br from-emerald-50 via-emerald-50/40 to-white">
                    <DialogTitle className="flex items-center gap-3.5">
                        <span className="flex items-center justify-center w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-600 shrink-0 ring-1 ring-emerald-200/60">
                            <Rocket className="w-5 h-5" />
                        </span>
                        <span className="flex flex-col gap-0.5">
                            <span className="text-lg font-semibold text-foreground leading-tight">Executar 1ª ordem da fila dos CTs</span>
                            <span className="text-xs font-normal text-muted-foreground">Coloca a próxima ordem da fila em execução em vários CTs de uma vez</span>
                        </span>
                    </DialogTitle>
                </DialogHeader>

                {results ? (
                    /* ─── Resultado ─── */
                    <div className="flex-1 overflow-auto px-7 py-6">
                        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5 flex items-center gap-3">
                            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                                <CheckCircle2 className="w-5 h-5" />
                            </span>
                            <span className="text-sm text-foreground">
                                <span className="font-semibold">{successCount}</span> de <span className="font-semibold">{results.length}</span> CT{results.length !== 1 ? "s" : ""} em execução
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {results.map((r) => (
                                <div
                                    key={r.centro_trabalho_id}
                                    className={cn(
                                        "rounded-xl border px-4 py-3 text-sm flex items-center gap-3",
                                        r.ok
                                            ? "border-emerald-200 bg-emerald-50"
                                            : "border-rose-200 bg-rose-50"
                                    )}
                                >
                                    {r.ok
                                        ? <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
                                        : <XCircle className="w-4.5 h-4.5 text-rose-500 shrink-0" />
                                    }
                                    <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-foreground truncate">
                                            {r.nome}
                                            {r.ordem_codigo && (
                                                <span className="text-xs text-muted-foreground font-normal ml-2 tabular-nums">{r.ordem_codigo}</span>
                                            )}
                                        </div>
                                        <div className={cn("text-xs font-medium", r.ok ? "text-emerald-700" : "text-rose-700")}>
                                            {r.ok ? "Em execução" : (r.error || "Falha")}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {results.length === 0 && (
                                <div className="col-span-full px-3 py-4 text-sm text-muted-foreground text-center">Nenhum CT executado.</div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* ─── Seleção ─── */
                    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                        <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-7 py-6">
                            <div className="flex items-center justify-between mb-2.5 shrink-0">
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1.5">
                                    <Users className="w-3.5 h-3.5" />
                                    CTs a executar <span className="text-foreground">{items.length}/{ctsComFila.length}</span>
                                </span>
                                {ctsComFila.length > 0 && (
                                    <button
                                        onClick={toggleAll}
                                        className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition inline-flex items-center gap-1"
                                    >
                                        {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                        {allSelected ? "Desmarcar tudo" : "Marcar tudo"}
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-2 min-h-0">
                                {ctsHook.isLoading && (
                                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">Carregando CTs...</div>
                                )}
                                {!ctsHook.isLoading && cts.length === 0 && (
                                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">Nenhum CT encontrado.</div>
                                )}
                                {!ctsHook.isLoading && cts.length > 0 && ctsComFila.length === 0 && (
                                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">Nenhum CT tem ordens na fila.</div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {ctsComFila.map((c) => {
                                        const checked = selectedCTs.has(c.centro_trabalho_id)
                                        const chosen = resolveChosen(c)
                                        return (
                                            <div
                                                key={c.centro_trabalho_id}
                                                className={cn(
                                                    "rounded-lg border px-3.5 py-3 flex items-center gap-3 transition",
                                                    checked
                                                        ? "bg-emerald-50 border-emerald-200 shadow-sm"
                                                        : "bg-white border-transparent hover:border-border hover:bg-muted/40"
                                                )}
                                            >
                                                <button
                                                    onClick={() => toggleCT(c.centro_trabalho_id)}
                                                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                                                >
                                                    {checked
                                                        ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                                                        : <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                                    }
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-semibold text-foreground leading-tight truncate">{c.nome || c.codigo}</div>
                                                        <div className="text-xs text-muted-foreground truncate">
                                                            {c.ordem_atual_codigo
                                                                ? <>em curso: <span className="tabular-nums">{c.ordem_atual_codigo}</span></>
                                                                : "parado"}
                                                            <span className="text-muted-foreground/70"> · {c.fila.length} na fila</span>
                                                        </div>
                                                    </div>
                                                </button>
                                                <div className="relative shrink-0">
                                                    <select
                                                        value={chosen}
                                                        onChange={(e) => setOrder(c.centro_trabalho_id, e.target.value)}
                                                        disabled={!checked}
                                                        className="appearance-none rounded-lg border border-border bg-white pl-2.5 pr-7 py-1.5 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring/20 max-w-[140px] truncate disabled:opacity-40"
                                                        title="Ordem a executar"
                                                    >
                                                        {c.fila.map((f, idx) => (
                                                            <option key={f.fila_item_id} value={f.ordem_id}>
                                                                {idx + 1}. {f.ordem_codigo || "—"}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="shrink-0 px-7 py-4 border-t border-border bg-muted/20 space-y-3">
                            {execError && (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                    {execError}
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] text-muted-foreground hidden sm:block">
                                    Coloca a ordem escolhida em execução em cada CT (encerra a corrida atual).
                                </span>
                                <div className="flex justify-end gap-2 ml-auto">
                                    <button
                                        onClick={() => onOpenChange(false)}
                                        disabled={isExecuting}
                                        className="rounded-lg px-4 py-2 text-sm font-semibold border border-border bg-white text-foreground hover:bg-muted transition"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleExecute}
                                        disabled={!canExecute}
                                        className={cn(
                                            "rounded-lg px-4 py-2 text-sm font-semibold border transition inline-flex items-center gap-2 shadow-sm",
                                            canExecute
                                                ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                                                : "border-border bg-muted text-muted-foreground cursor-not-allowed shadow-none"
                                        )}
                                    >
                                        {isExecuting
                                            ? <><RefreshCcw className="w-4 h-4 animate-spin" /> Executando...</>
                                            : <><Rocket className="w-4 h-4" /> Executar em {items.length} CT{items.length !== 1 ? "s" : ""}</>
                                        }
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {results && (
                    <div className="shrink-0 px-7 py-4 border-t border-border bg-muted/20 flex justify-end">
                        <button
                            onClick={() => onOpenChange(false)}
                            className="rounded-lg px-4 py-2 text-sm font-semibold border border-foreground bg-foreground text-background hover:opacity-90 transition"
                        >
                            Fechar
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

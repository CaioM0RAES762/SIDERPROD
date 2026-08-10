"use client"

import React, { useEffect, useRef } from "react"
import type {
    ApiDashboardCard,
    UiCyclePoint,
    UiLossBar,
    UiProductionPoint,
} from "@/hooks/posto/use-api"
import type { ChartType, TooltipData } from "./utils"

type Props = {
    chartType: ChartType
    onTooltip: (data: TooltipData) => void
    stationHeader: ApiDashboardCard | null | undefined
    productionPoints: UiProductionPoint[]
    cyclePoints: UiCyclePoint[]
    lossBars: UiLossBar[]
    oeeBars?: UiLossBar[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampV(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v))
}

function getXPositions(left: number, width: number, total: number) {
    if (total <= 0) return []
    if (total === 1) return [left + width / 2]
    const step = width / (total - 1)
    return Array.from({ length: total }, (_, i) => left + step * i)
}

function getMinVisibleBarHeight(value: number, heightPx: number, minPx = 3) {
    if (value <= 0 || heightPx <= 0) return 0
    return Math.max(minPx, heightPx)
}

function safeNum(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

function niceStep(maxValue: number, steps = 5) {
    const raw = Math.max(1, maxValue) / Math.max(1, steps)
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
    const residual = raw / magnitude
    if (residual <= 1) return 1 * magnitude
    if (residual <= 2) return 2 * magnitude
    if (residual <= 5) return 5 * magnitude
    return 10 * magnitude
}

function niceAxisMax(maxValue: number, steps = 5) {
    const step = niceStep(maxValue, steps)
    return Math.max(step, Math.ceil(maxValue / step) * step)
}

function formatAxisValue(val: number, suffix = "") {
    if (suffix) return `${Math.round(val)}${suffix}`
    if (val >= 1000) {
        const k = val / 1000
        const text = k >= 100 ? k.toFixed(0) : k >= 10 ? k.toFixed(1) : k.toFixed(2)
        return `${text.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}k`
    }
    if (val >= 100) return `${Math.round(val)}`
    if (val >= 10) return `${val.toFixed(0)}`
    return `${val.toFixed(1).replace(/\.0$/, "")}`
}

function buildProductionScale(data: UiProductionPoint[]) {
    const producedMax  = Math.max(0, ...data.map((d) => safeNum(d.value)))
    const rejectedMax  = Math.max(0, ...data.map((d) => safeNum(d.rejected)))
    const capacityMax  = Math.max(0, ...data.map((d) => safeNum(d.capacity)))
    const metaMax      = Math.max(0, ...data.map((d) => safeNum(d.meta)))
    const baseSeriesMax = Math.max(producedMax, rejectedMax, capacityMax, 1)
    const metaLooksInvalidForHourlyScale =
        metaMax > baseSeriesMax * 3 && metaMax - baseSeriesMax > 100
    const effectiveMetaValues = data.map((d) => {
        const rawMeta = Math.max(0, safeNum(d.meta))
        if (!metaLooksInvalidForHourlyScale) return rawMeta
        return Math.max(0, safeNum(d.capacity), safeNum(d.value))
    })
    const effectiveMetaMax = Math.max(0, ...effectiveMetaValues)
    const axisBaseMax = Math.max(baseSeriesMax, effectiveMetaMax, 1)
    return { maxVal: niceAxisMax(axisBaseMax, 5), metaLooksInvalidForHourlyScale, effectiveMetaValues }
}

// ─── Shared draw utilities ────────────────────────────────────────────────────

function makeDrawHelpers(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    PAD: { top: number; right: number; bottom: number; left: number },
    CW: number,
    CH: number,
) {
    const py = (val: number, maxVal: number) =>
        PAD.top + CH - clampV((val / Math.max(maxVal, 1)) * CH, 0, CH)

    const drawHGrid = (steps: number, maxVal: number, minVal = 0, suffix = "", solidLines = false) => {
        for (let i = 0; i <= steps; i++) {
            const y   = PAD.top + (CH / steps) * i
            const val = maxVal - ((maxVal - minVal) / steps) * i
            ctx.save()
            if (solidLines) {
                ctx.strokeStyle = i === steps ? "rgba(100,116,139,0.32)" : "rgba(148,163,184,0.38)"
                ctx.lineWidth   = 1
                ctx.setLineDash([])
            } else {
                ctx.strokeStyle = i === steps ? "rgba(100,116,139,0.22)" : "rgba(226,232,240,0.55)"
                ctx.lineWidth   = i === steps ? 1 : 0.5
                ctx.setLineDash(i === steps ? [] : [4, 4])
            }
            ctx.beginPath()
            ctx.moveTo(PAD.left, y)
            ctx.lineTo(W - PAD.right, y)
            ctx.stroke()
            ctx.restore()

            ctx.fillStyle     = "rgba(100,116,139,0.75)"
            ctx.font          = "500 11px 'IBM Plex Mono','JetBrains Mono',ui-monospace,monospace"
            ctx.textAlign     = "right"
            ctx.textBaseline  = "middle"
            ctx.fillText(formatAxisValue(val, suffix), PAD.left - 8, y)
        }
    }

    const drawXLabels = (labels: string[], positions: number[]) => {
        const total = labels.length
        const skip  = total > 20 ? 4 : total > 12 ? 2 : 1
        ctx.font          = "500 11px 'IBM Plex Mono','JetBrains Mono',ui-monospace,monospace"
        ctx.fillStyle     = "rgba(100,116,139,0.75)"
        ctx.textAlign     = "center"
        ctx.textBaseline  = "top"
        labels.forEach((lbl, i) => {
            if (i % skip !== 0 && i !== total - 1) return
            const x = positions[i]
            if (x == null) return
            ctx.strokeStyle = "rgba(148,163,184,0.3)"
            ctx.lineWidth   = 1
            ctx.beginPath()
            ctx.moveTo(x, PAD.top + CH)
            ctx.lineTo(x, PAD.top + CH + 4)
            ctx.stroke()
            ctx.fillText(lbl, x, PAD.top + CH + 7)
        })
    }

    const drawYAxisLabel = (label: string) => {
        ctx.save()
        ctx.translate(14, PAD.top + CH / 2)
        ctx.rotate(-Math.PI / 2)
        ctx.fillStyle    = "rgba(100,116,139,0.65)"
        ctx.font         = "500 10px 'IBM Plex Mono','JetBrains Mono',ui-monospace,monospace"
        ctx.textAlign    = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(label, 0, 0)
        ctx.restore()
    }

    const drawEmpty = (hint: string) => {
        ctx.fillStyle    = "rgba(100,116,139,0.55)"
        ctx.font         = "500 12px system-ui, sans-serif"
        ctx.textAlign    = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(hint, PAD.left + CW / 2, PAD.top + CH / 2)
    }

    const drawLegendItem = (
        x: number, y: number,
        color: string,
        label: string,
        opts: { rect?: boolean; dashed?: boolean } = { rect: true },
    ) => {
        if (opts.dashed) {
            ctx.save()
            ctx.setLineDash([4, 3])
            ctx.strokeStyle = color
            ctx.lineWidth   = 1.5
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 12, y); ctx.stroke()
            ctx.restore()
        } else if (opts.rect) {
            ctx.fillStyle = color
            ctx.fillRect(x, y - 5, 12, 10)
        } else {
            ctx.save()
            ctx.strokeStyle = color; ctx.lineWidth = 2
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 12, y); ctx.stroke()
            ctx.restore()
            ctx.beginPath(); ctx.arc(x + 6, y, 2.5, 0, Math.PI * 2)
            ctx.fillStyle = color; ctx.fill()
        }
        ctx.fillStyle    = "rgba(71,85,105,0.9)"
        ctx.font         = "500 10.5px system-ui,sans-serif"
        ctx.textAlign    = "left"
        ctx.textBaseline = "middle"
        ctx.fillText(label, x + 16, y)
    }

    return { py, drawHGrid, drawXLabels, drawYAxisLabel, drawEmpty, drawLegendItem }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InteractiveChart({
    chartType,
    onTooltip,
    stationHeader,
    productionPoints,
    cyclePoints,
    lossBars,
    oeeBars,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        let frame = 0

        const draw = () => {
            const rect = canvas.getBoundingClientRect()
            if (rect.width < 1 || rect.height < 1) return

            const dpr = window.devicePixelRatio || 1
            canvas.width  = Math.round(rect.width  * dpr)
            canvas.height = Math.round(rect.height * dpr)

            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            const W   = rect.width
            const H   = rect.height
            const PAD = { top: 48, right: 24, bottom: 46, left: 60 }
            const CW  = Math.max(1, W - PAD.left - PAD.right)
            const CH  = Math.max(1, H - PAD.top  - PAD.bottom)

            // White background
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, W, H)

            const { py, drawHGrid, drawXLabels, drawYAxisLabel, drawEmpty, drawLegendItem } =
                makeDrawHelpers(ctx, W, H, PAD, CW, CH)

            // Left axis baseline
            ctx.strokeStyle = "rgba(100,116,139,0.22)"
            ctx.lineWidth   = 1
            ctx.beginPath()
            ctx.moveTo(PAD.left, PAD.top)
            ctx.lineTo(PAD.left, PAD.top + CH)
            ctx.stroke()

            // ══ PRODUÇÃO ══════════════════════════════════════════════════════
            if (chartType === "producao") {
                const data = productionPoints
                const fallbackLabels = ["06h","07h","08h","09h","10h","11h","12h","13h"]
                const labels    = data.length ? data.map((d) => d.hour) : fallbackLabels
                const positions = getXPositions(PAD.left, CW, Math.max(1, labels.length))

                drawYAxisLabel("UN")
                drawXLabels(labels, positions)

                if (!data.length) {
                    drawHGrid(5, 10)
                    drawEmpty("Sem dados de produção no período")
                    return
                }

                const { maxVal, effectiveMetaValues } = buildProductionScale(data)
                drawHGrid(5, maxVal, 0, "", true)

                const step = data.length > 1 ? CW / (data.length - 1) : CW
                const barW = Math.max(16, Math.min(60, step * 0.74))

                // ── Capacity area fill (behind bars)
                const capAreaGrad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + CH)
                capAreaGrad.addColorStop(0, "rgba(5,150,105,0.08)")
                capAreaGrad.addColorStop(1, "rgba(5,150,105,0.00)")

                ctx.beginPath()
                ctx.moveTo(positions[0], PAD.top + CH)
                data.forEach((d, i) => {
                    ctx.lineTo(positions[i], py(Math.max(0, safeNum(d.capacity)), maxVal))
                })
                ctx.lineTo(positions[positions.length - 1], PAD.top + CH)
                ctx.closePath()
                ctx.fillStyle = capAreaGrad
                ctx.fill()

                // ── Production bars (dark green gradient, flat)
                ctx.save()
                ctx.beginPath()
                ctx.rect(PAD.left, PAD.top, CW, CH + 2)
                ctx.clip()
                data.forEach((d, i) => {
                    const x      = positions[i]
                    const val    = Math.max(0, safeNum(d.value))
                    const rejVal = Math.max(0, safeNum(d.rejected))

                    const rawH     = (val / maxVal) * CH
                    const producedH = getMinVisibleBarHeight(val, rawH, 4)
                    if (producedH <= 0) return
                    const yTop = PAD.top + CH - producedH

                    // Main bar — deep green gradient
                    const barGrad = ctx.createLinearGradient(0, yTop, 0, PAD.top + CH)
                    barGrad.addColorStop(0, "#047857")
                    barGrad.addColorStop(0.55, "#065f46")
                    barGrad.addColorStop(1, "#022c22")

                    ctx.fillStyle = barGrad
                    ctx.fillRect(x - barW / 2, yTop, barW, producedH)

                    // Subtle left-edge highlight
                    const hlGrad = ctx.createLinearGradient(x - barW / 2, 0, x + barW / 2, 0)
                    hlGrad.addColorStop(0, "rgba(255,255,255,0.10)")
                    hlGrad.addColorStop(0.3, "rgba(255,255,255,0.04)")
                    hlGrad.addColorStop(1, "rgba(255,255,255,0.00)")
                    ctx.fillStyle = hlGrad
                    ctx.fillRect(x - barW / 2, yTop, barW, producedH)

                    // Refugo overlay (red, same width, bottom of bar)
                    if (rejVal > 0) {
                        const rawRejH = (rejVal / maxVal) * CH
                        const rejH   = Math.min(producedH, getMinVisibleBarHeight(rejVal, rawRejH, 3))
                        const rejY   = PAD.top + CH - rejH

                        const rejGrad = ctx.createLinearGradient(0, rejY, 0, rejY + rejH)
                        rejGrad.addColorStop(0, "rgba(220,38,38,0.88)")
                        rejGrad.addColorStop(1, "rgba(127,29,29,0.88)")
                        ctx.fillStyle = rejGrad
                        ctx.fillRect(x - barW / 2, rejY, barW, rejH)
                    }
                })
                ctx.restore()

                // ── Meta line (dashed gray) — above bars
                ctx.save()
                ctx.setLineDash([5, 5])
                ctx.strokeStyle = "rgba(100,116,139,0.70)"
                ctx.lineWidth   = 1.5
                ctx.beginPath()
                data.forEach((_, i) => {
                    const y = py(effectiveMetaValues[i] || 0, maxVal)
                    i === 0 ? ctx.moveTo(positions[i], y) : ctx.lineTo(positions[i], y)
                })
                ctx.stroke()
                ctx.restore()

                // ── Capacity line — above bars
                ctx.save()
                ctx.strokeStyle = "rgba(5,150,105,0.95)"
                ctx.lineWidth   = 2
                ctx.lineJoin    = "round"
                ctx.beginPath()
                data.forEach((d, i) => {
                    const y = py(Math.max(0, safeNum(d.capacity)), maxVal)
                    i === 0 ? ctx.moveTo(positions[i], y) : ctx.lineTo(positions[i], y)
                })
                ctx.stroke()
                ctx.restore()

                // ── Capacity dots — topmost layer
                data.forEach((d, i) => {
                    const x = positions[i]
                    const y = py(Math.max(0, safeNum(d.capacity)), maxVal)
                    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2)
                    ctx.fillStyle = "#ffffff"; ctx.fill()
                    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
                    ctx.fillStyle = "rgba(5,150,105,0.9)"; ctx.fill()
                })

                // ── Legend
                const legendY = 24
                let lx = W - PAD.right
                ctx.font = "500 10.5px system-ui,sans-serif"
                ;[
                    { color: "#022c22", label: "Produzido", rect: true },
                    { color: "rgba(220,38,38,0.85)", label: "Refugo", rect: true },
                    { color: "rgba(5,150,105,0.85)", label: "Capacidade", rect: false },
                    { color: "rgba(100,116,139,0.5)", label: "Meta", dashed: true },
                ].slice().reverse().forEach((item) => {
                    const tw = ctx.measureText(item.label).width
                    lx -= tw + 30
                    drawLegendItem(lx, legendY, item.color, item.label, item)
                })
            }

            // ══ CICLO ═════════════════════════════════════════════════════════
            if (chartType === "ciclo") {
                const data = cyclePoints
                const fallbackLabels = ["06h","07h","08h","09h","10h","11h","12h","13h"]
                const labels    = data.length ? data.map((d) => d.hour) : fallbackLabels
                const positions = getXPositions(PAD.left, CW, Math.max(1, labels.length))

                const maxRaw = data.length
                    ? Math.max(10, ...data.map((d) => Math.max(safeNum(d.value), safeNum(d.nominal))))
                    : 10
                const maxVal = niceAxisMax(maxRaw, 4)

                drawHGrid(4, maxVal, 0, "s", true)
                drawXLabels(labels, positions)
                drawYAxisLabel("Segundos")

                if (!data.length) {
                    drawEmpty("Sem dados de ciclo no período")
                    return
                }

                // Area fill — dark green smooth gradient
                const areaGrad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + CH)
                areaGrad.addColorStop(0,   "rgba(2,44,34,0.38)")
                areaGrad.addColorStop(0.5, "rgba(2,44,34,0.16)")
                areaGrad.addColorStop(1,   "rgba(2,44,34,0.00)")

                ctx.beginPath()
                ctx.moveTo(positions[0], PAD.top + CH)
                data.forEach((d, i) => {
                    ctx.lineTo(positions[i], py(Math.max(0, safeNum(d.value)), maxVal))
                })
                ctx.lineTo(positions[positions.length - 1], PAD.top + CH)
                ctx.closePath()
                ctx.fillStyle = areaGrad
                ctx.fill()

                // Nominal reference line (dashed emerald)
                ctx.save()
                ctx.setLineDash([6, 4])
                ctx.strokeStyle = "rgba(5,150,105,0.70)"
                ctx.lineWidth   = 1.5
                ctx.beginPath()
                data.forEach((d, i) => {
                    const y = py(Math.max(0, safeNum(d.nominal)), maxVal)
                    i === 0 ? ctx.moveTo(positions[i], y) : ctx.lineTo(positions[i], y)
                })
                ctx.stroke()
                ctx.restore()

                // Main line — dark green (same family as production)
                ctx.save()
                ctx.strokeStyle = "#047857"
                ctx.lineWidth   = 2.5
                ctx.lineJoin    = "round"
                ctx.beginPath()
                data.forEach((d, i) => {
                    const y = py(Math.max(0, safeNum(d.value)), maxVal)
                    i === 0 ? ctx.moveTo(positions[i], y) : ctx.lineTo(positions[i], y)
                })
                ctx.stroke()
                ctx.restore()

                // Legend
                const legendY = 24
                let lx = W - PAD.right
                ;[
                    { color: "#047857", label: "Ciclo médio", rect: false },
                    { color: "rgba(5,150,105,0.70)", label: "Nominal", dashed: true },
                ].slice().reverse().forEach((item) => {
                    const tw = ctx.measureText(item.label).width
                    lx -= tw + 30
                    drawLegendItem(lx, legendY, item.color, item.label, item)
                })
            }

            // ══ OEE / PERDAS ══════════════════════════════════════════════════
            if (chartType === "oee") {
                const useOee = Array.isArray(oeeBars) && oeeBars.length >= 3
                const data   = useOee ? (oeeBars as UiLossBar[]) : lossBars

                const fallbackLabels = useOee
                    ? ["OEE","Disponib.","Perform.","Qualidade"]
                    : ["Grupo A","Grupo B","Grupo C"]
                const labels = data.length ? data.map((d) => d.label) : fallbackLabels

                const maxRaw = data.length
                    ? Math.max(1, ...data.map((d) => Math.abs(safeNum(d.value))))
                    : 1
                const maxVal = useOee ? 100 : niceAxisMax(maxRaw, 5)

                // Wider bars: 72% of slot
                const slotCount = Math.max(4, data.length + 2)
                const slot = CW / slotCount
                const bW   = slot * 0.72

                const barPositions = data.map((_, i) => PAD.left + slot * (i + 1) + slot * 0.7)

                drawHGrid(5, maxVal, 0, useOee ? "%" : "", true)
                drawXLabels(labels, barPositions)
                drawYAxisLabel(useOee ? "%" : "min")

                if (!data.length) {
                    drawEmpty(useOee ? "Sem dados de OEE no período" : "Sem perdas registradas")
                    return
                }

                // Monochromatic amber/brown palette — OEE and loss bars
                const amberPalette: [string, string][] = [
                    ["#7c2d12", "#3b0f04"],
                    ["#b45309", "#7c2d12"],
                    ["#d97706", "#b45309"],
                    ["#f59e0b", "#c2410c"],
                    ["#fbbf24", "#d97706"],
                ]

                data.forEach((d, i) => {
                    const x    = barPositions[i]
                    const val  = Math.abs(safeNum(d.value))
                    const rawH = maxVal > 0 ? (val / maxVal) * CH : 0
                    const h    = getMinVisibleBarHeight(val, rawH, 4)
                    if (h <= 0) return
                    const yTop = PAD.top + CH - h

                    const [colorTop, colorBot] = amberPalette[i % amberPalette.length]

                    const barGrad = ctx.createLinearGradient(0, yTop, 0, PAD.top + CH)
                    barGrad.addColorStop(0, colorTop)
                    barGrad.addColorStop(1, colorBot)

                    ctx.fillStyle = barGrad
                    ctx.fillRect(x - bW / 2, yTop, bW, h)

                    // Left highlight
                    const hlGrad = ctx.createLinearGradient(x - bW / 2, 0, x + bW / 2, 0)
                    hlGrad.addColorStop(0, "rgba(255,255,255,0.08)")
                    hlGrad.addColorStop(1, "rgba(255,255,255,0.00)")
                    ctx.fillStyle = hlGrad
                    ctx.fillRect(x - bW / 2, yTop, bW, h)

                    // Value label above bar
                    ctx.fillStyle    = "rgba(15,23,42,0.75)"
                    ctx.font         = "600 11px 'IBM Plex Mono','JetBrains Mono',ui-monospace,monospace"
                    ctx.textAlign    = "center"
                    ctx.textBaseline = "bottom"
                    const txt = useOee
                        ? `${clampV(safeNum(d.value), 0, 100).toFixed(0)}%`
                        : `${safeNum(d.value).toFixed(1).replace(".", ",")}`
                    ctx.fillText(txt, x, yTop - 4)
                })
            }
        }

        const scheduleDraw = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(draw)
        }

        scheduleDraw()

        const ro = new ResizeObserver(scheduleDraw)
        ro.observe(canvas)
        window.addEventListener("resize", scheduleDraw)

        return () => {
            cancelAnimationFrame(frame)
            ro.disconnect()
            window.removeEventListener("resize", scheduleDraw)
        }
    }, [chartType, productionPoints, cyclePoints, lossBars, oeeBars])

    // ── Tooltip interaction ───────────────────────────────────────────────────
    const handleMouseMove = (e: React.MouseEvent) => {
        try {
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            const PAD = { top: 48, right: 24, bottom: 46, left: 60 }
            const CW  = rect.width - PAD.left - PAD.right

            if (chartType === "producao") {
                const data = productionPoints
                if (!data.length) return onTooltip(null)
                const positions = getXPositions(PAD.left, CW, data.length)
                let idx = -1, bestDist = Infinity
                positions.forEach((px, i) => { const d = Math.abs(px - x); if (d < bestDist) { bestDist = d; idx = i } })
                if (idx < 0 || x < PAD.left || x > rect.width - PAD.right) return onTooltip(null)
                const d = data[idx]
                const ordem = stationHeader?.ordem_codigo || stationHeader?.ordem_public_id || "--"
                onTooltip({
                    x: e.clientX, y: e.clientY,
                    content: (
                        <div style={{ border: "1px solid #e4e8ed", background: "#ffffff", padding: "10px 12px", minWidth: 170, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f1117" }}>{d.hour}</span>
                                <span style={{ fontFamily: "monospace", fontSize: 10, background: "#f0f2f5", padding: "1px 6px", color: "#475569" }}>OP {ordem}</span>
                            </div>
                            {[
                                { label: "Produzido", val: safeNum(d.value), color: "#047857" },
                                { label: "Capacidade", val: safeNum(d.capacity), color: "#059669" },
                                { label: "Meta", val: safeNum(d.meta), color: "#64748b" },
                                { label: "Refugo", val: safeNum(d.rejected), color: "#dc2626" },
                            ].map(({ label, val, color }) => (
                                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f2f5", fontSize: 11 }}>
                                    <span style={{ color: "#64748b" }}>{label}</span>
                                    <span style={{ fontFamily: "monospace", fontWeight: 700, color }}>{val}</span>
                                </div>
                            ))}
                        </div>
                    ),
                })
                return
            }

            if (chartType === "ciclo") {
                const data = cyclePoints
                if (!data.length) return onTooltip(null)
                const positions = getXPositions(PAD.left, CW, data.length)
                let idx = -1, bestDist = Infinity
                positions.forEach((px, i) => { const d = Math.abs(px - x); if (d < bestDist) { bestDist = d; idx = i } })
                if (idx < 0 || x < PAD.left || x > rect.width - PAD.right) return onTooltip(null)
                const d = data[idx]
                const ordem = stationHeader?.ordem_codigo || stationHeader?.ordem_public_id || "--"
                const prod  = productionPoints[idx]
                onTooltip({
                    x: e.clientX, y: e.clientY,
                    content: (
                        <div style={{ border: "1px solid #e4e8ed", background: "#ffffff", padding: "10px 12px", minWidth: 160, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f1117" }}>{d.hour}</span>
                                <span style={{ fontFamily: "monospace", fontSize: 10, background: "#f0f2f5", padding: "1px 6px", color: "#475569" }}>OP {ordem}</span>
                            </div>
                            {[
                                { label: "Ciclo médio", val: safeNum(d.value) > 0 ? `${safeNum(d.value).toFixed(1)}s` : "0s", color: "#1e293b" },
                                { label: "Nominal",     val: safeNum(d.nominal) > 0 ? `${safeNum(d.nominal).toFixed(1)}s` : "—", color: "#059669" },
                                ...(prod ? [
                                    { label: "Produzido", val: String(safeNum(prod.value)),   color: "#047857" },
                                    { label: "Refugo",    val: String(safeNum(prod.rejected)), color: "#dc2626" },
                                ] : []),
                            ].map(({ label, val, color }) => (
                                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f2f5", fontSize: 11 }}>
                                    <span style={{ color: "#64748b" }}>{label}</span>
                                    <span style={{ fontFamily: "monospace", fontWeight: 700, color }}>{val}</span>
                                </div>
                            ))}
                        </div>
                    ),
                })
                return
            }

            if (chartType === "oee") {
                const useOee = Array.isArray(oeeBars) && oeeBars.length >= 3
                const data   = useOee ? (oeeBars as UiLossBar[]) : lossBars
                if (!data.length) return onTooltip(null)
                const slotCount = Math.max(4, data.length + 2)
                const slot = CW / slotCount
                const bW   = slot * 0.72
                let found = false
                data.forEach((d, i) => {
                    const barX = PAD.left + slot * (i + 1) + slot * 0.7
                    if (x >= barX - bW / 2 && x <= barX + bW / 2 && y >= PAD.top && y <= rect.height - PAD.bottom) {
                        found = true
                        onTooltip({
                            x: e.clientX, y: e.clientY,
                            content: (
                                <div style={{ border: "1px solid #e4e8ed", background: "#ffffff", padding: "10px 12px", minWidth: 140, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0f1117", marginBottom: 4 }}>{d.label}</div>
                                    <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18, color: "#1e293b" }}>
                                        {useOee
                                            ? `${clampV(safeNum(d.value), 0, 100).toFixed(1)}%`
                                            : `${safeNum(d.value).toFixed(2).replace(".", ",")} min`}
                                    </div>
                                </div>
                            ),
                        })
                    }
                })
                if (!found) onTooltip(null)
            }
        } catch { onTooltip(null) }
    }

    return (
        <div className="w-full h-full relative">
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => onTooltip(null)}
            />
        </div>
    )
}

export function Tooltip({ data }: { data: TooltipData }) {
    if (!data) return null
    return (
        <div className="fixed z-50 pointer-events-none" style={{ left: data.x + 14, top: data.y - 16 }}>
            {data.content}
        </div>
    )
}

// components/analitico/rebarbador-charts.tsx
"use client"

/**
 * ══════════════════════════════════════════════════════════════════
 * REBARBADORES — ANALÍTICO (ranking + eficiência x parada)
 *
 * Contraparte, no /analitico, dos gráficos de rebarbadores do
 * /historico (components/historico/rebarbadores-tab.tsx) — mesma
 * fonte de dados (mes.corridas.rebarbador_id) e matemática (pçs/h,
 * aderência à meta, qualidade), mas agregada POR REBARBADOR sobre
 * TODO o período filtrado (não por atuação individual), no estilo
 * "comparar e bater o olho" do /analitico.
 *
 * Lições aplicadas (sessão anterior, /historico):
 *   - Tooltip SEMPRE position:fixed (nunca absolute dentro de card com
 *     overflow-hidden) — evita o bug de "só a ponta aparece".
 *   - Gráficos em SVG usam aspect-ratio (viewBox + className
 *     aspect-[W/H]), nunca altura fixa em px — evita letterbox.
 *
 * Guarded: se a migração REBARBADOR não rodou, mostra aviso amigável
 * em vez de quebrar a aba.
 * ══════════════════════════════════════════════════════════════════
 */

import React, { useMemo, useRef, useState, useCallback } from "react"
import {
  Users, Zap, Clock, AlertCircle, RefreshCcw, BarChart2,
  Award, ArrowUpDown, Info,
} from "lucide-react"
import {
  useRebarbadoresRanking,
  type RebarbadorRankingRow,
  type AnalyticsFilters,
} from "@/hooks/analitico/use-api"
import { SHIFT_PAL } from "@/components/analitico/shift-chart"

/* ─────────────────────────── formatadores ─────────────────────────── */
function fmtN(n: number, dec = 0): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPct(n: number | null, dec = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(dec).replace(".", ",")}%`
}
function fmtPcsH(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
const pad2 = (n: number) => String(n).padStart(2, "0")
function fmtHM(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00"
  const t = Math.round(s)
  return `${Math.floor(t / 3600)}:${pad2(Math.floor((t % 3600) / 60))}`
}
function truncName(s: string, max = 16): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/* ─────────────────────────── bandas de cor ─────────────────────────── */
/** aderência 0..n → cor (≥95% ótimo, ≥80% atenção, abaixo crítico) */
function aderenciaBand(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return SHIFT_PAL.volume
  return v >= 0.95 ? SHIFT_PAL.good : v >= 0.8 ? SHIFT_PAL.warn : SHIFT_PAL.bad
}
/** qualidade 0..1 (good/total) → cor (≥98% ótimo, ≥90% atenção) */
function qualidadeBand(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return SHIFT_PAL.volume
  return v >= 0.98 ? SHIFT_PAL.good : v >= 0.9 ? SHIFT_PAL.warn : SHIFT_PAL.bad
}

/* ═══════════════════════════════════════════════════════════════════
 * KPI CHIP — resumo do conjunto de rebarbadores
 * ═══════════════════════════════════════════════════════════════════ */
function KpiChip({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="flex items-center gap-2.5 border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] px-3 py-2.5 min-w-0">
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: color ?? "#a1a1aa" }} />
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-white/30 truncate">{label}</div>
        <div className="text-[15px] font-black tabular-nums leading-tight" style={{ color: color ?? undefined }}>{value}</div>
        {sub && <div className="text-[9px] text-zinc-400 dark:text-white/25 tabular-nums truncate">{sub}</div>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 * RANKING — barras horizontais por rebarbador (pçs/h)
 * ═══════════════════════════════════════════════════════════════════ */
const MAX_BARS = 12

function RankingChart({ rows }: { rows: RebarbadorRankingRow[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b.pcs_h ?? -1) - (a.pcs_h ?? -1))
  }, [rows])

  const shown = sorted.slice(0, MAX_BARS)

  const withValue = shown.filter(r => (r.pcs_h ?? 0) > 0)
  let bestId: string | null = null
  let worstId: string | null = null
  if (withValue.length >= 2) {
    const vals = new Set(withValue.map(r => r.pcs_h))
    if (vals.size > 1) {
      bestId = withValue.reduce((a, b) => (b.pcs_h! > a.pcs_h! ? b : a)).rebarbador_id
      worstId = withValue.reduce((a, b) => (b.pcs_h! < a.pcs_h! ? b : a)).rebarbador_id
    }
  }

  const axisMax = useMemo(() => {
    let m = 1
    for (const r of shown) {
      if (r.pcs_h != null) m = Math.max(m, r.pcs_h)
      if (r.meta_pcs_h != null) m = Math.max(m, r.meta_pcs_h)
    }
    return m * 1.15
  }, [shown])

  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / (axisMax || 1)) * 100))}%`

  if (!shown.length) {
    return (
      <div className="w-full min-h-[220px] flex items-center justify-center border border-dashed border-zinc-200 dark:border-white/[0.08] bg-zinc-50/50 dark:bg-white/[0.015]">
        <div className="text-center text-zinc-400 dark:text-white/25">
          <Users className="w-9 h-9 mx-auto mb-2 opacity-20" />
          <p className="text-sm font-bold text-zinc-500 dark:text-white/40">Sem rebarbadores no período</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full px-2 sm:px-3 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/45">
            Ranking — Peças / hora
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-white/28 mt-0.5">
            Barra = pçs/h produzidas. Marcador ▏= meta (3600/ciclo ideal). Verde = melhor, vermelho = pior.
            {sorted.length > MAX_BARS ? ` Mostrando top ${MAX_BARS} de ${sorted.length}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 dark:text-white/40">
            <span className="w-[3px] h-3.5" style={{ background: SHIFT_PAL.target }} /> Meta
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {shown.map((r, i) => {
          const isBest = r.rebarbador_id === bestId
          const isWorst = r.rebarbador_id === worstId
          const color = isBest ? SHIFT_PAL.good : isWorst ? SHIFT_PAL.bad : SHIFT_PAL.volume
          const val = r.pcs_h ?? 0
          return (
            <div
              key={r.rebarbador_id}
              className="flex items-center gap-2 sm:gap-3 py-1.5 group"
              onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              onMouseEnter={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
            >
              <div className="w-20 sm:w-28 shrink-0 text-right pr-1">
                <div className="text-[12px] sm:text-[13px] font-bold text-zinc-700 dark:text-white/70 truncate" title={r.rebarbador_nome}>
                  {truncName(r.rebarbador_nome)}
                </div>
                {(isBest || isWorst) && (
                  <div
                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] mt-0.5"
                    style={{ color: isBest ? SHIFT_PAL.good : SHIFT_PAL.bad }}
                  >
                    {isBest ? "▲ melhor" : "▼ pior"}
                  </div>
                )}
              </div>

              <div className="relative flex-1 h-9 sm:h-10">
                <div className="absolute inset-0 bg-zinc-100 dark:bg-white/[0.045]" />
                {val > 0 && (
                  <div
                    className="absolute transition-[width] duration-300"
                    style={{ left: 0, width: pct(val), top: 4, height: "calc(100% - 8px)", background: color }}
                  />
                )}
                {r.meta_pcs_h != null && r.meta_pcs_h > 0 && r.meta_pcs_h <= axisMax && (
                  <div
                    className="absolute -top-1 -bottom-1 w-[2px] z-10"
                    style={{ left: pct(r.meta_pcs_h), background: SHIFT_PAL.target }}
                    title={`Meta ${fmtPcsH(r.meta_pcs_h)} pçs/h`}
                  >
                    <span className="absolute -top-[3px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rotate-45" style={{ background: SHIFT_PAL.target }} />
                  </div>
                )}
              </div>

              <div className="w-[104px] sm:w-36 shrink-0 text-right">
                <div className="text-[13px] sm:text-[15px] font-black tabular-nums leading-none" style={{ color }}>
                  {fmtPcsH(r.pcs_h)} <span className="text-[9px] font-bold opacity-60">pçs/h</span>
                </div>
                <div className="flex items-center justify-end gap-1 mt-1 flex-wrap">
                  {r.aderencia != null && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-px text-[9px] font-bold tabular-nums"
                      style={{ background: `${aderenciaBand(r.aderencia)}1a`, color: aderenciaBand(r.aderencia) }}
                      title="Aderência à meta"
                    >
                      <span className="opacity-70">Ader.</span>{fmtPct(r.aderencia * 100, 0)}
                    </span>
                  )}
                  {r.qualidade != null && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-px text-[9px] font-bold tabular-nums"
                      style={{ background: `${qualidadeBand(r.qualidade)}1a`, color: qualidadeBand(r.qualidade) }}
                      title="Qualidade (aprovado/total)"
                    >
                      <span className="opacity-70">Qual.</span>{fmtPct(r.qualidade * 100, 0)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {hover && shown[hover.i] && (() => {
        const r = shown[hover.i]
        return (
          <div
            className="fixed pointer-events-none z-[100] border border-zinc-200 shadow-2xl overflow-hidden"
            style={{
              left: Math.max(8, Math.min(hover.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1280) - 232)),
              top: hover.y - 14,
              transform: hover.y > 220 ? "translateY(-100%)" : "translateY(18px)",
              minWidth: 210,
              background: "rgba(255,255,255,0.98)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="px-3 py-2 border-b border-zinc-100 bg-zinc-50">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{r.rebarbador_nome}</span>
            </div>
            <div className="px-3 py-2 space-y-1">
              {[
                { label: "Pçs/h", value: `${fmtPcsH(r.pcs_h)} pçs/h`, strong: true },
                { label: "Meta pçs/h", value: r.meta_pcs_h != null ? fmtPcsH(r.meta_pcs_h) : "—" },
                { label: "Aderência", value: fmtPct(r.aderencia != null ? r.aderencia * 100 : null, 0) },
                { label: "Qualidade", value: fmtPct(r.qualidade != null ? r.qualidade * 100 : null, 0) },
                { label: "Atuações", value: fmtN(r.atuacoes) },
                { label: "Aprovado", value: fmtN(r.good) },
                { label: "Refugo", value: fmtN(r.scrap) },
                { label: "Retrabalho", value: fmtN(r.rework) },
                { label: "Tempo parado", value: `${fmtHM(r.parada_seg)} (${fmtN(r.qtd_paradas)}x)` },
              ].map((t) => (
                <div key={t.label} className="flex items-center justify-between gap-4">
                  <span className="text-[11px] text-zinc-500">{t.label}</span>
                  <span className={`text-[12px] tabular-nums ${t.strong ? "font-black text-zinc-900" : "font-bold text-zinc-700"}`}>{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 * SCATTER — Eficiência (pçs/h) x Tempo parado, bolha = volume (good)
 * ═══════════════════════════════════════════════════════════════════ */
function ScatterChart({ rows }: { rows: RebarbadorRankingRow[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const W = 900, H = 320, PAD_L = 56, PAD_R = 20, PAD_T = 16, PAD_B = 36

  const pts = useMemo(() => rows.filter(r => r.dur_total_seg > 0), [rows])

  const maxParadaMin = useMemo(
    () => Math.max(1, ...pts.map(r => r.parada_seg / 60)) * 1.1,
    [pts],
  )
  const maxPcsH = useMemo(
    () => Math.max(1, ...pts.map(r => r.pcs_h ?? 0)) * 1.15,
    [pts],
  )
  const maxGood = useMemo(() => Math.max(1, ...pts.map(r => r.good)), [pts])

  const xOf = (paradaMin: number) => PAD_L + (paradaMin / maxParadaMin) * (W - PAD_L - PAD_R)
  const yOf = (pcsH: number) => H - PAD_B - (pcsH / maxPcsH) * (H - PAD_T - PAD_B)
  const rOf = (good: number) => 4 + Math.sqrt(Math.max(0, good) / maxGood) * 14

  if (!pts.length) {
    return (
      <div className="w-full min-h-[220px] flex items-center justify-center border border-dashed border-zinc-200 dark:border-white/[0.08] bg-zinc-50/50 dark:bg-white/[0.015]">
        <div className="text-center text-zinc-400 dark:text-white/25">
          <BarChart2 className="w-9 h-9 mx-auto mb-2 opacity-20" />
          <p className="text-sm font-bold text-zinc-500 dark:text-white/40">Sem dados para o gráfico</p>
        </div>
      </div>
    )
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxPcsH)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxParadaMin)

  return (
    <div className="relative w-full px-2 sm:px-3 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/45">
            Eficiência × Parada
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-white/28 mt-0.5">
            Eixo Y = pçs/h · Eixo X = tempo parado (min) · Tamanho da bolha = volume aprovado. Ideal: canto superior esquerdo.
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full aspect-[900/320]" onMouseLeave={() => setHover(null)}>
        {/* eixos */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="currentColor" className="text-zinc-200 dark:text-white/10" strokeWidth={1} />
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="currentColor" className="text-zinc-200 dark:text-white/10" strokeWidth={1} />

        {yTicks.map((t, i) => (
          <g key={`y-${i}`}>
            <line x1={PAD_L} y1={yOf(t)} x2={W - PAD_R} y2={yOf(t)} stroke="currentColor" className="text-zinc-100 dark:text-white/[0.04]" strokeWidth={1} />
            <text x={PAD_L - 6} y={yOf(t) + 3} textAnchor="end" fontSize={9} className="fill-zinc-400 dark:fill-white/25 tabular-nums">
              {fmtN(t, 0)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={`x-${i}`} x={xOf(t)} y={H - PAD_B + 14} textAnchor="middle" fontSize={9} className="fill-zinc-400 dark:fill-white/25 tabular-nums">
            {fmtN(t, 0)}
          </text>
        ))}
        <text x={12} y={PAD_T + 8} fontSize={9} className="fill-zinc-400 dark:fill-white/25" transform={`rotate(-90 12 ${PAD_T + 8})`}>pçs/h</text>
        <text x={W - PAD_R} y={H - 6} textAnchor="end" fontSize={9} className="fill-zinc-400 dark:fill-white/25">min. parado</text>

        {pts.map((r, i) => {
          const cx = xOf(r.parada_seg / 60)
          const cy = yOf(r.pcs_h ?? 0)
          const color = r.aderencia != null ? aderenciaBand(r.aderencia) : qualidadeBand(r.qualidade)
          return (
            <circle
              key={r.rebarbador_id}
              cx={cx}
              cy={cy}
              r={rOf(r.good)}
              fill={color}
              fillOpacity={0.72}
              stroke={color}
              strokeWidth={1.5}
              onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              onMouseEnter={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              className="cursor-pointer transition-opacity hover:opacity-100"
            />
          )
        })}
      </svg>

      {hover && pts[hover.i] && (() => {
        const r = pts[hover.i]
        return (
          <div
            className="fixed pointer-events-none z-[100] border border-zinc-200 shadow-2xl overflow-hidden"
            style={{
              left: Math.max(8, Math.min(hover.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1280) - 232)),
              top: hover.y - 14,
              transform: hover.y > 220 ? "translateY(-100%)" : "translateY(18px)",
              minWidth: 210,
              background: "rgba(255,255,255,0.98)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="px-3 py-2 border-b border-zinc-100 bg-zinc-50">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{r.rebarbador_nome}</span>
            </div>
            <div className="px-3 py-2 space-y-1">
              {[
                { label: "Pçs/h", value: `${fmtPcsH(r.pcs_h)} pçs/h`, strong: true },
                { label: "Tempo parado", value: fmtHM(r.parada_seg) },
                { label: "Aprovado", value: fmtN(r.good) },
                { label: "Aderência", value: fmtPct(r.aderencia != null ? r.aderencia * 100 : null, 0) },
                { label: "Qualidade", value: fmtPct(r.qualidade != null ? r.qualidade * 100 : null, 0) },
              ].map((t) => (
                <div key={t.label} className="flex items-center justify-between gap-4">
                  <span className="text-[11px] text-zinc-500">{t.label}</span>
                  <span className={`text-[12px] tabular-nums ${t.strong ? "font-black text-zinc-900" : "font-bold text-zinc-700"}`}>{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 * TABELA COMPACTA — todos os rebarbadores, ordenável
 * ═══════════════════════════════════════════════════════════════════ */
type SortKey = "rebarbador_nome" | "atuacoes" | "good" | "pcs_h" | "aderencia" | "qualidade" | "parada_seg"

function RebarbadoresTable({ rows }: { rows: RebarbadorRankingRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("pcs_h")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const diff = typeof av === "string" || typeof bv === "string"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : (Number(av ?? -1) - Number(bv ?? -1))
      return sortDir === "asc" ? diff : -diff
    })
    return arr
  }, [rows, sortKey, sortDir])

  const onSort = useCallback((k: SortKey) => {
    setSortKey(prev => {
      if (prev === k) { setSortDir(d => d === "asc" ? "desc" : "asc"); return prev }
      setSortDir("desc")
      return k
    })
  }, [])

  const cols: { key: SortKey; label: string }[] = [
    { key: "rebarbador_nome", label: "Rebarbador" },
    { key: "atuacoes", label: "Atuações" },
    { key: "good", label: "Aprovado" },
    { key: "pcs_h", label: "Pçs/h" },
    { key: "aderencia", label: "Aderência" },
    { key: "qualidade", label: "Qualidade" },
    { key: "parada_seg", label: "Parado" },
  ]

  if (!rows.length) return null

  return (
    <div className="border-t border-zinc-100 dark:border-white/[0.06]">
      <div className="max-h-72 overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-[#12141a] z-10">
            <tr className="border-b border-zinc-100 dark:border-white/[0.06]">
              {cols.map(c => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 select-none whitespace-nowrap cursor-pointer hover:text-zinc-700 dark:hover:text-white/55 transition-colors ${c.key === "rebarbador_nome" ? "text-left" : "text-right"}`}
                >
                  <span className={`inline-flex items-center gap-1 ${c.key === "rebarbador_nome" ? "" : "justify-end"}`}>
                    {c.label}
                    {sortKey === c.key ? (
                      <span className="text-amber-500 font-black">{sortDir === "asc" ? "↑" : "↓"}</span>
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.rebarbador_id} className="border-b border-zinc-100 dark:border-white/[0.04] hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors">
                <td className="px-3 py-2 text-left font-bold text-[12px] text-zinc-700 dark:text-white/70">{r.rebarbador_nome}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">{fmtN(r.atuacoes)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-[12px]" style={{ color: SHIFT_PAL.good }}>{fmtN(r.good)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-black text-[12px] text-zinc-800 dark:text-white/80">{fmtPcsH(r.pcs_h)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-[12px]" style={{ color: aderenciaBand(r.aderencia) }}>
                  {fmtPct(r.aderencia != null ? r.aderencia * 100 : null, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-[12px]" style={{ color: qualidadeBand(r.qualidade) }}>
                  {fmtPct(r.qualidade != null ? r.qualidade * 100 : null, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-[12px] text-zinc-700 dark:text-white/70">
                  {fmtHM(r.parada_seg)} <span className="text-[9px] text-zinc-400 dark:text-white/30">({fmtN(r.qtd_paradas)}x)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 * SEÇÃO — orquestra fetch + estados (loading/erro/indisponível) + charts
 * ═══════════════════════════════════════════════════════════════════ */
export function RebarbadorAnaliticoSection({
  filters, enabled,
}: {
  filters: AnalyticsFilters
  enabled: boolean
}) {
  const { rows, disponivel, motivoIndisponivel, isLoading, error, refresh } =
    useRebarbadoresRanking({ filters, enabled })

  const kpis = useMemo(() => {
    if (!rows.length) return null
    const withPcsH = rows.filter(r => r.pcs_h != null && r.pcs_h > 0)
    const avgPcsH = withPcsH.length ? withPcsH.reduce((a, r) => a + (r.pcs_h ?? 0), 0) / withPcsH.length : null
    const withAd = rows.filter(r => r.aderencia != null)
    const avgAd = withAd.length ? withAd.reduce((a, r) => a + (r.aderencia ?? 0), 0) / withAd.length : null
    const totalParada = rows.reduce((a, r) => a + r.parada_seg, 0)
    const totalGood = rows.reduce((a, r) => a + r.good, 0)
    return { count: rows.length, avgPcsH, avgAd, totalParada, totalGood }
  }, [rows])

  if (!enabled) return null

  return (
    <div className="border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-300 dark:text-white/20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-white/45">
            Rebarbadores — ranking e eficiência
          </span>
        </div>
        <button
          onClick={() => refresh()}
          className="h-7 w-7 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-zinc-300 dark:text-white/22 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
          title="Atualizar"
          type="button"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-[280px] flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
          <span className="text-[11px] text-zinc-400 dark:text-white/28 uppercase tracking-[0.1em]">Carregando rebarbadores…</span>
        </div>
      ) : error ? (
        <div className="h-[280px] border-t border-red-100 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.05] flex flex-col items-center justify-center gap-4 p-6">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <div className="text-center">
            <p className="text-sm font-bold text-red-600 dark:text-red-400 uppercase tracking-[0.08em]">Falha ao carregar rebarbadores</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-white/35 max-w-sm font-mono">{String(error?.message ?? error)}</p>
          </div>
          <button
            onClick={() => refresh()}
            className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-600 dark:text-white/55 hover:bg-zinc-50 dark:hover:bg-white/[0.07] transition-colors"
            type="button"
          >
            <RefreshCcw className="w-4 h-4" />
            Tentar novamente
          </button>
        </div>
      ) : !disponivel ? (
        <div className="h-[220px] flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Info className="w-8 h-8 text-amber-500" />
          <p className="text-sm font-bold text-zinc-600 dark:text-white/55">Recurso ainda não disponível</p>
          <p className="text-xs text-zinc-400 dark:text-white/30 max-w-md">{motivoIndisponivel}</p>
        </div>
      ) : (
        <>
          {kpis && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 pt-3">
              <KpiChip icon={Users} label="Rebarbadores" value={fmtN(kpis.count)} />
              <KpiChip icon={Zap} label="Pçs/h médio" value={fmtPcsH(kpis.avgPcsH)} color={SHIFT_PAL.volume} />
              <KpiChip
                icon={Award}
                label="Aderência média"
                value={fmtPct(kpis.avgAd != null ? kpis.avgAd * 100 : null, 0)}
                color={aderenciaBand(kpis.avgAd)}
              />
              <KpiChip icon={Clock} label="Tempo parado total" value={fmtHM(kpis.totalParada)} color={SHIFT_PAL.unplanned} />
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start p-3">
            <div className="border border-zinc-100 dark:border-white/[0.05] min-w-0">
              <RankingChart rows={rows} />
            </div>
            <div className="border border-zinc-100 dark:border-white/[0.05] min-w-0">
              <ScatterChart rows={rows} />
            </div>
          </div>

          <RebarbadoresTable rows={rows} />
        </>
      )}
    </div>
  )
}

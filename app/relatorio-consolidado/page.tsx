// app/relatorio-consolidado/page.tsx
// Versão industrial v5.1 — coluna Equipamento → Início / Fim na tabela de Paradas
"use client"

import React, {
  Suspense, useCallback, useEffect, useMemo, useRef, useState,
} from "react"
import {
  Activity, AlertCircle, BarChart2, Calendar, ChevronDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clock, FileText, Info, Loader2, MessageSquare, Printer,
  RefreshCw, Search, TrendingDown, TrendingUp, Users, X, Zap,
  Filter, ChevronUp, ArrowUpRight, ArrowDownRight, Minus,
  AlertTriangle, CheckCircle2, Settings2, LayoutDashboard,
} from "lucide-react"

import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import {
  buildUtcWindow, useEmpresaId, useRelatorioApi,
  type GraficoPerdaItem, type GraficoPerdaTabelaRow,
  type ParadaMotivoParetoItem, type AnotacaoItem, type PlanoAcaoItem,
} from "@/hooks/relatorios/use-api"

/* ═══════════════════════════════════════════════════════════════
 * DESIGN TOKENS 
 * ═══════════════════════════════════════════════════════════════ */
const DS = {
  green: "#22c55e", red: "#ef4444", amber: "#f59e0b",
  indigo: "#7c3aed", sky: "#0891b2",
}
const ACCENT_DARK = "#ea580c" 
const PROD_GREEN = {
  top: "#15803d", bottom: "#052e16",
  topHov: "#16a34a", bottomHov: "#14532d",
  line: "#166534",
  area: "22,101,52",
}

/* ═══════════════════════════════════════════════════════════════
 * UTILIDADES
 * ═══════════════════════════════════════════════════════════════ */
function fmtNum(n: number | null | undefined, dec = 0): string {
  const x = Number.isFinite(n as number) ? (n as number) : 0
  return x.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPct(f: number | null | undefined): string {
  if (f == null || !Number.isFinite(f)) return "—"
  return (f * 100).toFixed(2).replace(".", ",") + "%"
}
function fmtHH(totalSeg: number): string {
  const s = Math.max(0, Math.floor(totalSeg))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}
function fmtMM(totalSeg: number): string {
  const s = Math.max(0, Math.floor(totalSeg))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}
function semColor(v: number): string {
  if (v >= 0.85) return DS.green
  if (v >= 0.65) return DS.amber
  return DS.red
}
/**
 * Formata uma string ISO UTC em dd/MM HH:mm no fuso local (America/Sao_Paulo).
 * A API envia UTC via CONVERT(...,126), que NÃO tem sufixo "Z" — sem tratar
 * isso, `new Date(iso)` interpreta a string como hora LOCAL (spec ES), e o
 * horário exibido saía ~3h adiantado. Mesmo fix aplicado em /historico.
 */
function parseUtcIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  return Number.isFinite(d.getTime()) ? d : null
}
function fmtDateTime(iso: string | null | undefined): string {
  const d = parseUtcIso(iso)
  if (!d) return "—"
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}
const PALETTE = [
  "#d97706", "#dc2626", "#2563eb", "#059669", "#7c3aed", "#0891b2",
  "#ea580c", "#65a30d", "#db2777", "#64748b", "#EC4899", "#8B5CF6",
  "#84CC16", "#E11D48", "#A855F7", "#22D3EE",
]
function pal(i: number) { return PALETTE[i % PALETTE.length] }

/**
 * Trunca texto para caber em `maxWidth` px no contexto de canvas atual (usa
 * o ctx.font já configurado pelo chamador), acrescentando "…". Substitui os
 * antigos `.slice(0, N)` fixos, que cortavam rótulos de eixo de forma
 * arbitrária e causavam texto cortado/ilegível nos gráficos de Perdas e
 * Pareto de Paradas.
 */
function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "…"
}

/* ═══════════════════════════════════════════════════════════════
 * DATE PRESETS
 * ═══════════════════════════════════════════════════════════════ */
type PresetId = "hoje" | "ontem" | "7dias" | "30dias" | "semanaAtual" | "semanaAnterior" | "mesAtual" | "mesAnterior" | "personalizado"
const PRESETS: { id: PresetId; label: string }[] = [
  { id: "hoje", label: "Hoje" }, { id: "ontem", label: "Ontem" },
  { id: "7dias", label: "Últimos 7 dias" }, { id: "30dias", label: "Últimos 30 dias" },
  { id: "semanaAtual", label: "Semana atual" }, { id: "semanaAnterior", label: "Semana anterior" },
  { id: "mesAtual", label: "Mês atual" }, { id: "mesAnterior", label: "Mês anterior" },
  { id: "personalizado", label: "Personalizado" },
]
function applyPreset(id: PresetId) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let s = new Date(today), e = new Date(today)
  if (id === "ontem") { s = e = new Date(today.getTime() - 86400000) }
  else if (id === "7dias") { s = new Date(today.getTime() - 6 * 86400000) }
  else if (id === "30dias") { s = new Date(today.getTime() - 29 * 86400000) }
  else if (id === "semanaAtual") { const d = (today.getDay() + 6) % 7; s = new Date(today.getTime() - d * 86400000) }
  else if (id === "semanaAnterior") { const d = (today.getDay() + 6) % 7; e = new Date(today.getTime() - (d + 1) * 86400000); s = new Date(e.getTime() - 6 * 86400000) }
  else if (id === "mesAtual") { s = new Date(today.getFullYear(), today.getMonth(), 1) }
  else if (id === "mesAnterior") { s = new Date(today.getFullYear(), today.getMonth() - 1, 1); e = new Date(today.getFullYear(), today.getMonth(), 0) }
  return { start: s, end: e }
}
const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

/* ═══════════════════════════════════════════════════════════════
 * DATE RANGE PICKER
 * ═══════════════════════════════════════════════════════════════ */
function DateRangePicker({ isOpen, onClose, startDate, endDate, onSelect }: {
  isOpen: boolean; onClose: () => void; startDate: Date; endDate: Date; onSelect: (s: Date, e: Date) => void
}) {
  const [preset, setPreset] = useState<PresetId>("personalizado")
  const [s, setS] = useState(startDate), [e, setE] = useState(endDate)
  const [picking, setPicking] = useState<"start" | "end">("start")
  const [lm, setLm] = useState(new Date(startDate.getFullYear(), startDate.getMonth(), 1))
  const [rm, setRm] = useState(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1))
  useEffect(() => { if (!isOpen) return; setS(startDate); setE(endDate); setLm(new Date(startDate.getFullYear(), startDate.getMonth(), 1)); setRm(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1)) }, [isOpen, startDate, endDate])
  const handleDay = (d: Date) => { setPreset("personalizado"); if (picking === "start" || d < s) { setS(d); setE(d); setPicking("end") } else { setE(d); setPicking("start") } }
  const Cal = ({ month, setMonth }: { month: Date; setMonth: (d: Date) => void }) => {
    const y = month.getFullYear(), m = month.getMonth()
    const off = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate(), prev = new Date(y, m, 0).getDate()
    const days: { date: Date; cur: boolean }[] = []
    for (let i = 0; i < off; i++) days.push({ date: new Date(y, m - 1, prev - off + i + 1), cur: false })
    for (let i = 1; i <= dim; i++) days.push({ date: new Date(y, m, i), cur: true })
    while (days.length < 42) days.push({ date: new Date(y, m + 1, days.length - off - dim + 1), cur: false })
    return (
      <div className="w-52">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(new Date(y, m - 1, 1))} className="p-1 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors">
            <ChevronLeft className="w-4 h-4 text-zinc-400 dark:text-white/30" />
          </button>
          <span className="text-sm font-bold text-zinc-800 dark:text-white/75">{MONTHS_PT[m]} {y}</span>
          <button onClick={() => setMonth(new Date(y, m + 1, 1))} className="p-1 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors">
            <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-white/30" />
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">{"STQQSSD".split("").map((d, i) => <div key={i} className="text-center text-[10px] font-bold text-zinc-400 dark:text-white/25 py-0.5">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d, i) => {
            const isSt = d.date.toDateString() === s.toDateString(), isEn = d.date.toDateString() === e.toDateString(), inR = d.date > s && d.date < e
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
      <div className="bg-white dark:bg-[#0d1117] border border-zinc-200 dark:border-white/[0.1] shadow-2xl overflow-hidden max-h-[95vh] overflow-y-auto">
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
          <div className="w-full sm:w-44 border-b sm:border-b-0 sm:border-r border-zinc-100 dark:border-white/[0.06] p-3 bg-zinc-50/60 dark:bg-white/[0.015]">
            <p className="text-[10px] font-bold text-zinc-400 dark:text-white/25 uppercase tracking-[0.2em] mb-2 px-1">Atalhos rápidos</p>
            {PRESETS.map(p => (
              <button key={p.id}
                onClick={() => { setPreset(p.id); const { start, end } = applyPreset(p.id); setS(start); setE(end) }}
                className={[
                  "w-full text-left px-2.5 py-1.5 text-[12px] font-medium mb-0.5 transition-all",
                  preset === p.id
                    ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold"
                    : "text-zinc-600 dark:text-white/40 hover:bg-white dark:hover:bg-white/[0.06]",
                ].join(" ")}
              >{p.label}</button>
            ))}
          </div>
          <div className="p-5 flex flex-col sm:flex-row gap-6">
            <Cal month={lm} setMonth={setLm} />
            <Cal month={rm} setMonth={setRm} />
          </div>
        </div>
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

/* ═══════════════════════════════════════════════════════════════
 * MULTI-SELECT MODAL
 * ═══════════════════════════════════════════════════════════════ */
type Option = { id: string; label: string; meta?: string }
function MultiSelectModal({ isOpen, onClose, title, options, selectedIds, onSelect, emptyText = "Nenhum item" }: {
  isOpen: boolean; onClose: () => void; title: string; options: Option[]; selectedIds: string[]
  onSelect: (ids: string[]) => void; emptyText?: string
}) {
  const [sa, setSa] = useState(""), [ss2, setSs2] = useState("")
  const [temp, setTemp] = useState<string[]>(selectedIds)
  useEffect(() => { if (isOpen) { setTemp(selectedIds); setSa(""); setSs2("") } }, [isOpen, selectedIds])
  const selSet = useMemo(() => new Set(temp), [temp])
  const optMap = useMemo(() => new Map(options.map(o => [o.id, o])), [options])
  const avail = useMemo(() => { const q = sa.trim().toLowerCase(); return options.filter(o => !selSet.has(o.id) && (q === "" || o.label.toLowerCase().includes(q) || (o.meta ?? "").toLowerCase().includes(q))) }, [options, selSet, sa])
  const sel = useMemo(() => { const q = ss2.trim().toLowerCase(); const all = temp.map(id => optMap.get(id)).filter(Boolean) as Option[]; return q === "" ? all : all.filter(o => o.label.toLowerCase().includes(q) || (o.meta ?? "").toLowerCase().includes(q)) }, [temp, optMap, ss2])
  if (!isOpen) return null
  const List = ({ items, onCI, hc, search, setSearch, ph, empty }: { items: Option[]; onCI: (id: string) => void; hc: string; search: string; setSearch: (s: string) => void; ph: string; empty: string }) => (
    <div className="flex-1 min-w-0">
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 dark:text-white/25" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={ph} className="w-full pl-8 pr-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/30 bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65 placeholder:text-zinc-300 dark:placeholder:text-white/18" />
      </div>
      <div className="border border-zinc-200 dark:border-white/[0.09] h-52 overflow-y-auto divide-y divide-zinc-100 dark:divide-white/[0.05] bg-white dark:bg-white/[0.02]">
        {items.map(o => (<button key={o.id} onClick={() => onCI(o.id)} className={`w-full text-left px-3 py-2 text-xs transition-colors ${hc}`}><div className="font-semibold text-zinc-700 dark:text-white/70">{o.label}</div>{o.meta && <div className="text-zinc-400 dark:text-white/25 text-[10px]">{o.meta}</div>}</button>))}
        {!items.length && <div className="px-3 py-10 text-center text-xs text-zinc-400 dark:text-white/25">{empty}</div>}
      </div>
    </div>
  )
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-sm p-4" onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-[#0d1117] border border-zinc-200 dark:border-white/[0.1] shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-white/[0.07] bg-zinc-50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2"><Filter className="w-4 h-4 text-amber-500" /><h3 className="font-bold text-zinc-900 dark:text-white/80 text-sm tracking-tight">{title}</h3></div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.07] transition-colors"><X className="w-4 h-4 text-zinc-400 dark:text-white/30" /></button>
        </div>
        <div className="p-5">
          <div className="flex gap-3 items-start">
            <List items={avail} onCI={id => setTemp(p => [...p, id])} hc="hover:bg-zinc-50 dark:hover:bg-white/[0.05] hover:text-amber-600 dark:hover:text-amber-400" search={sa} setSearch={setSa} ph="Filtrar disponíveis..." empty={emptyText} />
            <div className="flex flex-col items-center gap-2 mt-8 flex-shrink-0">
              <button onClick={() => setTemp(p => Array.from(new Set([...p, ...avail.map(a => a.id)])))} className="w-9 h-9 border border-zinc-200 dark:border-white/[0.1] bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center transition-colors"><ChevronsRight className="w-4 h-4" /></button>
              <button onClick={() => { const s = new Set(sel.map(x => x.id)); setTemp(p => p.filter(id => !s.has(id))) }} className="w-9 h-9 border border-zinc-200 dark:border-white/[0.1] bg-zinc-50 dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.08] text-zinc-500 dark:text-white/40 flex items-center justify-center transition-colors"><ChevronsLeft className="w-4 h-4" /></button>
            </div>
            <List items={sel} onCI={id => setTemp(p => p.filter(x => x !== id))} hc="hover:bg-red-50 dark:hover:bg-red-500/[0.08] hover:text-red-600 dark:hover:text-red-400" search={ss2} setSearch={setSs2} ph="Filtrar selecionados..." empty="Nada selecionado" />
          </div>
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-zinc-100 dark:border-white/[0.06]">
            <span className="text-xs text-zinc-400 dark:text-white/25 font-medium">{temp.length} selecionado{temp.length !== 1 ? "s" : ""}</span>
            <div className="flex gap-2">
              <button onClick={() => setTemp([])} className="px-4 py-2 text-sm text-zinc-500 dark:text-white/40 hover:text-red-600 dark:hover:text-red-400 font-medium transition-colors">Limpar</button>
              <button onClick={onClose} className="px-4 py-2 border border-zinc-200 dark:border-white/[0.1] text-sm text-zinc-600 dark:text-white/40 hover:bg-zinc-50 dark:hover:bg-white/[0.06] font-medium transition-colors">Cancelar</button>
              <button onClick={() => { onSelect(temp); onClose() }} className="px-5 py-2 bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold transition-colors">Aplicar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * UI PRIMITIVES
 * ═══════════════════════════════════════════════════════════════ */
function Sk({ className = "" }: { className?: string }) {
  return <div className={`bg-zinc-200 dark:bg-white/[0.06] animate-pulse ${className}`} />
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white dark:bg-white/[0.02] border border-zinc-200 dark:border-white/[0.07] overflow-hidden ${className}`}>{children}</div>
}
function SectionHeader({ title, subtitle, right, icon }: { title: string; subtitle?: string; right?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-zinc-100 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && <div className="w-8 h-8 border border-zinc-200 dark:border-white/[0.08] flex items-center justify-center flex-shrink-0">{icon}</div>}
        <div>
          <h2 className="font-black text-zinc-900 dark:text-white/85 text-sm tracking-tight uppercase">{title}</h2>
          {subtitle && <p className="text-[11px] text-zinc-400 dark:text-white/28 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}
function ToggleGroup({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03]">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} className={["px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition-all whitespace-nowrap", value === o.id ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "text-zinc-500 dark:text-white/40 hover:text-zinc-800 dark:hover:text-white/70"].join(" ")}>{o.label}</button>
      ))}
    </div>
  )
}
function StatusDot({ status }: { status: "green" | "amber" | "red" }) {
  const colors = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} ring-2 ring-white dark:ring-[#0f1117]`} />
}

/* ═══════════════════════════════════════════════════════════════
 * KPI CARD
 * ═══════════════════════════════════════════════════════════════ */
// Mesmo visual do KpiCard industrial do /historico: caixa reta, número
// grande em mono, label uppercase tiny, barra lateral âmbar quando isPrimary.
// Valor e ícone ficam em preto/neutro para todos os cards — só o card
// isPrimary (OEE Global) usa o laranja de destaque, igual ao /historico.
const KPI_NUM_FONT = "var(--font-mono), 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace"
function KpiCard({ label, value, unit, sub, icon, trend, isPrimary }: {
  label: string; value: string; unit?: string; sub?: string
  icon: React.ReactNode; trend?: "up" | "down" | "neutral"
  isPrimary?: boolean
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus
  const accentStyle = isPrimary ? { color: ACCENT_DARK } : undefined
  const accentClass = isPrimary ? "" : "text-zinc-900 dark:text-white/85"
  return (
    <div className="relative overflow-hidden border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.025] p-4 tabular-nums" style={{ fontFamily: KPI_NUM_FONT }}>
      {isPrimary && (
        <div aria-hidden="true" className="absolute left-0 top-1/2 w-0.5 -translate-y-1/2" style={{ height: "85%", background: ACCENT_DARK }} />
      )}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 dark:text-white/35">{label}</span>
        <span className={accentClass} style={accentStyle}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`tabular-nums text-[34px] font-extrabold leading-none ${accentClass}`} style={accentStyle}>{value}</span>
        {unit && <span className="tabular-nums text-base font-semibold text-zinc-400 dark:text-white/35">{unit}</span>}
        {trend && <TrendIcon className={`w-4 h-4 ml-0.5 ${trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-zinc-400"}`} />}
      </div>
      {sub && <div className="mt-1.5 text-[11px] font-medium text-zinc-400 dark:text-white/30 tabular-nums truncate">{sub}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * OEE RING
 * ═══════════════════════════════════════════════════════════════ */
function OeeRing({ value, meta, size = 160, color }: { value: number; meta: number; size?: number; color: string }) {
  const r = size / 2 - 14, circ = 2 * Math.PI * r
  const pct = Math.min(Math.max(value, 0), 1), metaPct = Math.min(Math.max(meta, 0), 1)
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-zinc-200 dark:text-white/[0.08]" strokeWidth={14} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-zinc-300 dark:text-white/[0.18]" strokeWidth={14} strokeDasharray={circ} strokeDashoffset={circ * (1 - metaPct)} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10} strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="butt" style={{ transition: "stroke-dashoffset 0.7s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 font-mono">
        <span className="text-[9px] text-zinc-400 dark:text-white/30 uppercase font-bold tracking-[0.2em]">OEE</span>
        <span className="text-2xl font-black leading-none tabular-nums" style={{ color }}>{(value * 100).toFixed(1).replace(".", ",")}%</span>
        <span className="text-[9px] text-zinc-400 dark:text-white/25 font-medium tabular-nums">Meta {(meta * 100).toFixed(0)}%</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: HORA A HORA
 * ═══════════════════════════════════════════════════════════════ */
type CTBreakdownItem = { ct_codigo: string; ct_nome: string | null; good: number }
type HoraDataItem = { label: string; value: number; target: number; breakdown: CTBreakdownItem[] }
function HoraChart({ data, ctColors }: { data: HoraDataItem[]; ctColors: Map<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; item: HoraDataItem; idx: number } | null>(null)
  const normalized = useMemo(() => data.map(d => {
    const sum = (d.breakdown ?? []).reduce((s, b) => s + (Number(b.good) || 0), 0)
    const v = Number.isFinite(Number(d.value)) && Number(d.value) > 0 ? Number(d.value) : sum
    const t = Number.isFinite(Number(d.target)) ? Number(d.target) : 0
    const breakdown = (d.breakdown ?? []).map(b => ({ ct_codigo: String(b.ct_codigo ?? ""), ct_nome: b.ct_nome ?? null, good: Number(b.good) || 0 })).filter(b => b.ct_codigo && b.good > 0).sort((a, b) => a.ct_codigo.localeCompare(b.ct_codigo))
    return { ...d, value: v, target: t, breakdown }
  }), [data])
  const maxV = useMemo(() => Math.max(0.001, ...normalized.map(d => Math.max(d.value || 0, d.target || 0))) * 1.2, [normalized])
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const P = { t: 24, r: 20, b: 50, l: 76 }, cW = W - P.l - P.r, cH = H - P.t - P.b
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    const steps = 5
    for (let i = 0; i <= steps; i++) {
      const y = P.t + (cH / steps) * i, v = maxV - (maxV / steps) * i
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === steps ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
      ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0), P.l - 8, y + 4)
    }
    if (!normalized.length) return
    const bw = cW / normalized.length, pad = bw * 0.20
    ctx.beginPath(); ctx.moveTo(P.l + bw / 2, P.t + cH)
    normalized.forEach((d, i) => ctx.lineTo(P.l + i * bw + bw / 2, P.t + cH - (d.value / maxV) * cH))
    ctx.lineTo(P.l + (normalized.length - 1) * bw + bw / 2, P.t + cH); ctx.closePath()
    ctx.fillStyle = isDark ? `rgba(${PROD_GREEN.area},0.22)` : `rgba(${PROD_GREEN.area},0.15)`; ctx.fill()
    normalized.forEach((d, i) => {
      const x = P.l + i * bw + pad / 2, w = bw - pad, isHov = tip?.idx === i
      if (!d.breakdown.length) {
        const bh = Math.max(2, (d.value / maxV) * cH), y = P.t + cH - bh
        const grad = ctx.createLinearGradient(x, y, x, y + bh)
        grad.addColorStop(0, isHov ? PROD_GREEN.topHov : PROD_GREEN.top); grad.addColorStop(1, isHov ? PROD_GREEN.bottomHov : PROD_GREEN.bottom)
        ctx.fillStyle = grad; ctx.fillRect(x, y, w, bh)
      } else {
        let yOff = P.t + cH
        d.breakdown.forEach((b, bi) => {
          const seg = Math.max(0, (b.good / maxV) * cH); if (seg < 0.5) return
          const col = ctColors.get(b.ct_codigo) ?? pal(bi)
          ctx.fillStyle = isHov ? col + "bb" : col + "cc"; ctx.fillRect(x, yOff - seg, w, seg)
          yOff -= seg
        })
      }
    })
    if (normalized.some(d => d.target > 0)) {
      ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.strokeStyle = isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"; ctx.lineWidth = 1.5
      normalized.forEach((d, i) => { if (d.target <= 0) return; const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.target / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.stroke(); ctx.setLineDash([])
    }
    ctx.beginPath(); ctx.strokeStyle = PROD_GREEN.line; ctx.lineWidth = 2.5; ctx.lineJoin = "round"
    normalized.forEach((d, i) => { const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.value / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }); ctx.stroke()
    normalized.forEach((d, i) => { const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.value / maxV) * cH; ctx.beginPath(); ctx.fillStyle = PROD_GREEN.line; ctx.arc(x, y, tip?.idx === i ? 5 : 3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = isDark ? "#0f1117" : "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke() })
    normalized.forEach((d, i) => { if (bw < 20) return; const x = P.l + i * bw + bw / 2; ctx.save(); ctx.translate(x, H - 6); if (bw < 44) ctx.rotate(-Math.PI / 5); ctx.fillStyle = isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.55)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(d.label, 0, 0); ctx.restore() })
  }, [normalized, maxV, ctColors, tip?.idx])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  return (
    <div className="relative w-full h-72">
      <canvas ref={ref} style={{ width: "100%", height: "100%" }}
        onMouseMove={ev => { const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, bw = (r.width - 96) / Math.max(1, normalized.length), i = Math.floor((x - 76) / bw); if (i >= 0 && i < normalized.length) setTip({ x, y: ev.clientY - r.top - 12, item: normalized[i], idx: i }); else setTip(null) }}
        onMouseLeave={() => setTip(null)} />
      {tip && (
        <div className="absolute pointer-events-none bg-white/97 dark:bg-[#0d1117]/95 backdrop-blur-md text-zinc-800 dark:text-white/85 text-xs border border-zinc-200 dark:border-white/[0.12] shadow-2xl whitespace-nowrap z-10 min-w-[200px]"
          style={{ left: Math.min(tip.x, 420), top: tip.y, transform: "translate(-50%,-100%)" }}>
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/[0.08] font-bold text-green-700 dark:text-green-400 flex items-center gap-1.5"><Clock className="w-3 h-3" />{tip.item.label}</div>
          <div className="px-3 py-2 space-y-1">
            <div className="flex justify-between gap-3">Produção: <span className="font-bold tabular-nums">{fmtNum(tip.item.value)} UN</span></div>
            {tip.item.target > 0 && <div className="text-zinc-400 dark:text-white/40 flex justify-between gap-3">Meta: <span className="font-bold">{fmtNum(tip.item.target)} UN</span></div>}
            {tip.item.breakdown.length > 0 && <div className="mt-1 pt-1 border-t border-zinc-100 dark:border-white/[0.08] space-y-0.5">
              {tip.item.breakdown.slice(0, 10).map(b => (<div key={b.ct_codigo} className="flex justify-between gap-3"><span style={{ color: ctColors.get(b.ct_codigo) ?? "#94A3B8" }}>{b.ct_nome ?? b.ct_codigo}:</span><span className="font-bold tabular-nums">{fmtNum(b.good)}</span></div>))}
            </div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: PRODUÇÃO DIÁRIA
 * ═══════════════════════════════════════════════════════════════ */
type DiaDataItem = { label: string; value: number; capacidade: number; breakdown: { ct_codigo: string; ct_nome: string | null; good: number }[] }
function DiaChart({ data, ctColors }: { data: DiaDataItem[]; ctColors: Map<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; item: DiaDataItem; idx: number } | null>(null)
  const maxV = useMemo(() => Math.max(0.001, ...data.map(d => Math.max(d.value, d.capacidade))) * 1.25, [data])
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const P = { t: 24, r: 20, b: 50, l: 76 }, cW = W - P.l - P.r, cH = H - P.t - P.b
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    const steps = 5
    for (let i = 0; i <= steps; i++) {
      const y = P.t + (cH / steps) * i, v = maxV - (maxV / steps) * i
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === steps ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
      ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0), P.l - 8, y + 4)
    }
    if (!data.length) return
    const bw = cW / data.length, pad = bw * 0.18
    data.forEach((d, i) => {
      const x = P.l + i * bw + pad / 2, w = bw - pad, isHov = tip?.idx === i
      if (!d.breakdown.length) {
        const bh = Math.max(2, (d.value / maxV) * cH)
        const grad = ctx.createLinearGradient(x, P.t + cH - bh, x, P.t + cH)
        grad.addColorStop(0, isHov ? PROD_GREEN.topHov : PROD_GREEN.top); grad.addColorStop(1, isHov ? PROD_GREEN.bottomHov : PROD_GREEN.bottom)
        ctx.fillStyle = grad; ctx.fillRect(x, P.t + cH - bh, w, bh)
      } else {
        let yOff = P.t + cH
        d.breakdown.forEach((b, bi) => {
          const seg = Math.max(0, (b.good / maxV) * cH); if (seg < 0.5) return
          const col = ctColors.get(b.ct_codigo) ?? pal(bi)
          ctx.fillStyle = isHov ? col + "bb" : col + "cc"; ctx.fillRect(x, yOff - seg, w, seg)
          yOff -= seg
        })
      }
    })
    // fill de área sob a linha — ponto inicial alinhado ao centro da 1ª barra
    // (antes era um cálculo morto que sempre avaliava para P.l, distorcendo a
    // borda esquerda do preenchimento).
    ctx.beginPath(); ctx.moveTo(P.l + bw / 2, P.t + cH)
    data.forEach((d, i) => ctx.lineTo(P.l + i * bw + bw / 2, P.t + cH - (d.value / maxV) * cH))
    ctx.lineTo(P.l + (data.length - 1) * bw + bw / 2, P.t + cH); ctx.closePath()
    ctx.fillStyle = isDark ? `rgba(${PROD_GREEN.area},0.18)` : `rgba(${PROD_GREEN.area},0.12)`; ctx.fill()
    ctx.beginPath(); ctx.strokeStyle = PROD_GREEN.line; ctx.lineWidth = 2.5; ctx.lineJoin = "round"
    data.forEach((d, i) => { const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.value / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }); ctx.stroke()
    data.forEach((d, i) => { const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.value / maxV) * cH; ctx.beginPath(); ctx.fillStyle = PROD_GREEN.line; ctx.arc(x, y, tip?.idx === i ? 5 : 3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = isDark ? "#0f1117" : "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke() })
    if (data.some(d => d.capacidade > 0)) {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"; ctx.lineWidth = 1.5; ctx.beginPath()
      data.forEach((d, i) => { if (d.capacidade <= 0) return; const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.capacidade / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }); ctx.stroke(); ctx.setLineDash([])
    }
    data.forEach((d, i) => { if (bw < 16) return; const x = P.l + i * bw + bw / 2; ctx.save(); ctx.translate(x, H - 6); if (bw < 38) ctx.rotate(-Math.PI / 5); ctx.fillStyle = isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.55)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(d.label, 0, 0); ctx.restore() })
  }, [data, maxV, ctColors, tip?.idx])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  return (
    <div className="relative w-full h-72">
      <canvas ref={ref} style={{ width: "100%", height: "100%" }}
        onMouseMove={ev => { const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, bw = (r.width - 96) / Math.max(1, data.length), i = Math.floor((x - 76) / bw); if (i >= 0 && i < data.length) setTip({ x, y: ev.clientY - r.top - 12, item: data[i], idx: i }); else setTip(null) }}
        onMouseLeave={() => setTip(null)} />
      {tip && (
        <div className="absolute pointer-events-none bg-white/97 dark:bg-[#0d1117]/95 backdrop-blur-md text-zinc-800 dark:text-white/85 text-xs border border-zinc-200 dark:border-white/[0.12] shadow-2xl whitespace-nowrap z-10"
          style={{ left: Math.min(tip.x, 400), top: tip.y, transform: "translate(-50%,-100%)" }}>
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/[0.08] font-bold text-green-700 dark:text-green-400">{tip.item.label}</div>
          <div className="px-3 py-2 space-y-1">
            <div>Produção: <span className="font-bold tabular-nums">{fmtNum(tip.item.value)} UN</span></div>
            {tip.item.capacidade > 0 && <div className="text-zinc-400 dark:text-white/40">Capacidade: <span className="font-bold">{fmtNum(tip.item.capacidade)}</span></div>}
            {tip.item.breakdown.length > 0 && <div className="mt-1 pt-1 border-t border-zinc-100 dark:border-white/[0.08] space-y-0.5">
              {tip.item.breakdown.slice(0, 6).map(b => (<div key={b.ct_codigo} className="flex justify-between gap-3"><span style={{ color: ctColors.get(b.ct_codigo) ?? "#94A3B8" }}>{b.ct_nome ?? b.ct_codigo}:</span><span className="font-bold tabular-nums">{fmtNum(b.good)}</span></div>))}
            </div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: CICLO
 * ═══════════════════════════════════════════════════════════════ */
type CicloData = { label: string; cycleSec: number }
function CicloChart({ data }: { data: CicloData[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; label: string; v: number; idx: number } | null>(null)
  const maxV = useMemo(() => Math.max(1, ...data.map(d => d.cycleSec)) * 1.25, [data])
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const P = { t: 24, r: 20, b: 50, l: 76 }, cW = W - P.l - P.r, cH = H - P.t - P.b
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    for (let i = 0; i <= 5; i++) {
      const y = P.t + (cH / 5) * i, v = maxV - (maxV / 5) * i
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === 5 ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.40)" : "rgba(0,0,0,0.55)"; ctx.font = "500 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText(fmtMM(v), P.l - 8, y + 4)
    }
    if (!data.length) return
    const bw = cW / data.length
    ctx.beginPath(); ctx.moveTo(P.l + bw / 2, P.t + cH)
    data.forEach((d, i) => ctx.lineTo(P.l + i * bw + bw / 2, P.t + cH - (d.cycleSec / maxV) * cH))
    ctx.lineTo(P.l + (data.length - 1) * bw + bw / 2, P.t + cH); ctx.closePath()
    ctx.fillStyle = isDark ? "rgba(217,119,6,0.14)" : "rgba(217,119,6,0.10)"; ctx.fill()
    ctx.beginPath(); ctx.strokeStyle = "#d97706"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"
    data.forEach((d, i) => { const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.cycleSec / maxV) * cH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }); ctx.stroke()
    data.forEach((d, i) => { const x = P.l + i * bw + bw / 2, y = P.t + cH - (d.cycleSec / maxV) * cH; ctx.beginPath(); ctx.fillStyle = tip?.idx === i ? "#b45309" : "#d97706"; ctx.arc(x, y, tip?.idx === i ? 5 : 3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = isDark ? "#0f1117" : "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke() })
    data.forEach((d, i) => { if (bw < 16) return; const x = P.l + i * bw + bw / 2; ctx.save(); ctx.translate(x, H - 6); if (bw < 44) ctx.rotate(-Math.PI / 5); ctx.fillStyle = isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.45)"; ctx.font = "500 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(d.label, 0, 0); ctx.restore() })
  }, [data, maxV, tip?.idx])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  return (
    <div className="relative w-full h-72">
      <canvas ref={ref} style={{ width: "100%", height: "100%" }}
        onMouseMove={ev => { const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, bw = (r.width - 96) / Math.max(1, data.length), i = Math.floor((x - 76) / bw); if (i >= 0 && i < data.length) setTip({ x, y: ev.clientY - r.top - 12, label: data[i].label, v: data[i].cycleSec, idx: i }); else setTip(null) }}
        onMouseLeave={() => setTip(null)} />
      {tip && (
        <div className="absolute pointer-events-none bg-white/97 dark:bg-[#0d1117]/95 backdrop-blur-md text-zinc-800 dark:text-white/85 text-xs border border-zinc-200 dark:border-white/[0.12] shadow-2xl whitespace-nowrap z-10"
          style={{ left: tip.x, top: tip.y, transform: "translate(-50%,-100%)" }}>
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/[0.08] font-bold text-amber-600 dark:text-amber-400">{tip.label}</div>
          <div className="px-3 py-2">Ciclo: <span className="font-bold tabular-nums">{fmtMM(tip.v)}</span></div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: OEE D/P/Q BARS
 * ═══════════════════════════════════════════════════════════════ */
function OeeBarChart({ disp, perf, qual }: { disp: number; perf: number; qual: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const maxV = Math.max(1.1, perf) * 1.10
    const P = { t: 24, r: 16, b: 64, l: 52 }, cH = H - P.t - P.b, cW = W - P.l - P.r
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    for (let i = 0; i <= 5; i++) {
      const y = P.t + (cH / 5) * i, v = maxV - (maxV / 5) * i
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === 5 ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.40)" : "rgba(0,0,0,0.55)"; ctx.font = "500 9px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText((v * 100).toFixed(0) + "%", P.l - 4, y + 3)
    }
    const ref100y = P.t + cH * (1 - 1 / maxV)
    ctx.setLineDash([4, 3]); ctx.strokeStyle = isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.28)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(P.l, ref100y); ctx.lineTo(W - P.r, ref100y); ctx.stroke(); ctx.setLineDash([])
    const bars = [
      { v: disp, label: "Disponibilidade", color: semColor(disp) },
      { v: perf, label: "Performance", color: semColor(Math.min(perf, 1)) },
      { v: qual, label: "Qualidade", color: semColor(qual) },
    ]
    const bw = cW / 3, pad = bw * 0.28
    bars.forEach((b, i) => {
      const bh = Math.max(2, (Math.min(b.v, maxV) / maxV) * cH)
      const x = P.l + i * bw + pad / 2, y = P.t + cH - bh, w = bw - pad
      const grad = ctx.createLinearGradient(x, y, x, y + bh)
      grad.addColorStop(0, b.color); grad.addColorStop(1, b.color + "88")
      ctx.fillStyle = grad; ctx.fillRect(x, y, w, bh)
    })
    bars.forEach((b, i) => {
      const x = P.l + i * bw, w = bw - bw * 0.28
      ctx.fillStyle = b.color; ctx.font = "700 8px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
      ctx.fillText(b.label, x + w / 2 + bw * 0.14, H - 36)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.85)" : "#18181b"; ctx.font = "700 13px 'Inter', system-ui, sans-serif"
      ctx.fillText((b.v * 100).toFixed(2).replace(".", ",") + "%", x + w / 2 + bw * 0.14, H - 16)
    })
  }, [disp, perf, qual])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  return <canvas ref={ref} style={{ width: "100%", height: "100%" }} />
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: GRÁFICO DE PERDAS
 * ═══════════════════════════════════════════════════════════════ */
const LOSS_COLOR: Record<string, string> = {
  planejado: DS.indigo, disponibilidade: DS.red, performance: DS.green, qualidade: DS.amber, efetivo: DS.sky,
}
const LOSS_LABEL: Record<string, string> = {
  // "planejado" e "efetivo" antes compartilhavam o mesmo texto ("Planejado/Efetivo"),
  // tornando a legenda ambígua (duas cores, um rótulo). Agora cada barra do
  // waterfall tem seu próprio nome.
  planejado: "Planejado", disponibilidade: "Disponibilidade", performance: "Performance", qualidade: "Qualidade", efetivo: "Efetivo",
}
// Paleta monocromática ("chumbo") usada só no GRÁFICO de perdas e na legenda
// que o acompanha — cada categoria recebe um tom de cinza-grafite distinto.
// A tabela de detalhamento ao lado continua usando LOSS_COLOR (semântico,
// por coluna: disponibilidade/performance/qualidade), que é independente.
const LOSS_MONO_HEX: Record<string, { light: string; dark: string }> = {
  planejado: { light: "#18181b", dark: "#e4e4e7" },
  disponibilidade: { light: "#27272a", dark: "#d4d4d8" },
  performance: { light: "#3f3f46", dark: "#a1a1aa" },
  qualidade: { light: "#52525b", dark: "#71717a" },
  efetivo: { light: "#71717a", dark: "#52525b" },
}
const LOSS_MONO_BG: Record<string, string> = {
  planejado: "bg-zinc-900 dark:bg-zinc-200",
  disponibilidade: "bg-zinc-800 dark:bg-zinc-300",
  performance: "bg-zinc-700 dark:bg-zinc-400",
  qualidade: "bg-zinc-600 dark:bg-zinc-500",
  efetivo: "bg-zinc-500 dark:bg-zinc-600",
}
const LOSS_MONO_TEXT: Record<string, string> = {
  planejado: "text-zinc-900 dark:text-zinc-200",
  disponibilidade: "text-zinc-800 dark:text-zinc-300",
  performance: "text-zinc-700 dark:text-zinc-400",
  qualidade: "text-zinc-600 dark:text-zinc-500",
  efetivo: "text-zinc-500 dark:text-zinc-400",
}
type LossView = "quantidade" | "hora"
function LossChart({ items, viewMode }: { items: GraficoPerdaItem[]; viewMode: LossView }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [hov, setHov] = useState<number | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; name: string; val: number; hint: string } | null>(null)
  const getValue = (d: GraficoPerdaItem) => viewMode === "hora" ? Math.abs(d.hours) : Math.abs(d.disponibilidade) + Math.abs(d.performance) + Math.abs(d.qualidade)
  const maxV = useMemo(() => Math.max(0.001, ...items.map(getValue)) * 1.2, [items, viewMode])
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const P = { t: 24, r: 24, b: 92, l: 84 }, cH = H - P.t - P.b, cW = W - P.l - P.r
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (cH / 4) * i, v = ((4 - i) / 4) * maxV
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === 4 ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      const lbl = viewMode === "quantidade" ? (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)) : fmtHH(v * 3600)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText(lbl, P.l - 6, y + 3)
    }
    if (!items.length) return
    const bw = cW / items.length, pad = Math.max(2, bw * 0.18)
    items.forEach((d, i) => {
      const v = getValue(d), bh = Math.max(2, (v / maxV) * cH)
      const x = P.l + i * bw + pad / 2, y = P.t + cH - bh, w = bw - pad
      if (hov === i) { ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)"; ctx.fillRect(P.l + i * bw, P.t, bw, cH) }
      const tone = (LOSS_MONO_HEX[d.color_hint] ?? LOSS_MONO_HEX.efetivo)[isDark ? "dark" : "light"]
      const grad = ctx.createLinearGradient(x, y, x, y + bh)
      grad.addColorStop(0, tone); grad.addColorStop(1, tone + "d9")
      ctx.fillStyle = grad; ctx.fillRect(x, y, w, bh)
      if (bw > 28) {
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.92)" : "#18181b"; ctx.font = "800 11px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
        const lbl = viewMode === "quantidade" ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) : fmtHH(v * 3600)
        ctx.fillText(lbl, x + w / 2, y - 6)
      }
      ctx.save(); ctx.translate(x + w / 2, H - 6); ctx.rotate(-Math.PI / 4)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.62)"; ctx.font = "600 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
      ctx.fillText(ellipsizeText(ctx, d.name, Math.max(56, bw * 1.5)), 0, 0)
      ctx.restore()
    })
  }, [items, hov, maxV, viewMode])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  return (
    <div className="relative w-full h-80">
      <canvas ref={ref} style={{ width: "100%", height: "100%" }}
        onMouseMove={ev => { const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, bw = (r.width - 108) / Math.max(1, items.length), i = Math.floor((x - 84) / bw); if (i >= 0 && i < items.length) { setHov(i); const v = getValue(items[i]); setTip({ x, y: ev.clientY - r.top - 12, name: items[i].name, val: v, hint: items[i].color_hint }) } else { setHov(null); setTip(null) } }}
        onMouseLeave={() => { setHov(null); setTip(null) }} />
      {tip && (
        <div className="absolute pointer-events-none bg-white/97 dark:bg-[#0d1117]/95 backdrop-blur-md text-zinc-800 dark:text-white/85 text-xs border border-zinc-200 dark:border-white/[0.12] shadow-2xl whitespace-nowrap z-10"
          style={{ left: Math.min(tip.x, 400), top: tip.y, transform: "translate(-50%,-100%)" }}>
          <div className={`px-3 py-2 border-b border-zinc-100 dark:border-white/[0.08] font-bold ${LOSS_MONO_TEXT[tip.hint] ?? "text-zinc-700 dark:text-white/70"}`}>{tip.name}</div>
          <div className="px-3 py-2">{viewMode === "quantidade" ? `${fmtNum(tip.val, 2)} UN` : fmtHH(tip.val * 3600)}</div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: PARADAS PARETO
 * ═══════════════════════════════════════════════════════════════ */
// Acima de 7 motivos, o modo de colunas (rotuladas na diagonal) fica
// ilegível e corta texto no eixo X. A partir daí o gráfico vira barras
// horizontais empilhadas por linha — acompanha o crescimento natural da
// tabela de motivos ao lado, sem rótulo cortado e com altura dinâmica.
const PARETO_ROWS_THRESHOLD = 7
const PARETO_ROW_H = 34
const PARETO_ROWS_P = { t: 30, l: 176, r: 68 }
function ParadaParetoChart({ data, motivoColors }: { data: ParadaMotivoParetoItem[]; motivoColors: Map<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; item: ParadaMotivoParetoItem; idx: number } | null>(null)
  const isRows = data.length > PARETO_ROWS_THRESHOLD
  const maxV = useMemo(() => Math.max(1, ...data.map(d => d.duracao_total_seg)) * 1.2, [data])
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    if (!data.length) return

    if (isRows) {
      const P = PARETO_ROWS_P, cW = W - P.l - P.r, cH = data.length * PARETO_ROW_H
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
      for (let i = 0; i <= 4; i++) {
        const x = P.l + (cW / 4) * i, v = (i / 4) * (maxV / 60)
        ctx.beginPath(); ctx.setLineDash([2, 6])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)"; ctx.lineWidth = 1
        ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + cH); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
        ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0), x, P.t - 10)
      }
      data.forEach((d, i) => {
        const y0 = P.t + i * PARETO_ROW_H, yc = y0 + PARETO_ROW_H / 2, barH = PARETO_ROW_H * 0.58
        if (tip?.idx === i) { ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"; ctx.fillRect(0, y0, W, PARETO_ROW_H) }
        const bw = Math.max(2, (d.duracao_total_seg / maxV) * cW)
        if (d.breakdown_ct.length > 0) {
          let xOff = P.l
          d.breakdown_ct.slice(0, 8).forEach((b, bi) => {
            const seg = Math.max(0, (b.duracao_seg / maxV) * cW); if (seg < 0.5) return
            ctx.fillStyle = pal(bi) + "cc"; ctx.fillRect(xOff, yc - barH / 2, seg, barH)
            xOff += seg
          })
        } else {
          const col = motivoColors.get(String(d.motivo_id)) ?? pal(i)
          const grad = ctx.createLinearGradient(P.l, 0, P.l + bw, 0)
          grad.addColorStop(0, col); grad.addColorStop(1, col + "99")
          ctx.fillStyle = grad; ctx.fillRect(P.l, yc - barH / 2, bw, barH)
        }
        ctx.font = "700 11px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.78)" : "#27272a"
        ctx.fillText(ellipsizeText(ctx, d.motivo_descricao, P.l - 16), P.l - 10, yc + 4)
        ctx.font = "700 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "left"
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.88)" : "#18181b"
        ctx.fillText(d.duracao_total_fmt || fmtHH(d.duracao_total_seg), P.l + bw + 8, yc + 4)
      })
      return
    }

    const P = { t: 24, r: 24, b: 92, l: 76 }, cH = H - P.t - P.b, cW = W - P.l - P.r
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (cH / 4) * i, v = ((4 - i) / 4) * maxV / 60
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === 4 ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
      ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0), P.l - 6, y + 3)
    }
    const bw = cW / data.length, pad = Math.max(2, bw * 0.20)
    data.forEach((d, i) => {
      const x = P.l + i * bw + pad / 2, w = bw - pad
      if (tip?.idx === i) { ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)"; ctx.fillRect(P.l + i * bw, P.t, bw, cH) }
      if (d.breakdown_ct.length > 0) {
        let yOff = P.t + cH
        d.breakdown_ct.slice(0, 8).forEach((b, bi) => {
          const seg = Math.max(0, (b.duracao_seg / maxV) * cH); if (seg < 0.5) return
          ctx.fillStyle = pal(bi) + "cc"; ctx.fillRect(x, yOff - seg, w, seg)
          yOff -= seg
        })
      } else {
        const bh = Math.max(2, (d.duracao_total_seg / maxV) * cH)
        const col = motivoColors.get(String(d.motivo_id)) ?? pal(i)
        const grad = ctx.createLinearGradient(x, P.t + cH - bh, x, P.t + cH)
        grad.addColorStop(0, col); grad.addColorStop(1, col + "88")
        ctx.fillStyle = grad; ctx.fillRect(x, P.t + cH - bh, w, bh)
      }
      ctx.save(); ctx.translate(x + w / 2, H - 6); ctx.rotate(-Math.PI / 4)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.62)"; ctx.font = "600 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
      ctx.fillText(ellipsizeText(ctx, d.motivo_descricao, Math.max(56, bw * 1.5)), 0, 0)
      ctx.restore()
    })
  }, [data, motivoColors, maxV, tip?.idx, isRows])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  const containerHeight = isRows ? Math.max(288, data.length * PARETO_ROW_H + PARETO_ROWS_P.t + 16) : 288
  return (
    <div className="relative w-full" style={{ height: containerHeight }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }}
        onMouseMove={ev => {
          const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top
          if (isRows) {
            const i = Math.floor((y - PARETO_ROWS_P.t) / PARETO_ROW_H)
            if (i >= 0 && i < data.length) setTip({ x, y: y - 10, item: data[i], idx: i }); else setTip(null)
          } else {
            const bw = (r.width - 100) / Math.max(1, data.length), i = Math.floor((x - 76) / bw)
            if (i >= 0 && i < data.length) setTip({ x, y: y - 12, item: data[i], idx: i }); else setTip(null)
          }
        }}
        onMouseLeave={() => setTip(null)} />
      {tip && (
        <div className="absolute pointer-events-none bg-white/97 dark:bg-[#0d1117]/95 backdrop-blur-md text-zinc-800 dark:text-white/85 text-xs border border-zinc-200 dark:border-white/[0.12] shadow-2xl whitespace-nowrap z-10 min-w-[220px]"
          style={{ left: Math.min(tip.x, 380), top: tip.y, transform: isRows ? "translate(-8px,-50%)" : "translate(-50%,-100%)" }}>
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/[0.08] font-bold text-amber-600 dark:text-amber-400">{tip.item.motivo_descricao}</div>
          <div className="px-3 py-2 space-y-1">
            <div className="flex justify-between gap-3">Duração total: <span className="font-bold tabular-nums">{fmtHH(tip.item.duracao_total_seg)}</span></div>
            <div className="flex justify-between gap-3">Ocorrências: <span className="font-bold">{tip.item.ocorrencias}</span></div>
            {tip.item.breakdown_ct.length > 0 && (
              <div className="mt-1 pt-1 border-t border-zinc-100 dark:border-white/[0.08] space-y-0.5">
                <div className="text-zinc-400 dark:text-white/35 text-[10px] mb-1">Por Centro de Trabalho:</div>
                {tip.item.breakdown_ct.slice(0, 6).map((b, bi) => (<div key={b.centro_trabalho_id} className="flex justify-between gap-3"><span style={{ color: pal(bi) }}>{b.ct_codigo}:</span><span className="font-bold tabular-nums">{fmtHH(b.duracao_seg)}</span></div>))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * CHART: PRODUÇÃO POR ORDEM
 * ═══════════════════════════════════════════════════════════════ */
// Acima de 8 ordens, colunas ficam apertadas demais para rótulo legível —
// vira barras horizontais empilhadas por linha, mesma lógica do Pareto de
// Paradas, com altura dinâmica acompanhando a tabela ao lado.
const ORDEM_ROWS_THRESHOLD = 8
const ORDEM_ROW_H = 32
const ORDEM_ROWS_P = { t: 22, l: 108, r: 74 }
type OrdemBar = { label: string; value: number; produto_descricao?: string | null }
function OrdemBarChart({ data }: { data: OrdemBar[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: number; desc?: string | null; idx: number } | null>(null)
  const isRows = data.length > ORDEM_ROWS_THRESHOLD
  const maxV = useMemo(() => { const m = Math.max(0.001, ...data.map(d => Number(d.value) || 0)); return m * 1.30 }, [data])
  const fmtBarLabel = (val: number) => val >= 1000000 ? `${(val / 1000000).toFixed(2).replace(".", ",")}M` : val >= 1000 ? `${(val / 1000).toFixed(0)}k` : fmtNum(val)
  const draw = useCallback(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext("2d"); if (!ctx) return
    const isDark = document.documentElement.classList.contains("dark")
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    if (!data.length) return

    if (isRows) {
      const P = ORDEM_ROWS_P, cW = W - P.l - P.r, cH = data.length * ORDEM_ROW_H
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
      for (let i = 0; i <= 4; i++) {
        const x = P.l + (cW / 4) * i, v = (i / 4) * maxV
        ctx.beginPath(); ctx.setLineDash([2, 6])
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)"; ctx.lineWidth = 1
        ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + cH); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
        ctx.fillText(fmtBarLabel(v), x, P.t - 8)
      }
      data.forEach((d, i) => {
        const val = Number(d.value) || 0
        const y0 = P.t + i * ORDEM_ROW_H, yc = y0 + ORDEM_ROW_H / 2, barH = ORDEM_ROW_H * 0.58
        if (tip?.idx === i) { ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"; ctx.fillRect(0, y0, W, ORDEM_ROW_H) }
        const bw = Math.max(2, (val / maxV) * cW), col = pal(i)
        const grad = ctx.createLinearGradient(P.l, 0, P.l + bw, 0)
        grad.addColorStop(0, col); grad.addColorStop(1, col + "99")
        ctx.fillStyle = grad; ctx.fillRect(P.l, yc - barH / 2, bw, barH)
        ctx.font = "700 11px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.78)" : "#27272a"
        ctx.fillText(ellipsizeText(ctx, d.label, P.l - 16), P.l - 10, yc + 4)
        ctx.font = "700 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "left"
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.88)" : "#18181b"
        ctx.fillText(fmtBarLabel(val), P.l + bw + 8, yc + 4)
      })
      return
    }

    const P = { t: 32, r: 16, b: 54, l: 76 }, cH = H - P.t - P.b, cW = W - P.l - P.r
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.012)"; ctx.fillRect(P.l, P.t, cW, cH)
    for (let i = 0; i <= 5; i++) {
      const y = P.t + (cH / 5) * i, v = maxV - (maxV / 5) * i
      ctx.beginPath(); ctx.setLineDash([2, 6])
      ctx.strokeStyle = i === 5 ? (isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)")
      ctx.lineWidth = 1
      ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.58)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "right"
      ctx.fillText(fmtBarLabel(v), P.l - 8, y + 4)
    }
    const bw = cW / data.length, pad = bw * 0.22
    data.forEach((d, i) => {
      const val = Number(d.value) || 0; if (val === 0) return
      const bh = Math.max(2, (val / maxV) * cH), x = P.l + i * bw + pad / 2, y = P.t + cH - bh, w = bw - pad
      const isHov = tip?.idx === i, col = pal(i)
      const grad = ctx.createLinearGradient(x, y, x, y + bh)
      grad.addColorStop(0, isHov ? col : col + "dd"); grad.addColorStop(1, isHov ? col + "aa" : col + "77")
      ctx.fillStyle = grad; ctx.fillRect(x, y, w, bh)
      if (w > 20) {
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.92)" : "#18181b"; ctx.textAlign = "center"; ctx.font = `800 ${Math.min(12, Math.max(9, w / 5))}px 'Inter', system-ui, sans-serif`
        ctx.fillText(fmtBarLabel(val), x + w / 2, y - 6)
      }
      ctx.save(); ctx.translate(x + w / 2, H - 7); if (bw < 60) ctx.rotate(-Math.PI / 4.5)
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.62)"; ctx.font = "600 10.5px 'Inter', system-ui, sans-serif"; ctx.textAlign = "center"
      ctx.fillText(ellipsizeText(ctx, d.label, Math.max(60, bw * 1.4)), 0, 0)
      ctx.restore()
    })
  }, [data, maxV, tip?.idx, isRows])
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [draw])
  const containerHeight = isRows ? Math.max(288, data.length * ORDEM_ROW_H + ORDEM_ROWS_P.t + 16) : 288
  return (
    <div className="relative w-full" style={{ height: containerHeight }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }}
        onMouseMove={ev => {
          const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top
          if (isRows) {
            const i = Math.floor((y - ORDEM_ROWS_P.t) / ORDEM_ROW_H)
            if (i >= 0 && i < data.length) setTip({ x, y: y - 10, label: data[i].label, value: data[i].value, desc: data[i].produto_descricao, idx: i }); else setTip(null)
          } else {
            const bw = (r.width - 92) / Math.max(1, data.length), i = Math.floor((x - 76) / bw)
            if (i >= 0 && i < data.length) setTip({ x, y: y - 12, label: data[i].label, value: data[i].value, desc: data[i].produto_descricao, idx: i }); else setTip(null)
          }
        }}
        onMouseLeave={() => setTip(null)} />
      {tip && (
        <div className="absolute pointer-events-none bg-white/97 dark:bg-[#0d1117]/95 backdrop-blur-md text-zinc-800 dark:text-white/85 text-xs border border-zinc-200 dark:border-white/[0.12] shadow-2xl whitespace-nowrap z-10"
          style={{ left: isRows ? Math.min(tip.x, 380) : tip.x, top: tip.y, transform: isRows ? "translate(-8px,-50%)" : "translate(-50%,-100%)" }}>
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/[0.08] font-bold text-rose-600 dark:text-rose-400">{tip.label}</div>
          <div className="px-3 py-2">
            {tip.desc && <div className="text-zinc-400 dark:text-white/35 text-[11px] mb-0.5">{tip.desc}</div>}
            <div>Produção: <span className="font-bold tabular-nums">{fmtNum(tip.value)} UN</span></div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * PARADAS PARETO TABLE
 * ═══════════════════════════════════════════════════════════════ */
function ParadaParetoTable({ data }: { data: ParadaMotivoParetoItem[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  if (!data.length) return <div className="py-10 text-center text-sm text-zinc-400 dark:text-white/25 italic">Sem paradas no período.</div>
  return (
    <div className="border border-zinc-300 dark:border-white/[0.1] overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-zinc-100 dark:bg-white/[0.04] border-b-2 border-zinc-200 dark:border-white/[0.1]">
            <th className="py-3 px-3.5 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/40">Motivo</th>
            <th className="py-3 px-3.5 text-right text-[10.5px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/40 whitespace-nowrap">Ocorrências</th>
            <th className="py-3 px-3.5 text-right text-[10.5px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/40">Duração</th>
            <th className="py-3 px-3.5 text-right text-[10.5px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-white/40 w-8"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
          {data.map((item, idx) => {
            const id = String(item.motivo_id ?? `idx-${idx}`), isExp = expanded.has(id), hasCT = item.breakdown_ct.length > 0
            return (
              <React.Fragment key={id}>
                <tr className={`hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer ${isExp ? "bg-zinc-50/80 dark:bg-white/[0.025]" : ""}`} onClick={() => hasCT && toggle(id)}>
                  <td className="py-3 px-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: pal(idx) }} />
                      <span className="font-bold text-zinc-900 dark:text-white/85 leading-snug">{item.motivo_descricao}</span>
                      {item.is_planejada != null && <span className={`text-[9.5px] px-1.5 py-0.5 font-bold flex-shrink-0 ${item.is_planejada ? "bg-amber-50 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400" : "bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"}`}>{item.is_planejada ? "PLAN" : "N.PLAN"}</span>}
                    </div>
                  </td>
                  <td className="py-3 px-3.5 text-right font-mono font-extrabold text-zinc-900 dark:text-white/90 tabular-nums">{item.ocorrencias}</td>
                  <td className="py-3 px-3.5 text-right font-mono font-extrabold text-zinc-900 dark:text-white/90 tabular-nums">{item.duracao_total_fmt || fmtHH(item.duracao_total_seg)}</td>
                  <td className="py-3 px-3.5 text-right">{hasCT && <button className="text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/60 transition-colors">{isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>}</td>
                </tr>
                {isExp && hasCT && item.breakdown_ct.map((ct, ci) => (
                  <tr key={ct.centro_trabalho_id} className="bg-zinc-50/50 dark:bg-white/[0.015]">
                    <td className="py-2 px-3.5 pl-11">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 flex-shrink-0" style={{ background: pal(ci + 4) }} />
                        <span className="font-mono font-bold text-zinc-700 dark:text-white/60">{ct.ct_codigo}</span>
                        {ct.ct_nome && <span className="text-zinc-400 dark:text-white/25 text-[10.5px]">{ct.ct_nome}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3.5 text-right font-mono text-zinc-600 dark:text-white/45 text-[12px] tabular-nums">{ct.ocorrencias}</td>
                    <td className="py-2 px-3.5 text-right font-mono font-bold text-amber-600 dark:text-amber-400 text-[12px] tabular-nums">{ct.duracao_fmt || fmtHH(ct.duracao_seg)}</td>
                    <td />
                  </tr>
                ))}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * MOTIVO FILTER DROPDOWN
 * ═══════════════════════════════════════════════════════════════ */
function MotivoFilterDropdown({ motivos, selected, onToggle, onClear }: {
  motivos: { id: string; label: string }[]; selected: Set<string>; onToggle: (id: string) => void; onClear: () => void
}) {
  const [open, setOpen] = useState(false), [q, setQ] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h) }, [])
  const filtered = useMemo(() => motivos.filter(m => m.label.toLowerCase().includes(q.toLowerCase())), [motivos, q])
  const label = selected.size === 0 ? "Todos" : `${selected.size} motivo${selected.size > 1 ? "s" : ""}`
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-2 px-3 py-1.5 border text-[10px] font-bold uppercase tracking-[0.08em] transition-all ${selected.size > 0 ? "bg-amber-50 dark:bg-amber-400/10 border-amber-200 dark:border-amber-500/25 text-amber-700 dark:text-amber-400" : "bg-white dark:bg-white/[0.04] border-zinc-200 dark:border-white/[0.08] text-zinc-600 dark:text-white/40 hover:border-zinc-300 dark:hover:border-white/[0.15]"}`}>
        <Filter className="w-3 h-3" /><span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-[#0d1117] border border-zinc-200 dark:border-white/[0.1] shadow-2xl z-30 overflow-hidden">
          <div className="p-2 border-b border-zinc-100 dark:border-white/[0.06]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 dark:text-white/25" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar motivos..."
                className="w-full pl-7 pr-3 py-1.5 border border-zinc-200 dark:border-white/[0.09] text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/30 bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65" />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.map(m => (
              <button key={m.id} onClick={() => onToggle(m.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-white/[0.05] transition-colors">
                <div className={`w-4 h-4 border-2 flex items-center justify-center flex-shrink-0 transition-all ${selected.has(m.id) ? "bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white" : "border-zinc-300 dark:border-white/20"}`}>
                  {selected.has(m.id) && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 fill-white dark:fill-zinc-900"><path d="M1 6l4 4 6-6" /></svg>}
                </div>
                <span className="text-zinc-700 dark:text-white/65">{m.label}</span>
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <div className="p-2 border-t border-zinc-100 dark:border-white/[0.06]">
              <button onClick={() => { onClear(); setOpen(false) }} className="w-full text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium py-1">Limpar seleção</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
 * MAIN PAGE CONTENT
 * ═══════════════════════════════════════════════════════════════ */
type TimeView = "hora" | "dia"
type MetricView = "producao" | "ciclo"

function PageContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [showGrp, setShowGrp] = useState(false)
  const [showCt, setShowCt] = useState(false)
  const [showTurno, setShowTurno] = useState(false)

  const [empresaId] = useEmpresaId("1")

  const [startDate, setStartDate] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [endDate, setEndDate] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })

  const [selSetorIds, setSelSetorIds] = useState<string[]>([])
  const [selCtIds, setSelCtIds] = useState<string[]>([])
  const [selTurnoIds, setSelTurnoIds] = useState<string[]>([])

  const [timeView, setTimeView] = useState<TimeView>("hora")
  const [metricView, setMetricView] = useState<MetricView>("producao")
  const [lossView, setLossView] = useState<LossView>("quantidade")
  const [paradasView, setParadasView] = useState<"tabela" | "pareto">("tabela")

  const [stopsSearch, setStopsSearch] = useState("")
  const [ordensSearch, setOrdensSearch] = useState("")
  const [motivosSel, setMotivosSel] = useState<Set<string>>(new Set())

  const { startUtc, endUtc } = useMemo(() => buildUtcWindow(startDate, endDate), [startDate, endDate])

  const {
    data, loading, error, refetch,
    grupos, centros, turnos, lookupsLoading, lastFetchedAt,
    producaoHora, producaoDia, oee,
    graficoPerdas, paradas, paradasPareto,
    producaoOrdens, planosAcao, anotacoes,
  } = useRelatorioApi({
    empresaId, startUtc, endUtc,
    setorIds: selSetorIds.length ? selSetorIds : undefined,
    centrosTrabalhoIds: selCtIds.length ? selCtIds : undefined,
    turnoIds: selTurnoIds.length ? selTurnoIds : undefined,
  })

  useEffect(() => { if (!centros.length) return; const allowed = new Set(centros.map(c => c.centro_trabalho_id)); setSelCtIds(p => p.filter(id => allowed.has(id))) }, [centros])

  const ctColorMap = useMemo(() => { const m = new Map<string, string>(); const all = new Set<string>(); producaoDia.forEach(d => d.breakdown.forEach(b => all.add(b.ct_codigo))); Array.from(all).forEach((ct, i) => m.set(ct, pal(i))); return m }, [producaoDia])
  const ctLegend = useMemo(() => { const all = new Set<string>(); producaoDia.forEach(d => d.breakdown.forEach(b => all.add(b.ct_codigo))); return Array.from(all) }, [producaoDia])
  const motivoColorMap = useMemo(() => { const m = new Map<string, string>(); paradasPareto.forEach((p, i) => { if (p.motivo_id) m.set(String(p.motivo_id), pal(i)) }); return m }, [paradasPareto])

  const horaChartData = useMemo(() => producaoHora.map(p => ({ label: p.label, value: p.value, target: p.target, breakdown: [] })), [producaoHora])
  const diaChartData = useMemo(() => producaoDia.map(p => ({ label: p.label, value: p.value, capacidade: p.capacidade, breakdown: p.breakdown })), [producaoDia])
  const cicloData = useMemo(() => { const src = timeView === "hora" ? producaoHora : producaoDia; return src.map((p: any) => ({ label: p.label, cycleSec: Number.isFinite(Number(p.ciclo_medio_seg)) ? Number(p.ciclo_medio_seg) : 0 })) }, [producaoHora, producaoDia, timeView])
  const totalProd = useMemo(() => { const src = timeView === "hora" ? producaoHora : producaoDia; return src.reduce((s: number, d: any) => s + Number(d.value ?? 0), 0) }, [producaoHora, producaoDia, timeView])

  const lossItems = useMemo(() => graficoPerdas?.items ?? [], [graficoPerdas])
  const lossTabela = useMemo(() => graficoPerdas?.tabela ?? [], [graficoPerdas])
  const planejadoUN = graficoPerdas?.planejado_un ?? 0
  const efativoUN = graficoPerdas?.efetivo_un ?? 0

  const paradasFiltered = useMemo(() => {
    const rows = paradas.slice().sort((a: any, b: any) => (b.duracao_seg ?? 0) - (a.duracao_seg ?? 0))
    let filtered = motivosSel.size > 0 ? rows.filter((p: any) => p.motivo_id && motivosSel.has(String(p.motivo_id))) : rows
    const q = stopsSearch.trim().toLowerCase()
    if (q) filtered = filtered.filter((p: any) =>
      (p.motivo_descricao ?? "").toLowerCase().includes(q) ||
      (p.ct_nome ?? "").toLowerCase().includes(q) ||
      (p.ct_codigo ?? "").toLowerCase().includes(q)
    )
    return filtered.slice(0, 150)
  }, [paradas, motivosSel, stopsSearch])

  const motivosForDropdown = useMemo(() => paradasPareto.map(p => ({ id: String(p.motivo_id ?? "sem-motivo"), label: p.motivo_descricao })), [paradasPareto])

  const ordensFiltered = useMemo(() => {
    const q = ordensSearch.trim().toLowerCase()
    return (q ? producaoOrdens.filter((o: any) => (o.produto_codigo ?? "").toLowerCase().includes(q) || (o.produto_descricao ?? "").toLowerCase().includes(q) || (o.ordem_codigo ?? "").toLowerCase().includes(q)) : producaoOrdens).slice(0, 100)
  }, [producaoOrdens, ordensSearch])

  // Cap em 20 (não 8): acima de ORDEM_ROWS_THRESHOLD (8) o próprio
  // OrdemBarChart alterna para barras horizontais, então o gráfico pode
  // acompanhar mais itens sem virar uma parede de colunas espremidas.
  const ordemBars = useMemo(() => {
    const rows = [...producaoOrdens].sort((a: any, b: any) => Number(b.por_ordem ?? 0) - Number(a.por_ordem ?? 0))
    return rows.slice(0, 20).map((r: any) => ({ label: String(r.ordem_codigo ?? r.produto_codigo ?? "—"), value: Number(r.por_ordem ?? 0), produto_descricao: r.produto_descricao }))
  }, [producaoOrdens])

  const oeeVal = oee?.oee_pct ?? 0
  const metaVal = oee?.meta_pct ?? 0.85
  const dispVal = oee?.disponibilidade_pct ?? 0
  const perfVal = oee?.performance_pct ?? 0
  const qualVal = oee?.qualidade_pct ?? 0

  const grupoOpts = useMemo((): Option[] => (grupos ?? []).map(g => ({ id: g.setor_id, label: g.nome })), [grupos])
  const ctOpts = useMemo((): Option[] => (centros ?? []).map(c => ({ id: c.centro_trabalho_id, label: `${c.codigo} — ${c.nome}`, meta: c.setor_id ?? "" })), [centros])
  const turnoOpts = useMemo((): Option[] => (turnos ?? []).map(t => ({ id: t.turno_id, label: t.nome, meta: `${t.hora_inicio}–${t.hora_fim}` })), [turnos])

  const fmtRange = () => `${startDate.toLocaleDateString("pt-BR")} – ${endDate.toLocaleDateString("pt-BR")}`
  const activeFilters = selSetorIds.length + selCtIds.length + selTurnoIds.length

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117] print:bg-white">
      <Header onMenuClick={() => setSidebarOpen(true)} title="Relatório Consolidado" />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* ── NAV BAR (mesmo padrão visual da barra de abas do /historico) ── */}
      <div className="sticky top-12 z-40 bg-white dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/[0.07] print:hidden">
        <div className="max-w-screen-2xl mx-auto px-4">
          <div className="flex items-center gap-0 h-12 overflow-x-auto">
            <button onClick={() => setShowDate(true)}
              className="flex-shrink-0 flex items-center gap-2 h-full px-4 border-r border-zinc-200 dark:border-white/[0.07] text-[11px] font-bold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/[0.08] transition-colors">
              <Calendar className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums normal-case">{fmtRange()}</span>
            </button>
            <div className="flex-shrink-0 flex items-center h-full px-3 gap-1.5 border-r border-zinc-200 dark:border-white/[0.07]">
              <button onClick={() => setShowGrp(true)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-all ${selSetorIds.length ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"}`}>
                <Filter className="w-3 h-3" />Setor{selSetorIds.length > 0 && <span className="bg-amber-500 text-white px-1 py-0.5 text-[9px] leading-none">{selSetorIds.length}</span>}
              </button>
              <button onClick={() => setShowCt(true)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-all ${selCtIds.length ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"}`}>
                <Settings2 className="w-3 h-3" />CT{selCtIds.length > 0 && <span className="bg-amber-500 text-white px-1 py-0.5 text-[9px] leading-none">{selCtIds.length}</span>}
              </button>
              <button onClick={() => setShowTurno(true)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-all ${selTurnoIds.length ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "text-zinc-500 dark:text-white/40 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"}`}>
                <Clock className="w-3 h-3" />Turno{selTurnoIds.length > 0 && <span className="bg-amber-500 text-white px-1 py-0.5 text-[9px] leading-none">{selTurnoIds.length}</span>}
              </button>
              {activeFilters > 0 && (
                <button onClick={() => { setSelSetorIds([]); setSelCtIds([]); setSelTurnoIds([]) }}
                  className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/[0.08] transition-colors">
                  <X className="w-3 h-3" /><span className="hidden sm:block">Limpar</span>
                </button>
              )}
            </div>
            <div className="hidden lg:flex flex-shrink-0 items-center gap-2 px-3 h-full border-r border-zinc-200 dark:border-white/[0.07]">
              {!loading && data && (
                <>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-white/40 font-bold tabular-nums">
                    <StatusDot status={oeeVal >= 0.85 ? "green" : oeeVal >= 0.65 ? "amber" : "red"} />
                    OEE {(oeeVal * 100).toFixed(1).replace(".", ",")}%
                  </div>
                  <span className="text-zinc-200 dark:text-white/10">|</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-white/40 font-bold tabular-nums">
                    <Activity className="w-3 h-3 text-emerald-500" />{fmtNum(totalProd)} UN
                  </div>
                  <span className="text-zinc-200 dark:text-white/10">|</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-white/40 font-bold tabular-nums">
                    <AlertTriangle className="w-3 h-3 text-amber-500" />{paradas.length} paradas
                  </div>
                </>
              )}
            </div>
            <div className="ml-auto flex-shrink-0 flex items-center gap-1 px-3 h-full">
              {lastFetchedAt && <span className="text-[10px] text-zinc-400 dark:text-white/22 mr-2 hidden md:block tabular-nums">Atualizado {lastFetchedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
              <button onClick={refetch} disabled={loading} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.06] disabled:opacity-50 transition-colors" title="Atualizar">
                <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 dark:text-white/30 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button onClick={() => window.print()} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors" title="Imprimir">
                <Printer className="w-3.5 h-3.5 text-zinc-400 dark:text-white/30" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTENT ──────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto p-4 lg:p-5 space-y-4">

        {error && (
          <div className="bg-red-50 dark:bg-red-500/[0.06] border border-red-200 dark:border-red-500/25 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-red-800 dark:text-red-300 text-sm">Erro ao carregar relatório</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-all">{error}</p>
            </div>
            <button onClick={refetch} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex-shrink-0">Tentar novamente</button>
          </div>
        )}

        {/* ── KPI ROW ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {loading && !data
            ? [...Array(5)].map((_, i) => <Sk key={i} className="h-[76px]" />)
            : (
              <>
                <KpiCard label="OEE Global" value={(oeeVal * 100).toFixed(1).replace(".", ",")} unit="%" icon={<Zap className="w-5 h-5" />} sub={`Meta ${(metaVal * 100).toFixed(0)}%`} isPrimary />
                <KpiCard label="Produção Total" value={totalProd >= 1000 ? `${(totalProd / 1000).toFixed(1).replace(".", ",")}k` : fmtNum(totalProd)} unit="UN" icon={<Activity className="w-5 h-5" />} sub="Peças boas no período" />
                <KpiCard label="Disponibilidade" value={(dispVal * 100).toFixed(1).replace(".", ",")} unit="%" icon={<BarChart2 className="w-5 h-5" />} sub={`${paradas.length} paradas`} />
                <KpiCard label="Performance" value={(perfVal * 100).toFixed(1).replace(".", ",")} unit="%" icon={<TrendingUp className="w-5 h-5" />} sub="vs ciclo ideal" />
                <KpiCard label="Qualidade" value={(qualVal * 100).toFixed(1).replace(".", ",")} unit="%" icon={<CheckCircle2 className="w-5 h-5" />} sub={`${fmtNum(oee?.total_scrap ?? 0)} refugo`} />
              </>
            )}
        </div>

        {/* ── [1] PRODUÇÃO HORA A HORA / DIÁRIO ─────────────────── */}
        <Card>
          <SectionHeader
            title={timeView === "hora" ? "Hora a Hora" : "Relatório Diário"}
            subtitle={timeView === "hora" ? "Produção e meta por hora" : "Produção acumulada por dia operacional"}
            icon={<Clock className="w-4 h-4 text-zinc-400 dark:text-white/35" />}
            right={
              <div className="flex flex-wrap gap-2">
                <ToggleGroup options={[{ id: "hora", label: "Hora" }, { id: "dia", label: "Dia" }]} value={timeView} onChange={v => setTimeView(v as TimeView)} />
                <ToggleGroup options={[{ id: "producao", label: "Produção" }, { id: "ciclo", label: "Ciclo" }]} value={metricView} onChange={v => setMetricView(v as MetricView)} />
              </div>
            } />
          <div className="p-5">
            {loading && !data ? <Sk className="h-72 w-full" /> : (
              <>
                {metricView === "producao"
                  ? (timeView === "hora" ? <HoraChart data={horaChartData} ctColors={ctColorMap} /> : <DiaChart data={diaChartData} ctColors={ctColorMap} />)
                  : <CicloChart data={cicloData} />
                }
                <div className="mt-4 flex items-center justify-center gap-6 flex-wrap">
                  <div className="text-center">
                    <p className="text-[10px] text-zinc-400 dark:text-white/30 font-bold uppercase tracking-[0.14em]">Produção Total</p>
                    <p className="text-2xl font-black text-zinc-900 dark:text-white/90 font-mono tabular-nums">{fmtNum(totalProd)} <span className="text-zinc-400 dark:text-white/30 text-sm font-medium">UN</span></p>
                  </div>
                  {metricView === "producao" && timeView === "hora" && (
                    <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-white/40">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 bg-green-700 dark:bg-green-600 inline-block" />Produção</span>
                      <span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-zinc-400 dark:border-white/30 inline-block" />Meta</span>
                    </div>
                  )}
                  {metricView === "producao" && timeView === "dia" && ctLegend.length > 0 && (
                    <div className="flex flex-wrap gap-3 justify-center">
                      {ctLegend.map(ct => (<span key={ct} className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-white/40"><span className="w-2.5 h-2.5" style={{ background: ctColorMap.get(ct) ?? "#94A3B8" }} />{ct}</span>))}
                    </div>
                  )}
                </div>
                {(timeView === "hora" ? producaoHora : producaoDia).length > 0 && (
                  <div className="mt-3 overflow-x-auto border border-zinc-200 dark:border-white/[0.07]">
                    <table className="min-w-full text-xs">
                      <thead className="bg-zinc-50 dark:bg-white/[0.025]">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap w-28">Métrica</th>
                          {(timeView === "hora" ? producaoHora : producaoDia).slice(0, 16).map((d: any, i: number) => (
                            <th key={i} className="px-2 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap text-center min-w-[60px]">{d.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.04]">
                        <tr className={metricView === "producao" ? "bg-emerald-50/40 dark:bg-emerald-500/[0.05]" : ""}>
                          <td className="px-3 py-2 font-bold text-zinc-700 dark:text-white/60 whitespace-nowrap">Produção (UN)</td>
                          {(timeView === "hora" ? producaoHora : producaoDia).slice(0, 16).map((d: any, i: number) => (
                            <td key={i} className="px-2 py-2 font-mono font-bold text-zinc-900 dark:text-white/85 text-center whitespace-nowrap tabular-nums">{fmtNum(d.value)}</td>
                          ))}
                        </tr>
                        {metricView === "ciclo" && (
                          <tr className="bg-amber-50/60 dark:bg-amber-500/[0.06]">
                            <td className="px-3 py-2 font-bold text-zinc-700 dark:text-white/60 whitespace-nowrap">Ciclo (mm:ss)</td>
                            {cicloData.slice(0, 16).map((d, i) => (
                              <td key={i} className="px-2 py-2 font-mono text-amber-700 dark:text-amber-400 text-center whitespace-nowrap text-[11px] tabular-nums">{d.cycleSec > 0 ? fmtMM(d.cycleSec) : "—"}</td>
                            ))}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {/* ── [2] GRÁFICO DE PERDAS ────────────────────────────────── */}
        <Card>
          <SectionHeader title="Análise de Perdas"
            subtitle="Disponibilidade, performance e qualidade"
            icon={<TrendingDown className="w-4 h-4 text-zinc-400 dark:text-white/35" />}
            right={<ToggleGroup options={[{ id: "quantidade", label: "Quantidade" }, { id: "hora", label: "Hora" }]} value={lossView} onChange={v => setLossView(v as LossView)} />} />
          <div className="px-6 pt-3 pb-0 flex flex-wrap gap-3">
            {Object.keys(LOSS_COLOR).map(hint => (
              <span key={hint} className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-white/45 font-semibold">
                <span className={`w-2.5 h-2.5 flex-shrink-0 ${LOSS_MONO_BG[hint] ?? "bg-zinc-500"}`} />{LOSS_LABEL[hint]}
              </span>
            ))}
          </div>
          <div className="p-5 grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6">
            <div>{loading && !data ? <Sk className="h-80 w-full" /> : <LossChart items={lossItems} viewMode={lossView} />}</div>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.08] p-3"><p className="text-[10px] text-zinc-400 dark:text-white/30 font-bold uppercase tracking-[0.12em]">Planejado</p><p className="text-lg font-black font-mono text-zinc-800 dark:text-white/80 tabular-nums">{fmtNum(planejadoUN)}</p></div>
                <div className="bg-emerald-50 dark:bg-emerald-500/[0.08] border border-emerald-200 dark:border-emerald-500/25 p-3"><p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-[0.12em]">Efetivo</p><p className="text-lg font-black font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtNum(efativoUN)}</p></div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-zinc-200 dark:border-white/[0.1]">
                    <th className="text-left py-2 pr-2 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28">Motivo</th>
                    <th className="text-right py-2 px-1 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 whitespace-nowrap">Disponib.</th>
                    <th className="text-right py-2 px-1 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28">Perf.</th>
                    <th className="text-right py-2 px-1 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28">Qual.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.04]">
                  {lossTabela.map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors">
                      <td className="py-1.5 pr-2"><div className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${LOSS_MONO_BG[row.color_hint] ?? "bg-zinc-500"}`} /><span className="font-medium text-zinc-700 dark:text-white/60 text-[11px] leading-tight">{row.name}</span></div></td>
                      <td className="py-1.5 px-1 text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: row.disponibilidade != null ? LOSS_COLOR.disponibilidade : "#94A3B8" }}>{row.disponibilidade != null ? fmtNum(row.disponibilidade, 2) : ""}</td>
                      <td className="py-1.5 px-1 text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: row.performance != null ? LOSS_COLOR.performance : "#94A3B8" }}>{row.performance != null ? fmtNum(row.performance, 2) : ""}</td>
                      <td className="py-1.5 px-1 text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: row.qualidade != null ? LOSS_COLOR.qualidade : "#94A3B8" }}>{row.qualidade != null ? fmtNum(row.qualidade, 2) : ""}</td>
                    </tr>
                  ))}
                  {lossTabela.length > 0 && (
                    <tr className="bg-zinc-50 dark:bg-white/[0.03] font-bold border-t-2 border-zinc-200 dark:border-white/[0.1]">
                      <td className="py-2 pr-2 text-xs text-zinc-600 dark:text-white/45">Total</td>
                      <td className="py-2 px-1 text-right font-mono text-xs tabular-nums" style={{ color: LOSS_COLOR.disponibilidade }}>{fmtNum(lossTabela.reduce((s, r) => s + (r.disponibilidade ?? 0), 0), 2)}</td>
                      <td className="py-2 px-1 text-right font-mono text-xs tabular-nums" style={{ color: LOSS_COLOR.performance }}>{fmtNum(lossTabela.reduce((s, r) => s + (r.performance ?? 0), 0), 2)}</td>
                      <td className="py-2 px-1 text-right font-mono text-xs tabular-nums" style={{ color: LOSS_COLOR.qualidade }}>{fmtNum(lossTabela.reduce((s, r) => s + (r.qualidade ?? 0), 0), 2)}</td>
                    </tr>
                  )}
                  {!lossTabela.length && <tr><td colSpan={4} className="py-8 text-center text-zinc-400 dark:text-white/25 italic">Sem dados de perdas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {/* ── [3] PARADAS REPORTADAS ─────────────────────────────── */}
        <Card>
          <SectionHeader title="Paradas Reportadas"
            subtitle={`${paradas.length} ocorrências · ${fmtHH(paradas.reduce((s: any, p: any) => s + (p.duracao_seg ?? 0), 0))} total`}
            icon={<AlertTriangle className="w-4 h-4 text-zinc-400 dark:text-white/35" />}
            right={
              <div className="flex items-center gap-2">
                <ToggleGroup options={[{ id: "tabela", label: "Tabela" }, { id: "pareto", label: "Pareto + CT" }]} value={paradasView} onChange={v => setParadasView(v as any)} />
                <MotivoFilterDropdown motivos={motivosForDropdown} selected={motivosSel}
                  onToggle={id => setMotivosSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })}
                  onClear={() => setMotivosSel(new Set())} />
              </div>
            } />

          <div className="p-5">
            {paradasView === "pareto" ? (
              <div className="grid grid-cols-1 xl:grid-cols-[2fr_3fr] gap-6">
                <div>
                  <p className="text-[10px] text-zinc-400 dark:text-white/28 font-bold uppercase tracking-[0.16em] mb-2">Duração por motivo (min.) — por CT</p>
                  {loading && !data ? <Sk className="h-72 w-full" /> : <ParadaParetoChart data={paradasPareto} motivoColors={motivoColorMap} />}
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400 dark:text-white/28 font-bold uppercase tracking-[0.16em] mb-2">Motivos — clique para expandir CTs</p>
                  {loading && !data ? <Sk className="h-72" /> : <ParadaParetoTable data={paradasPareto} />}
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-white/25" />
                  <input value={stopsSearch} onChange={e => setStopsSearch(e.target.value)}
                    placeholder="Buscar motivo ou CT..."
                    className="w-full pl-9 pr-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/30 bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65" />
                </div>

                {/* ══════════════════════════════════════════════════════
                 * TABELA DE PARADAS — v5.1
                 * MUDANÇA: coluna "Equipamento" substituída por
                 *          "Início" (dd/MM HH:mm) e "Fim" (dd/MM HH:mm)
                 * ══════════════════════════════════════════════════════ */}
                <div className="overflow-x-auto border border-zinc-200 dark:border-white/[0.07]">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 dark:bg-white/[0.025]">
                      <tr>
                        <th className="py-2.5 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07]">Motivo</th>
                        <th className="py-2.5 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap">Centro de Trabalho</th>
                        {/* ── NOVOS cabeçalhos ── */}
                        <th className="py-2.5 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Início</span>
                        </th>
                        <th className="py-2.5 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Fim</span>
                        </th>
                        <th className="py-2.5 px-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07]">Duração</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.04]">
                      {paradasFiltered.map((d: any) => (
                        <tr key={d.parada_id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors">
                          {/* Motivo */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.is_planejada ? "#7c3aed" : "#ef4444" }} />
                              <span className="font-semibold text-zinc-800 dark:text-white/75">{d.motivo_descricao || "—"}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 font-bold ${d.is_planejada ? "bg-amber-50 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400" : "bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"}`}>
                                {d.is_planejada ? "PLAN" : "N.PLAN"}
                              </span>
                            </div>
                          </td>
                          {/* CT */}
                          <td className="py-2.5 px-3">
                            {d.ct_codigo && <span className="font-mono font-bold text-zinc-800 dark:text-white/70 bg-zinc-100 dark:bg-white/[0.06] px-1.5 py-0.5 text-[11px]">{d.ct_codigo}</span>}
                            {d.ct_nome && <span className="text-zinc-400 dark:text-white/28 ml-1 text-[11px]">{d.ct_nome}</span>}
                          </td>
                          {/* ── INÍCIO ── */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="font-mono text-zinc-700 dark:text-white/55 text-[11px]">{fmtDateTime(d.inicio_utc)}</span>
                          </td>
                          {/* ── FIM ── */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {d.fim_utc
                              ? <span className="font-mono text-zinc-700 dark:text-white/55 text-[11px]">{fmtDateTime(d.fim_utc)}</span>
                              : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-500/25 px-1.5 py-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />Em aberto
                              </span>
                            }
                          </td>
                          {/* Duração */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-zinc-900 dark:text-white/85 tabular-nums">{d.duracao_fmt || fmtHH(d.duracao_seg)}</td>
                        </tr>
                      ))}
                      {!paradasFiltered.length && (
                        <tr><td colSpan={5} className="py-10 text-center text-zinc-400 dark:text-white/25 italic">
                          {stopsSearch || motivosSel.size > 0 ? "Nenhuma parada encontrada." : "Sem registros de parada."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {paradasFiltered.length >= 150 && <p className="text-[10px] text-zinc-400 dark:text-white/25 text-right mt-1.5">Exibindo 150 de {paradas.length} registros.</p>}
              </>
            )}
          </div>
        </Card>

        {/* ── [4] PRODUÇÃO POR ORDEM ─────────────────────────────── */}
        <Card>
          <SectionHeader title="Produção por Ordem" subtitle={`${producaoOrdens.length} ordens no período`} icon={<FileText className="w-4 h-4 text-zinc-400 dark:text-white/35" />} />
          <div className="p-5">
            <div className="mb-3 relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-white/25" />
              <input value={ordensSearch} onChange={e => setOrdensSearch(e.target.value)} placeholder="Buscar produto ou ordem..."
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 dark:border-white/[0.09] text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/30 bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-white/65" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[2fr_3fr] gap-6">
              <div>
                <p className="text-[10px] text-zinc-400 dark:text-white/28 font-bold uppercase tracking-[0.16em] mb-2">Top {ordemBars.length} por quantidade</p>
                {loading && !data ? <Sk className="h-72" /> : <OrdemBarChart data={ordemBars} />}
              </div>
              <div className="overflow-x-auto border border-zinc-200 dark:border-white/[0.07]">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 dark:bg-white/[0.025]">
                    <tr>
                      <th className="py-2.5 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07]">Produto</th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07]">Ordem</th>
                      <th className="py-2.5 px-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap">Por Ordem</th>
                      <th className="py-2.5 px-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 dark:text-white/28 border-b border-zinc-200 dark:border-white/[0.07] whitespace-nowrap">Por Produto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.04]">
                    {ordensFiltered.map((d: any, i: number) => (
                      <tr key={d.ordem_id ?? i} className="hover:bg-zinc-50 dark:hover:bg-white/[0.025] transition-colors">
                        <td className="py-3 px-3"><div className="font-bold text-zinc-900 dark:text-white/85">{d.produto_codigo ?? "—"}</div>{d.produto_descricao && <div className="text-zinc-400 dark:text-white/28 text-[10px] truncate max-w-[200px]">{d.produto_descricao}</div>}</td>
                        <td className="py-3 px-3 font-mono text-zinc-600 dark:text-white/45">{d.ordem_codigo ?? "—"}</td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-zinc-900 dark:text-white/85 tabular-nums">{fmtNum(d.por_ordem, 2)}</td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmtNum(d.por_produto, 2)}</td>
                      </tr>
                    ))}
                    {!ordensFiltered.length && <tr><td colSpan={4} className="py-10 text-center text-zinc-400 dark:text-white/25 italic">{ordensSearch ? "Nenhuma ordem encontrada." : "Sem dados de produção por ordem."}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>

        {/* ── [5] OEE ──────────────────────────────────────────────── */}
        <Card>
          <SectionHeader title="OEE — Overall Equipment Effectiveness" subtitle="Disponibilidade × Performance × Qualidade" icon={<Zap className="w-4 h-4 text-zinc-400 dark:text-white/35" />} />
          <div className="p-5">
            {loading && !data ? <Sk className="h-64 w-full" /> : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-6">
                    <OeeRing value={oeeVal} meta={metaVal} size={160} color={semColor(Math.min(oeeVal, 1))} />
                    <div className="flex flex-col gap-3">
                      {[
                        { label: "Média Pessoas/Turno", value: oee?.media_pessoas_turno != null ? fmtNum(oee.media_pessoas_turno, 2) : "—" },
                        { label: "Prod. Boa / Pessoa-Hora", value: oee?.producao_boa_por_pessoa_hora != null ? `${fmtNum(oee.producao_boa_por_pessoa_hora, 2)} UN` : "—" },
                        { label: "Taxa de Produção", value: oee?.taxa_producao_hora != null ? `${fmtNum(oee.taxa_producao_hora, 2)} UN/h` : "—" },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[10px] text-zinc-400 dark:text-white/30 font-bold uppercase tracking-[0.14em]">{label}</p>
                          <p className="text-lg font-black text-zinc-900 dark:text-white/85 tabular-nums font-mono">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { label: "Total Bom", value: `${fmtNum(oee?.total_good ?? 0)} UN`, cls: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/[0.08] border-emerald-200 dark:border-emerald-500/25" },
                      { label: "Refugo", value: `${fmtNum(oee?.total_scrap ?? 0)} UN`, cls: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-500/[0.08] border-red-200 dark:border-red-500/25" },
                      { label: "Retrabalho", value: `${fmtNum(oee?.total_rework ?? 0)} UN`, cls: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/[0.08] border-amber-200 dark:border-amber-500/25" },
                      { label: "T. Planejado", value: fmtHH(oee?.tempo_planejado_seg ?? 0), cls: "text-zinc-700 dark:text-white/70", bg: "bg-zinc-50 dark:bg-white/[0.03] border-zinc-200 dark:border-white/[0.08]" },
                      { label: "T. Operação", value: fmtHH(oee?.tempo_operacao_seg ?? 0), cls: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/[0.08] border-emerald-200 dark:border-emerald-500/25" },
                      { label: "Parada N.Plan.", value: fmtHH(oee?.unplanned_stop_seg ?? 0), cls: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-500/[0.08] border-red-200 dark:border-red-500/25" },
                    ].map(({ label, value, cls, bg }) => (
                      <div key={label} className={`${bg} border px-3 py-2.5`}>
                        <p className="text-[9px] text-zinc-500 dark:text-white/35 font-bold uppercase tracking-[0.12em]">{label}</p>
                        <p className={`text-sm font-black font-mono mt-0.5 tabular-nums ${cls}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-64 w-full"><OeeBarChart disp={dispVal} perf={perfVal} qual={qualVal} /></div>
              </div>
            )}
          </div>
        </Card>

        {/* ── [6] PLANO DE AÇÃO + ANOTAÇÕES ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <SectionHeader title="Planos de Ação" subtitle={planosAcao.length > 0 ? `${planosAcao.length} plano${planosAcao.length > 1 ? "s" : ""}` : undefined} icon={<CheckCircle2 className="w-4 h-4 text-zinc-400 dark:text-white/35" />} />
            <div className="p-4 space-y-3 min-h-[120px]">
              {loading && !data ? (<><Sk className="h-16" /><Sk className="h-16" /></>) : (
                planosAcao.length > 0 ? planosAcao.map(p => (
                  <div key={p.plano_acao_id} className="border border-zinc-200 dark:border-white/[0.08] p-3 hover:border-amber-300 dark:hover:border-amber-500/30 hover:bg-amber-50/30 dark:hover:bg-amber-500/[0.04] transition-all">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <span className="text-[10px] font-bold text-zinc-400 dark:text-white/28 font-mono">{p.public_id}</span>
                        <p className="text-xs font-bold text-zinc-900 dark:text-white/85">{p.titulo}</p>
                        {p.plano_melhoria_titulo && <p className="text-[10px] text-amber-600 dark:text-amber-400">{p.plano_melhoria_titulo}</p>}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 font-bold whitespace-nowrap ${p.status === "DONE" ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : p.status === "IN_PROGRESS" ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" : p.status === "OVERDUE" ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400" : "bg-zinc-100 dark:bg-white/[0.06] text-zinc-600 dark:text-white/45"}`}>{p.status}</span>
                    </div>
                    {p.itens.slice(0, 3).map(it => (
                      <div key={it.plano_acao_item_id} className="flex items-start gap-2 text-[11px] text-zinc-600 dark:text-white/45 py-1.5 border-t border-zinc-100 dark:border-white/[0.05]">
                        <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 mt-0.5 ${it.status === "DONE" ? "bg-emerald-500 border-emerald-500" : "border-zinc-300 dark:border-white/20"}`} />
                        <span className="flex-1 leading-snug">{it.o_que}</span>
                        {it.quem_nome && <span className="text-zinc-400 dark:text-white/28 flex-shrink-0 text-[10px] font-medium">{it.quem_nome}</span>}
                      </div>
                    ))}
                  </div>
                )) : <div className="flex items-center justify-center h-20 text-sm text-zinc-400 dark:text-white/25 italic">Sem planos de ação</div>
              )}
            </div>
          </Card>

          <Card>
            <SectionHeader title="Anotações" subtitle={anotacoes.length > 0 ? `${anotacoes.length} anotaç${anotacoes.length > 1 ? "ões" : "ão"}` : undefined} icon={<MessageSquare className="w-4 h-4 text-zinc-400 dark:text-white/35" />} />
            <div className="p-4 space-y-2.5 min-h-[120px]">
              {loading && !data ? (<><Sk className="h-14" /><Sk className="h-14" /></>) : (
                anotacoes.length > 0 ? anotacoes.slice(0, 10).map(a => (
                  <div key={a.anotacao_id} className="border border-zinc-200 dark:border-white/[0.08] p-3 hover:border-amber-300 dark:hover:border-amber-500/30 hover:bg-amber-50/20 dark:hover:bg-amber-500/[0.03] transition-all">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        {a.ct_codigo && <span className="text-[10px] bg-zinc-100 dark:bg-white/[0.06] text-zinc-700 dark:text-white/60 px-2 py-0.5 font-bold font-mono">{a.ct_codigo}</span>}
                        {a.ct_nome && <span className="text-[10px] text-zinc-400 dark:text-white/28">{a.ct_nome}</span>}
                      </div>
                      <span className="text-[10px] text-zinc-400 dark:text-white/30 font-mono flex-shrink-0">
                        {fmtDateTime(a.anotacao_time_utc)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-700 dark:text-white/60 leading-snug">{a.texto}</p>
                    {a.autor_nome && <p className="text-[10px] text-zinc-400 dark:text-white/28 mt-1.5 font-medium">— {a.autor_nome}</p>}
                  </div>
                )) : <div className="flex items-center justify-center h-20 text-sm text-zinc-400 dark:text-white/25 italic">Sem anotações</div>
              )}
            </div>
          </Card>
        </div>

        <div className="text-center text-[10px] text-zinc-300 dark:text-white/14 pb-2 flex items-center justify-center gap-2 uppercase tracking-[0.1em]">
          <span className="w-6 border-t border-zinc-300 dark:border-white/15 inline-block" />
          SiderProd · Relatório Consolidado v5.1 · {new Date().getFullYear()}
          <span className="w-6 border-t border-zinc-300 dark:border-white/15 inline-block" />
        </div>
      </div>

      {loading && data && (
        <div className="fixed bottom-5 right-5 z-50 bg-zinc-900/95 dark:bg-white/95 backdrop-blur-sm text-white dark:text-zinc-900 text-xs px-4 py-2.5 flex items-center gap-2 shadow-2xl border border-white/10 dark:border-black/10">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 dark:text-amber-600" />
          Atualizando dados...
        </div>
      )}

      <MultiSelectModal isOpen={showGrp} onClose={() => setShowGrp(false)} title="Filtrar por Grupo / Setor" options={grupoOpts} selectedIds={selSetorIds} onSelect={setSelSetorIds} emptyText={lookupsLoading ? "Carregando..." : "Nenhum grupo"} />
      <MultiSelectModal isOpen={showCt} onClose={() => setShowCt(false)} title="Filtrar por Centro de Trabalho" options={ctOpts} selectedIds={selCtIds} onSelect={setSelCtIds} emptyText={lookupsLoading ? "Carregando..." : "Nenhum centro"} />
      <MultiSelectModal isOpen={showTurno} onClose={() => setShowTurno(false)} title="Filtrar por Turno" options={turnoOpts} selectedIds={selTurnoIds} onSelect={setSelTurnoIds} emptyText={lookupsLoading ? "Carregando..." : "Nenhum turno"} />
      <DateRangePicker isOpen={showDate} onClose={() => setShowDate(false)} startDate={startDate} endDate={endDate} onSelect={(s, e) => { setStartDate(s); setEndDate(e) }} />
    </div>
  )
}

export default function RelatorioConsolidadoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
          <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-white/28">Carregando relatório...</span>
        </div>
      </div>
    }>
      <PageContent />
    </Suspense>
  )
}
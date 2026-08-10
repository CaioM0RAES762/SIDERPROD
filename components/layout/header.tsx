// components/layout/header.tsx
"use client"

import { useEffect, useState } from "react"
import { Menu, ChevronDown } from "lucide-react"
import { usePathname } from "next/navigation"

interface HeaderProps {
  onMenuClick: () => void
  title?: string
}

const POLL_SECONDS = 2

function formatDateBR(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

function formatTimeBR(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
}

// ─── Seven-segment display ────────────────────────────────────────────────────
const SEG_ON  = "#c8f000"
const SEG_OFF = "rgba(200,240,0,0.08)"

const DW = 10    // digit width
const DH = 18    // digit height
const T  = 1.9   // segment thickness
const G  = 0.7   // end gap from corner
const M  = DH / 2
const COL_W    = 4  // colon slot width
const CHAR_GAP = 2  // gap between characters

// [a, b, c, d, e, f, g] — classic seven-segment encoding
const SEGS: Record<string, number[]> = {
  "0": [1,1,1,1,1,1,0],
  "1": [0,1,1,0,0,0,0],
  "2": [1,1,0,1,1,0,1],
  "3": [1,1,1,1,0,0,1],
  "4": [0,1,1,0,0,1,1],
  "5": [1,0,1,1,0,1,1],
  "6": [1,0,1,1,1,1,1],
  "7": [1,1,1,0,0,0,0],
  "8": [1,1,1,1,1,1,1],
  "9": [1,1,1,1,0,1,1],
  "-": [0,0,0,0,0,0,1],
}

function SegDigit({ ch, x = 0 }: { ch: string; x?: number }) {
  const s = SEGS[ch] ?? [0,0,0,0,0,0,0]
  const c = (i: number) => (s[i] ? SEG_ON : SEG_OFF)
  const hx  = G + T / 2
  const hw  = DW - 2 * (G + T / 2)
  const vt  = G + T / 2
  const vh  = M - G - T
  const vb  = M + G
  const vbh = M - G - T / 2
  return (
    <g transform={`translate(${x},0)`}>
      {/* a – top       */} <rect x={hx}   y={0}       width={hw} height={T}   fill={c(0)} rx={0.4} />
      {/* b – top-right */} <rect x={DW-T} y={vt}      width={T}  height={vh}  fill={c(1)} rx={0.4} />
      {/* c – bot-right */} <rect x={DW-T} y={vb}      width={T}  height={vbh} fill={c(2)} rx={0.4} />
      {/* d – bottom    */} <rect x={hx}   y={DH-T}    width={hw} height={T}   fill={c(3)} rx={0.4} />
      {/* e – bot-left  */} <rect x={0}    y={vb}      width={T}  height={vbh} fill={c(4)} rx={0.4} />
      {/* f – top-left  */} <rect x={0}    y={vt}      width={T}  height={vh}  fill={c(5)} rx={0.4} />
      {/* g – middle    */} <rect x={hx}   y={M - T/2} width={hw} height={T}   fill={c(6)} rx={0.4} />
    </g>
  )
}

function SegColon({ x }: { x: number }) {
  return (
    <g transform={`translate(${x},0)`}>
      <rect x={0.8} y={M - 3.8} width={T} height={T} fill={SEG_ON} rx={0.4} />
      <rect x={0.8} y={M + 1.2} width={T} height={T} fill={SEG_ON} rx={0.4} />
    </g>
  )
}

function SevenSegClock({ time }: { time: string }) {
  if (!time || time.length !== 8) return null
  const chars = time.split("")

  const items: { ch: string; x: number; isColon: boolean }[] = []
  let cx = 0
  for (const ch of chars) {
    if (ch === ":") {
      items.push({ ch, x: cx, isColon: true })
      cx += COL_W + CHAR_GAP
    } else {
      items.push({ ch, x: cx, isColon: false })
      cx += DW + CHAR_GAP
    }
  }
  const vw = cx - CHAR_GAP

  return (
    <svg
      viewBox={`0 0 ${vw} ${DH}`}
      width={vw}
      height={DH}
      style={{
        display: "block",
        overflow: "visible",
        filter: "drop-shadow(0 0 2px rgba(200,240,0,0.7)) drop-shadow(0 0 7px rgba(200,240,0,0.25))",
      }}
      aria-label={`Horário: ${time}`}
    >
      {items.map(({ ch, x, isColon }, i) =>
        isColon
          ? <SegColon key={i} x={x} />
          : <SegDigit key={i} ch={ch} x={x} />
      )}
    </svg>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_TITLES: [string, string][] = [
  ["/historico", "Histórico"],
  ["/analitico", "Analítico"],
  ["/planos-melhoria", "Melhoria"],
  ["/plano-acao", "Plano de Ação"],
  ["/anotacao", "Anotação"],
  ["/logistica-ordens", "Logística"],
  ["/relatorio-consolidado", "Relatório Consolidado"],
  ["/admin", "Administração"],
  ["/dashboard-v2", "Dashboard"],
  ["/", "Dashboard"],
]

function getPageTitle(pathname: string | null): string {
  if (!pathname) return "Dashboard"
  for (const [path, label] of PAGE_TITLES) {
    if (path === "/" ? pathname === "/" : pathname.startsWith(path)) return label
  }
  return "Dashboard"
}

export function Header({ onMenuClick }: HeaderProps) {
  const [now, setNow] = useState<Date | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  const currentPage = getPageTitle(pathname)

  return (
    <header className="sticky top-0 z-50">
      <div
        className="h-12 flex items-center px-3 sm:px-4 justify-between gap-3"
        style={{
          background: "#0f1117",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* ── Esquerda ─────────────────────────────────── */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Abrir menu"
            className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>

          {/* Wordmark */}
          <div className="flex items-center select-none">
            <span
              style={{
                fontSize: "14px",
                fontWeight: 300,
                color: "rgba(255,255,255,0.45)",
                letterSpacing: "-0.01em",
                lineHeight: 1,
              }}
            >
              Sider
            </span>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              prod
            </span>
          </div>

          {/* Divisor + página atual */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="w-px h-3.5 shrink-0" style={{ background: "rgba(255,255,255,0.12)" }} />
            <span
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.55)",
                letterSpacing: "-0.01em",
              }}
            >
              {currentPage}
            </span>
          </div>

          {/* Ponto ao vivo */}
          <span className="hidden md:flex items-center gap-1.5 ml-0.5">
            <span className="w-[6px] h-[6px] rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span
              style={{
                fontSize: "11px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.28)",
                letterSpacing: "0.03em",
              }}
            >
              ao vivo · {POLL_SECONDS}s
            </span>
          </span>
        </div>

        {/* ── Direita ───────────────────────────────────── */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Data + relógio de segmentos */}
          <div
            className="hidden sm:flex items-center gap-3 px-3"
            style={{
              height: "34px",
              borderRadius: "4px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <span
              className="tabular-nums"
              style={{
                fontSize: "11px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.32)",
                letterSpacing: "0.03em",
              }}
            >
              {now ? formatDateBR(now) : "--/--/----"}
            </span>
            <span className="w-px h-3 shrink-0" style={{ background: "rgba(255,255,255,0.10)" }} />
            <SevenSegClock time={now ? formatTimeBR(now) : "--:--:--"} />
          </div>

          {/* Empresa */}
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.09)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
          >
            <div
              className="w-5 h-5 rounded flex items-center justify-center shrink-0"
              style={{
                background: "rgba(255,255,255,0.1)",
                fontSize: "10px",
                fontWeight: 700,
                color: "rgba(255,255,255,0.65)",
              }}
            >
              S
            </div>
            <span
              className="hidden sm:block"
              style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.6)" }}
            >
              Planta Demo
            </span>
            <ChevronDown
              className="w-3.5 h-3.5"
              style={{ color: "rgba(255,255,255,0.3)" }}
            />
          </button>
        </div>
      </div>
    </header>
  )
}

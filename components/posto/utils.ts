// components/posto/utils.ts

export function pad2(n: number) {
  return String(n).padStart(2, "0")
}

export function isoToDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}


export function formatHMS(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return null
  const s = Math.max(0, Math.floor(Number(totalSeconds)))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`
}

export function formatBRDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formatBRTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fmtHHMMfromMinutes(min: number) {
  const m = Math.max(0, Math.floor(min))
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${pad2(hh)}:${pad2(mm)}`
}

export function pct(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

export type ChartType = "producao" | "ciclo" | "oee"

export type TooltipData = { x: number; y: number; content: React.ReactNode } | null

/** * Stop reason codes (UI-only, enquanto não há endpoint dedicado) 
 */
export const stopReasonCodes = [
  { 
    code: "0", 
    name: "Micro Parada", 
    description: "Micro Parada", 
    motivo_id: "97F44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "01", 
    name: "Setup", 
    description: "", 
    motivo_id: "98F44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "02", 
    name: "Quebra de rebarba", 
    description: "", 
    motivo_id: "99F44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "2", 
    name: "Parada para café", 
    description: "", 
    motivo_id: "9AF44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "3", 
    name: "Parada para Banheiro", 
    description: "", 
    motivo_id: "9BF44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "4", 
    name: "Falta de Operador", 
    description: "", 
    motivo_id: "9CF44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "5", 
    name: "Troca de turno", 
    description: "", 
    motivo_id: "9DF44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
  { 
    code: "6", 
    name: "Perda de Velocidade", 
    description: "", 
    motivo_id: "9EF44E02-1108-F111-B8FA-C4474E3C4C99" 
  },
]
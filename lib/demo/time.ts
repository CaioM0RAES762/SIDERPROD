// lib/demo/time.ts
//
// Recortes de tempo do chão de fábrica: dia operacional (06h → 06h) e turnos.
//
// O deslocamento de fuso é fixo (constante em config.ts) de propósito: o mesmo
// cálculo precisa rodar no servidor (que na hospedagem está em UTC) e no
// navegador do visitante (que pode estar em qualquer fuso) chegando ao MESMO
// recorte. Usar o fuso local do host faria o painel mudar de dia conforme quem
// abre a página.

import { DEMO_TZ_OFFSET_HOURS, OPERATIONAL_DAY_START_HOUR } from "./config"

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

const OFFSET_MS = DEMO_TZ_OFFSET_HOURS * HOUR_MS
const DAY_START_MS = OPERATIONAL_DAY_START_HOUR * HOUR_MS

/** Relógio da demo. Isolado para os testes poderem congelar o tempo. */
let clock: () => number = () => Date.now()

export function demoNow(): number {
  return clock()
}

/** Usado apenas em testes. */
export function __setDemoClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now())
}

/** Converte instante UTC para "relógio de parede" da planta. */
export function toWall(utcMs: number): number {
  return utcMs + OFFSET_MS
}

/** Converte "relógio de parede" da planta de volta para UTC. */
export function toUtc(wallMs: number): number {
  return wallMs - OFFSET_MS
}

/** Índice sequencial do dia operacional a que o instante pertence. */
export function operationalDayIndex(utcMs: number): number {
  return Math.floor((toWall(utcMs) - DAY_START_MS) / DAY_MS)
}

/** Instante UTC em que o dia operacional começa (06h locais). */
export function operationalDayStart(dayIndex: number): number {
  return toUtc(dayIndex * DAY_MS + DAY_START_MS)
}

export function operationalDayEnd(dayIndex: number): number {
  return operationalDayStart(dayIndex) + DAY_MS
}

/** Data civil (YYYY-MM-DD) do dia operacional, no relógio da planta. */
export function operationalDayISO(dayIndex: number): string {
  const wall = new Date(dayIndex * DAY_MS + DAY_START_MS)
  return wall.toISOString().slice(0, 10)
}

/** Índice do dia operacional a partir de uma data YYYY-MM-DD. */
export function dayIndexFromISO(iso: string): number {
  const [y, m, d] = iso.split("-").map((n) => Number(n))
  if (!y || !m || !d) return operationalDayIndex(demoNow())
  return Math.floor((Date.UTC(y, m - 1, d) - 0) / DAY_MS)
}

export type ShiftSlot = {
  index: 0 | 1 | 2
  nome: string
  /** Início/fim do turno em UTC. */
  inicio: number
  fim: number
}

const SHIFT_NAMES = ["Turno A · Manhã", "Turno B · Tarde", "Turno C · Noite"] as const

/** Os três turnos de um dia operacional, em ordem cronológica. */
export function shiftsOfDay(dayIndex: number): ShiftSlot[] {
  const start = operationalDayStart(dayIndex)
  return [0, 1, 2].map((i) => ({
    index: i as 0 | 1 | 2,
    nome: SHIFT_NAMES[i],
    inicio: start + i * 8 * HOUR_MS,
    fim: start + (i + 1) * 8 * HOUR_MS,
  }))
}

/** Turno que contém o instante informado. */
export function shiftAt(utcMs: number): ShiftSlot {
  const day = operationalDayIndex(utcMs)
  const shifts = shiftsOfDay(day)
  return shifts.find((s) => utcMs >= s.inicio && utcMs < s.fim) ?? shifts[0]
}

/** Sobreposição, em segundos, entre dois intervalos. */
export function overlapSeconds(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart)
  const end = Math.min(aEnd, bEnd)
  return end > start ? (end - start) / 1000 : 0
}

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export function isoOrNull(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString()
}

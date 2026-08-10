// lib/demo/rng.ts
//
// Gerador pseudoaleatório determinístico.
//
// Todo o dataset da demo é derivado de uma semente textual: a mesma chave produz
// sempre os mesmos números. Isso é o que permite gerar dados "vivos" (que mudam
// com o relógio) sem banco de dados e sem que a tela pisque valores diferentes a
// cada requisição — servidor e cliente chegam ao mesmo resultado.

/** Hash de string → inteiro 32 bits (xmur3). */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/** PRNG mulberry32: rápido, estável e suficiente para dados de vitrine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = {
  /** Float em [0, 1). */
  next: () => number
  /** Float em [min, max). */
  float: (min: number, max: number) => number
  /** Inteiro em [min, max]. */
  int: (min: number, max: number) => number
  /** Verdadeiro com probabilidade `p`. */
  chance: (p: number) => boolean
  /** Um item do array. */
  pick: <T>(items: readonly T[]) => T
  /** Um item do array respeitando pesos relativos. */
  weighted: <T>(items: readonly { item: T; weight: number }[]) => T
}

export function makeRng(...keys: (string | number)[]): Rng {
  const next = mulberry32(xmur3(keys.join("|"))())
  const float = (min: number, max: number) => min + next() * (max - min)
  const int = (min: number, max: number) => Math.floor(float(min, max + 1))
  return {
    next,
    float,
    int,
    chance: (p: number) => next() < p,
    pick: <T,>(items: readonly T[]) => items[Math.min(items.length - 1, int(0, items.length - 1))],
    weighted: <T,>(items: readonly { item: T; weight: number }[]) => {
      const total = items.reduce((acc, i) => acc + Math.max(0, i.weight), 0)
      if (total <= 0) return items[0].item
      let roll = next() * total
      for (const i of items) {
        roll -= Math.max(0, i.weight)
        if (roll <= 0) return i.item
      }
      return items[items.length - 1].item
    },
  }
}

const HEX = "0123456789abcdef"

/**
 * Identificador estável no formato UUID v4.
 *
 * Vários componentes da interface validam o formato do identificador antes de
 * usá-lo como chave, então os IDs da demo precisam ser UUIDs bem formados — e
 * precisam ser sempre os mesmos para a mesma entidade.
 */
export function stableId(...keys: (string | number)[]): string {
  const rng = makeRng("uuid", ...keys)
  const hex = (n: number) => Array.from({ length: n }, () => HEX[rng.int(0, 15)]).join("")
  const variant = "89ab"[rng.int(0, 3)]
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`
}

// lib/demo/factory.ts
//
// Gerador da massa de dados fictícia.
//
// Toda a demonstração sai daqui. A ideia central é ter UMA fonte de verdade
// determinística — o "plano" de cada centro de trabalho em cada dia operacional —
// e derivar dela todas as visões (cards ao vivo, produção por hora, OEE por
// turno, Pareto de paradas, histórico, analítico). Assim os números fecham entre
// as telas: se um posto ficou 40 min parado, esse tempo aparece na
// disponibilidade, no Pareto, no histórico e na produção da hora afetada.
//
// Regras de coerência respeitadas:
//   total          = boas + refugo + retrabalho
//   tempo planejado= tempo decorrido − paradas planejadas
//   tempo operante = tempo planejado − paradas não planejadas
//   disponibilidade= tempo operante / tempo planejado
//   performance    = (ciclo ideal × total) / tempo operante
//   qualidade      = boas / total
//   OEE            = disponibilidade × performance × qualidade

import { DEMO_SEED } from "./config"
import {
  CENTROS,
  CENTROS_BY_ID,
  MOTIVOS,
  MOTIVOS_BY_ID,
  MOTIVOS_NAO_PLANEJADOS_PESO,
  MOTIVO_REFEICAO,
  MOTIVO_SETUP,
  PRODUTOS,
  PRODUTOS_BY_ID,
  PRODUTOS_POR_CENTRO,
  type DemoCentro,
  type DemoProduto,
} from "./catalog"
import { makeRng, stableId } from "./rng"
import {
  DAY_MS,
  HOUR_MS,
  demoNow,
  operationalDayEnd,
  operationalDayIndex,
  operationalDayStart,
  overlapSeconds,
  shiftsOfDay,
} from "./time"

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type DemoCorrida = {
  corrida_id: string
  ordem_id: string
  ordem_codigo: string
  produto_id: string
  centro_trabalho_id: string
  inicio: number
  fim: number
  meta: number
}

export type DemoParada = {
  parada_id: string
  centro_trabalho_id: string
  motivo_id: string
  inicio: number
  fim: number
  is_justificada: boolean
  justificativa_texto: string | null
}

export type DemoDayPlan = {
  centro_trabalho_id: string
  dayIndex: number
  inicio: number
  fim: number
  corridas: DemoCorrida[]
  paradas: DemoParada[]
}

export type HourBucket = {
  centro_trabalho_id: string
  corrida_id: string | null
  produto_id: string | null
  ciclo_ideal_seg: number
  inicio: number
  fim: number
  elapsed_seg: number
  parada_planejada_seg: number
  parada_nao_planejada_seg: number
  run_time_seg: number
  planned_time_seg: number
  ideal_time_seg: number
  total: number
  good: number
  scrap: number
  rework: number
}

export type Aggregate = {
  elapsed_seg: number
  planned_stop_seg: number
  unplanned_stop_seg: number
  planned_time_seg: number
  run_time_seg: number
  ideal_time_seg: number
  total: number
  good: number
  scrap: number
  rework: number
  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null
}

// ─── Perfis de comportamento ─────────────────────────────────────────────────

const PERFIL = {
  estavel: { paradas: [4, 6], perf: [0.86, 0.97], scrap: [0.004, 0.014], rework: [0.003, 0.012] },
  irregular: { paradas: [6, 9], perf: [0.74, 0.92], scrap: [0.010, 0.028], rework: [0.008, 0.022] },
  gargalo: { paradas: [8, 11], perf: [0.68, 0.88], scrap: [0.014, 0.034], rework: [0.010, 0.026] },
} as const

// ─── Plano diário (determinístico e cacheável) ───────────────────────────────

const planCache = new Map<string, DemoDayPlan>()

function produtosDoCentro(ct: DemoCentro): DemoProduto[] {
  const codigos = PRODUTOS_POR_CENTRO[ct.codigo] ?? []
  const list = codigos
    .map((c) => PRODUTOS.find((p) => p.codigo === c))
    .filter((p): p is DemoProduto => Boolean(p))
  return list.length ? list : PRODUTOS.slice(0, 3)
}

/** Remove sobreposições mantendo a ordem cronológica e descartando o excedente. */
function dedupeIntervals(items: DemoParada[]): DemoParada[] {
  const sorted = [...items].sort((a, b) => a.inicio - b.inicio)
  const out: DemoParada[] = []
  let lastEnd = -Infinity
  for (const item of sorted) {
    if (item.inicio < lastEnd) {
      // Encosta a parada no fim da anterior; se não sobrar duração, descarta.
      const shifted = { ...item, inicio: lastEnd, fim: item.fim }
      if (shifted.fim - shifted.inicio < 3 * 60_000) continue
      out.push(shifted)
      lastEnd = shifted.fim
      continue
    }
    out.push(item)
    lastEnd = item.fim
  }
  return out
}

/**
 * Plano completo (ordens + paradas) de um centro de trabalho num dia operacional.
 * É gerado inteiro, sem olhar para o relógio: o corte pelo "agora" acontece na
 * leitura. Isso mantém o resultado estável entre servidor e navegador.
 */
export function getDayPlan(centroId: string, dayIndex: number): DemoDayPlan {
  const key = `${centroId}|${dayIndex}`
  const cached = planCache.get(key)
  if (cached) return cached

  const ct = CENTROS_BY_ID.get(centroId)
  const inicio = operationalDayStart(dayIndex)
  const fim = operationalDayEnd(dayIndex)

  if (!ct) {
    const empty: DemoDayPlan = { centro_trabalho_id: centroId, dayIndex, inicio, fim, corridas: [], paradas: [] }
    planCache.set(key, empty)
    return empty
  }

  const rng = makeRng(DEMO_SEED, "plan", ct.codigo, dayIndex)
  const perfil = PERFIL[ct.perfil]
  const catalogo = produtosDoCentro(ct)

  // ── Ordens de produção do dia ──────────────────────────────────────────────
  const qtdOrdens = rng.int(1, Math.min(3, catalogo.length))
  const cortes: number[] = [inicio]
  for (let i = 1; i < qtdOrdens; i++) {
    const base = inicio + (DAY_MS / qtdOrdens) * i
    cortes.push(Math.round(base + rng.float(-1.5, 1.5) * HOUR_MS))
  }
  cortes.push(fim)

  const corridas: DemoCorrida[] = []
  for (let i = 0; i < qtdOrdens; i++) {
    const produto = catalogo[(dayIndex + i) % catalogo.length]
    const cIni = cortes[i]
    const cFim = cortes[i + 1]
    const duracaoSeg = (cFim - cIni) / 1000
    // Código único por posto/dia/sequência — dois postos nunca exibem a mesma OP.
    const seq = makeRng(DEMO_SEED, "ordem", ct.codigo, dayIndex, i).int(10_000, 99_999)
    const ordemCodigo = `OP-${ct.codigo.split("-")[0]}-${seq}`
    corridas.push({
      corrida_id: stableId("corrida", ct.codigo, dayIndex, i),
      ordem_id: stableId("ordem", ct.codigo, dayIndex, i),
      ordem_codigo: ordemCodigo,
      produto_id: produto.produto_id,
      centro_trabalho_id: ct.centro_trabalho_id,
      inicio: cIni,
      fim: cFim,
      // Meta da OP: 80% da capacidade teórica do intervalo.
      meta: Math.max(1, Math.floor((duracaoSeg / produto.ciclo_ideal_seg) * 0.8)),
    })
  }

  // ── Paradas ────────────────────────────────────────────────────────────────
  const paradas: DemoParada[] = []
  let paradaSeq = 0

  const push = (motivoId: string, ini: number, durMin: number, justificada: boolean, texto: string | null) => {
    const fimP = ini + durMin * 60_000
    if (ini < inicio || fimP > fim) return
    paradas.push({
      parada_id: stableId("parada", ct.codigo, dayIndex, paradaSeq++),
      centro_trabalho_id: ct.centro_trabalho_id,
      motivo_id: motivoId,
      inicio: Math.round(ini),
      fim: Math.round(fimP),
      is_justificada: justificada,
      justificativa_texto: texto,
    })
  }

  // Passagem de turno (planejada, curta) no início de cada turno, menos o 1º.
  const turnos = shiftsOfDay(dayIndex)
  const motivoReuniao = MOTIVOS.find((m) => m.codigo === "REUNIAO")!
  for (const turno of turnos.slice(1)) {
    push(motivoReuniao.motivo_id, turno.inicio + rng.int(0, 4) * 60_000, rng.int(8, 15), true, "Passagem de turno")
  }

  // Intervalo de refeição, um por turno.
  for (const turno of turnos) {
    push(
      MOTIVO_REFEICAO.motivo_id,
      turno.inicio + rng.float(4.2, 5.4) * HOUR_MS,
      rng.int(35, 55),
      true,
      "Intervalo de refeição",
    )
  }

  // Setup a cada troca de OP.
  for (const corrida of corridas.slice(1)) {
    push(MOTIVO_SETUP.motivo_id, corrida.inicio, rng.int(14, 42), true, "Troca de ferramental e ajuste inicial")
  }

  // Manutenção preventiva ocasional.
  if (rng.chance(0.18)) {
    push(
      MOTIVOS.find((m) => m.codigo === "MANPREV")!.motivo_id,
      inicio + rng.float(1, 21) * HOUR_MS,
      rng.int(55, 130),
      true,
      "Manutenção preventiva conforme plano",
    )
  }

  // Paradas não planejadas.
  const qtd = rng.int(perfil.paradas[0], perfil.paradas[1])
  const pesos = MOTIVOS_NAO_PLANEJADOS_PESO.map((m) => ({
    item: MOTIVOS.find((x) => x.codigo === m.codigo)!,
    weight: m.weight,
  }))
  for (let i = 0; i < qtd; i++) {
    const motivo = rng.weighted(pesos)
    // Distribuição enviesada para paradas curtas, com cauda longa.
    const base = rng.next()
    const durMin = Math.round(7 + Math.pow(base, 2.2) * 92)
    const naoJustificada = motivo.codigo === "SEMJUST"
    push(
      motivo.motivo_id,
      inicio + rng.float(0.3, 23.2) * HOUR_MS,
      durMin,
      !naoJustificada,
      naoJustificada ? null : justificativaPara(motivo.codigo, rng.int(1, 3)),
    )
  }

  const plan: DemoDayPlan = {
    centro_trabalho_id: ct.centro_trabalho_id,
    dayIndex,
    inicio,
    fim,
    corridas,
    paradas: dedupeIntervals(paradas),
  }
  planCache.set(key, plan)
  return plan
}

const JUSTIFICATIVAS: Record<string, string[]> = {
  QUEBRA: [
    "Rolamento do eixo principal substituído pela manutenção.",
    "Falha no acionamento hidráulico; componente trocado.",
    "Sensor de fim de curso danificado e substituído.",
  ],
  FALTAMAT: [
    "Aguardando abastecimento de matéria-prima pelo almoxarifado.",
    "Lote anterior consumido antes da reposição programada.",
    "Transferência interna atrasada entre setores.",
  ],
  AJUSTE: [
    "Ajuste de parâmetros após desvio dimensional.",
    "Correção de alinhamento do dispositivo.",
    "Recalibração do sistema de medição.",
  ],
  QUALID: [
    "Segregação de lote com desvio dimensional.",
    "Inspeção adicional solicitada pela qualidade.",
    "Retrabalho de peças fora de especificação.",
  ],
  FALTAOP: [
    "Operador remanejado para outro posto.",
    "Cobertura de turno em atraso.",
    "Treinamento operacional programado.",
  ],
  ENERGIA: [
    "Oscilação na rede elétrica registrada pela subestação.",
    "Queda de energia de curta duração.",
    "Religamento após proteção do quadro.",
  ],
  FERRAM: [
    "Inserto substituído por desgaste natural.",
    "Troca preventiva de ferramenta de corte.",
    "Afiação de ferramental realizada.",
  ],
}

function justificativaPara(codigo: string, variante: number): string {
  const list = JUSTIFICATIVAS[codigo]
  if (!list?.length) return "Ocorrência registrada pelo operador."
  return list[(variante - 1) % list.length]
}

// ─── Leitura recortada pelo "agora" ──────────────────────────────────────────

export type ParadaView = DemoParada & {
  /** Fim efetivo: null quando a parada ainda está aberta. */
  fim_efetivo: number | null
  duracao_seg: number
}

/** Paradas do dia já cortadas pelo instante atual. */
export function paradasDoDia(centroId: string, dayIndex: number, nowMs = demoNow()): ParadaView[] {
  const plan = getDayPlan(centroId, dayIndex)
  const out: ParadaView[] = []
  for (const p of plan.paradas) {
    if (p.inicio >= nowMs) continue
    const aberta = p.fim > nowMs
    const fimEfetivo = aberta ? null : p.fim
    out.push({
      ...p,
      fim_efetivo: fimEfetivo,
      duracao_seg: Math.max(0, Math.round(((aberta ? nowMs : p.fim) - p.inicio) / 1000)),
    })
  }
  return out
}

/** Paradas dentro de uma janela livre (varre os dias tocados pela janela). */
export function paradasNaJanela(
  centroId: string,
  fromMs: number,
  toMs: number,
  nowMs = demoNow(),
): ParadaView[] {
  const first = operationalDayIndex(fromMs)
  const last = operationalDayIndex(Math.min(toMs, nowMs))
  const out: ParadaView[] = []
  for (let d = first; d <= last; d++) {
    for (const p of paradasDoDia(centroId, d, nowMs)) {
      const fim = p.fim_efetivo ?? nowMs
      if (fim <= fromMs || p.inicio >= toMs) continue
      out.push(p)
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio)
}

/** Corrida (ordem em execução) ativa num instante. */
export function corridaEm(centroId: string, ms: number): DemoCorrida | null {
  const plan = getDayPlan(centroId, operationalDayIndex(ms))
  return plan.corridas.find((c) => ms >= c.inicio && ms < c.fim) ?? null
}

/** Parada aberta agora, se houver. */
export function paradaAbertaEm(centroId: string, nowMs = demoNow()): ParadaView | null {
  const dia = paradasDoDia(centroId, operationalDayIndex(nowMs), nowMs)
  return dia.find((p) => p.fim_efetivo === null) ?? null
}

// ─── Buckets horários ────────────────────────────────────────────────────────

function fatorPerformance(ct: DemoCentro, dayIndex: number, hourIndex: number): number {
  const perfil = PERFIL[ct.perfil]
  const rng = makeRng(DEMO_SEED, "perf", ct.codigo, dayIndex, hourIndex)
  // Ondulação suave ao longo do dia + ruído: evita série "serrilhada".
  const onda = Math.sin((hourIndex / 24) * Math.PI * 2 + dayIndex) * 0.035
  const base = rng.float(perfil.perf[0], perfil.perf[1])
  return Math.max(0.45, Math.min(0.99, base + onda))
}

/**
 * Buckets de 1 hora de um centro num dia operacional, já cortados pelo relógio.
 * É a granularidade base de todos os gráficos de produção.
 */
export function bucketsDoDia(centroId: string, dayIndex: number, nowMs = demoNow()): HourBucket[] {
  const ct = CENTROS_BY_ID.get(centroId)
  if (!ct) return []

  const plan = getDayPlan(centroId, dayIndex)
  if (plan.inicio > nowMs) return []

  const out: HourBucket[] = []

  for (let h = 0; h < 24; h++) {
    const bIni = plan.inicio + h * HOUR_MS
    const bFimPlano = bIni + HOUR_MS
    if (bIni >= nowMs) break
    const bFim = Math.min(bFimPlano, nowMs)
    const elapsed = (bFim - bIni) / 1000
    if (elapsed <= 0) continue

    let planejada = 0
    let naoPlanejada = 0
    for (const p of plan.paradas) {
      const seg = overlapSeconds(p.inicio, Math.min(p.fim, nowMs), bIni, bFim)
      if (seg <= 0) continue
      const motivo = MOTIVOS_BY_ID.get(p.motivo_id)
      if (motivo?.is_planejada) planejada += seg
      else naoPlanejada += seg
    }

    const meio = bIni + (bFim - bIni) / 2
    const corrida = plan.corridas.find((c) => meio >= c.inicio && meio < c.fim) ?? plan.corridas[0] ?? null
    const produto = corrida ? PRODUTOS_BY_ID.get(corrida.produto_id) ?? null : null
    const ciclo = produto?.ciclo_ideal_seg ?? 60

    const plannedTime = Math.max(0, elapsed - planejada)
    const runTime = Math.max(0, plannedTime - naoPlanejada)

    const perf = fatorPerformance(ct, dayIndex, h)
    const total = Math.max(0, Math.floor((runTime / ciclo) * perf))

    const rng = makeRng(DEMO_SEED, "qual", ct.codigo, dayIndex, h)
    const perfil = PERFIL[ct.perfil]
    const scrapRate = rng.float(perfil.scrap[0], perfil.scrap[1])
    const reworkRate = rng.float(perfil.rework[0], perfil.rework[1])
    const scrap = Math.min(total, Math.round(total * scrapRate))
    const rework = Math.min(total - scrap, Math.round(total * reworkRate))
    const good = total - scrap - rework

    out.push({
      centro_trabalho_id: centroId,
      corrida_id: corrida?.corrida_id ?? null,
      produto_id: produto?.produto_id ?? null,
      ciclo_ideal_seg: ciclo,
      inicio: bIni,
      fim: bFimPlano,
      elapsed_seg: Math.round(elapsed),
      parada_planejada_seg: Math.round(planejada),
      parada_nao_planejada_seg: Math.round(naoPlanejada),
      planned_time_seg: Math.round(plannedTime),
      run_time_seg: Math.round(runTime),
      ideal_time_seg: Math.round(total * ciclo),
      total,
      good,
      scrap,
      rework,
    })
  }

  return out
}

/** Buckets horários de um centro numa janela livre. */
export function bucketsNaJanela(
  centroId: string,
  fromMs: number,
  toMs: number,
  nowMs = demoNow(),
): HourBucket[] {
  const limite = Math.min(toMs, nowMs)
  if (limite <= fromMs) return []
  const first = operationalDayIndex(fromMs)
  const last = operationalDayIndex(limite)
  const out: HourBucket[] = []
  for (let d = first; d <= last; d++) {
    for (const b of bucketsDoDia(centroId, d, nowMs)) {
      if (b.fim <= fromMs || b.inicio >= limite) continue
      out.push(b)
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio)
}

// ─── Agregações ──────────────────────────────────────────────────────────────

export const ZERO_AGGREGATE: Aggregate = {
  elapsed_seg: 0,
  planned_stop_seg: 0,
  unplanned_stop_seg: 0,
  planned_time_seg: 0,
  run_time_seg: 0,
  ideal_time_seg: 0,
  total: 0,
  good: 0,
  scrap: 0,
  rework: 0,
  availability: null,
  performance: null,
  quality: null,
  oee: null,
}

/** Consolida uma lista de buckets aplicando a fórmula clássica de OEE. */
export function aggregate(buckets: HourBucket[]): Aggregate {
  if (!buckets.length) return { ...ZERO_AGGREGATE }

  const acc = buckets.reduce(
    (a, b) => {
      a.elapsed_seg += b.elapsed_seg
      a.planned_stop_seg += b.parada_planejada_seg
      a.unplanned_stop_seg += b.parada_nao_planejada_seg
      a.planned_time_seg += b.planned_time_seg
      a.run_time_seg += b.run_time_seg
      a.ideal_time_seg += b.ideal_time_seg
      a.total += b.total
      a.good += b.good
      a.scrap += b.scrap
      a.rework += b.rework
      return a
    },
    { ...ZERO_AGGREGATE },
  )

  const availability = acc.planned_time_seg > 0 ? acc.run_time_seg / acc.planned_time_seg : null
  const performance = acc.run_time_seg > 0 ? Math.min(1, acc.ideal_time_seg / acc.run_time_seg) : null
  const quality = acc.total > 0 ? acc.good / acc.total : null
  const oee =
    availability != null && performance != null && quality != null
      ? availability * performance * quality
      : null

  return { ...acc, availability, performance, quality, oee }
}

/** Agregado de um centro numa janela livre. */
export function aggregateWindow(
  centroId: string,
  fromMs: number,
  toMs: number,
  nowMs = demoNow(),
): Aggregate {
  return aggregate(bucketsNaJanela(centroId, fromMs, toMs, nowMs))
}

// ─── Progresso acumulado por produto ─────────────────────────────────────────

/**
 * Produção histórica acumulada de um produto contra o programa mensal.
 * Base determinística + produção real gerada nos últimos dias, para o número
 * subir ao longo do dia sem depender de persistência.
 */
export function progressoProduto(produtoId: string, nowMs = demoNow()): {
  total_good: number
  meta: number
  pct: number
} {
  const produto = PRODUTOS_BY_ID.get(produtoId)
  if (!produto) return { total_good: 0, meta: 0, pct: 0 }

  const rng = makeRng(DEMO_SEED, "progresso", produto.codigo)
  const base = Math.floor(produto.meta_planejada * rng.float(0.28, 0.62))

  let recente = 0
  const dia = operationalDayIndex(nowMs)
  for (const ct of CENTROS) {
    for (let d = dia - 2; d <= dia; d++) {
      for (const b of bucketsDoDia(ct.centro_trabalho_id, d, nowMs)) {
        if (b.produto_id === produtoId) recente += b.good
      }
    }
  }

  const total = base + recente
  return {
    total_good: total,
    meta: produto.meta_planejada,
    pct: produto.meta_planejada > 0 ? Math.min(1, total / produto.meta_planejada) : 0,
  }
}

/** Peças em rodízio de retrabalho num posto REWORK. */
export function pecasRetrabalho(centroId: string): string[] {
  const ct = CENTROS_BY_ID.get(centroId)
  if (!ct || ct.modo_contagem !== "REWORK") return []
  return produtosDoCentro(ct).map((p) => p.codigo)
}

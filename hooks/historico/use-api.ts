// hooks/historico/use-api.ts
"use client"

import useSWR from "swr"

/**
 * ============================================================
 * HISTÓRICO (client hooks) — NÍVEL INDUSTRIAL
 * - Consome /api/db/historico (GET) e (opcional) POST
 * - Totalmente compatível com o novo route.ts + history.ts
 *
 * Suporta:
 * - tabs: oee | producao | paradas | refugo | retrabalho | ciclo | perdas | pessoas | eventos
 * - granularidade: hour | op_day | turno | Dia | Semana | Mês
 * - filtros (CT/Setor/Produto/Ordem/Turno/Planta)
 * - tabelas e séries multi-métrica (seriesList + table multi-colunas do backend)
 *
 * Objetivo:
 * - entregar dados extremamente específicos, com ótima granularidade,
 *   prontos para histórico/controle de qualidade e processos industriais.
 * ============================================================
 */

/* ─────────────────────────────────────────────────────────────
 * TIPOS (alinhados ao backend novo)
 * ───────────────────────────────────────────────────────────── */

export type HistoryTab =
  | "oee"
  | "producao"
  | "paradas"
  | "refugo"
  | "retrabalho"
  | "ciclo"
  | "perdas"
  | "pessoas"
  | "eventos"

export type Granularity = "hour" | "op_day" | "turno" | "Dia" | "Semana" | "Mês"

export type ProducaoMetric =
  | "Qtd. Produzida e Capacidade"
  | "Qtd. Produzida"
  | "Capacidade"

export type ParadasMetric = "Duração" | "Quantidade"
export type CicloMetric = "Tempo de Ciclo" | "Ciclo Médio"
export type PerdasMetric = "Tempo perdido" | "Quantidade perdida"
export type UnitSelect = "UN" | "KG" | "L" | string

export interface HistoryFilters {
  setorId?: string
  turnoId?: string
  centroTrabalhoId?: string
  produtoId?: string
  ordemId?: string
  plantaId?: string

  // extensões futuras (podem ser ignoradas no backend sem quebrar)
  equipamentoId?: string
  tipoPerdaId?: string
}

export interface HistoryPoint {
  bucket: string
  dia_utc: string
  valor: number
  // compat (caso algum endpoint antigo envie multi-série via points)
  serie?: string
  metric?: string
  nome?: string
}

export interface HistorySeries {
  name: string
  data: number[]
  unit?: string
}

export interface HistoryTableRow {
  dia: string
  [k: string]: string | number
}

/** eco opcional do backend (debug/auditoria) */
export interface HistoryApiQueryEcho {
  empresaId: string
  tab: HistoryTab
  granularity: Granularity
  startUtc: string
  endUtc: string
  filters?: HistoryFilters
  producaoMetric?: ProducaoMetric
  paradasMetric?: ParadasMetric
  cicloMetric?: CicloMetric
  perdasMetric?: PerdasMetric
  unit?: UnitSelect
}

export interface HistoryApiResponseNormalized {
  empresaId?: string
  query?: HistoryApiQueryEcho

  labels: string[]
  seriesList: HistorySeries[]
  /** compat: 1ª série (se existir) */
  series: number[]
  /** tabela normalizada */
  table: HistoryTableRow[]
  /** pontos crus (quando presentes) */
  points: HistoryPoint[]

  /** payload cru para debug */
  raw?: any
}

export interface ApiErrorShape {
  error: string
  extra?: any
}

/* ─────────────────────────────────────────────────────────────
 * CONSTANTES / CONFIG
 * ───────────────────────────────────────────────────────────── */

const API_BASE = "/api/db/historico"

/**
 * Regras industriais de default por tab:
 * (sem “adivinhar” o backend, só escolha de granularity default para UX)
 */
const DEFAULT_GRANULARITY_BY_TAB: Record<HistoryTab, Granularity> = {
  oee: "op_day",
  producao: "hour",
  paradas: "op_day",
  refugo: "op_day",
  retrabalho: "op_day",
  ciclo: "hour",
  perdas: "op_day",
  pessoas: "op_day",
  eventos: "hour",
}

/* ─────────────────────────────────────────────────────────────
 * UTILS
 * ───────────────────────────────────────────────────────────── */

function isNonEmpty(v: any) {
  return v != null && String(v).trim() !== ""
}

function safeNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr))
}

function toIsoOrUndefined(v?: string | Date | null) {
  if (v == null) return undefined
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString()
  const s = String(v).trim()
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * Range default (últimos 30 dias) — estável p/ SWR
 */
export function defaultRangeIso(range?: { startUtc?: string | Date; endUtc?: string | Date }) {
  const endUtc = toIsoOrUndefined(range?.endUtc) ?? new Date().toISOString()
  const startUtc =
    toIsoOrUndefined(range?.startUtc) ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  return { startUtc, endUtc }
}

/**
 * Serialização determinística de parâmetros (evita bugs de cache / “acúmulo” no front)
 * - Ordena as keys
 * - Remove vazios
 * - Mantém coerência entre requests iguais
 */
function buildSearchParamsDeterministic(params: Record<string, any>) {
  const sp = new URLSearchParams()
  const keys = Object.keys(params).sort()
  for (const k of keys) {
    const v = params[k]
    if (!isNonEmpty(v)) continue
    sp.set(k, String(v))
  }
  return sp
}

/**
 * Fetcher robusto (GET)
 */
async function fetcherJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data as any).error) || `Erro HTTP ${res.status}`
    const err: any = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }

  return data as T
}

/**
 * POST opcional (quando quiser mandar filtros complexos no body)
 * - Mantém compatibilidade com o route.ts (empresaId pode ir via querystring)
 */
export async function postHistorico<T = any>(
  body: any,
  opts?: { empresaId?: string }
): Promise<T> {
  const sp = new URLSearchParams()
  if (opts?.empresaId) sp.set("empresaId", opts.empresaId)
  const url = sp.toString() ? `${API_BASE}?${sp.toString()}` : API_BASE

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data as any).error) || `Erro HTTP ${res.status}`
    const err: any = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }

  return data as T
}

function pickSeriesNameFallback(tab?: HistoryTab) {
  switch (tab) {
    case "oee":
      return "OEE"
    case "producao":
      return "Produção"
    case "paradas":
      return "Paradas"
    case "refugo":
      return "Refugo"
    case "retrabalho":
      return "Retrabalho"
    case "ciclo":
      return "Ciclo"
    case "perdas":
      return "Perdas"
    case "pessoas":
      return "Pessoas"
    case "eventos":
      return "Eventos"
    default:
      return "Série"
  }
}

/**
 * Labels:
 * - Preferimos labels vindos do backend (já formatados)
 * - Se não vierem, usamos points.bucket (hour) ou dia_utc
 */
function buildLabelsFromPoints(points: any): string[] {
  if (!Array.isArray(points) || !points.length) return []
  const labels = points
    .map((p) => {
      if (p?.bucket != null) return String(p.bucket)
      if (p?.dia_utc != null) return String(p.dia_utc).slice(0, 10)
      return ""
    })
    .filter(Boolean)
  return uniq(labels)
}

/**
 * Normaliza “points multi-série” (fallback legado)
 */
function buildSeriesListFromPoints(points: HistoryPoint[], labels: string[], tab?: HistoryTab): HistorySeries[] {
  const seriesKey = (p: any) => String(p?.serie ?? p?.metric ?? p?.nome ?? pickSeriesNameFallback(tab))
  const names = uniq(points.map(seriesKey))

  const byName: Record<string, Record<string, number>> = {}
  for (const n of names) byName[n] = {}

  for (const p of points) {
    const name = seriesKey(p)
    const label = p.bucket != null ? String(p.bucket) : p.dia_utc ? String(p.dia_utc).slice(0, 10) : ""
    if (!label) continue
    byName[name][label] = safeNum(p.valor)
  }

  return names.map((name) => ({
    name,
    data: labels.map((l) => safeNum(byName[name]?.[l])),
  }))
}

function isSimpleDiaValorRow(r: any) {
  if (!r || typeof r !== "object") return false
  if (!("dia" in r) || !("valor" in r)) return false
  const keys = Object.keys(r)
  const extra = keys.filter((k) => k !== "dia" && k !== "valor" && k !== "bucket")
  return extra.length === 0
}

/**
 * Tabela:
 * - Backend novo já envia table multi-colunas (dia + colunas por série)
 * - Caso venha simples {dia,valor}, converte para coluna da 1ª série
 * - Caso não venha table, gera a partir de labels+seriesList
 */
function normalizeTable(raw: any, labels: string[], seriesList: HistorySeries[]): HistoryTableRow[] {
  if (Array.isArray(raw?.table) && raw.table.length) {
    const t0 = raw.table[0]

    // multi-colunas já pronto
    if (t0 && typeof t0 === "object" && "dia" in t0 && !isSimpleDiaValorRow(t0)) {
      return raw.table.map((r: any) => {
        const out: HistoryTableRow = { dia: String(r.dia ?? "") }
        for (const [k, v] of Object.entries(r)) {
          if (k === "dia") continue
          if (typeof v === "number") out[k] = safeNum(v)
          else if (Number.isFinite(Number(v))) out[k] = safeNum(v)
          else out[k] = String(v)
        }
        return out
      })
    }

    // simples {dia,valor}
    const firstName = seriesList[0]?.name ?? "Valor"
    return raw.table.map((r: any) => ({
      dia: String(r.dia ?? ""),
      [firstName]: safeNum(r.valor),
    }))
  }

  // fallback: constrói por labels + seriesList
  if (!labels.length) return []
  return labels.map((dia, idx) => {
    const row: HistoryTableRow = { dia }
    for (const s of seriesList) row[s.name] = safeNum(s.data?.[idx])
    return row
  })
}

/**
 * Garante consistência industrial:
 * - labels e todas as séries com mesmo tamanho
 * - preenche faltantes com 0 (evita crashes de UI)
 */
function alignSeriesToLabels(labels: string[], seriesList: HistorySeries[]): HistorySeries[] {
  const L = labels.length
  return seriesList.map((s) => {
    const d = Array.isArray(s.data) ? s.data.map(safeNum) : []
    if (d.length === L) return { ...s, data: d }
    if (d.length > L) return { ...s, data: d.slice(0, L) }
    // d.length < L
    return { ...s, data: d.concat(Array.from({ length: L - d.length }, () => 0)) }
  })
}

/**
 * Normaliza qualquer resposta do backend para o formato industrial único.
 */
function normalizeHistoricoResponse(raw: any, tab?: HistoryTab): HistoryApiResponseNormalized {
  const labelsFromRaw: string[] = Array.isArray(raw?.labels) ? raw.labels.map(String) : []

  // 1) Backend novo: seriesList + table multi-colunas
  if (Array.isArray(raw?.seriesList)) {
    const mapped: HistorySeries[] = raw.seriesList
      .filter((s: any) => s && typeof s === "object")
      .map((s: any) => ({
        name: String(s.name ?? pickSeriesNameFallback(tab)),
        data: Array.isArray(s.data) ? s.data.map(safeNum) : [],
        unit: s.unit ? String(s.unit) : undefined,
      }))

    const points = Array.isArray(raw?.points) ? (raw.points as HistoryPoint[]) : []
    const labels = labelsFromRaw.length ? labelsFromRaw : buildLabelsFromPoints(points)
    const aligned = alignSeriesToLabels(labels, mapped.length ? mapped : [{ name: pickSeriesNameFallback(tab), data: [] }])
    const table = normalizeTable(raw, labels, aligned)

    return {
      empresaId: raw?.empresaId,
      query: raw?.query,
      labels,
      seriesList: aligned,
      series: aligned[0]?.data ?? [],
      table,
      points,
      raw,
    }
  }

  // 2) Map object: { series: {name: number[]} }
  if (raw?.series && typeof raw.series === "object" && !Array.isArray(raw.series)) {
    const keys = Object.keys(raw.series)
    const mapped: HistorySeries[] = keys.map((k) => ({
      name: String(k),
      data: Array.isArray(raw.series[k]) ? raw.series[k].map(safeNum) : [],
    }))

    const points = Array.isArray(raw?.points) ? (raw.points as HistoryPoint[]) : []
    const labels = labelsFromRaw.length ? labelsFromRaw : buildLabelsFromPoints(points)
    const aligned = alignSeriesToLabels(labels, mapped.length ? mapped : [{ name: pickSeriesNameFallback(tab), data: [] }])
    const table = normalizeTable(raw, labels, aligned)

    return {
      empresaId: raw?.empresaId,
      query: raw?.query,
      labels,
      seriesList: aligned,
      series: aligned[0]?.data ?? [],
      table,
      points,
      raw,
    }
  }

  // 3) Points-only (multi-série legado)
  if (Array.isArray(raw?.points) && raw.points.length) {
    const points = raw.points as HistoryPoint[]
    const labels = labelsFromRaw.length ? labelsFromRaw : buildLabelsFromPoints(points)
    const mapped = buildSeriesListFromPoints(points, labels, tab)
    const aligned = alignSeriesToLabels(labels, mapped.length ? mapped : [{ name: pickSeriesNameFallback(tab), data: [] }])
    const table = normalizeTable(raw, labels, aligned)

    return {
      empresaId: raw?.empresaId,
      query: raw?.query,
      labels,
      seriesList: aligned,
      series: aligned[0]?.data ?? [],
      table,
      points,
      raw,
    }
  }

  // 4) Simples: labels + series:number[]
  const labels = labelsFromRaw
  const oneSeries = Array.isArray(raw?.series) ? raw.series.map(safeNum) : []
  const aligned = alignSeriesToLabels(labels, [{ name: pickSeriesNameFallback(tab), data: oneSeries }])
  const table = normalizeTable(raw, labels, aligned)

  return {
    empresaId: raw?.empresaId,
    query: raw?.query,
    labels,
    seriesList: aligned,
    series: aligned[0]?.data ?? [],
    table,
    points: Array.isArray(raw?.points) ? (raw.points as HistoryPoint[]) : [],
    raw,
  }
}

/* ─────────────────────────────────────────────────────────────
 * HOOK PRINCIPAL
 * ───────────────────────────────────────────────────────────── */

export interface UseHistoricoParams {
  empresaId?: string

  tab: HistoryTab
  granularity?: Granularity
  range?: { startUtc?: string | Date; endUtc?: string | Date }
  filters?: HistoryFilters

  producaoMetric?: ProducaoMetric
  paradasMetric?: ParadasMetric
  cicloMetric?: CicloMetric
  perdasMetric?: PerdasMetric
  unit?: UnitSelect

  /** desliga chamadas */
  enable?: boolean

  /** tuning industrial */
  swr?: {
    dedupingIntervalMs?: number
    revalidateOnFocus?: boolean
    refreshIntervalMs?: number
  }
}

export function useHistorico(params: UseHistoricoParams) {
  const enable = params.enable ?? true
  const granularity =
    params.granularity ?? DEFAULT_GRANULARITY_BY_TAB[params.tab] ?? "op_day"
  const { startUtc, endUtc } = defaultRangeIso(params.range)

  // QUERYSTRING alinhada ao route.ts
  const sp = buildSearchParamsDeterministic({
    empresaId: params.empresaId,

    tab: params.tab,
    granularity,
    startUtc,
    endUtc,

    // filtros suportados no backend
    setorId: params.filters?.setorId,
    turnoId: params.filters?.turnoId,
    centroTrabalhoId: params.filters?.centroTrabalhoId,
    produtoId: params.filters?.produtoId,
    ordemId: params.filters?.ordemId,
    plantaId: params.filters?.plantaId,

    // extensões futuras (podem ser ignoradas)
    equipamentoId: (params.filters as any)?.equipamentoId,
    tipoPerdaId: (params.filters as any)?.tipoPerdaId,

    // métricas
    producaoMetric: params.producaoMetric,
    paradasMetric: params.paradasMetric,
    cicloMetric: params.cicloMetric,
    perdasMetric: params.perdasMetric,
    unit: params.unit,
  })

  const key = enable ? `${API_BASE}?${sp.toString()}` : null

  const swr = useSWR<any>(key, fetcherJson, {
    revalidateOnFocus: params.swr?.revalidateOnFocus ?? false,
    dedupingInterval: params.swr?.dedupingIntervalMs ?? 5000,
    refreshInterval: params.swr?.refreshIntervalMs ?? 0,
  })

  const normalized = normalizeHistoricoResponse(swr.data, params.tab)

  return {
    ...swr,

    // normalizados (padrão industrial)
    labels: normalized.labels,
    seriesList: normalized.seriesList,
    series: normalized.series, // compat: 1ª série
    table: normalized.table,
    points: normalized.points,

    // eco/debug
    empresaId: normalized.empresaId,
    query: normalized.query,
    raw: normalized.raw,

    // erros (industrial)
    errorMessage: (swr.error as any)?.message as string | undefined,
    errorData: (swr.error as any)?.data as ApiErrorShape | undefined,
  }
}

/* ─────────────────────────────────────────────────────────────
 * HOOKS ESPECIALIZADOS (qualidade/industrial)
 * ───────────────────────────────────────────────────────────── */

export function useHistoricoOee(params: Omit<UseHistoricoParams, "tab">) {
  return useHistorico({ ...params, tab: "oee" })
}
export function useHistoricoProducao(params: Omit<UseHistoricoParams, "tab">) {
  return useHistorico({ ...params, tab: "producao" })
}
export function useHistoricoParadas(params: Omit<UseHistoricoParams, "tab">) {
  return useHistorico({ ...params, tab: "paradas" })
}
export function useHistoricoCiclo(params: Omit<UseHistoricoParams, "tab">) {
  return useHistorico({ ...params, tab: "ciclo" })
}
export function useHistoricoPerdas(params: Omit<UseHistoricoParams, "tab">) {
  return useHistorico({ ...params, tab: "perdas" })
}
export function useHistoricoEventos(params: Omit<UseHistoricoParams, "tab">) {
  return useHistorico({ ...params, tab: "eventos" })
}

/* ─────────────────────────────────────────────────────────────
 * LISTAS / CHIPS (mode=...)
 * ───────────────────────────────────────────────────────────── */

export type HistoricoListMode = "setores" | "turnos" | "centros" | "produtos" | "ordens"

export interface ListResponse<T> {
  empresaId: string
  mode: HistoricoListMode | string
  data: T[]
  startUtc?: string
  endUtc?: string
}

export interface SetorRow {
  setor_id: string
  nome: string
  public_id: string
}
export interface TurnoRow {
  turno_id: string
  nome: string
  public_id: string
  hora_inicio?: string
  hora_fim?: string
}
export interface CentroTrabalhoRow {
  centro_trabalho_id: string
  codigo: string
  nome: string
  public_id: string
}
export interface ProdutoRow {
  produto_id: string
  codigo: string
  descricao: string
  public_id: string
}
export interface OrdemRow {
  ordem_id: string
  ordem_codigo: string
  ordem_public_id: string
  produto_descricao: string
}

function listKey(mode: HistoricoListMode, extra?: Record<string, any>, empresaId?: string) {
  const sp = buildSearchParamsDeterministic({ empresaId, mode, ...(extra ?? {}) })
  return `${API_BASE}?${sp.toString()}`
}

export function useHistoricoSetores(opts?: { empresaId?: string; enable?: boolean }) {
  const key = (opts?.enable ?? true) ? listKey("setores", undefined, opts?.empresaId) : null
  const swr = useSWR<ListResponse<SetorRow>>(key, fetcherJson, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  return { ...swr, data: swr.data?.data ?? [] }
}

export function useHistoricoTurnos(opts?: { empresaId?: string; enable?: boolean }) {
  const key = (opts?.enable ?? true) ? listKey("turnos", undefined, opts?.empresaId) : null
  const swr = useSWR<ListResponse<TurnoRow>>(key, fetcherJson, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  return { ...swr, data: swr.data?.data ?? [] }
}

export function useHistoricoCentrosTrabalho(opts?: { empresaId?: string; setorId?: string; enable?: boolean }) {
  const key =
    (opts?.enable ?? true)
      ? listKey("centros", { setorId: opts?.setorId }, opts?.empresaId)
      : null

  const swr = useSWR<ListResponse<CentroTrabalhoRow>>(key, fetcherJson, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  return { ...swr, data: swr.data?.data ?? [] }
}

export function useHistoricoProdutos(opts?: { empresaId?: string; enable?: boolean }) {
  const key = (opts?.enable ?? true) ? listKey("produtos", undefined, opts?.empresaId) : null
  const swr = useSWR<ListResponse<ProdutoRow>>(key, fetcherJson, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  return { ...swr, data: swr.data?.data ?? [] }
}

export function useHistoricoOrdens(opts?: {
  empresaId?: string
  range?: { startUtc?: string | Date; endUtc?: string | Date }
  enable?: boolean
}) {
  const { startUtc, endUtc } = defaultRangeIso(opts?.range)
  const key =
    (opts?.enable ?? true)
      ? listKey("ordens", { startUtc, endUtc }, opts?.empresaId)
      : null

  const swr = useSWR<ListResponse<OrdemRow> & { startUtc: string; endUtc: string }>(key, fetcherJson, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  return {
    ...swr,
    data: swr.data?.data ?? [],
    startUtc: swr.data?.startUtc,
    endUtc: swr.data?.endUtc,
  }
}

/* ─────────────────────────────────────────────────────────────
 * REBARBADORES (mode=rebarbadores) — analítico por operador
 * ───────────────────────────────────────────────────────────── */

/** Uma atuação = um rebarbador em uma corrida/posto. */
export interface RebarbadorAtuacao {
  rebarbador_id:      string
  rebarbador_nome:    string
  registro:           string | null
  cargo:              string | null
  corrida_id:         string
  ordem_id:           string | null
  ordem_codigo:       string | null
  produto_id:         string | null
  produto_codigo:     string | null
  produto_descricao:  string | null
  centro_trabalho_id: string
  ct_codigo:          string | null
  ct_nome:            string | null
  turno_id:           string | null
  turno_nome:         string | null
  inicio_utc:         string | null
  fim_utc:            string | null
  em_andamento:       boolean
  dur_atuacao_seg:    number
  parada_seg:         number
  parada_plan_seg:    number
  parada_nplan_seg:   number
  qtd_paradas:        number
  tempo_produzindo_seg: number
  good:               number
  scrap:              number
  rework:             number
  total:              number
  ciclo_ideal_seg:    number | null
  meta_pcs_h:         number | null
  pcs_h:              number | null
  aderencia:          number | null
  qualidade:          number | null
}

export interface RebarbadorTendenciaDia {
  rebarbador_id: string
  dia:           string
  good:          number
  total:         number
  horas_ativas:  number
  pcs_h:         number | null
  parada_seg:    number
  qtd_paradas:   number
}

export interface FuncionarioLite {
  funcionario_id: string
  nome:           string
  registro:       string | null
  cargo:          string | null
  is_active:      boolean
}

/** Uma parada individual contabilizada no tempo parado de uma atuação. */
export interface RebarbadorParada {
  rebarbador_id:      string
  parada_id:          string
  corrida_id:         string
  centro_trabalho_id: string
  ct_codigo:          string | null
  ordem_id:           string | null
  ordem_codigo:       string | null
  motivo_id:          string | null
  motivo_descricao:   string | null
  motivo_codigo:      string | null
  is_planejada:       boolean
  inicio_utc:         string | null
  fim_utc:            string | null
  em_andamento:       boolean
  duracao_seg:        number
}

export interface RebarbadoresResponse {
  ok:                 boolean
  mode:               string
  startUtc:           string
  endUtc:             string
  disponivel:         boolean
  motivoIndisponivel: string | null
  atuacoes:           RebarbadorAtuacao[]
  tendencia:          RebarbadorTendenciaDia[]
  funcionarios:       FuncionarioLite[]
  paradas:            RebarbadorParada[]
}

export interface UseHistoricoRebarbadoresParams {
  empresaId?: string
  range?: { startUtc?: string | Date; endUtc?: string | Date }
  filters?: HistoryFilters & { rebarbadorId?: string }
  enable?: boolean
}

export function useHistoricoRebarbadores(params: UseHistoricoRebarbadoresParams) {
  const enable = params.enable ?? true
  const { startUtc, endUtc } = defaultRangeIso(params.range)

  const sp = buildSearchParamsDeterministic({
    empresaId: params.empresaId,
    mode: "rebarbadores",
    startUtc,
    endUtc,
    setorId:          params.filters?.setorId,
    turnoId:          params.filters?.turnoId,
    centroTrabalhoId: params.filters?.centroTrabalhoId,
    produtoId:        params.filters?.produtoId,
    ordemId:          params.filters?.ordemId,
    plantaId:         params.filters?.plantaId,
    rebarbadorId:     params.filters?.rebarbadorId,
  })

  const key = enable ? `${API_BASE}?${sp.toString()}` : null

  const swr = useSWR<RebarbadoresResponse>(key, fetcherJson, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  })

  return {
    ...swr,
    disponivel:         swr.data?.disponivel ?? true,
    motivoIndisponivel: swr.data?.motivoIndisponivel ?? null,
    atuacoes:           swr.data?.atuacoes ?? [],
    tendencia:          swr.data?.tendencia ?? [],
    funcionarios:       swr.data?.funcionarios ?? [],
    paradas:            swr.data?.paradas ?? [],
    errorMessage:       (swr.error as any)?.message as string | undefined,
  }
}

/* ─────────────────────────────────────────────────────────────
 * HELPERS DE RANGE / PRESETS
 * ───────────────────────────────────────────────────────────── */

export function makeHistoricoRangeLastDays(days: number) {
  const endUtc = new Date().toISOString()
  const startUtc = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString()
  return { startUtc, endUtc }
}

/**
 * Presets industriais de granularidade por intenção:
 * - degradação/ciclo: hour
 * - consolidado OEE/perdas: op_day
 * - auditoria/turnos: turno
 */
export const HistoricoPresets = {
  qualityDaily: { granularity: "op_day" as Granularity, lastDays: 14 },
  oeeTurnos: { granularity: "turno" as Granularity, lastDays: 7 },
  cicloDegradacao: { granularity: "hour" as Granularity, lastDays: 3 },
  auditoriaEventos: { granularity: "hour" as Granularity, lastDays: 2 },
}

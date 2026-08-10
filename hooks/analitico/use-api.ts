// hooks/analitico/use-api.ts
"use client"

/**
 * ============================================================
 * HOOK ANALÍTICO — NÍVEL INDUSTRIAL (MES/LIVEMES)
 * v3.1.0 — Hardened client (route.ts + analytics.ts v2.2.x)
 *
 * CONTRATO:
 *   hook → /api/db/analitico → route.ts → analytics.ts → SQL Server
 *
 * OBS IMPORTANTE:
 *   Erros como "Invalid column name 'corrida_id'" são do SQL/DB (analytics.ts),
 *   não do hook. Aqui nós:
 *     - normalizamos filtros (evita filtros “não baterem”)
 *     - evitamos enviar parâmetros “enganosos” (empresaId)
 *     - damos tratamento robusto de erro e retry opcional
 * ============================================================
 */

import useSWR from "swr"

/* ═══════════════════════════════════════════════════════════════
 * TIPOS: ABAS
 * ═══════════════════════════════════════════════════════════════ */

export type AnalyticsTab =
  | "oee"
  | "producao"
  | "paradas"
  | "refugo"
  | "retrabalho"
  | "ciclo"
  | "perdas"
  | "pessoas"

/** Granularidades aceitas pela UI (backend atual agrega por turno) */
export type Granularity = "hour" | "turno" | "op_day" | "Semana" | "Mês"

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  hour: "Hora",
  turno: "Turno",
  op_day: "Dia Operacional",
  Semana: "Semana",
  Mês: "Mês",
}

export const GRANULARITY_OPTIONS: Granularity[] = ["hour", "turno", "op_day", "Semana", "Mês"]

/* ═══════════════════════════════════════════════════════════════
 * TIPOS: FILTROS
 * ═══════════════════════════════════════════════════════════════ */

export interface AnalyticsFilters {
  startUtc: string | Date
  endUtc: string | Date

  centroTrabalhoId?: string
  setorId?: string
  plantaId?: string
  turnoId?: string
  produtoId?: string
  ordemId?: string
  motivoId?: string
  /** Ex: "AVAILABILITY" | "PERFORMANCE" | "QUALITY" */
  motivoGrupoPerda?: string
  /** true = planejada; false = não-planejada; undefined = todos */
  isMotivoPlayground?: boolean

  /** Multi-tenant opcional (route.ts normalmente resolve por tenant/header/cookie) */
  empresaId?: string

  /** @deprecated */
  inicio_utc?: string | Date
  /** @deprecated */
  fim_utc?: string | Date
  /** @deprecated */
  centro_trabalho_id?: string
  /** @deprecated */
  turno_id?: string
  /** @deprecated */
  produto_id?: string
  /** @deprecated */
  ordem_id?: string
  /** @deprecated */
  motivo_id?: string
  /** @deprecated */
  grupo_perda?: string
}

/* ═══════════════════════════════════════════════════════════════
 * TIPOS: ROWS — espelham analytics.ts 1:1
 * ═══════════════════════════════════════════════════════════════ */

export interface OeeRow {
  turno: string
  oee: number
  disponibilidade: number
  performance: number
  qualidade: number
  oee_pct: string
  disp_pct: string
  perf_pct: string
  qual_pct: string
  total_good: number
  total_produzido: number
  tempo_calendario_seg: number
  tempo_planejado_seg: number
  tempo_operacao_seg: number
}

export interface ProducaoRow {
  turno: string
  good: number
  scrap: number
  rework: number
  total_produzido: number
  capacidade: number
  meta: number
  fpy: number | null
  fpy_pct: string
  taxa_refugo: number | null
  taxa_retrabalho: number | null
  ciclo_medio_seg: number | null
  ciclo_ideal_seg: number | null
}

export interface ParadasRow {
  turno: string
  duracao_seg: number
  duracao_fmt: string
  ocorrencias: number
  dur_planejada_seg: number
  dur_nao_planejada_seg: number
  qtd_planejada: number
  qtd_nao_planejada: number
  mttr_seg: number | null
  mttr_fmt: string
  mtbf_seg: number | null
  mtbf_fmt: string
}

export interface RefugoRow {
  turno: string
  refugo: number
  total_produzido: number
  taxa_refugo: number | null
  taxa_pct: string
}

export interface RetrabalhoRow {
  turno: string
  retrabalho: number
  total_produzido: number
  taxa_retrabalho: number | null
  taxa_pct: string
}

export interface CicloRow {
  turno: string
  ciclo_medio_seg: number | null
  ciclo_ideal_seg: number | null
  desvio_seg: number | null
  ciclo_medio_fmt: string
  ciclo_ideal_fmt: string
  total_ciclos: number
}

export interface PerdasRow {
  turno: string
  tempo_perdido_seg: number
  tempo_perdido_fmt: string
  qtd_perdida: number
  scrap: number
  rework: number
  dur_planejada_seg: number
  dur_nao_planejada_seg: number
}

export interface PessoasRow {
  turno: string
  pessoas_ativas: number
  total_interacoes: number
  producao_por_pessoa: number | null
}

/** Uma linha por rebarbador, agregada sobre TODO o período filtrado (ver mode=rebarbadores). */
export interface RebarbadorRankingRow {
  rebarbador_id: string
  rebarbador_nome: string
  registro: string | null
  cargo: string | null
  atuacoes: number
  dur_total_seg: number
  tempo_produzindo_seg: number
  good: number
  scrap: number
  rework: number
  total: number
  parada_seg: number
  parada_plan_seg: number
  parada_nplan_seg: number
  qtd_paradas: number
  pcs_h: number | null
  meta_pcs_h: number | null
  aderencia: number | null
  qualidade: number | null
}

export interface RebarbadoresAnaliticoResult {
  disponivel: boolean
  motivoIndisponivel: string | null
  rows: RebarbadorRankingRow[]
}

export interface ParetoParadasRow {
  motivo_id: string | null
  motivo_codigo: string | null
  motivo_descricao: string | null
  motivo_grupo_perda: string | null
  is_planejada: boolean | null
  duracao_total_seg: number
  quantidade: number
  percentual_duracao: number
  percentual_acumulado: number
}

export type AnyRow =
  | OeeRow
  | ProducaoRow
  | ParadasRow
  | RefugoRow
  | RetrabalhoRow
  | CicloRow
  | PerdasRow
  | PessoasRow

/* ═══════════════════════════════════════════════════════════════
 * SUMMARY / RESULT
 * ═══════════════════════════════════════════════════════════════ */

export interface AnalyticsSummary {
  oee_geral: number | null
  disponibilidade_geral: number | null
  performance_geral: number | null
  qualidade_geral: number | null
  total_good: number
  total_scrap: number
  total_rework: number
  total_produzido: number
  total_paradas_seg: number
  total_ocorrencias: number
}

export interface ChartPoint {
  label: string
  value: number
}

export interface AnalyticsMeta {
  empresaId: string
  startUtc: string
  endUtc: string
  tab: AnalyticsTab
  total: number
}

export interface AnalyticsResult<T = AnyRow> {
  rows: T[]
  chart: ChartPoint[]
  summary: AnalyticsSummary
  meta: AnalyticsMeta
}

/* ═══════════════════════════════════════════════════════════════
 * LOOKUPS
 * ═══════════════════════════════════════════════════════════════ */

export interface CentroTrabalho {
  centro_trabalho_id: string
  codigo: string
  nome: string
  public_id: string
  setor_id: string | null
}

export interface Turno {
  turno_id: string
  nome: string
  public_id: string
  hora_inicio: string
  hora_fim: string
  ordem_exibicao?: number
}

export interface Produto {
  produto_id: string
  codigo: string
  descricao: string
  public_id: string
  ciclo_ideal_seg: number | null
}

export interface MotivoParada {
  motivo_id: string
  codigo: string
  descricao: string
  grupo_perda: string | null
  is_planejada: boolean
  public_id: string
}

export interface OrdemProducao {
  ordem_id: string
  ordem_codigo: string | null
  produto_descricao: string | null
  inicio_utc: string | null
  fim_utc: string | null
}

export interface Setor {
  setor_id: string
  nome: string
  public_id: string
}

export interface LookupsData {
  empresaId?: string
  centros_trabalho?: CentroTrabalho[]
  turnos?: Turno[]
  produtos?: Produto[]
  motivos_parada?: MotivoParada[]
  ordens?: OrdemProducao[]
  setores?: Setor[]
}

/* ═══════════════════════════════════════════════════════════════
 * API RESPONSES
 * ═══════════════════════════════════════════════════════════════ */

export type ApiMode = "dados" | "lookups" | "summary" | "pareto" | "bundle"

interface ApiBase {
  ok: boolean
}

export interface ApiDadosResponse<T = AnyRow> extends ApiBase {
  ok: true
  mode: "dados"
  tab: AnalyticsTab
  filters: AnalyticsFilters
  result: AnalyticsResult<T>
}

export interface ApiLookupsResponse extends ApiBase {
  ok: true
  mode: "lookups"
  data: LookupsData
}

export interface ApiSummaryResponse extends ApiBase {
  ok: true
  mode: "summary"
  filters: AnalyticsFilters
  summary: AnalyticsSummary
}

export interface ApiParetoResponse extends ApiBase {
  ok: true
  mode: "pareto"
  filters: AnalyticsFilters
  topN: number
  rows: ParetoParadasRow[]
}

export interface ApiBundleResponse<T = AnyRow> extends ApiBase {
  ok: true
  mode: "bundle"
  tab: AnalyticsTab
  filters: AnalyticsFilters
  lookups: LookupsData
  summary: AnalyticsSummary
  result: AnalyticsResult<T>
  pareto: { topN: number; rows: ParetoParadasRow[] } | null
}

export interface ApiErrorResponse extends ApiBase {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export type ApiResponse<T = AnyRow> =
  | ApiDadosResponse<T>
  | ApiLookupsResponse
  | ApiSummaryResponse
  | ApiParetoResponse
  | ApiBundleResponse<T>
  | ApiErrorResponse

/* ═══════════════════════════════════════════════════════════════
 * CONFIG
 * ═══════════════════════════════════════════════════════════════ */

const API_BASE = "/api/db/analitico"

/**
 * route.ts normalmente resolve empresaId por tenant/header/cookie.
 * Enviar empresaId no querystring pode ser enganoso.
 * Se você realmente precisar (impersonation / admin), set true.
 */
const ALLOW_EMPRESA_ID_IN_QUERYSTRING = false

/* ═══════════════════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════════════════ */

function toISO(d: string | Date | null | undefined): string {
  if (!d) throw new Error("Data obrigatória (null/undefined)")
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) throw new Error("Date inválido (NaN)")
    return d.toISOString()
  }
  const s = String(d).trim()
  if (!s) throw new Error("Data vazia")
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) throw new Error(`Data inválida: "${s}"`)
  return dt.toISOString()
}

function normId(v: unknown): string | undefined {
  const s = String(v ?? "").trim()
  return s ? s : undefined
}

/** Normaliza enum textual (ex.: motivoGrupoPerda) */
function normEnumUpper(v: unknown): string | undefined {
  const s = String(v ?? "").trim()
  return s ? s.toUpperCase() : undefined
}

/** Resolve aliases legados → nomes canônicos + normalizações */
function resolveFilters(f: AnalyticsFilters): {
  startUtc: string
  endUtc: string
  centroTrabalhoId?: string
  setorId?: string
  plantaId?: string
  turnoId?: string
  produtoId?: string
  ordemId?: string
  motivoId?: string
  motivoGrupoPerda?: string
  isMotivoPlayground?: boolean
  empresaId?: string
} {
  const rawStart = f.startUtc ?? f.inicio_utc
  const rawEnd = f.endUtc ?? f.fim_utc

  const resolvedEmpresaId = normId(f.empresaId)

  return {
    startUtc: toISO(rawStart),
    endUtc: toISO(rawEnd),

    centroTrabalhoId: normId(f.centroTrabalhoId ?? f.centro_trabalho_id),
    setorId: normId(f.setorId),
    plantaId: normId(f.plantaId),
    turnoId: normId(f.turnoId ?? f.turno_id),
    produtoId: normId(f.produtoId ?? f.produto_id),
    ordemId: normId(f.ordemId ?? f.ordem_id),
    motivoId: normId(f.motivoId ?? f.motivo_id),

    // IMPORTANTÍSSIMO: backend costuma comparar com catálogo (uppercase)
    motivoGrupoPerda: normEnumUpper(f.motivoGrupoPerda ?? f.grupo_perda),

    isMotivoPlayground: typeof f.isMotivoPlayground === "boolean" ? f.isMotivoPlayground : undefined,

    empresaId: resolvedEmpresaId,
  }
}

/** QS com apenas valores válidos */
function buildQS(params: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    if (typeof v === "string" && !v.trim()) continue
    sp.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v))
  }
  return sp
}

/** Cria string de query estável (ordena por chave) */
function stableQS(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v != null && !(typeof v === "string" && !v.trim()))
    .sort(([a], [b]) => a.localeCompare(b))

  const sp = new URLSearchParams()
  for (const [k, v] of entries) {
    sp.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v))
  }
  return sp.toString()
}

function buildFiltersParams(
  resolved: ReturnType<typeof resolveFilters>,
  tab: AnalyticsTab,
  granularity: Granularity
): Record<string, string | number | boolean | null | undefined> {
  return {
    tab,
    granularity,
    startUtc: resolved.startUtc,
    endUtc: resolved.endUtc,

    centroTrabalhoId: resolved.centroTrabalhoId,
    setorId: resolved.setorId,
    plantaId: resolved.plantaId,
    turnoId: resolved.turnoId,
    produtoId: resolved.produtoId,
    ordemId: resolved.ordemId,
    motivoId: resolved.motivoId,
    motivoGrupoPerda: resolved.motivoGrupoPerda,
    isMotivoPlayground: resolved.isMotivoPlayground,

    // por padrão, NÃO enviamos empresaId (route.ts resolve por tenant)
    empresaId: ALLOW_EMPRESA_ID_IN_QUERYSTRING ? resolved.empresaId : undefined,
  }
}

/* ─────────────────────────────────────────────────────────────
 * fetcher tipado (robusto)
 * ───────────────────────────────────────────────────────────── */

async function fetcher<T = AnyRow>(url: string): Promise<ApiResponse<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    })
  } catch (e: any) {
    return { ok: false, error: { code: "NETWORK_ERROR", message: `Falha de rede: ${e?.message ?? "desconhecido"}` } }
  }

  const text = await res.text().catch(() => "")
  let data: any = null
  try {
    if (text) data = JSON.parse(text)
  } catch {
    // Se backend devolver HTML/plain, converte para erro estruturado
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: `HTTP_${res.status}`,
          message: text?.slice(0, 200) || `HTTP ${res.status}`,
          details: { raw: text?.slice(0, 5000) },
        },
      }
    }
  }

  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`
    return {
      ok: false,
      error: {
        code: data?.error?.code ?? `HTTP_${res.status}`,
        message: msg,
        details: data?.error?.details ?? data,
      },
    }
  }

  // Quando res.ok mas payload inesperado:
  if (!data || typeof data !== "object" || typeof data.ok !== "boolean") {
    return {
      ok: false,
      error: { code: "BAD_PAYLOAD", message: "Resposta inválida da API", details: { raw: data ?? text } },
    }
  }

  return data as ApiResponse<T>
}

/* ─────────────────────────────────────────────────────────────
 * Heurística simples: alguns erros são “conhecidos” (SQL/schema)
 * ───────────────────────────────────────────────────────────── */

function isRetryableApiError(err: ApiErrorResponse | null | undefined): boolean {
  const msg = err?.error?.message?.toLowerCase?.() ?? ""
  const code = err?.error?.code ?? ""
  // retry só pra erros transitórios; NÃO para erro de coluna inexistente (SQL)
  if (code === "NETWORK_ERROR") return true
  if (code.startsWith("HTTP_5")) return true
  if (msg.includes("timeout") || msg.includes("deadlock")) return true
  if (msg.includes("invalid column name")) return false
  return false
}

/* ═══════════════════════════════════════════════════════════════
 * HOOK PRINCIPAL — useAnalitico
 * ═══════════════════════════════════════════════════════════════ */

export interface UseAnaliticoArgs {
  tab: AnalyticsTab
  filters: AnalyticsFilters
  granularity?: Granularity
  enabled?: boolean
  refreshInterval?: number
  dedupingInterval?: number

  /** retry 1x em erro transitório */
  retryOnceOnTransientError?: boolean
}

export function useAnalitico<TRow = AnyRow>(args: UseAnaliticoArgs) {
  const {
    tab,
    filters,
    granularity = "op_day",
    enabled = true,
    refreshInterval = 0,
    dedupingInterval = 5_000,
    retryOnceOnTransientError = true,
  } = args

  let resolved: ReturnType<typeof resolveFilters> | null = null
  let resolveError: string | null = null

  if (enabled) {
    try {
      resolved = resolveFilters(filters)
    } catch (e: any) {
      resolveError = e?.message ?? "Filtros inválidos"
    }
  }

  const qs = resolved ? stableQS({ mode: "dados", ...buildFiltersParams(resolved, tab, granularity) }) : null
  const url = qs ? `${API_BASE}?${qs}` : null

  const { data, error: swrError, isLoading, mutate } = useSWR<ApiResponse<TRow>>(
    url,
    fetcher<TRow>,
    {
      revalidateOnFocus: false,
      dedupingInterval,
      refreshInterval,
      onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
        // SWR error = fetcher throw; nosso fetcher não lança, mas deixo blindado
        if (!retryOnceOnTransientError) return
        if (retryCount >= 1) return
        setTimeout(() => revalidate({ retryCount }), 800)
      },
    }
  )

  const apiError = data && !data.ok ? (data as ApiErrorResponse) : null

  const error: Error | null =
    resolveError
      ? new Error(resolveError)
      : swrError instanceof Error
        ? swrError
        : swrError
          ? new Error(String(swrError))
          : apiError
            ? new Error(apiError.error?.message ?? "Erro na API")
            : null

  const apiErrorCode = apiError?.error?.code ?? null
  const apiErrorDetails = apiError?.error?.details ?? null

  // Retry manual (1x) em erros transitórios (se desejado)
  async function refresh() {
    // Se for erro transitório, tenta 1 revalidate extra
    if (retryOnceOnTransientError && isRetryableApiError(apiError)) {
      await mutate()
      return
    }
    await mutate()
  }

  const success =
    data && data.ok && (data as any).mode === "dados"
      ? (data as ApiDadosResponse<TRow>)
      : null

  const result: AnalyticsResult<TRow> | null = success?.result ?? null

  return {
    // ── Dados ────────────────────────────────────────────────
    result,
    rows: (result?.rows ?? []) as TRow[],
    chart: (result?.chart ?? []) as ChartPoint[],
    summary: (result?.summary ?? null) as AnalyticsSummary | null,
    meta: (result?.meta ?? null) as AnalyticsMeta | null,

    // ── Estado ────────────────────────────────────────────────
    isLoading,
    error,
    refresh,

    // ── Erro estruturado (pra UI/telemetria) ──────────────────
    isApiError: !!apiError,
    apiError,
    apiErrorCode,
    apiErrorDetails,

    // útil pra UI mostrar “vazio por falha” vs “vazio real”
    isEmptyBecauseError: !!apiError && !(result?.rows?.length),

    // ── Debug ────────────────────────────────────────────────
    url,
    raw: data,
  }
}

/* ═══════════════════════════════════════════════════════════════
 * LOOKUPS — useAnaliticoLookups
 * ═══════════════════════════════════════════════════════════════ */

export type LookupKey = "centros" | "turnos" | "produtos" | "motivos" | "ordens" | "setores"

export interface UseAnaliticoLookupsArgs {
  include?: LookupKey[]
  limitOrdens?: number
  setorId?: string
  startUtc?: string | Date
  endUtc?: string | Date
  empresaId?: string
  enabled?: boolean
  refreshInterval?: number
}

export function useAnaliticoLookups(args: UseAnaliticoLookupsArgs = {}) {
  const {
    include = ["centros", "turnos", "produtos", "motivos", "ordens", "setores"],
    limitOrdens = 300,
    setorId,
    startUtc,
    endUtc,
    empresaId,
    enabled = true,
    refreshInterval = 60_000,
  } = args

  const params = {
    mode: "lookups",
    include: include.join(","),
    limit: limitOrdens,
    setorId: normId(setorId),
    startUtc: startUtc ? toISO(startUtc) : undefined,
    endUtc: endUtc ? toISO(endUtc) : undefined,
    empresaId: ALLOW_EMPRESA_ID_IN_QUERYSTRING ? normId(empresaId) : undefined,
  }

  const url = enabled ? `${API_BASE}?${stableQS(params)}` : null

  const { data, error: swrError, isLoading, mutate } = useSWR<ApiResponse<never>>(
    url,
    fetcher<never>,
    { revalidateOnFocus: false, dedupingInterval: 30_000, refreshInterval }
  )

  const apiError = data && !data.ok ? (data as ApiErrorResponse) : null

  const error: Error | null =
    swrError instanceof Error
      ? swrError
      : swrError
        ? new Error(String(swrError))
        : apiError
          ? new Error(apiError.error?.message ?? "Erro nos lookups")
          : null

  const lookups: LookupsData | null =
    data && data.ok && (data as ApiLookupsResponse).data
      ? (data as ApiLookupsResponse).data
      : null

  return {
    lookups,
    centros: (lookups?.centros_trabalho ?? []) as CentroTrabalho[],
    turnos: (lookups?.turnos ?? []) as Turno[],
    produtos: (lookups?.produtos ?? []) as Produto[],
    motivos: (lookups?.motivos_parada ?? []) as MotivoParada[],
    ordens: (lookups?.ordens ?? []) as OrdemProducao[],
    setores: (lookups?.setores ?? []) as Setor[],
    isLoading,
    error,
    refresh: () => mutate(),
    url,
    raw: data,
    apiError,
  }
}

/* ═══════════════════════════════════════════════════════════════
 * SUMMARY — useAnaliticoSummary
 * ═══════════════════════════════════════════════════════════════ */

export interface UseAnaliticoSummaryArgs {
  filters: AnalyticsFilters
  enabled?: boolean
  refreshInterval?: number
}

export function useAnaliticoSummary(args: UseAnaliticoSummaryArgs) {
  const { filters, enabled = true, refreshInterval = 0 } = args

  let resolved: ReturnType<typeof resolveFilters> | null = null
  let resolveError: string | null = null
  if (enabled) {
    try {
      resolved = resolveFilters(filters)
    } catch (e: any) {
      resolveError = e?.message ?? "Filtros inválidos"
    }
  }

  const params = resolved
    ? {
        mode: "summary",
        startUtc: resolved.startUtc,
        endUtc: resolved.endUtc,
        centroTrabalhoId: resolved.centroTrabalhoId,
        setorId: resolved.setorId,
        plantaId: resolved.plantaId,
        turnoId: resolved.turnoId,
        produtoId: resolved.produtoId,
        ordemId: resolved.ordemId,
        motivoId: resolved.motivoId,
        motivoGrupoPerda: resolved.motivoGrupoPerda,
        isMotivoPlayground: resolved.isMotivoPlayground,
        empresaId: ALLOW_EMPRESA_ID_IN_QUERYSTRING ? resolved.empresaId : undefined,
      }
    : null

  const url = params ? `${API_BASE}?${stableQS(params)}` : null

  const { data, error: swrError, isLoading, mutate } = useSWR<ApiResponse<never>>(
    url,
    fetcher<never>,
    { revalidateOnFocus: false, dedupingInterval: 10_000, refreshInterval }
  )

  const apiError = data && !data.ok ? (data as ApiErrorResponse) : null

  const error: Error | null =
    resolveError
      ? new Error(resolveError)
      : swrError instanceof Error
        ? swrError
        : swrError
          ? new Error(String(swrError))
          : apiError
            ? new Error(apiError.error?.message ?? "Erro no summary")
            : null

  const summary: AnalyticsSummary | null =
    data && data.ok && (data as ApiSummaryResponse).summary
      ? (data as ApiSummaryResponse).summary
      : null

  return {
    summary,
    isLoading,
    error,
    refresh: () => mutate(),
    url,
    raw: data,
    apiError,
  }
}

/* ═══════════════════════════════════════════════════════════════
 * PARETO — useParadasPareto
 * ═══════════════════════════════════════════════════════════════ */

export interface UseParadasParetoArgs {
  filters: AnalyticsFilters
  topN?: number
  enabled?: boolean
  refreshInterval?: number
}

export function useParadasPareto(args: UseParadasParetoArgs) {
  const { filters, topN = 10, enabled = true, refreshInterval = 0 } = args

  let resolved: ReturnType<typeof resolveFilters> | null = null
  let resolveError: string | null = null
  if (enabled) {
    try {
      resolved = resolveFilters(filters)
    } catch (e: any) {
      resolveError = e?.message ?? "Filtros inválidos"
    }
  }

  const params = resolved
    ? {
        mode: "pareto",
        topN,
        startUtc: resolved.startUtc,
        endUtc: resolved.endUtc,
        centroTrabalhoId: resolved.centroTrabalhoId,
        setorId: resolved.setorId,
        plantaId: resolved.plantaId,
        turnoId: resolved.turnoId,
        produtoId: resolved.produtoId,
        ordemId: resolved.ordemId,
        motivoId: resolved.motivoId,
        motivoGrupoPerda: resolved.motivoGrupoPerda,
        isMotivoPlayground: resolved.isMotivoPlayground,
        empresaId: ALLOW_EMPRESA_ID_IN_QUERYSTRING ? resolved.empresaId : undefined,
      }
    : null

  const url = params ? `${API_BASE}?${stableQS(params)}` : null

  const { data, error: swrError, isLoading, mutate } = useSWR<ApiResponse<never>>(
    url,
    fetcher<never>,
    { revalidateOnFocus: false, dedupingInterval: 5_000, refreshInterval }
  )

  const apiError = data && !data.ok ? (data as ApiErrorResponse) : null

  const error: Error | null =
    resolveError
      ? new Error(resolveError)
      : swrError instanceof Error
        ? swrError
        : swrError
          ? new Error(String(swrError))
          : apiError
            ? new Error(apiError.error?.message ?? "Erro no pareto")
            : null

  const rows: ParetoParadasRow[] =
    data && data.ok && (data as ApiParetoResponse).rows
      ? (data as ApiParetoResponse).rows
      : []

  return {
    rows,
    isLoading,
    error,
    refresh: () => mutate(),
    url,
    raw: data,
    apiError,
  }
}

/* ═══════════════════════════════════════════════════════════════
 * BUNDLE — useAnaliticoBundle
 * ═══════════════════════════════════════════════════════════════ */

export interface UseAnaliticoBundleArgs {
  tab: AnalyticsTab
  filters: AnalyticsFilters
  granularity?: Granularity
  include?: LookupKey[]
  withPareto?: boolean
  paretoTopN?: number
  enabled?: boolean
  refreshInterval?: number
}

export function useAnaliticoBundle<TRow = AnyRow>(args: UseAnaliticoBundleArgs) {
  const {
    tab,
    filters,
    granularity = "op_day",
    include = ["centros", "turnos", "produtos", "motivos", "ordens", "setores"],
    withPareto = false,
    paretoTopN = 10,
    enabled = true,
    refreshInterval = 0,
  } = args

  let resolved: ReturnType<typeof resolveFilters> | null = null
  let resolveError: string | null = null
  if (enabled) {
    try {
      resolved = resolveFilters(filters)
    } catch (e: any) {
      resolveError = e?.message ?? "Filtros inválidos"
    }
  }

  const params = resolved
    ? {
        mode: "bundle",
        tab,
        granularity,
        include: include.join(","),
        pareto: withPareto ? "1" : "0",
        topN: paretoTopN,

        startUtc: resolved.startUtc,
        endUtc: resolved.endUtc,
        centroTrabalhoId: resolved.centroTrabalhoId,
        setorId: resolved.setorId,
        plantaId: resolved.plantaId,
        turnoId: resolved.turnoId,
        produtoId: resolved.produtoId,
        ordemId: resolved.ordemId,
        motivoId: resolved.motivoId,
        motivoGrupoPerda: resolved.motivoGrupoPerda,
        isMotivoPlayground: resolved.isMotivoPlayground,
        empresaId: ALLOW_EMPRESA_ID_IN_QUERYSTRING ? resolved.empresaId : undefined,
      }
    : null

  const url = params ? `${API_BASE}?${stableQS(params)}` : null

  const { data, error: swrError, isLoading, mutate } = useSWR<ApiResponse<TRow>>(
    url,
    fetcher<TRow>,
    { revalidateOnFocus: false, dedupingInterval: 5_000, refreshInterval }
  )

  const apiError = data && !data.ok ? (data as ApiErrorResponse) : null

  const error: Error | null =
    resolveError
      ? new Error(resolveError)
      : swrError instanceof Error
        ? swrError
        : swrError
          ? new Error(String(swrError))
          : apiError
            ? new Error(apiError.error?.message ?? "Erro no bundle")
            : null

  const bundle =
    data && data.ok && (data as any).mode === "bundle"
      ? (data as ApiBundleResponse<TRow>)
      : null

  return {
    result: (bundle?.result ?? null) as AnalyticsResult<TRow> | null,
    rows: (bundle?.result?.rows ?? []) as TRow[],
    chart: (bundle?.result?.chart ?? []) as ChartPoint[],
    summary: (bundle?.summary ?? null) as AnalyticsSummary | null,

    lookups: (bundle?.lookups ?? null) as LookupsData | null,
    centros: (bundle?.lookups?.centros_trabalho ?? []) as CentroTrabalho[],
    turnos: (bundle?.lookups?.turnos ?? []) as Turno[],
    produtos: (bundle?.lookups?.produtos ?? []) as Produto[],
    motivos: (bundle?.lookups?.motivos_parada ?? []) as MotivoParada[],
    ordens: (bundle?.lookups?.ordens ?? []) as OrdemProducao[],
    setores: (bundle?.lookups?.setores ?? []) as Setor[],

    paretoRows: (bundle?.pareto?.rows ?? []) as ParetoParadasRow[],

    isLoading,
    error,
    refresh: () => mutate(),

    // erro estruturado
    apiError,
    apiErrorCode: apiError?.error?.code ?? null,
    apiErrorDetails: apiError?.error?.details ?? null,

    url,
    raw: data,
  }
}

/* ═══════════════════════════════════════════════════════════════
 * HOOKS ESPECIALIZADOS POR ABA
 * ═══════════════════════════════════════════════════════════════ */

export function useOee(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<OeeRow>({ ...opts, tab: "oee", filters })
}
export function useProducao(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<ProducaoRow>({ ...opts, tab: "producao", filters })
}
export function useParadas(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<ParadasRow>({ ...opts, tab: "paradas", filters })
}
export function useRefugo(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<RefugoRow>({ ...opts, tab: "refugo", filters })
}
export function useRetrabalho(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<RetrabalhoRow>({ ...opts, tab: "retrabalho", filters })
}
export function useCiclo(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<CicloRow>({ ...opts, tab: "ciclo", filters })
}
export function usePerdas(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<PerdasRow>({ ...opts, tab: "perdas", filters })
}
export function usePessoas(filters: AnalyticsFilters, opts?: Partial<UseAnaliticoArgs>) {
  return useAnalitico<PessoasRow>({ ...opts, tab: "pessoas", filters })
}

/* ═══════════════════════════════════════════════════════════════
 * REBARBADORES — ranking + eficiência x parada (mode=rebarbadores)
 *
 * Diferente dos demais hooks: não é por turno (uma linha por rebarbador,
 * agregada sobre TODO o período filtrado) — por isso não usa
 * useAnalitico<T>/AnalyticsResult (que é sempre por turno).
 * ═══════════════════════════════════════════════════════════════ */

export interface UseRebarbadoresRankingArgs {
  filters: AnalyticsFilters
  enabled?: boolean
  refreshInterval?: number
  dedupingInterval?: number
}

interface ApiRebarbadoresResponse {
  ok: true
  mode: "rebarbadores"
  filters: AnalyticsFilters
  result: RebarbadoresAnaliticoResult
}

export function useRebarbadoresRanking(args: UseRebarbadoresRankingArgs) {
  const { filters, enabled = true, refreshInterval = 0, dedupingInterval = 10_000 } = args

  let resolved: ReturnType<typeof resolveFilters> | null = null
  let resolveError: string | null = null
  if (enabled) {
    try {
      resolved = resolveFilters(filters)
    } catch (e: any) {
      resolveError = e?.message ?? "Filtros inválidos"
    }
  }

  const params = resolved
    ? {
        mode: "rebarbadores",
        startUtc: resolved.startUtc,
        endUtc: resolved.endUtc,
        centroTrabalhoId: resolved.centroTrabalhoId,
        setorId: resolved.setorId,
        plantaId: resolved.plantaId,
        turnoId: resolved.turnoId,
        produtoId: resolved.produtoId,
        ordemId: resolved.ordemId,
        empresaId: ALLOW_EMPRESA_ID_IN_QUERYSTRING ? resolved.empresaId : undefined,
      }
    : null

  const url = params ? `${API_BASE}?${stableQS(params)}` : null

  const { data, error: swrError, isLoading, mutate } = useSWR<ApiResponse<never> | ApiRebarbadoresResponse>(
    url,
    fetcher as any,
    { revalidateOnFocus: false, dedupingInterval, refreshInterval }
  )

  const apiError = data && !data.ok ? (data as ApiErrorResponse) : null

  const error: Error | null =
    resolveError
      ? new Error(resolveError)
      : swrError instanceof Error
        ? swrError
        : swrError
          ? new Error(String(swrError))
          : apiError
            ? new Error(apiError.error?.message ?? "Erro ao buscar rebarbadores")
            : null

  const result: RebarbadoresAnaliticoResult | null =
    data && data.ok && (data as any).mode === "rebarbadores"
      ? (data as ApiRebarbadoresResponse).result
      : null

  return {
    rows: (result?.rows ?? []) as RebarbadorRankingRow[],
    // disponivel=true por padrão (ainda sem resposta) — evita mostrar o
    // aviso de "migração pendente" precocemente durante o loading.
    disponivel: result ? Boolean(result.disponivel) : true,
    motivoIndisponivel: (result?.motivoIndisponivel ?? null) as string | null,

    isLoading,
    error,
    refresh: () => mutate(),

    isApiError: !!apiError,
    apiError,

    url,
    raw: data,
  }
}

/* ═══════════════════════════════════════════════════════════════
 * UTILITÁRIO: chartSeriesFromResult
 * ═══════════════════════════════════════════════════════════════ */

function hhmmToSec(s: string): number {
  const m = String(s ?? "").match(/^(-?\d+):(\d{2})$/)
  if (!m) return 0
  const h = parseInt(m[1], 10),
    min = parseInt(m[2], 10)
  return h * 3600 + min * 60
}

function hhmmssToSec(s: string): number {
  const m = String(s ?? "").match(/^(-?\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/)
  if (!m) return 0
  const h = parseInt(m[1], 10)
  const mn = parseInt(m[2], 10)
  const sc = parseInt(m[3], 10)
  const ms = m[4] ? parseInt(m[4].padEnd(3, "0"), 10) : 0
  return h * 3600 + mn * 60 + sc + ms / 1000
}

export function chartSeriesFromResult<TRow extends Record<string, any>>(params: {
  result: AnalyticsResult<TRow> | null
  metricKey: string
  labelKey?: string
}): { labels: string[]; values: number[] } {
  const { result, metricKey, labelKey = "turno" } = params
  if (!result?.rows?.length) return { labels: [], values: [] }

  const labels = result.rows.map((r) => String(r[labelKey] ?? "—"))

  const values = result.rows.map((r) => {
    const raw = r[metricKey]
    if (typeof raw === "number") return raw
    if (typeof raw !== "string" || !raw) return 0

    if (/^\d+:\d{2}:\d{2}/.test(raw)) return hhmmssToSec(raw)
    if (/^\d+:\d{2}$/.test(raw)) return hhmmToSec(raw)
    if (raw.endsWith("%")) return parseFloat(raw.replace(",", ".").replace("%", "")) || 0
    return parseFloat(raw.replace(",", ".")) || 0
  })

  return { labels, values }
}

/* ═══════════════════════════════════════════════════════════════
 * FORMATADORES
 * ═══════════════════════════════════════════════════════════════ */

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export function formatSec(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return "0:00:00"
  const s = Math.round(secs)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${hh}:${pad(mm)}:${pad(ss)}`
}

export function formatSecHHMM(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return "0:00"
  const s = Math.round(secs)
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`
}

export function formatPct(v: number | null | undefined, decimals = 2, isRaw = false): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const pct = isRaw ? v : v * 100
  return `${pct.toFixed(decimals).replace(".", ",")}%`
}

export function formatNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatOee(v: number | null | undefined): string {
  return formatPct(v, 2, false)
}

export function oeeColor(v: number | null | undefined): "green" | "yellow" | "red" | "gray" {
  if (v == null || !Number.isFinite(v)) return "gray"
  if (v >= 0.85) return "green"
  if (v >= 0.65) return "yellow"
  return "red"
}

/* ═══════════════════════════════════════════════════════════════
 * MÉTRICAS POR ABA
 * ═══════════════════════════════════════════════════════════════ */

export interface MetricOption {
  key: string
  label: string
  unit?: string
}

export const METRICS_BY_TAB: Record<AnalyticsTab, MetricOption[]> = {
  oee: [
    { key: "oee", label: "OEE (%)", unit: "%" },
    { key: "disponibilidade", label: "Disponibilidade (%)", unit: "%" },
    { key: "performance", label: "Performance (%)", unit: "%" },
    { key: "qualidade", label: "Qualidade (%)", unit: "%" },
  ],
  producao: [
    { key: "good", label: "Good (UN)", unit: "UN" },
    { key: "scrap", label: "Scrap (UN)", unit: "UN" },
    { key: "rework", label: "Retrabalho (UN)", unit: "UN" },
    { key: "capacidade", label: "Capacidade (UN)", unit: "UN" },
    { key: "meta", label: "Meta (UN)", unit: "UN" },
    { key: "fpy", label: "FPY (%)", unit: "%" },
    { key: "total_produzido", label: "Total Produzido", unit: "UN" },
  ],
  paradas: [
    { key: "duracao_seg", label: "Duração Total (s)", unit: "s" },
    { key: "dur_planejada_seg", label: "Dur. Planejada (s)", unit: "s" },
    { key: "dur_nao_planejada_seg", label: "Dur. Não-planejada (s)", unit: "s" },
    { key: "ocorrencias", label: "Ocorrências", unit: "UN" },
    { key: "mttr_seg", label: "MTTR (s)", unit: "s" },
    { key: "mtbf_seg", label: "MTBF (s)", unit: "s" },
  ],
  refugo: [
    { key: "refugo", label: "Qtd. Refugo (UN)", unit: "UN" },
    { key: "taxa_refugo", label: "Taxa Refugo (%)", unit: "%" },
    { key: "total_produzido", label: "Total Produzido", unit: "UN" },
  ],
  retrabalho: [
    { key: "retrabalho", label: "Qtd. Retrabalho (UN)", unit: "UN" },
    { key: "taxa_retrabalho", label: "Taxa Retrabalho (%)", unit: "%" },
    { key: "total_produzido", label: "Total Produzido", unit: "UN" },
  ],
  ciclo: [
    { key: "ciclo_medio_seg", label: "Ciclo Médio (s)", unit: "s" },
    { key: "ciclo_ideal_seg", label: "Ciclo Ideal (s)", unit: "s" },
    { key: "desvio_seg", label: "Desvio (s)", unit: "s" },
    { key: "total_ciclos", label: "Total Ciclos", unit: "UN" },
  ],
  perdas: [
    { key: "tempo_perdido_seg", label: "Tempo Perdido (s)", unit: "s" },
    { key: "qtd_perdida", label: "Qtd. Perdida (UN)", unit: "UN" },
    { key: "dur_planejada_seg", label: "Par. Planejadas (s)", unit: "s" },
    { key: "dur_nao_planejada_seg", label: "Par. Não-planejadas (s)", unit: "s" },
    { key: "scrap", label: "Scrap (UN)", unit: "UN" },
    { key: "rework", label: "Retrabalho (UN)", unit: "UN" },
  ],
  pessoas: [
    { key: "pessoas_ativas", label: "Pessoas Ativas", unit: "UN" },
    { key: "total_interacoes", label: "Total Interações", unit: "UN" },
    { key: "producao_por_pessoa", label: "Produção / Pessoa", unit: "UN" },
  ],
}

/** @deprecated */
export type LegacyAnalyticsFilters = AnalyticsFilters
/** @deprecated */
export type AnalyticsRow = AnyRow
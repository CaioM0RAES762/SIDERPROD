"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { EMPRESA_ID as DEMO_EMPRESA_ID } from "@/lib/demo/catalog"

/* ---------------------------------------------------------------
 * TIPOS  espelho exato de lib/db/services/relatorio.ts v4.0.0
 * --------------------------------------------------------------- */

// -- [1] Produção Hora-a-Hora ---------------------------------
export type ProducaoHoraItem = {
  label:           string
  hora_utc:        number
  value:           number
  target:          number
  ciclo_medio_seg: number | null
}

// -- [2] Produção Diária --------------------------------------
export type ProducaoDiaBreakdownCt = {
  centro_trabalho_id: string
  ct_codigo:          string
  ct_nome:            string | null
  good:               number
}

export type ProducaoDiaItem = {
  label:           string
  dia_utc:         string
  value:           number
  capacidade:      number
  ciclo_medio_seg: number | null
  breakdown:       ProducaoDiaBreakdownCt[]
}

// -- [3] OEE --------------------------------------------------
export type RelatorioOeeResult = {
  oee_pct:              number
  disponibilidade_pct:  number
  performance_pct:      number
  qualidade_pct:        number
  oee_fmt:              string
  disp_fmt:             string
  perf_fmt:             string
  qual_fmt:             string
  meta_pct:             number
  tempo_calendario_seg:  number
  tempo_planejado_seg:   number
  tempo_operacao_seg:    number
  planned_stop_seg:      number
  unplanned_stop_seg:    number
  run_time_seg:          number
  ideal_time_seg:        number
  total_good:            number
  total_scrap:           number
  total_rework:          number
  total_produzido:       number
  media_pessoas_turno:          number | null
  producao_boa_por_pessoa_hora: number | null
  taxa_producao_hora:           number | null
  ciclo_ideal_medio_seg:        number | null
}

// -- [4] Gráfico de Perdas ------------------------------------
export type ColorHint =
  | "planejado"
  | "disponibilidade"
  | "performance"
  | "qualidade"
  | "efetivo"

export type GraficoPerdaItem = {
  name:            string
  disponibilidade: number
  performance:     number
  qualidade:       number
  hours:           number
  motivo_id:       string | null
  is_planejada:    boolean | null
  grupo_perda:     string | null
  color_hint:      ColorHint
}

export type GraficoPerdaTabelaRow = {
  motivo_id:       string | null
  name:            string
  disponibilidade: number | null
  performance:     number | null
  qualidade:       number | null
  hours:           number
  grupo_perda:     string | null
  is_planejada:    boolean | null
  color_hint:      string
}

export type GraficoPerdaResult = {
  items:        GraficoPerdaItem[]
  tabela:       GraficoPerdaTabelaRow[]
  planejado_un: number
  efetivo_un:   number
  total_disp:   number
  total_perf:   number
  total_qual:   number
}

// -- [5A] Paradas Reportadas ----------------------------------
export type ParadaReportada = {
  parada_id:          string
  motivo_id:          string | null
  motivo_descricao:   string
  motivo_codigo:      string | null
  is_planejada:       boolean | null
  grupo_perda:        string | null
  centro_trabalho_id: string
  ct_codigo:          string | null
  ct_nome:            string | null
  equipamento:        string | null
  inicio_utc:         string
  fim_utc:            string | null
  duracao_seg:        number
  duracao_fmt:        string
}

// -- [5B] Paradas Pareto --------------------------------------
export type ParadaMotivoParetoCtBreakdown = {
  centro_trabalho_id: string
  ct_codigo:          string
  ct_nome:            string | null
  duracao_seg:        number
  duracao_fmt:        string
  ocorrencias:        number
}

export type ParadaMotivoParetoItem = {
  motivo_id:         string | null
  motivo_descricao:  string
  motivo_codigo:     string | null
  grupo_perda:       string | null
  is_planejada:      boolean | null
  duracao_total_seg: number
  duracao_total_fmt: string
  ocorrencias:       number
  breakdown_ct:      ParadaMotivoParetoCtBreakdown[]
}

// -- [6] Produção por Ordem -----------------------------------
export type ProducaoPorOrdemItem = {
  produto_id:        string | null
  produto_codigo:    string | null
  produto_descricao: string | null
  ordem_id:          string | null
  ordem_codigo:      string | null
  por_ordem:         number
  por_produto:       number
  scrap:             number
  rework:            number
}

// -- [7] Plano de Ação ----------------------------------------
export type PlanoAcaoSubItem = {
  plano_acao_item_id: string
  o_que:              string
  quem_nome:          string | null
  quando_utc:         string | null
  status:             string
}

export type PlanoAcaoItem = {
  plano_acao_id:         string
  public_id:             string
  titulo:                string
  status:                string
  itens:                 PlanoAcaoSubItem[]
  plano_melhoria_titulo: string | null | undefined
}

// -- [8] Anotações --------------------------------------------
export type AnotacaoItem = {
  anotacao_id:        string
  centro_trabalho_id: string
  ct_codigo:          string | null
  ct_nome:            string | null
  anotacao_time_utc:  string
  texto:              string
  autor_nome:         string | null
}

// -- Resultado consolidado -------------------------------------
export type RelatorioConsolidadoResult = {
  producao_hora:   ProducaoHoraItem[]
  producao_dia:    ProducaoDiaItem[]
  oee:             RelatorioOeeResult
  grafico_perdas:  GraficoPerdaResult
  paradas:         ParadaReportada[]
  paradas_pareto:  ParadaMotivoParetoItem[]
  producao_ordens: ProducaoPorOrdemItem[]
  planos_acao:     PlanoAcaoItem[]
  anotacoes:       AnotacaoItem[]
  meta: {
    empresaId: string
    startUtc:  string
    endUtc:    string
    gerado_em: string
  }
}

// -- Lookups ---------------------------------------------------
export type GrupoCT = {
  setor_id:  string
  nome:      string
  public_id: string
}

export type CentroCT = {
  centro_trabalho_id: string
  codigo:             string
  nome:               string
  public_id:          string
  setor_id:           string | null
}

export type Turno = {
  turno_id:       string
  nome:           string
  public_id:      string
  hora_inicio:    string
  hora_fim:       string
  ordem_exibicao: number
}

export type MotivoParada = {
  motivo_id:    string
  codigo:       string
  descricao:    string
  grupo_perda:  string | null
  is_planejada: boolean
  public_id:    string
}

/* ---------------------------------------------------------------
 * FILTROS
 * --------------------------------------------------------------- */

export interface RelatorioFiltersInput {
  empresaId:           string
  startUtc:            string
  endUtc:              string
  centrosTrabalhoIds?: string[]
  setorIds?:           string[]
  turnoIds?:           string[]
}

/* ---------------------------------------------------------------
 * ? FIX PRINCIPAL  UUID de empresa fixo/correto
 *
 * O hook useEmpresaId estava lendo "1" do localStorage porque
 * a chave armazenada tinha um valor incorreto.
 *
 * Solução:
 *  1. UUID correto definido como EMPRESA_ID_PADRAO.
 *  2. Validação de UUID na leitura do localStorage: se o valor
 *     armazenado não for um UUID válido, usa o padrão.
 *  3. Ao inicializar, persiste o UUID correto no localStorage
 *     para que futuras leituras já encontrem o valor certo.
 * --------------------------------------------------------------- */

// Empresa fictícia da demonstração (única no dataset gerado).
const EMPRESA_ID_PADRAO = DEMO_EMPRESA_ID

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_REGEX.test(v.trim())
}

function readEmpresaIdFromStorage(): string {
  if (typeof window === "undefined") return EMPRESA_ID_PADRAO
  try {
    // Tenta ler de "siderprod_demo_auth" (JSON)
    const raw = localStorage.getItem("siderprod_demo_auth")
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const id = parsed.empresa_id ?? parsed.empresaId
      if (isUuid(id)) return String(id).trim()
    }

    // Tenta ler direto como string (alguns auth providers gravam assim)
    const direct = localStorage.getItem("empresa_id") ?? localStorage.getItem("empresaId")
    if (isUuid(direct)) return String(direct).trim()
  } catch {
    // localStorage pode estar bloqueado (SSR, iframe, etc.)
  }

  // Fallback: UUID correto definido acima
  return EMPRESA_ID_PADRAO
}

function persistEmpresaIdToStorage(id: string): void {
  if (typeof window === "undefined") return
  try {
    const raw  = localStorage.getItem("siderprod_demo_auth") ?? "{}"
    const base = JSON.parse(raw) as Record<string, unknown>
    localStorage.setItem(
      "siderprod_demo_auth",
      JSON.stringify({ ...base, empresa_id: id })
    )
  } catch { /* ignore */ }
}

/* ---------------------------------------------------------------
 * CLIENTE DE API
 * --------------------------------------------------------------- */

const BASE = "/api/db/relatorio"

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

async function apiGet<T>(
  op: string,
  params: Record<string, string | string[] | number | undefined | null>,
  signal?: AbortSignal
): Promise<T> {
  const usp = new URLSearchParams()
  usp.set("op", op)

  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    if (Array.isArray(v)) {
      v.forEach((item) => usp.append(k, String(item)))
    } else {
      usp.set(k, String(v))
    }
  }

  const res = await fetch(`${BASE}?${usp.toString()}`, {
    cache: "no-store",
    credentials: "include",
    signal,
  })

  const contentType = res.headers.get("content-type") ?? ""

  if (!res.ok) {
    const body = contentType.includes("application/json")
      ? JSON.stringify(await res.json()).slice(0, 800)
      : (await res.text()).slice(0, 800)
    throw new Error(`HTTP ${res.status}: ${body}`)
  }

  const json = (await res.json()) as ApiResponse<T>
  if (!json.ok) throw new Error((json as { ok: false; error: string }).error ?? "API error")
  return (json as { ok: true; data: T }).data
}

async function apiPost<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(BASE, {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal,
  })

  const contentType = res.headers.get("content-type") ?? ""

  if (!res.ok) {
    const b = contentType.includes("application/json")
      ? JSON.stringify(await res.json()).slice(0, 800)
      : (await res.text()).slice(0, 800)
    throw new Error(`HTTP ${res.status}: ${b}`)
  }

  const json = (await res.json()) as ApiResponse<T>
  if (!json.ok) throw new Error((json as { ok: false; error: string }).error ?? "API error")
  return (json as { ok: true; data: T }).data
}

function filtersToParams(f: RelatorioFiltersInput): Record<string, string | string[]> {
  const p: Record<string, string | string[]> = {
    empresaId: f.empresaId,
    startUtc:  f.startUtc,
    endUtc:    f.endUtc,
  }
  if (f.centrosTrabalhoIds?.length) p["centrosTrabalhoIds"] = f.centrosTrabalhoIds
  if (f.setorIds?.length)           p["setorIds"]           = f.setorIds
  if (f.turnoIds?.length)           p["turnoIds"]           = f.turnoIds
  return p
}

/* ---------------------------------------------------------------
 * ESTADO GENÉRICO
 * --------------------------------------------------------------- */

type AsyncState<T> = {
  data:    T | null
  loading: boolean
  error:   string | null
}

function initialState<T>(): AsyncState<T> {
  return { data: null, loading: false, error: null }
}

/* ---------------------------------------------------------------
 * HOOK PRINCIPAL  useRelatorioApi
 * --------------------------------------------------------------- */

export interface UseRelatorioApiParams {
  empresaId:           string
  startUtc:            string
  endUtc:              string
  setorIds?:           string[]
  centrosTrabalhoIds?: string[]
  turnoIds?:           string[]
  enabled?: boolean
}

export interface UseRelatorioApiReturn {
  data:    RelatorioConsolidadoResult | null
  loading: boolean
  error:   string | null
  refetch: () => void
  lastFetchedAt: Date | null

  grupos:         GrupoCT[]
  centros:        CentroCT[]
  turnos:         Turno[]
  lookupsLoading: boolean
  lookupsError:   string | null

  producaoHora:   ProducaoHoraItem[]
  producaoDia:    ProducaoDiaItem[]
  oee:            RelatorioOeeResult | null
  graficoPerdas:  GraficoPerdaResult | null
  paradas:        ParadaReportada[]
  paradasPareto:  ParadaMotivoParetoItem[]
  producaoOrdens: ProducaoPorOrdemItem[]
  planosAcao:     PlanoAcaoItem[]
  anotacoes:      AnotacaoItem[]
}

export function useRelatorioApi({
  empresaId,
  startUtc,
  endUtc,
  setorIds,
  centrosTrabalhoIds,
  turnoIds,
  enabled = true,
}: UseRelatorioApiParams): UseRelatorioApiReturn {

  const [reportState,   setReportState]   = useState<AsyncState<RelatorioConsolidadoResult>>(initialState)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)

  const [grupos,  setGrupos]  = useState<GrupoCT[]>([])
  const [centros, setCentros] = useState<CentroCT[]>([])
  const [turnos,  setTurnos]  = useState<Turno[]>([])
  const [lookupsLoading, setLookupsLoading] = useState(false)
  const [lookupsError,   setLookupsError]   = useState<string | null>(null)

  const reportAbortRef  = useRef<AbortController | null>(null)
  const lookupsAbortRef = useRef<AbortController | null>(null)
  const centrosAbortRef = useRef<AbortController | null>(null)

  const setorKey  = useMemo(() => JSON.stringify(setorIds            ?? []), [setorIds])
  const ctKey     = useMemo(() => JSON.stringify(centrosTrabalhoIds  ?? []), [centrosTrabalhoIds])
  const turnoKey  = useMemo(() => JSON.stringify(turnoIds            ?? []), [turnoIds])

  // ? Garante que nunca dispara fetch com empresaId inválido
  const safeEmpresaId = isUuid(empresaId) ? empresaId : ""

  /* -- Fetch consolidado -------------------------------------- */
  const fetchReport = useCallback(async () => {
    if (!safeEmpresaId || !startUtc || !endUtc) return

    reportAbortRef.current?.abort()
    const ctrl = new AbortController()
    reportAbortRef.current = ctrl

    setReportState((s) => ({ ...s, loading: true, error: null }))

    try {
      const result = await apiPost<RelatorioConsolidadoResult>(
        {
          op:      "consolidado",
          filters: {
            empresaId: safeEmpresaId,
            startUtc,
            endUtc,
            ...(centrosTrabalhoIds?.length ? { centrosTrabalhoIds } : {}),
            ...(setorIds?.length           ? { setorIds }           : {}),
            ...(turnoIds?.length           ? { turnoIds }           : {}),
          },
        },
        ctrl.signal
      )

      if (!ctrl.signal.aborted) {
        setReportState({ data: result, loading: false, error: null })
        setLastFetchedAt(new Date())
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") return
      const msg = err instanceof Error ? err.message : "Falha ao carregar relatório."
      if (!ctrl.signal.aborted) {
        setReportState({ data: null, loading: false, error: msg })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeEmpresaId, startUtc, endUtc, setorKey, ctKey, turnoKey])

  useEffect(() => {
    if (!enabled) return
    fetchReport()
    return () => { reportAbortRef.current?.abort() }
  }, [fetchReport, enabled])

  const refetch = useCallback(() => { fetchReport() }, [fetchReport])

  /* -- Lookups: grupos + turnos ------------------------------- */
  useEffect(() => {
    if (!safeEmpresaId) return

    lookupsAbortRef.current?.abort()
    const ctrl = new AbortController()
    lookupsAbortRef.current = ctrl
    let alive = true

    setLookupsLoading(true)
    setLookupsError(null)

    Promise.all([
      apiGet<GrupoCT[]>("lookup-grupos", { empresaId: safeEmpresaId }, ctrl.signal),
      apiGet<Turno[]>("lookup-turnos",   { empresaId: safeEmpresaId }, ctrl.signal),
    ])
      .then(([g, t]) => {
        if (!alive || ctrl.signal.aborted) return
        setGrupos(g)
        setTurnos(t)
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return
        const msg = err instanceof Error ? err.message : "Falha ao carregar filtros."
        if (alive) setLookupsError(msg)
      })
      .finally(() => {
        if (alive && !ctrl.signal.aborted) setLookupsLoading(false)
      })

    return () => { alive = false; ctrl.abort() }
  }, [safeEmpresaId])

  /* -- Lookup: centros ---------------------------------------- */
  useEffect(() => {
    if (!safeEmpresaId) return

    centrosAbortRef.current?.abort()
    const ctrl = new AbortController()
    centrosAbortRef.current = ctrl
    let alive = true

    apiGet<CentroCT[]>(
      "lookup-centros",
      { empresaId: safeEmpresaId, ...(setorIds?.length ? { setorIds } : {}) },
      ctrl.signal
    )
      .then((c) => { if (alive && !ctrl.signal.aborted) setCentros(c) })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return
        console.error("[use-api] centros:", err)
      })

    return () => { alive = false; ctrl.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeEmpresaId, setorKey])

  /* -- Atalhos ----------------------------------------------- */
  const d = reportState.data

  return {
    data:    d,
    loading: reportState.loading,
    error:   reportState.error,
    refetch,
    lastFetchedAt,

    grupos,
    centros,
    turnos,
    lookupsLoading,
    lookupsError,

    producaoHora:   d?.producao_hora   ?? [],
    producaoDia:    d?.producao_dia    ?? [],
    oee:            d?.oee             ?? null,
    graficoPerdas:  d?.grafico_perdas  ?? null,
    paradas:        d?.paradas         ?? [],
    paradasPareto:  d?.paradas_pareto  ?? [],
    producaoOrdens: d?.producao_ordens ?? [],
    planosAcao:     d?.planos_acao     ?? [],
    anotacoes:      d?.anotacoes       ?? [],
  }
}

/* ---------------------------------------------------------------
 * HOOK GRANULAR  useRelatorioSection
 * --------------------------------------------------------------- */

type SectionOp =
  | "producao-hora"
  | "producao-dia"
  | "oee"
  | "grafico-perdas"
  | "paradas"
  | "paradas-pareto"
  | "producao-ordens"
  | "plano-acao"
  | "anotacoes"

type SectionResult<O extends SectionOp> =
  O extends "producao-hora"   ? ProducaoHoraItem[]         :
  O extends "producao-dia"    ? ProducaoDiaItem[]          :
  O extends "oee"             ? RelatorioOeeResult         :
  O extends "grafico-perdas"  ? GraficoPerdaResult         :
  O extends "paradas"         ? ParadaReportada[]          :
  O extends "paradas-pareto"  ? ParadaMotivoParetoItem[]   :
  O extends "producao-ordens" ? ProducaoPorOrdemItem[]     :
  O extends "plano-acao"      ? PlanoAcaoItem[]            :
  O extends "anotacoes"       ? AnotacaoItem[]             :
  never

export interface UseRelatorioSectionParams<O extends SectionOp> {
  op:       O
  filters:  RelatorioFiltersInput
  topN?:    number
  enabled?: boolean
}

export interface UseRelatorioSectionReturn<O extends SectionOp> {
  data:    SectionResult<O> | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function useRelatorioSection<O extends SectionOp>({
  op,
  filters,
  topN,
  enabled = true,
}: UseRelatorioSectionParams<O>): UseRelatorioSectionReturn<O> {
  const [state, setState] = useState<AsyncState<SectionResult<O>>>(initialState)
  const abortRef = useRef<AbortController | null>(null)

  const filtersKey = useMemo(
    () => JSON.stringify(filtersToParams(filters)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.empresaId,
      filters.startUtc,
      filters.endUtc,
      JSON.stringify(filters.centrosTrabalhoIds ?? []),
      JSON.stringify(filters.setorIds ?? []),
      JSON.stringify(filters.turnoIds ?? []),
    ]
  )

  const safeEmpresaId = isUuid(filters.empresaId) ? filters.empresaId : ""

  const fetchSection = useCallback(async () => {
    if (!safeEmpresaId || !filters.startUtc || !filters.endUtc) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setState((s) => ({ ...s, loading: true, error: null }))

    try {
      const params: Record<string, string | string[]> = {
        ...filtersToParams({ ...filters, empresaId: safeEmpresaId }),
        ...(topN != null ? { topN: String(topN) } : {}),
      }

      const result = await apiGet<SectionResult<O>>(op, params, ctrl.signal)

      if (!ctrl.signal.aborted) {
        setState({ data: result, loading: false, error: null })
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") return
      const msg = err instanceof Error ? err.message : "Erro desconhecido."
      if (!ctrl.signal.aborted) {
        setState({ data: null, loading: false, error: msg })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, filtersKey, topN, safeEmpresaId])

  useEffect(() => {
    if (!enabled) return
    fetchSection()
    return () => { abortRef.current?.abort() }
  }, [fetchSection, enabled])

  const refetch = useCallback(() => { fetchSection() }, [fetchSection])

  return { data: state.data, loading: state.loading, error: state.error, refetch }
}

/* ---------------------------------------------------------------
 * HOOK  useMotivosFiltro
 * --------------------------------------------------------------- */

export function useMotivosFiltro(empresaId: string) {
  const [motivos, setMotivos] = useState<MotivoParada[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const safeId = isUuid(empresaId) ? empresaId : ""

  useEffect(() => {
    if (!safeId) return
    let alive = true
    const ctrl = new AbortController()
    setLoading(true)

    apiGet<MotivoParada[]>("lookup-motivos", { empresaId: safeId }, ctrl.signal)
      .then((m) => { if (alive) setMotivos(m) })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return
        if (alive) setError(err instanceof Error ? err.message : "Erro")
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false; ctrl.abort() }
  }, [safeId])

  return { motivos, loading, error }
}

/* ---------------------------------------------------------------
 * UTILITÁRIOS DERIVADOS
 * --------------------------------------------------------------- */

export function totalProducaoHora(items: ProducaoHoraItem[]): number {
  return items.reduce((s, i) => s + i.value, 0)
}

export function totalProducaoDia(items: ProducaoDiaItem[]): number {
  return items.reduce((s, i) => s + i.value, 0)
}

export function ctListFromDia(items: ProducaoDiaItem[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const day of items) {
    for (const b of day.breakdown) {
      if (!seen.has(b.ct_codigo)) {
        seen.add(b.ct_codigo)
        result.push(b.ct_codigo)
      }
    }
  }
  return result
}

export function filterParadasByMotivo(
  paradas: ParadaReportada[],
  motivoIds: string[] | undefined
): ParadaReportada[] {
  if (!motivoIds || motivoIds.length === 0) return paradas
  const set = new Set(motivoIds)
  return paradas.filter((p) => p.motivo_id != null && set.has(p.motivo_id))
}

export function topMotivosByDuracao(
  pareto: ParadaMotivoParetoItem[],
  n = 10
): ParadaMotivoParetoItem[] {
  return [...pareto]
    .sort((a, b) => b.duracao_total_seg - a.duracao_total_seg)
    .slice(0, n)
}

export function fmtUN(v: number, decimals = 0): string {
  return v.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtPct(v: number | null): string {
  if (v == null) return ""
  return (v * 100).toFixed(2).replace(".", ",") + "%"
}

export function oeeColor(
  oee_pct: number,
  meta_pct = 0.85
): "green" | "yellow" | "red" {
  if (oee_pct >= meta_pct) return "green"
  if (oee_pct >= 0.7)      return "yellow"
  return "red"
}

export function componentColor(pct: number): "green" | "yellow" | "red" {
  if (pct >= 0.9) return "green"
  if (pct >= 0.7) return "yellow"
  return "red"
}

/* ---------------------------------------------------------------
 * HOOK  buildUtcWindow
 * --------------------------------------------------------------- */

export function buildUtcWindow(
  startDate: Date,
  endDate:   Date
): { startUtc: string; endUtc: string } {
  const clamp = (d: Date) => (Number.isFinite(d.getTime()) ? new Date(d) : new Date())

  const s = clamp(startDate)
  s.setHours(6, 0, 0, 0)

  const e = clamp(endDate)
  e.setHours(6, 0, 0, 0)
  e.setDate(e.getDate() + 1)

  return { startUtc: s.toISOString(), endUtc: e.toISOString() }
}

/* ---------------------------------------------------------------
 * HOOK  useEmpresaId  ? CORRIGIDO
 *
 * Lê o empresa_id do localStorage validando UUID.
 * Se o valor armazenado não for UUID válido (ex: "1"),
 * usa EMPRESA_ID_PADRAO e o persiste automaticamente.
 * --------------------------------------------------------------- */

export function useEmpresaId(fallback = EMPRESA_ID_PADRAO): [string, (id: string) => void] {
  const [empresaId, setEmpresaIdState] = useState<string>(() => {
    const fromStorage = readEmpresaIdFromStorage()
    // Se leu um UUID válido, usa; senão cai no fallback
    const resolved = isUuid(fromStorage) ? fromStorage : (isUuid(fallback) ? fallback : EMPRESA_ID_PADRAO)
    // Já persiste o valor correto para leituras futuras
    persistEmpresaIdToStorage(resolved)
    return resolved
  })

  const setEmpresaId = useCallback((id: string) => {
    if (!isUuid(id)) {
      console.warn(`[useEmpresaId] tentativa de setar empresaId inválido: "${id}"  ignorado.`)
      return
    }
    setEmpresaIdState(id)
    persistEmpresaIdToStorage(id)
  }, [])

  return [empresaId, setEmpresaId]
}

/* ---------------------------------------------------------------
 * HOOK  useDateRange
 * --------------------------------------------------------------- */

export interface DateRange {
  startDate: Date
  endDate:   Date
}

export interface UseDateRangeReturn extends DateRange {
  startUtc:     string
  endUtc:       string
  setStartDate: (d: Date) => void
  setEndDate:   (d: Date) => void
  setRange:     (r: DateRange) => void
}

export function useDateRange(initial?: Partial<DateRange>): UseDateRangeReturn {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [startDate, setStartDate] = useState<Date>(initial?.startDate ?? today)
  const [endDate,   setEndDate]   = useState<Date>(initial?.endDate   ?? today)

  const { startUtc, endUtc } = useMemo(
    () => buildUtcWindow(startDate, endDate),
    [startDate, endDate]
  )

  const setRange = useCallback(({ startDate: s, endDate: e }: DateRange) => {
    setStartDate(s)
    setEndDate(e)
  }, [])

  return { startDate, endDate, startUtc, endUtc, setStartDate, setEndDate, setRange }
}

/* ---------------------------------------------------------------
 * HOOK  useRelatorioFilters
 * --------------------------------------------------------------- */

export interface UseRelatorioFiltersReturn {
  startDate:    Date
  endDate:      Date
  startUtc:     string
  endUtc:       string
  setRange:     (r: DateRange) => void

  selectedSetorIds:           string[]
  selectedCentrosTrabalhoIds: string[]
  selectedTurnoIds:           string[]

  setSelectedSetorIds:           (ids: string[]) => void
  setSelectedCentrosTrabalhoIds: (ids: string[]) => void
  setSelectedTurnoIds:           (ids: string[]) => void

  clearAll: () => void

  grupos:         GrupoCT[]
  centros:        CentroCT[]
  turnos:         Turno[]
  lookupsLoading: boolean
  lookupsError:   string | null

  filters: RelatorioFiltersInput
}

export function useRelatorioFilters(empresaId: string): UseRelatorioFiltersReturn {
  const dateRange = useDateRange()

  const [selectedSetorIds,           setSelectedSetorIds]           = useState<string[]>([])
  const [selectedCentrosTrabalhoIds, setSelectedCentrosTrabalhoIds] = useState<string[]>([])
  const [selectedTurnoIds,           setSelectedTurnoIds]           = useState<string[]>([])

  const [grupos,  setGrupos]  = useState<GrupoCT[]>([])
  const [centros, setCentros] = useState<CentroCT[]>([])
  const [turnos,  setTurnos]  = useState<Turno[]>([])
  const [lookupsLoading, setLookupsLoading] = useState(false)
  const [lookupsError,   setLookupsError]   = useState<string | null>(null)

  const setorKey    = useMemo(() => JSON.stringify(selectedSetorIds), [selectedSetorIds])
  const safeId      = isUuid(empresaId) ? empresaId : ""

  useEffect(() => {
    if (!safeId) return
    let alive = true
    const ctrl = new AbortController()
    setLookupsLoading(true)
    setLookupsError(null)

    Promise.all([
      apiGet<GrupoCT[]>("lookup-grupos", { empresaId: safeId }, ctrl.signal),
      apiGet<Turno[]>("lookup-turnos",   { empresaId: safeId }, ctrl.signal),
    ])
      .then(([g, t]) => { if (alive) { setGrupos(g); setTurnos(t) } })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return
        if (alive) setLookupsError(err instanceof Error ? err.message : "Erro nos lookups.")
      })
      .finally(() => { if (alive) setLookupsLoading(false) })

    return () => { alive = false; ctrl.abort() }
  }, [safeId])

  useEffect(() => {
    if (!safeId) return
    let alive = true
    const ctrl = new AbortController()

    apiGet<CentroCT[]>(
      "lookup-centros",
      { empresaId: safeId, ...(selectedSetorIds.length ? { setorIds: selectedSetorIds } : {}) },
      ctrl.signal
    )
      .then((c) => { if (alive) setCentros(c) })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return
        console.error("[useRelatorioFilters] centros:", err)
      })

    return () => { alive = false; ctrl.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeId, setorKey])

  const clearAll = useCallback(() => {
    setSelectedSetorIds([])
    setSelectedCentrosTrabalhoIds([])
    setSelectedTurnoIds([])
  }, [])

  const filters = useMemo<RelatorioFiltersInput>(
    () => ({
      empresaId: safeId,
      startUtc:  dateRange.startUtc,
      endUtc:    dateRange.endUtc,
      ...(selectedSetorIds.length           ? { setorIds:           selectedSetorIds           } : {}),
      ...(selectedCentrosTrabalhoIds.length ? { centrosTrabalhoIds: selectedCentrosTrabalhoIds } : {}),
      ...(selectedTurnoIds.length           ? { turnoIds:           selectedTurnoIds           } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      safeId,
      dateRange.startUtc,
      dateRange.endUtc,
      JSON.stringify(selectedSetorIds),
      JSON.stringify(selectedCentrosTrabalhoIds),
      JSON.stringify(selectedTurnoIds),
    ]
  )

  return {
    startDate:    dateRange.startDate,
    endDate:      dateRange.endDate,
    startUtc:     dateRange.startUtc,
    endUtc:       dateRange.endUtc,
    setRange:     dateRange.setRange,

    selectedSetorIds,
    selectedCentrosTrabalhoIds,
    selectedTurnoIds,

    setSelectedSetorIds,
    setSelectedCentrosTrabalhoIds,
    setSelectedTurnoIds,

    clearAll,

    grupos,
    centros,
    turnos,
    lookupsLoading,
    lookupsError,

    filters,
  }
}

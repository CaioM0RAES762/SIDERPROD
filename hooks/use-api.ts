// hooks/use-api.ts
"use client"

import useSWR, { type KeyedMutator } from "swr"
import { useSyncExternalStore } from "react"

const API_BASE = "/api/db"

/** =========================================================
 * Reconnecting state — rastreia requisições em retry
 * ========================================================= */
let _reconnectingCount = 0
const _reconnectListeners = new Set<() => void>()

function _setReconnecting(delta: 1 | -1) {
  _reconnectingCount = Math.max(0, _reconnectingCount + delta)
  _reconnectListeners.forEach((fn) => fn())
}

export function useIsReconnecting() {
  return useSyncExternalStore(
    (cb) => { _reconnectListeners.add(cb); return () => _reconnectListeners.delete(cb) },
    () => _reconnectingCount > 0,
    () => false,
  )
}

/** =========================================================
 * Fetcher (SAFE)  alinhado ao route.ts
 * - route.ts retorna { error, details } em erro
 * ========================================================= */
type ApiErrorPayload = { error?: string; details?: any }

const RETRY_DELAY_MS = 3_000
const MAX_NETWORK_RETRIES = 3
// Tempo máximo por tentativa de fetch. Mantido LIGEIRAMENTE ACIMA do
// requestTimeout do banco (30s — ver lib/db/config.ts) para que, quando uma
// query é lenta, o próprio servidor expire primeiro e responda com um JSON de
// erro tratado (PT), em vez de o cliente abortar antes e vazar um AbortError
// cru em inglês ("signal is aborted"/"The operation was aborted").
// Valor antigo (15s) abortava queries saudáveis-porém-lentas no tablet/DB
// carregado, e o abort sequer cancela a query no servidor — só desperdiçava
// trabalho e pressionava o pool.
const FETCH_TIMEOUT_MS = 35_000

/** Erro "transiente": rede instável, timeout, abort. Não é falha fatal —
 *  a UI deve manter o último dado válido e tentar reconectar. */
type TransientFlags = { transient?: boolean; isTimeout?: boolean; status?: number; details?: any }
function markTransient(message: string, extra?: TransientFlags): Error & TransientFlags {
  return Object.assign(new Error(message), { transient: true, ...extra })
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message.toLowerCase().includes("aborted"))
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    err.name === "TypeError" ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("err_network_changed")
  )
}

const fetcher = async (url: string) => {
  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
    const controller = new AbortController()
    let didTimeout = false
    const timeoutId = setTimeout(() => { didTimeout = true; controller.abort() }, FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "include", signal: controller.signal })
      clearTimeout(timeoutId)
      if (!res.ok) {
        const payload: ApiErrorPayload = await res.json().catch(() => ({ error: "Erro desconhecido" }))
        const msg = payload?.error || `Erro ao buscar dados (${res.status})`
        const err = new Error(msg) as Error & { status?: number; details?: any }
        err.status = res.status
        err.details = payload?.details
        throw err
      }
      return res.json()
    } catch (err) {
      clearTimeout(timeoutId)

      // Timeout/abort: NÃO retenta dentro do fetcher (retentar uma query lenta
      // só multiplica a carga no pool). Normaliza para um erro transiente em PT
      // — o SWR revalida depois (errorRetryInterval) e o próximo poll recupera,
      // enquanto a UI mantém o último dado válido.
      if (isAbortError(err)) {
        throw markTransient(
          didTimeout
            ? "Tempo de resposta excedido — os dados continuam atualizando em segundo plano."
            : "Requisição cancelada.",
          { isTimeout: didTimeout },
        )
      }

      // Erro de rede genuíno (ex.: WiFi caiu): retenta com backoff curto e
      // sinaliza "reconectando" para a UI.
      if (isNetworkError(err)) {
        if (attempt < MAX_NETWORK_RETRIES) {
          _setReconnecting(1)
          try {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          } finally {
            _setReconnecting(-1)
          }
          continue
        }
        // Esgotou as tentativas: ainda é transiente (não fatal) — preserva dado.
        throw markTransient("Falha de conexão — tentando reconectar…")
      }

      // Demais erros (ex.: 4xx/5xx já tratados como JSON pelo route) propagam.
      throw err
    }
  }
}

/** Um erro deve ser tratado como FATAL (banner vermelho) apenas quando não é
 *  transiente. Abort/timeout/rede são transientes e não devem quebrar a tela. */
export function isFatalApiError(err: unknown): boolean {
  if (!err) return false
  if ((err as TransientFlags)?.transient) return false
  if (isAbortError(err) || isNetworkError(err)) return false
  return true
}

/** =========================================================
 * Hook genérico (SWR)
 * ========================================================= */
export function useApiData<T>(
  endpoint: string | null,
  params?: Record<string, string | number | boolean | null | undefined>
) {
  const searchParams = new URLSearchParams()
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") searchParams.append(key, String(value))
    })
  }

  const url = endpoint
    ? `${API_BASE}/${endpoint}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
    : null

  return useSWR<T>(url, fetcher, {
    revalidateOnFocus: false,
    // Dedup de revalidações concorrentes da MESMA chave (ex.: cards e stats
    // compartilham /dashboard/cards). Evita disparar listCards duplicado.
    dedupingInterval: 5000,
    // NOTA: não usamos keepPreviousData de propósito — ele preserva dados ao
    // TROCAR de chave e causaria vazamento entre entidades nos hooks por-CT
    // (ex.: modal de outro CT mostrando dados do anterior). A estabilidade da
    // grade já vem do comportamento padrão do SWR: numa revalidação que falha,
    // o último `data` bem-sucedido permanece (chave estável dos cards).
    // Retry com backoff para erros (inclui transientes de rede/timeout). O SWR
    // aplica jitter; limitamos a 4 tentativas a cada ~5s para não saturar.
    shouldRetryOnError: true,
    errorRetryCount: 4,
    errorRetryInterval: 5000,
  })
}

/** =========================================================
 * Mutations (POST / DELETE)  alinhadas ao route.ts
 * - POST: JSON
 * - DELETE: usa ?id= (não /:id)
 * ========================================================= */
export async function apiCreate<T>(endpoint: string, data: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const payload: ApiErrorPayload = await res.json().catch(() => ({ error: "Erro desconhecido" }))
    const err = new Error(payload?.error || "Erro ao criar") as Error & { status?: number; details?: any }
    err.status = res.status
    err.details = payload?.details
    throw err
  }

  return res.json()
}

/** route.ts usa `?id=` no DELETE */
export async function apiDelete(endpoint: string, id: number | string): Promise<void> {
  const url = `${API_BASE}/${endpoint}?id=${encodeURIComponent(String(id))}`
  const res = await fetch(url, { method: "DELETE", credentials: "include" })

  if (!res.ok) {
    const payload: ApiErrorPayload = await res.json().catch(() => ({ error: "Erro desconhecido" }))
    const err = new Error(payload?.error || "Erro ao excluir") as Error & { status?: number; details?: any }
    err.status = res.status
    err.details = payload?.details
    throw err
  }
}

/** =========================================================
 * Helpers (SAFE)
 * ========================================================= */
export type StatusKey = "producing" | "stopped"

function safeNum(v: any, fallback = 0) {
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : fallback
}

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
function isGuid(v: any): boolean {
  return typeof v === "string" && GUID_RE.test(v.trim())
}

/** Normaliza qualquer resposta em array */
function normalizeArray<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload
  if (isPlainObject(payload)) {
    const candidates = [payload.data, payload.items, payload.rows, payload.stats, payload.result, payload.paradas]
    for (const c of candidates) if (Array.isArray(c)) return c
  }
  return []
}

function pickNum(obj: any, keys: string[], fallback = 0): number {
  if (!obj) return fallback
  for (const k of keys) {
    const v = (obj as any)[k]
    const n = safeNum(v, Number.NaN)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function getShiftNameFromNow(now = new Date()): string {
  const h = now.getHours()
  if (h >= 6 && h < 14) return "Manhã"
  if (h >= 14 && h < 21) return "Tarde"
  return "Noite"
}

function formatHMS(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return null
  const s = Math.max(0, Math.floor(Number(totalSeconds)))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad2 = (n: number) => String(n).padStart(2, "0")
  return `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`
}

function parseIsoToMs(v?: string | null): number | null {
  if (!v) return null
  const d = new Date(v)
  const t = d.getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * OEE/Availability/Performance/Quality:
 * - view costuma vir 0..1
 * - legados podem vir 0..100
 * => normaliza para 0..100
 */
function normalizePct(v: any): number {
  const n = safeNum(v, 0)
  if (!Number.isFinite(n)) return 0
  return n <= 1.5 ? n * 100 : n
}

function normalizeRatioToPct(v: any): number {
  const n = safeNum(v, 0)
  if (!Number.isFinite(n)) return 0
  return n <= 1.5 ? n * 100 : n
}

function calcCapacidadeHora(cicloIdealSeg?: number | null): number {
  const ciclo = safeNum(cicloIdealSeg, 0)
  if (ciclo <= 0) return 0
  return Math.floor(3600 / ciclo)
}

function mapStatusFromCTStatus(status_ct?: string | null): StatusKey {
  const s = String(status_ct ?? "").trim().toUpperCase()
  if (s === "STOPPED") return "stopped"
  if (s === "RUNNING" || s === "PRODUCING") return "producing"
  return "producing"
}

/** =========================================================
 * Shapes da API (ALINHADO ao route.ts + views/service)
 * ========================================================= */
export type Id = string | number

export interface TurnoAtual {
  turno_id: string | null
  turno_nome: string | null
  inicio_utc: string // ISO
  fim_utc: string // ISO
}

export interface ApiDashboardCard {
  centro_trabalho_id: string // GUID
  ct_public_id: string | null
  ct_codigo: string | null
  ct_nome: string | null

  status_ct: string
  status_descricao: string | null
  status_updated_at_utc: string | null
  last_event_time_utc: string | null

  corrida_atual_id: string | null
  corrida_inicio_utc: string | null
  corrida_fim_utc: string | null

  ordem_atual_id: string | null
  ordem_public_id: string | null
  ordem_codigo: string | null

  produto_atual_id: string | null
  produto_public_id: string | null
  produto_descricao: string | null
  produto_ciclo_ideal_seg: number | null

  meta_corrida: number | null

  total_good: number
  total_scrap: number
  total_rework: number

  turno: TurnoAtual
  turno_good: number
  turno_scrap: number
  turno_rework: number

  motivo_parada_id: string | null
  motivo_codigo: string | null
  motivo_descricao: string | null
  motivo_grupo_perda: string | null
  motivo_is_planejada: boolean | null
  parada_inicio_utc: string | null
  parada_duracao_seg: number | null

  produzindo_segmento_inicio_utc?: string | null
  produzindo_segmento_seg?: number | null

  planned_time_seg: number | null
  unplanned_stop_seg: number | null
  run_time_seg: number | null

  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null

  produto_total_good_historico?: number | null
  produto_producao_total_good?: number | null
  produto_meta_planejada?: number | null
  produto_progresso_pct?: number | null

  paradas_turno_qtd?: number | null
  paradas_turno_tempo_seg?: number | null
  paradas_dia_qtd?: number | null
  paradas_dia_tempo_seg?: number | null
  produzindo_dia_tempo_seg?: number | null

  // OP anterior (última corrida finalizada)
  ordem_anterior_codigo?: string | null
  ordem_anterior_public_id?: string | null
  ordem_anterior_good?: number | null

  /** Produção da corrida atual DENTRO do turno corrente (reseta na virada de turno) */
  corrida_turno_good?: number | null

  // -- LEGACY/ALIASES (tolerância) ------------------------------------
  turno_paradas_qtd?: number
  turno_paradas_duracao_seg?: number

  modo_contagem?: string | null

  /** Peças em retrabalho (rodízio) do CT, na ordem da fila cíclica */
  retrabalho_pecas?: string[]

  [k: string]: any
}

// ─── Histórico do Dia ─────────────────────────────────────────────────────────

export interface CorridaTurnoVM {
  corrida_id: string | null
  ordem_codigo: string | null
  ordem_public_id: string | null
  total_good_clipped: number
  /** Início desta corrida dentro da janela do turno (UTC ISO) */
  clip_ini_utc: string
  /** Fim desta corrida dentro da janela do turno; null = em curso */
  clip_fim_utc: string | null
  em_curso: boolean
  elapsed_seg: number
  availability: number | null // 0..1
  performance: number | null  // 0..1
}

export interface HistoricoTurnoVM {
  turno_id: string | null
  turno_nome: string | null
  inicio_utc: string
  fim_utc: string
  turno_good: number
  availability: number | null  // 0..1
  performance: number | null   // 0..1
  quality: number | null       // 0..1
  oee: number | null           // 0..1
  corridas: CorridaTurnoVM[]
}

export interface HistoricoDiaVM {
  centro_trabalho_id: string
  ordem_anterior: {
    corrida_id: string | null
    ordem_codigo: string | null
    ordem_public_id: string | null
    total_good: number
    fim_utc: string | null
  } | null
  historico_turnos: HistoricoTurnoVM[]
}

export interface ApiCentroTrabalhoBase {
  id: Id
  public_id?: string | null
  codigo?: string | null
  nome?: string | null
  setor_id?: Id | null
  ativo?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export interface Grupo {
  id: Id
  nome: string
  descricao: string | null
}

// ? NOVO: Parada agregada por motivo  shape da API
export interface ApiParadaAgregadaPorMotivo {
  centro_trabalho_id: string
  motivo_id: string | null
  motivo_codigo: string | null
  motivo_descricao: string | null
  grupo_perda: string | null
  is_planejada: boolean | null
  exige_justificativa: boolean | null

  ocorrencias: number
  tempo_total_seg: number
  justificadas_qtd: number
  nao_justificadas_qtd: number

  // campos derivados opcionais (preenchidos pelos hooks de ViewModel)
  tempo_total_hms?: string | null
  tempo_total_min?: number
  pct_do_total?: number // 0..100  percentual deste motivo no tempo total do CT
}

// ? NOVO: Resposta do endpoint /dashboard/paradas-agregadas-turno-atual
export interface ApiParadasAgregadasTurnoAtualResponse {
  turno: TurnoAtual
  paradas: ApiParadaAgregadaPorMotivo[]
}

/** =========================================================
 * Hooks brutos (API)
 * ========================================================= */
export function useHealth() {
  return useApiData<any>("health")
}

export function useGrupos() {
  return useApiData<Grupo[]>("grupos")
}

export function useCentrosTrabalhoBase() {
  return useApiData<ApiCentroTrabalhoBase[]>("centros-trabalho")
}

/** =========================================================
 * DASHBOARD (GRID / CARDS)
 * ========================================================= */
export function useDashboardCards(params?: { centrosIds?: string[] }) {
  const centrosIds = params?.centrosIds?.length ? params.centrosIds.join(",") : undefined
  return useApiData<ApiDashboardCard[]>("dashboard/cards", centrosIds ? { centrosIds } : undefined)
}

/** Legacy */
export function useDashboardCardsPostosLegacy(params?: { centrosIds?: string[] }) {
  const centrosIds = params?.centrosIds?.length ? params.centrosIds.join(",") : undefined
  return useApiData<ApiDashboardCard[]>("dashboard/postos", centrosIds ? { centrosIds } : undefined)
}

/** =========================================================
 * Endpoints de detalhe (route.ts)
 * ========================================================= */

function getEmpresaIdFallback(): string {
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : null
    const v = ls?.getItem("empresa_id") || ls?.getItem("empresaId") || ls?.getItem("empresa") ||
      (process.env.NEXT_PUBLIC_EMPRESA_ID as string | undefined) || ""
    return String(v || "1")
  } catch {
    return String((process.env.NEXT_PUBLIC_EMPRESA_ID as string | undefined) || "1")
  }
}

/** Fetcher que desembrulha o envelope { ok, data } do posto/route.ts */
async function postoFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "include" })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  if (json?.ok === true) return json.data as T
  if (json?.ok === false) throw new Error(json.error || "Erro na API")
  return json as T
}

/** Header vindo de posto.ts - rota: GET /api/db/posto?op=header */
export function useDashboardHeader(centroTrabalhoId: string | null) {
  const empresaId = getEmpresaIdFallback()
  const sp = new URLSearchParams()
  if (centroTrabalhoId) { sp.set("op", "header"); sp.set("empresa_id", empresaId); sp.set("centro_trabalho_id", centroTrabalhoId) }
  const url = centroTrabalhoId ? `/api/db/posto?${sp.toString()}` : null
  return useSWR<ApiDashboardCard | null>(url, postoFetcher, { revalidateOnFocus: false, dedupingInterval: 5000 })
}

/** Alias para useDashboardHeader */
export function usePostoHeader(centroTrabalhoId: string | null) {
  return useDashboardHeader(centroTrabalhoId)
}
export interface ProducaoPorHoraPoint {
  bucket_time_utc: string
  bucket_hour_utc: string
  good_count: number
  scrap_count: number
  rework_count: number
  produced_target: number | null
  capacidade?: number | null
  meta?: number | null
  ciclo_medio_seg?: number | null
  corrida_id?: string | null
}

export function useDashboardProducaoPorHora(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<ProducaoPorHoraPoint[]>(
    ok ? "dashboard/producao-por-hora" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
        }
      : undefined
  )
}

export interface OeePorPeriodoRow {
  dia_utc: string
  inicio_utc: string
  fim_utc: string

  turno_id: string | null
  turno_nome: string | null

  ordem_id?: string | null
  ordem_codigo?: string | null
  produto_id?: string | null
  produto_descricao?: string | null

  total_good: number
  total_scrap: number
  total_rework: number

  planned_time_seg?: number | null
  unplanned_stop_seg?: number | null
  run_time_seg?: number | null

  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null
}

export function useDashboardOeePorPeriodo(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<OeePorPeriodoRow[]>(
    ok ? "posto/oee-por-periodo" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
        }
      : undefined
  )
}

/** (Opcional) Alias explícito */
export function usePostoOeePorPeriodo(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<OeePorPeriodoRow[]>(
    ok ? "posto/oee-por-periodo" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
        }
      : undefined
  )
}

export interface PerdasPorPeriodoRow {
  motivo_codigo: string | null
  motivo_descricao: string | null
  grupo_perda: string | null
  is_planejada: boolean | null

  ocorrencias: number | null
  perda_tempo_seg: number | null
  perda_quantidade_scrap: number | null
  perda_quantidade_rework: number | null
}

export function useDashboardPerdasPorPeriodo(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
  isExactTime?: boolean | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<PerdasPorPeriodoRow[]>(
    ok ? "posto/perdas-por-periodo" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
          is_exact_time: params.isExactTime ? true : undefined,
        }
      : undefined
  )
}

/** (Opcional) Alias explícito */
export function usePostoPerdasPorPeriodo(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
  isExactTime?: boolean | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<PerdasPorPeriodoRow[]>(
    ok ? "posto/perdas-por-periodo" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
          is_exact_time: params.isExactTime ? true : undefined,
        }
      : undefined
  )
}

export interface PerdasPorMinutoPoint {
  minute_utc: string
  grupo_perda: string | null
  perda_minutos: number
  ocorrencias: number
}

export function useDashboardPerdasPorMinutoParadas(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<PerdasPorMinutoPoint[]>(
    ok ? "dashboard/perdas-por-minuto-paradas" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
        }
      : undefined
  )
}

export interface ParadaTurnoRow {
  parada_id: string
  centro_trabalho_id: string
  corrida_id: string | null

  motivo_id: string | null
  motivo_codigo: string | null
  motivo_descricao: string | null
  grupo_perda: string | null
  is_planejada: boolean | null
  exige_justificativa: boolean | null

  inicio_utc: string
  fim_utc: string | null
  duracao_seg: number | null

  is_justificada: boolean | null
  justificativa_texto: string | null

  [k: string]: any
}

/** GET /dashboard/paradas-turno */
export function useDashboardParadasDoTurno(params: {
  centroTrabalhoId: string | null
  turnoInicio: string | null
  turnoFim: string | null
}) {
  const ok = !!(params.centroTrabalhoId && params.turnoInicio && params.turnoFim)
  return useApiData<ParadaTurnoRow[]>(
    ok ? "dashboard/paradas-turno" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          turnoInicio: params.turnoInicio!,
          turnoFim: params.turnoFim!,
        }
      : undefined
  )
}

export interface CicloInstantaneoRow {
  centro_trabalho_id: string
  corrida_id: string | null
  ciclo_instantaneo_seg: number | null
  ciclo_medio_janela_seg?: number | null
  updated_at_utc?: string | null
}

/** GET /dashboard/historico-dia */
export function useDashboardHistoricoDia(centroTrabalhoId: string | null) {
  return useApiData<HistoricoDiaVM | null>(
    centroTrabalhoId ? "dashboard/historico-dia" : null,
    centroTrabalhoId ? { centroTrabalhoId } : undefined
  )
}

/** GET /dashboard/ciclo-instantaneo */
export function useDashboardCicloInstantaneo(centroTrabalhoId: string | null) {
  return useApiData<CicloInstantaneoRow | null>(
    centroTrabalhoId ? "dashboard/ciclo-instantaneo" : null,
    centroTrabalhoId ? { centroTrabalhoId } : undefined
  )
}

/** GET /dashboard/detalhe */
export type DashboardDetalhePayload = any
export function useDashboardDetalhe(params: {
  centroTrabalhoId: string | null
  dataInicio: string | null
  dataFim: string | null
}) {
  const ok = !!(params.centroTrabalhoId && params.dataInicio && params.dataFim)
  return useApiData<DashboardDetalhePayload>(
    ok ? "dashboard/detalhe" : null,
    ok
      ? {
          centroTrabalhoId: params.centroTrabalhoId!,
          dataInicio: params.dataInicio!,
          dataFim: params.dataFim!,
        }
      : undefined
  )
}

/** GET /dashboard/stats */
export type DashboardStatsApi = any
export function useDashboardStatsApi(params?: { centrosIds?: string[] }) {
  const centrosIds = params?.centrosIds?.length ? params.centrosIds.join(",") : undefined
  return useApiData<DashboardStatsApi>("dashboard/stats", centrosIds ? { centrosIds } : undefined)
}

/* ------------------------------------------------------------------------------
 * ? NOVO: Paradas agregadas por motivo  hooks RAW
 *
 * Endpoints no route.ts:
 *   GET /api/db/dashboard/paradas-agregadas-por-motivo
 *     ?centrosIds=guid,guid&inicioUtc=ISO&fimUtc=ISO
 *
 *   GET /api/db/dashboard/paradas-agregadas-turno-atual
 *     ?centrosIds=guid,guid   (janela resolvida pelo backend)
 * ------------------------------------------------------------------------------ */

/**
 * Paradas agregadas por motivo  janela livre (ISO).
 *
 * Retorna array plano de { centro_trabalho_id, motivo_*, ocorrencias, tempo_total_seg, ... }
 *
 * @example
 * const { data, isLoading } = useDashboardParadasAgregadasPorMotivo({
 *   centrosIds: ["guid1", "guid2"],
 *   inicioUtc: "2026-03-05T06:00:00.000Z",
 *   fimUtc:    "2026-03-05T14:00:00.000Z",
 * })
 */
export function useDashboardParadasAgregadasPorMotivo(params: {
  centrosIds?: string[] | null
  inicioUtc: string | null
  fimUtc: string | null
}) {
  const ok = !!(params.inicioUtc && params.fimUtc)
  const centrosIds = params.centrosIds?.length ? params.centrosIds.join(",") : undefined

  return useApiData<ApiParadaAgregadaPorMotivo[]>(
    ok ? "dashboard/paradas-agregadas-por-motivo" : null,
    ok
      ? {
          ...(centrosIds ? { centrosIds } : {}),
          inicioUtc: params.inicioUtc!,
          fimUtc: params.fimUtc!,
        }
      : undefined
  )
}

/**
 * Paradas agregadas  TURNO ATUAL (janela resolvida pelo backend).
 *
 * Retorna { turno, paradas[] }  ideal para o modal do dashboard
 * quando você não quer gerenciar a janela do turno no front.
 *
 * @example
 * const { data, isLoading } = useDashboardParadasAgregadasTurnoAtual({
 *   centrosIds: ["guid1"],
 * })
 * const rows = data?.paradas ?? []
 */
export function useDashboardParadasAgregadasTurnoAtual(params?: {
  centrosIds?: string[] | null
}) {
  const centrosIds = params?.centrosIds?.length ? params.centrosIds.join(",") : undefined

  return useApiData<ApiParadasAgregadasTurnoAtualResponse>(
    "dashboard/paradas-agregadas-turno-atual",
    centrosIds ? { centrosIds } : undefined
  )
}

/* ------------------------------------------------------------------------------
 * ? NOVO: ViewModels derivados para paradas agregadas
 * ------------------------------------------------------------------------------ */

/**
 * Parada agregada enriquecida (VM)  adiciona campos derivados úteis para UI:
 * - tempo_total_hms: "01h23m45s"
 * - tempo_total_min: minutos (float, 1 decimal)
 * - pct_do_total: percentual do tempo deste motivo sobre o total do CT (0..100)
 */
export interface ParadaAgregadaPorMotivoVM extends ApiParadaAgregadaPorMotivo {
  tempo_total_hms: string | null
  tempo_total_min: number
  pct_do_total: number // 0..100
}

/**
 * Resumo de paradas de um CT agrupado por grupo_perda.
 * Útil para gráfico de Pareto / pizza.
 */
export interface ParadasPorGrupoPerdaVM {
  grupo_perda: string
  is_planejada: boolean | null
  ocorrencias: number
  tempo_total_seg: number
  tempo_total_hms: string | null
  tempo_total_min: number
  pct_do_total: number // 0..100
  motivos: ParadaAgregadaPorMotivoVM[]
}

/**
 * Dados prontos para UI de um único CT  inclui Pareto + tabela detalhada.
 */
export interface ParadasAgregadasCTVM {
  centro_trabalho_id: string
  turno: TurnoAtual | null
  total_ocorrencias: number
  total_tempo_seg: number
  total_tempo_hms: string | null
  nao_justificadas_total: number
  por_grupo: ParadasPorGrupoPerdaVM[]
  por_motivo: ParadaAgregadaPorMotivoVM[]
}

/** Helper interno: enriquece uma linha com campos derivados */
function enrichParadaAgregada(
  row: ApiParadaAgregadaPorMotivo,
  totalSegDoCT: number
): ParadaAgregadaPorMotivoVM {
  const tempoSeg = safeNum(row.tempo_total_seg, 0)
  return {
    ...row,
    tempo_total_hms: formatHMS(tempoSeg),
    tempo_total_min: Math.round((tempoSeg / 60) * 10) / 10,
    pct_do_total: totalSegDoCT > 0 ? Math.round((tempoSeg / totalSegDoCT) * 1000) / 10 : 0,
  }
}

/**
 * Hook principal: ViewModel completo de paradas agregadas para um CT,
 * usando janela livre (ISO).
 *
 * Retorna:
 * - por_motivo: tabela detalhada (ordenada por tempo desc)
 * - por_grupo: Pareto por grupo_perda
 * - totais: ocorrencias, tempo total, não justificadas
 *
 * @example
 * const vm = useParadasAgregadasCTViewModel({
 *   centroTrabalhoId: "guid-do-ct",
 *   inicioUtc: turno.inicio_utc,
 *   fimUtc: turno.fim_utc,
 * })
 */
export function useParadasAgregadasCTViewModel(params: {
  centroTrabalhoId: string | null
  inicioUtc: string | null
  fimUtc: string | null
}): {
  data: ParadasAgregadasCTVM | null
  isLoading: boolean
  error: any
  mutate: () => Promise<any>
} {
  const raw = useDashboardParadasAgregadasPorMotivo({
    centrosIds: params.centroTrabalhoId ? [params.centroTrabalhoId] : null,
    inicioUtc: params.inicioUtc,
    fimUtc: params.fimUtc,
  })

  const rows = normalizeArray<ApiParadaAgregadaPorMotivo>(raw.data).filter(
    (r) => r.centro_trabalho_id === params.centroTrabalhoId
  )

  const data: ParadasAgregadasCTVM | null = params.centroTrabalhoId
    ? buildParadasAgregadasCTVM(params.centroTrabalhoId, null, rows)
    : null

  return {
    data,
    isLoading: raw.isLoading,
    error: raw.error,
    mutate: async () => raw.mutate(),
  }
}

/**
 * Hook: ViewModel completo usando TURNO ATUAL (janela resolvida pelo backend).
 * Mais simples que a versão com janela livre  recomendado para o modal principal.
 *
 * @example
 * const vm = useParadasAgregadasTurnoAtualCTViewModel({ centroTrabalhoId: "guid" })
 * vm.data?.por_grupo.forEach(g => console.log(g.grupo_perda, g.tempo_total_hms))
 */
export function useParadasAgregadasTurnoAtualCTViewModel(params: {
  centroTrabalhoId: string | null
}): {
  data: ParadasAgregadasCTVM | null
  turno: TurnoAtual | null
  isLoading: boolean
  error: any
  mutate: () => Promise<any>
} {
  const raw = useDashboardParadasAgregadasTurnoAtual(
    params.centroTrabalhoId ? { centrosIds: [params.centroTrabalhoId] } : undefined
  )

  const turno: TurnoAtual | null = (raw.data as any)?.turno ?? null
  const allRows = normalizeArray<ApiParadaAgregadaPorMotivo>((raw.data as any)?.paradas)

  const rows = allRows.filter(
    (r) => !params.centroTrabalhoId || r.centro_trabalho_id === params.centroTrabalhoId
  )

  const data: ParadasAgregadasCTVM | null = params.centroTrabalhoId
    ? buildParadasAgregadasCTVM(params.centroTrabalhoId, turno, rows)
    : null

  return {
    data,
    turno,
    isLoading: raw.isLoading,
    error: raw.error,
    mutate: async () => raw.mutate(),
  }
}

/**
 * Hook: ViewModel agregado para MÚLTIPLOS CTs, turno atual.
 * Retorna um Map<centro_trabalho_id, ParadasAgregadasCTVM>.
 * Útil para o grid do dashboard mostrar chips/badges de paradas.
 *
 * @example
 * const { dataMap, isLoading } = useParadasAgregadasTurnoAtualMultiCT({
 *   centrosIds: cards.map(c => c.id),
 * })
 * const vm = dataMap.get(ctId)
 */
export function useParadasAgregadasTurnoAtualMultiCT(params?: {
  centrosIds?: string[]
}): {
  dataMap: Map<string, ParadasAgregadasCTVM>
  turno: TurnoAtual | null
  isLoading: boolean
  error: any
  mutate: () => Promise<any>
} {
  const raw = useDashboardParadasAgregadasTurnoAtual(
    params?.centrosIds?.length ? { centrosIds: params.centrosIds } : undefined
  )

  const turno: TurnoAtual | null = (raw.data as any)?.turno ?? null
  const allRows = normalizeArray<ApiParadaAgregadaPorMotivo>((raw.data as any)?.paradas)

  // Agrupa por CT
  const byCtId = new Map<string, ApiParadaAgregadaPorMotivo[]>()
  for (const row of allRows) {
    const ctId = row.centro_trabalho_id
    if (!byCtId.has(ctId)) byCtId.set(ctId, [])
    byCtId.get(ctId)!.push(row)
  }

  const dataMap = new Map<string, ParadasAgregadasCTVM>()
  for (const [ctId, rows] of byCtId) {
    dataMap.set(ctId, buildParadasAgregadasCTVM(ctId, turno, rows))
  }

  return {
    dataMap,
    turno,
    isLoading: raw.isLoading,
    error: raw.error,
    mutate: async () => raw.mutate(),
  }
}

/**
 * Hook: ViewModel agregado para MÚLTIPLOS CTs, num PERÍODO ESPECÍFICO.
 * Retorna um Map<centro_trabalho_id, ParadasAgregadasCTVM>.
 * Perfeito para a visão de Dia Operacional (06h às 06h).
 *
 * @example
 * const { dataMap, isLoading } = useParadasAgregadasPeriodoMultiCT({
 * centrosIds: ["guid1", "guid2"],
 * dataInicio: "2026-03-16T06:00:00.000Z",
 * dataFim: "2026-03-17T05:59:59.000Z"
 * })
 */
export function useParadasAgregadasPeriodoMultiCT(params?: {
  centrosIds?: string[]
  dataInicio?: string | null
  dataFim?: string | null
}): {
  dataMap: Map<string, ParadasAgregadasCTVM>
  isLoading: boolean
  error: any
  mutate: () => Promise<any>
} {
  // Chama a API que aceita as datas de início e fim
  const raw = useDashboardParadasAgregadasPorMotivo({
    centrosIds: params?.centrosIds?.length ? params.centrosIds : undefined,
    inicioUtc: params?.dataInicio ?? null,
    fimUtc: params?.dataFim ?? null
  })

  const allRows = normalizeArray<ApiParadaAgregadaPorMotivo>(raw.data)

  // Agrupa os resultados brutos por Centro de Trabalho
  const byCtId = new Map<string, ApiParadaAgregadaPorMotivo[]>()
  for (const row of allRows) {
    const ctId = row.centro_trabalho_id
    if (!byCtId.has(ctId)) byCtId.set(ctId, [])
    byCtId.get(ctId)!.push(row)
  }

  // Constrói o ViewModel (Pareto, tempos formatados, etc) para cada CT
  const dataMap = new Map<string, ParadasAgregadasCTVM>()
  for (const [ctId, rows] of byCtId) {
    // Passamos 'null' para o turno, pois a visão agora é do Dia Operacional inteiro
    dataMap.set(ctId, buildParadasAgregadasCTVM(ctId, null, rows))
  }

  return {
    dataMap,
    isLoading: raw.isLoading,
    error: raw.error,
    mutate: async () => raw.mutate(),
  }
}

/** Builder interno: constrói o VM de um CT a partir das linhas brutas */
function buildParadasAgregadasCTVM(
  ctId: string,
  turno: TurnoAtual | null,
  rows: ApiParadaAgregadaPorMotivo[]
): ParadasAgregadasCTVM {
  const total_tempo_seg = rows.reduce((acc, r) => acc + safeNum(r.tempo_total_seg, 0), 0)
  const total_ocorrencias = rows.reduce((acc, r) => acc + safeNum(r.ocorrencias, 0), 0)
  const nao_justificadas_total = rows.reduce((acc, r) => acc + safeNum(r.nao_justificadas_qtd, 0), 0)

  // Enriquece cada motivo
  const por_motivo: ParadaAgregadaPorMotivoVM[] = rows
    .map((r) => enrichParadaAgregada(r, total_tempo_seg))
    .sort((a, b) => b.tempo_total_seg - a.tempo_total_seg)

  // Agrupa por grupo_perda (Pareto)
  const grupoMap = new Map<
    string,
    {
      is_planejada: boolean | null
      ocorrencias: number
      tempo_total_seg: number
      motivos: ParadaAgregadaPorMotivoVM[]
    }
  >()

  for (const m of por_motivo) {
    const key = m.grupo_perda ?? "Sem grupo"
    const cur = grupoMap.get(key) ?? {
      is_planejada: m.is_planejada ?? null,
      ocorrencias: 0,
      tempo_total_seg: 0,
      motivos: [],
    }
    cur.ocorrencias += m.ocorrencias
    cur.tempo_total_seg += m.tempo_total_seg
    cur.motivos.push(m)
    grupoMap.set(key, cur)
  }

  const por_grupo: ParadasPorGrupoPerdaVM[] = Array.from(grupoMap.entries())
    .map(([grupo_perda, g]) => ({
      grupo_perda,
      is_planejada: g.is_planejada,
      ocorrencias: g.ocorrencias,
      tempo_total_seg: g.tempo_total_seg,
      tempo_total_hms: formatHMS(g.tempo_total_seg),
      tempo_total_min: Math.round((g.tempo_total_seg / 60) * 10) / 10,
      pct_do_total: total_tempo_seg > 0 ? Math.round((g.tempo_total_seg / total_tempo_seg) * 1000) / 10 : 0,
      motivos: g.motivos,
    }))
    .sort((a, b) => b.tempo_total_seg - a.tempo_total_seg)

  return {
    centro_trabalho_id: ctId,
    turno,
    total_ocorrencias,
    total_tempo_seg,
    total_tempo_hms: formatHMS(total_tempo_seg),
    nao_justificadas_total,
    por_grupo,
    por_motivo,
  }
}

// --- Produção por CT · Dia Operacional ---------------------------------------
export interface ProducaoDiaOpRow {
  hora_op_utc: string   // ISO  hora do bucket no Dia Operacional
  centro_trabalho_id: string
  ct_codigo: string
  total_good: number
  meta_hora: number
}

/**
 * Produção por hora, detalhada por CT, para o Dia Operacional (06h06h).
 * Agrupamento com offset -6h no backend para alinhamento correto.
 */
export function useProducaoDiaOperacional(params: {
  inicioUtc: string | null
  fimUtc: string | null
  centrosIds?: string[] | null
}): ReturnType<typeof useApiData<ProducaoDiaOpRow[]>> {
  const ok = !!(params.inicioUtc && params.fimUtc)
  const centrosIds = params.centrosIds?.length ? params.centrosIds.join(",") : undefined
  return useApiData<ProducaoDiaOpRow[]>(
    ok ? "dashboard/producao-dia-operacional" : null,
    ok
      ? {
          inicioUtc: params.inicioUtc!,
          fimUtc: params.fimUtc!,
          ...(centrosIds ? { centrosIds } : {}),
        }
      : undefined
  )
}

/** =========================================================
 * DASHBOARD  comandos operacionais (POST) (route.ts)
 * ========================================================= */
export type ApiCommandOut = any

export function apiDashboardApontarProducao(input: { centroTrabalhoId: string; quantidade: number }) {
  return apiCreate<ApiCommandOut>("dashboard/apontar-producao", input as any)
}

export function apiDashboardApontarRefugoRetrabalho(input: {
  centroTrabalhoId: string
  tipo: "SCRAP" | "REWORK"
  quantidade: number
}) {
  return apiCreate<ApiCommandOut>("dashboard/apontar-refugo-retrabalho", input as any)
}

export function apiDashboardApontarParada(input: { centroTrabalhoId: string; motivoId: string }) {
  return apiCreate<ApiCommandOut>("dashboard/apontar-parada", input as any)
}

export function apiDashboardIniciarNovaParada(input: { centroTrabalhoId: string; motivoId: string }) {
  return apiCreate<ApiCommandOut>("dashboard/iniciar-nova-parada", input as any)
}

export function apiDashboardRetomarProducao(input: { centroTrabalhoId: string }) {
  return apiCreate<ApiCommandOut>("dashboard/retomar-producao", input as any)
}

/** =========================================================
 * Total de paradas por TURNO (ATUAL)
 * ========================================================= */
export function useTotalParadasNoTurno(params: { centroTrabalhoId: string | null }) {
  const header = useDashboardHeader(params.centroTrabalhoId)

  const turnoInicio = header.data?.turno?.inicio_utc ?? null
  const turnoFim = header.data?.turno?.fim_utc ?? null

  const qtdAg = pickNum(header.data, ["paradas_turno_qtd", "turno_paradas_qtd", "paradas_no_turno"], Number.NaN)
  const tempoAg = pickNum(
    header.data,
    ["paradas_turno_tempo_seg", "turno_paradas_duracao_seg", "tempo_parado_turno_seg"],
    Number.NaN
  )

  const paradas = useDashboardParadasDoTurno({
    centroTrabalhoId: params.centroTrabalhoId,
    turnoInicio,
    turnoFim,
  })

  const rows = normalizeArray<ParadaTurnoRow>(paradas.data)

  const qtdList = rows.length
  const nao_justificadas_turno = rows.filter((r) => r.is_justificada === false).length
  const tempoList = rows.reduce((acc, r) => acc + safeNum(r.duracao_seg, 0), 0)

  const total_paradas_turno = Number.isFinite(qtdAg) ? safeNum(qtdAg, 0) : qtdList
  const tempo_parado_turno_seg = Number.isFinite(tempoAg) ? safeNum(tempoAg, 0) : tempoList

  return {
    data: {
      turno_inicio_utc: turnoInicio,
      turno_fim_utc: turnoFim,
      total_paradas_turno,
      nao_justificadas_turno,
      tempo_parado_turno_seg,
      tempo_parado_turno_hms: formatHMS(tempo_parado_turno_seg),
    },
    error: (header.error as any) || paradas.error,
    isLoading: !!(header.isLoading || paradas.isLoading),
    mutate: async () => {
      await Promise.all([header.mutate(), paradas.mutate()])
      return true
    },
  }
}

/** =========================================================
 * ViewModel para os CARDS (pronto pra UI)
 * ========================================================= */
export interface CentroTrabalhoCardVM {
  id: string

  codigo: string | null
  nome: string | null
  ativo: boolean

  grupo_nome: string | null
  grupo_id: string | null

  status: StatusKey
  status_ct: string | null
  headline: string | null

  tempo_status_hms: string | null
  tempo_producao_hms: string | null
  tempo_parado_hms: string | null

  produto_public_id: string | null
  produto_descricao: string | null
  ciclo_ideal_seg: number | null

  ordem_codigo: string | null

  turno_id: string | null
  turno_nome: string | null
  turno_inicio_utc: string | null
  turno_fim_utc: string | null

  /** Produção do turno inteiro (soma de todas as OPs no turno) */
  produzido_turno: number
  scrap_turno: number
  rework_turno: number

  /** Produção da OP atual dentro do turno corrente (reseta na virada de turno) */
  corrida_good: number

  produzido_total: number
  scrap_total: number
  rework_total: number

  paradas_turno_qtd: number
  paradas_turno_tempo_seg: number
  paradas_turno_tempo_hms: string | null

  paradas_dia_qtd: number
  paradas_dia_tempo_seg: number
  paradas_dia_tempo_hms: string | null

  produzindo_dia_tempo_seg: number
  produzindo_dia_tempo_hms: string | null

  peca_total_good: number
  peca_meta_planejada: number
  peca_progresso_pct: number // 0..100

  meta_corrida: number

  capacidade_hora: number

  oee: number
  availability: number
  performance: number
  quality: number

  motivo_parada_id: string | null
  motivo_codigo: string | null
  motivo_descricao: string | null
  motivo_grupo_perda: string | null
  motivo_is_planejada: boolean | null
  parada_inicio_utc: string | null
  parada_duracao_seg: number

  modo_contagem: string | null

  /** Peças em retrabalho (rodízio), na ordem da fila cíclica.
   *  Vazio em modo REWORK = retrabalho atribuído à peça atual do CT. */
  retrabalho_pecas: string[]

  // OP anterior (última corrida finalizada)
  ordem_anterior_codigo: string | null
  ordem_anterior_good: number | null

  /** Rebarbador atribuído ao CT (NULL = Indefinido) */
  rebarbador?: { nome: string; registro: string | null; cargo: string | null } | null
}

export function useCentrosTrabalhoCards(params?: { centrosIds?: string[] }) {
  const cardsRes = useDashboardCards({ centrosIds: params?.centrosIds })
  const centrosBase = useCentrosTrabalhoBase()
  const grupos = useGrupos()

  const isLoading = !!(cardsRes.isLoading || centrosBase.isLoading || grupos.isLoading)
  const error = (cardsRes.error as any) || centrosBase.error || grupos.error

  const cards = normalizeArray<ApiDashboardCard>(cardsRes.data)

  const ctToSetor = new Map<string, string | null>()
  for (const c of centrosBase.data || []) {
    const key = c.public_id && isGuid(c.public_id) ? c.public_id.trim() : String(c.id ?? "").trim()
    if (!key) continue
    ctToSetor.set(key, c.setor_id != null ? String(c.setor_id) : null)
  }

  const setorToNome = new Map<string, string>()
  for (const g of grupos.data || []) {
    const sid = String(g.id ?? "").trim()
    if (!sid) continue
    setorToNome.set(sid, g.nome)
  }

  const now = Date.now()
  const nowShiftName = getShiftNameFromNow(new Date())

  const data: CentroTrabalhoCardVM[] = cards.map((c) => {
    const ctKey = String(c.centro_trabalho_id ?? "").trim()

    const setorId = ctToSetor.get(ctKey) ?? null
    const setorNome = setorId ? setorToNome.get(setorId) ?? null : null

    const status = mapStatusFromCTStatus(c.status_ct)

    const headline =
      status === "stopped"
        ? c.motivo_descricao?.trim()
          ? c.motivo_descricao
          : "Parada não justificada"
        : c.status_descricao?.trim()
          ? c.status_descricao
          : "Produzindo"

    const paradaInicioMs = parseIsoToMs(c.parada_inicio_utc)
    const corridaInicioMs = parseIsoToMs(c.corrida_inicio_utc)
    const segmentoInicioMs = parseIsoToMs(c.produzindo_segmento_inicio_utc)

    const paradaDurSeg =
      c.parada_duracao_seg != null
        ? Math.max(0, safeNum(c.parada_duracao_seg, 0))
        : paradaInicioMs != null
          ? Math.max(0, Math.floor((now - paradaInicioMs) / 1000))
          : 0

    const runDurSeg =
      status === "producing" && segmentoInicioMs != null
        ? Math.max(0, Math.floor((now - segmentoInicioMs) / 1000))
        : c.run_time_seg != null
          ? Math.max(0, safeNum(c.run_time_seg, 0))
          : corridaInicioMs != null
            ? Math.max(0, Math.floor((now - corridaInicioMs) / 1000))
            : 0

    const tempo_parado_hms = paradaDurSeg > 0 ? formatHMS(paradaDurSeg) : null
    const tempo_producao_hms = runDurSeg > 0 ? formatHMS(runDurSeg) : null
    const tempo_status_hms = status === "stopped" ? tempo_parado_hms : tempo_producao_hms

    const turnoNome = c.turno?.turno_nome?.trim() ? String(c.turno.turno_nome) : nowShiftName
    const turnoId = c.turno?.turno_id ?? null

    // Autoritativo: valor explícito da coluna vence; se NULL/vazio, cai no
    // fallback pelo nome do CT (compat legado com "retrabalho").
    const modoCol = String(c.modo_contagem ?? "").trim().toUpperCase()
    const isReworkCt = modoCol === "REWORK"
      || (modoCol !== "GOOD" && String(c.ct_nome ?? "").toLowerCase().includes("retrabalho"))
    const produzido_turno = isReworkCt
      ? pickNum(c, ["turno_rework", "rework_turno", "turno_total_rework", "total_rework_turno"], 0)
      : pickNum(c, ["turno_good", "good_turno", "turno_total_good", "produzido_turno", "total_good_turno"], 0)
    const scrap_turno = pickNum(c, ["turno_scrap", "scrap_turno", "turno_total_scrap", "total_scrap_turno"], 0)
    const rework_turno = pickNum(c, ["turno_rework", "rework_turno", "turno_total_rework", "total_rework_turno"], 0)
    // Produção apenas da OP corrente dentro do turno (reseta na virada de turno)
    const corrida_good = isReworkCt
      ? pickNum(c, ["turno_rework", "rework_turno"], 0)
      : safeNum(c.corrida_turno_good, 0)

    const produzido_total = safeNum(c.total_good, 0)
    const scrap_total = safeNum(c.total_scrap, 0)
    const rework_total = safeNum(c.total_rework, 0)

    const paradas_turno_qtd = pickNum(c, ["paradas_turno_qtd", "turno_paradas_qtd", "paradas_no_turno", "qtd_paradas_turno"], 0)
    const paradas_turno_tempo_seg = pickNum(c, ["paradas_turno_tempo_seg", "turno_paradas_duracao_seg", "tempo_parado_turno_seg", "paradas_turno_duracao_seg"], 0)

    const paradas_dia_qtd = pickNum(c, ["paradas_dia_qtd", "qtd_paradas_dia", "paradas_no_dia"], 0)
    const paradas_dia_tempo_seg = pickNum(c, ["paradas_dia_tempo_seg", "tempo_parado_dia_seg"], 0)

    const produzindo_dia_tempo_seg = pickNum(c, ["produzindo_dia_tempo_seg", "run_time_dia_seg", "tempo_produzindo_dia_seg"], 0)

    // Progresso global: soma de TODAS as corridas de TODOS os CTs para o produto.
    // produto_producao_total_good vem do backend (SQL_PRODUTO_PROGRESSO_BASE — sem filtro de CT ou turno).
    // produto_total_good_historico é fallback (vem da view, escopo por CT/mês).
    const peca_total_good = pickNum(c, ["produto_producao_total_good", "produto_total_good_historico", "produto_total_good", "peca_total_good"], 0)

    const metaFromApi = pickNum(c, ["produto_meta_planejada", "produto_meta", "meta_planejada"], 0)
    const peca_meta_planejada = metaFromApi > 0 ? metaFromApi : 5_000_000

    const progressoRatio = (() => {
      // produto_progresso_pct = peca_total_good_global / meta (calculado no backend, cross-CT).
      // Usar diretamente quando disponível para garantir consistência entre todos os cards.
      const v = (c as any)?.produto_progresso_pct
      if (v != null) {
        const n = safeNum(v, 0)
        return n <= 1.5 ? n : n / 100
      }
      const m = peca_meta_planejada > 0 ? peca_meta_planejada : 1
      return peca_total_good / m
    })()
    const peca_progresso_pct = Math.max(0, Math.min(100, normalizeRatioToPct(progressoRatio)))

    const meta_corrida = c.meta_corrida != null ? safeNum(c.meta_corrida, 0) : 0

    const oee = normalizePct(c.oee)
    const availability = normalizePct(c.availability)
    const performance = normalizePct(c.performance)
    const quality = normalizePct(c.quality)

    return {
      id: ctKey,

      codigo: c.ct_codigo ?? null,
      nome: c.ct_nome ?? null,
      ativo: true,

      grupo_nome: setorNome,
      grupo_id: setorId,

      status,
      status_ct: c.status_ct ?? null,
      headline,

      tempo_status_hms,
      tempo_producao_hms,
      tempo_parado_hms,

      produto_public_id: c.produto_public_id ?? null,
      produto_descricao: c.produto_descricao ?? null,
      ciclo_ideal_seg: c.produto_ciclo_ideal_seg ?? null,

      ordem_codigo: c.ordem_codigo ?? null,

      turno_id: turnoId,
      turno_nome: turnoNome,
      turno_inicio_utc: c.turno?.inicio_utc ?? null,
      turno_fim_utc: c.turno?.fim_utc ?? null,

      produzido_turno,
      scrap_turno,
      rework_turno,
      corrida_good,

      produzido_total,
      scrap_total,
      rework_total,

      paradas_turno_qtd,
      paradas_turno_tempo_seg,
      paradas_turno_tempo_hms: formatHMS(paradas_turno_tempo_seg),

      paradas_dia_qtd,
      paradas_dia_tempo_seg,
      paradas_dia_tempo_hms: formatHMS(paradas_dia_tempo_seg),

      produzindo_dia_tempo_seg,
      produzindo_dia_tempo_hms: formatHMS(produzindo_dia_tempo_seg),

      peca_total_good,
      peca_meta_planejada,
      peca_progresso_pct,

      meta_corrida,

      capacidade_hora: calcCapacidadeHora(c.produto_ciclo_ideal_seg ?? null),

      oee,
      availability,
      performance,
      quality,

      motivo_parada_id: c.motivo_parada_id ?? null,
      motivo_codigo: c.motivo_codigo ?? null,
      motivo_descricao: c.motivo_descricao ?? null,
      motivo_grupo_perda: c.motivo_grupo_perda ?? null,
      motivo_is_planejada: c.motivo_is_planejada ?? null,
      parada_inicio_utc: c.parada_inicio_utc ?? null,
      parada_duracao_seg: paradaDurSeg,

      modo_contagem: isReworkCt ? "REWORK" : "GOOD",
      retrabalho_pecas: Array.isArray((c as any).retrabalho_pecas)
        ? ((c as any).retrabalho_pecas as any[]).map((x) => String(x)).filter(Boolean)
        : [],

      ordem_anterior_codigo: c.ordem_anterior_codigo ?? null,
      ordem_anterior_good: c.ordem_anterior_good != null ? safeNum(c.ordem_anterior_good, 0) : null,

      rebarbador: (c as any).rebarbador ?? null,
    }
  })

  const mutate: KeyedMutator<CentroTrabalhoCardVM[]> = async () => {
    await Promise.all([cardsRes.mutate(), centrosBase.mutate(), grupos.mutate()])
    return data
  }

  return { data, error, isLoading, mutate }
}

/** =========================================================
 * Stats por TURNO e por CT (derivado dos cards)
 * ========================================================= */
export interface TurnoCentroTrabalhoStatsRow {
  turno_id: string | null
  turno_nome: string | null
  turno_inicio_utc: string | null
  turno_fim_utc: string | null

  centro_trabalho_id: string
  ct_codigo: string | null
  ct_nome: string | null

  turno_good: number
  turno_scrap: number
  turno_rework: number
  turno_total_pecas: number

  paradas_turno_qtd: number
  paradas_turno_tempo_seg: number
  paradas_turno_tempo_hms: string | null
}

export function useTurnoCentroTrabalhoStatsFromCards(params?: { centrosIds?: string[] }) {
  const centros = useCentrosTrabalhoCards(params)
  const stations = centros.data || []

  const rows: TurnoCentroTrabalhoStatsRow[] = stations.map((s) => {
    const turno_good = safeNum(s.produzido_turno, 0)
    const turno_scrap = safeNum(s.scrap_turno, 0)
    const turno_rework = safeNum(s.rework_turno, 0)
    const turno_total_pecas = turno_good + turno_scrap + turno_rework

    return {
      turno_id: s.turno_id ?? null,
      turno_nome: s.turno_nome ?? null,
      turno_inicio_utc: s.turno_inicio_utc ?? null,
      turno_fim_utc: s.turno_fim_utc ?? null,

      centro_trabalho_id: s.id,
      ct_codigo: s.codigo ?? null,
      ct_nome: s.nome ?? null,

      turno_good,
      turno_scrap,
      turno_rework,
      turno_total_pecas,

      paradas_turno_qtd: safeNum(s.paradas_turno_qtd, 0),
      paradas_turno_tempo_seg: safeNum(s.paradas_turno_tempo_seg, 0),
      paradas_turno_tempo_hms: formatHMS(s.paradas_turno_tempo_seg),
    }
  })

  return {
    data: rows,
    error: centros.error,
    isLoading: centros.isLoading,
    mutate: centros.mutate as any,
  }
}

/** =========================================================
 * Totais agregados por TURNO (somando todos os CTs)
 * ========================================================= */
export interface TotaisPorTurnoRow {
  turno_id: string | null
  turno_nome: string | null
  turno_inicio_utc: string | null
  turno_fim_utc: string | null

  centros_qtd: number

  total_good: number
  total_scrap: number
  total_rework: number
  total_pecas: number

  paradas_qtd: number
  paradas_tempo_seg: number
  paradas_tempo_hms: string | null
}

export function useTotaisPorTurnoFromCards(params?: { centrosIds?: string[] }) {
  const stats = useTurnoCentroTrabalhoStatsFromCards(params)
  const rows = stats.data || []

  const map = new Map<string, TotaisPorTurnoRow>()

  for (const r of rows) {
    const key = r.turno_id ?? `${r.turno_nome ?? "turno"}|${r.turno_inicio_utc ?? ""}`

    const cur =
      map.get(key) ??
      ({
        turno_id: r.turno_id ?? null,
        turno_nome: r.turno_nome ?? null,
        turno_inicio_utc: r.turno_inicio_utc ?? null,
        turno_fim_utc: r.turno_fim_utc ?? null,
        centros_qtd: 0,
        total_good: 0,
        total_scrap: 0,
        total_rework: 0,
        total_pecas: 0,
        paradas_qtd: 0,
        paradas_tempo_seg: 0,
        paradas_tempo_hms: null,
      } satisfies TotaisPorTurnoRow)

    cur.centros_qtd += 1
    cur.total_good += safeNum(r.turno_good, 0)
    cur.total_scrap += safeNum(r.turno_scrap, 0)
    cur.total_rework += safeNum(r.turno_rework, 0)
    cur.paradas_qtd += safeNum(r.paradas_turno_qtd, 0)
    cur.paradas_tempo_seg += safeNum(r.paradas_turno_tempo_seg, 0)

    map.set(key, cur)
  }

  const out = Array.from(map.values()).map((t) => {
    const total_pecas = safeNum(t.total_good, 0) + safeNum(t.total_scrap, 0) + safeNum(t.total_rework, 0)
    return {
      ...t,
      total_pecas,
      paradas_tempo_hms: formatHMS(t.paradas_tempo_seg),
    }
  })

  out.sort((a, b) => {
    const ta = a.turno_inicio_utc ? new Date(a.turno_inicio_utc).getTime() : 0
    const tb = b.turno_inicio_utc ? new Date(b.turno_inicio_utc).getTime() : 0
    return tb - ta
  })

  return {
    data: out,
    error: stats.error,
    isLoading: stats.isLoading,
    mutate: stats.mutate as any,
  }
}

/** =========================================================
 * Stats topo (derivado dos cards)
 * ========================================================= */
export interface DashboardStats {
  total_centros: number
  produzindo: number
  parados: number
  oee_medio: number
  total_turno_good: number
  total_turno_scrap: number
  total_turno_rework: number

  total_paradas_turno: number
  tempo_parado_turno_seg: number
  tempo_produzindo_dia_seg: number
  tempo_parado_dia_seg: number
}

export function useDashboardStatsFromCards(params?: { centrosIds?: string[] }) {
  const centros = useCentrosTrabalhoCards(params)

  const stations = centros.data || []
  const total_centros = stations.length

  const produzindo = stations.filter((s) => s.status === "producing").length
  const parados = stations.filter((s) => s.status === "stopped").length

  const stationsProduzindo = stations.filter((s) => s.status === "producing")
  // Exclui CTs produzindo que ainda não têm dados de OEE (oee=0 por ausência de eventos).
  // Incluí-los na média puxaria o valor para baixo incorretamente.
  const oeeVals = stationsProduzindo
    .map((s) => Number(s.oee))
    .filter((v) => Number.isFinite(v) && v > 0)

  const oee_medio = oeeVals.length
    ? oeeVals.reduce((a, b) => a + b, 0) / oeeVals.length
    : 0

  const total_turno_good = stations.reduce((acc, s) => acc + safeNum(s.produzido_turno, 0), 0)
  const total_turno_scrap = stations.reduce((acc, s) => acc + safeNum(s.scrap_turno, 0), 0)
  const total_turno_rework = stations.reduce((acc, s) => acc + safeNum(s.rework_turno, 0), 0)

  const total_paradas_turno = stations.reduce((acc, s) => acc + safeNum(s.paradas_turno_qtd, 0), 0)
  const tempo_parado_turno_seg = stations.reduce((acc, s) => acc + safeNum(s.paradas_turno_tempo_seg, 0), 0)

  const tempo_produzindo_dia_seg = stations.reduce((acc, s) => acc + safeNum(s.produzindo_dia_tempo_seg, 0), 0)
  const tempo_parado_dia_seg = stations.reduce((acc, s) => acc + safeNum(s.paradas_dia_tempo_seg, 0), 0)

  return {
    data: {
      total_centros,
      produzindo,
      parados,
      oee_medio,
      total_turno_good,
      total_turno_scrap,
      total_turno_rework,
      total_paradas_turno,
      tempo_parado_turno_seg,
      tempo_produzindo_dia_seg,
      tempo_parado_dia_seg,
    } satisfies DashboardStats,
    error: centros.error,
    isLoading: centros.isLoading,
    mutate: centros.mutate as any,
  }
}

/** =========================================================
 * Totais por PEÇA (agora inclui meta/progresso)
 * ========================================================= */
export interface TotaisPorPecaRow {
  produto_public_id: string
  produto_descricao: string | null

  total_good: number
  total_scrap: number
  total_rework: number

  turno_good: number
  turno_scrap: number
  turno_rework: number

  peca_total_good: number
  peca_meta_planejada: number
  peca_progresso_pct: number
}

export function useTotaisPorPecaFromCards(params?: { centrosIds?: string[] }) {
  const centros = useCentrosTrabalhoCards(params)
  const stations = centros.data || []

  const map = new Map<string, TotaisPorPecaRow>()

  for (const s of stations) {
    const key = (s.produto_public_id || "").trim()
    if (!key) continue

    const cur =
      map.get(key) ??
      ({
        produto_public_id: key,
        produto_descricao: s.produto_descricao ?? null,
        total_good: 0,
        total_scrap: 0,
        total_rework: 0,
        turno_good: 0,
        turno_scrap: 0,
        turno_rework: 0,
        peca_total_good: 0,
        peca_meta_planejada: 0,
        peca_progresso_pct: 0,
      } satisfies TotaisPorPecaRow)

    cur.total_good += safeNum(s.produzido_total, 0)
    cur.total_scrap += safeNum(s.scrap_total, 0)
    cur.total_rework += safeNum(s.rework_total, 0)

    cur.turno_good += safeNum(s.produzido_turno, 0)
    cur.turno_scrap += safeNum(s.scrap_turno, 0)
    cur.turno_rework += safeNum(s.rework_turno, 0)

    cur.peca_total_good = Math.max(cur.peca_total_good, safeNum(s.peca_total_good, 0))
    cur.peca_meta_planejada = Math.max(cur.peca_meta_planejada, safeNum(s.peca_meta_planejada, 0))
    cur.peca_progresso_pct = Math.max(cur.peca_progresso_pct, safeNum(s.peca_progresso_pct, 0))

    if (!cur.produto_descricao && s.produto_descricao) cur.produto_descricao = s.produto_descricao

    map.set(key, cur)
  }

  const rows = Array.from(map.values()).sort((a, b) => b.turno_good - a.turno_good)

  return {
    data: rows,
    error: centros.error,
    isLoading: centros.isLoading,
    mutate: centros.mutate as any,
  }
}

/** =========================================================
 * "Total de paradas no DIA" (legacy)
 * ========================================================= */
export function useTotalParadasNoDia(params: { centroTrabalhoId: string | null; dia: string | null }) {
  const ok = !!(params.centroTrabalhoId && params.dia)
  const perdas = useDashboardPerdasPorPeriodo({
    centroTrabalhoId: ok ? params.centroTrabalhoId : null,
    dataInicio: ok ? params.dia : null,
    dataFim: ok ? params.dia : null,
  })

  const rows = normalizeArray<PerdasPorPeriodoRow>(perdas.data)
  const total_paradas = rows.reduce((acc, r) => acc + safeNum(r.ocorrencias, 0), 0)

  return {
    data: { total_paradas },
    error: perdas.error,
    isLoading: perdas.isLoading,
    mutate: perdas.mutate,
  }
}

/** =========================================================
 * Outros hooks (não-dashboard)  alinhados ao route.ts
 * ========================================================= */
export interface Turno {
  id: Id
  nome: string
  hora_inicio: string
  hora_fim: string
}

export interface Produto {
  id: Id
  codigo: string | null
  nome: string | null
  descricao: string | null
  unidade_medida?: string | null
  tempo_ciclo_padrao?: number | null
}

export interface Usuario {
  id: Id
  nome: string
  email: string
  cargo: string | null
}

export interface MotivoParada {
  id: Id
  nome: string
  descricao: string | null
  tipo?: string | null
  afeta_disponibilidade?: boolean | null
  afeta_performance?: boolean | null
  afeta_qualidade?: boolean | null
  codigo?: string | null
  grupo_perda?: string | null
  is_planejada?: boolean | null
  exige_justificativa?: boolean | null
}

export interface Anotacao {
  id: Id
  data_hora: string
  texto: string
  created_at: string
  centro_trabalho_id: Id | null
  centro_trabalho_nome: string | null
  usuario_id: Id | null
  usuario_nome: string | null
}

export interface PlanoAcao {
  id: Id
  o_que: string
  como: string | null
  por_que: string | null
  quando: string | null
  estado: string
  anotacoes: string | null
  created_at: string | null
  onde_id: Id | null
  onde_nome: string | null
  quem_id: Id | null
  quem_nome: string | null
}

export interface Ordem {
  id: Id
  codigo: string | null
  quantidade_planejada: number | null
  quantidade_produzida: number | null
  quantidade_rejeitada: number | null
  estado: string | null
  data_inicio_planejado: string | null
  data_fim_planejado: string | null
  data_inicio_real: string | null
  data_fim_real: string | null
  prioridade: number | null
  produto_id: Id | null
  produto_codigo: string | null
  produto_nome: string | null
  centro_trabalho_id: Id | null
  centro_trabalho_nome: string | null
}

export interface ProducaoHora {
  hora: number
  producao: number
  capacidade: number
}

export interface ProducaoDia {
  data: string
  producao: number
  capacidade: number
}

export interface OEEData {
  disponibilidade: number
  performance: number
  qualidade: number
  oee: number
}

export interface Perda {
  motivo: string
  tipo: string
  quantidade: number
  duracao_minutos: number
}

export interface ParadaAtiva {
  id: Id
  inicio: string
  observacao: string | null
  centro_trabalho_id: Id | null
  centro_trabalho_nome: string | null
  motivo_id: Id | null
  motivo_nome: string | null
  motivo_tipo: string | null
  equipamento_id: Id | null
  equipamento_nome: string | null
  duracao_minutos: number
}

export interface ParadaNaoJustificada {
  id: Id
  inicio: string
  fim: string | null
  observacao: string | null
  centro_trabalho_id: Id | null
  centro_trabalho_nome: string | null
  duracao_minutos: number
}

export interface PlanoMelhoria {
  id: Id
  titulo: string
  descricao: string | null
  estado: string
  data_inicio: string | null
  data_conclusao: string | null
  resultado_esperado: string | null
  resultado_obtido: string | null
  criado_em: string | null
  centro_trabalho_id: Id | null
  centro_trabalho_nome: string | null
  responsavel_id: Id | null
  responsavel_nome: string | null
}

export interface ProducaoOrdem {
  produto_codigo: string
  produto_nome: string
  ordem_codigo: string
  producao_ordem: number
  producao_produto: number
}

export interface ParadaRow {
  id: string
  centro_trabalho_id: string
  corrida_id: string | null
  motivo_id: string | null
  data_hora_inicio: string
  data_hora_fim: string | null
  inicio_utc?: string | null
  fim_utc?: string | null
  justificada: boolean
  observacoes: string | null
  duracao_seg: number | null
  created_at?: string | null
  updated_at?: string | null
}

export function useTurnos() {
  return useApiData<Turno[]>("turnos")
}
export function useProdutos() {
  return useApiData<Produto[]>("produtos")
}
export function useUsuarios() {
  return useApiData<Usuario[]>("usuarios")
}
export function useMotivosParada() {
  return useApiData<MotivoParada[]>("motivos-parada")
}

export function useAnotacoes(params?: { centroTrabalhoId?: number | string }) {
  return useApiData<Anotacao[]>("anotacoes", params as any)
}

export function usePlanosAcao() {
  return useApiData<PlanoAcao[]>("planos-acao")
}

export function useOrdens(params?: { status?: string; centroTrabalhoId?: number | string }) {
  return useApiData<Ordem[]>("ordens", params as any)
}

export function useParadas(params?: { centroTrabalhoId?: string; justificada?: boolean | null }) {
  return useApiData<ParadaRow[]>("paradas", params as any)
}

export function useProducaoHora(params?: {
  dataInicio?: string
  dataFim?: string
  centrosIds?: string
  turnosIds?: string
}) {
  return useApiData<ProducaoHora[]>("relatorios/producao-hora", params)
}

export function useProducaoDia(params?: {
  dataInicio?: string
  dataFim?: string
  centrosIds?: string
  turnosIds?: string
}) {
  return useApiData<ProducaoDia[]>("relatorios/producao-dia", params)
}

export function useOEE(params?: { dataInicio?: string; dataFim?: string; centrosIds?: string; turnosIds?: string }) {
  return useApiData<OEEData>("relatorios/oee-consolidado", params)
}

export function usePerdas(params?: { dataInicio?: string; dataFim?: string; centrosIds?: string }) {
  return useApiData<Perda[]>("relatorios/perdas", params)
}

export function useParadasAtivas() {
  return useApiData<ParadaAtiva[]>("paradas/ativas")
}

export function useParadasNaoJustificadas() {
  return useApiData<ParadaNaoJustificada[]>("paradas/nao-justificadas")
}

export function usePlanosMelhoria(params?: { estado?: string; search?: string; grupoPerda?: string }) {
  return useApiData<PlanoMelhoria[]>("planos-melhoria", params as any)
}

export function useProducaoOrdem(params?: { dataInicio?: string; dataFim?: string; centrosIds?: string }) {
  return useApiData<ProducaoOrdem[]>("relatorios/producao-por-ordem", params)
}

// ─── OEE TENDÊNCIA DIA OPERACIONAL ────────────────────────────────────────────

/** Shape retornado por /api/db/dashboard/oee-consolidado-turnos */
export type OeeConsolidadoTurnoRow = {
  turno_id: string | null
  turno_nome: string | null
  inicio_utc: string
  fim_utc: string
  turno_good: number
  turno_scrap: number
  turno_rework: number
  total_pecas: number
  /** Tempo operante consolidado (s) */
  run_time_seg: number | null
  /** Tempo planejado consolidado (s) */
  planned_time_seg: number | null
  /** Tempo ideal consolidado (s) */
  ideal_time_seg: number | null
  /** 0..1 */
  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null
}

/**
 * OEE consolidado por turno do dia operacional (06h→06h).
 * Fonte: /api/db/dashboard/oee-consolidado-turnos
 * Atualiza a cada 30 segundos.
 */
export function useOeeTendenciaDia() {
  return useSWR<OeeConsolidadoTurnoRow[]>(
    `${API_BASE}/dashboard/oee-consolidado-turnos`,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false, dedupingInterval: 20_000 }
  )
}
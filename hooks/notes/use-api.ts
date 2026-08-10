"use client"
// hooks/notes/use-api.ts
//
// ✅ Autenticação via cookie de sessão.
//    empresa_id e usuario_id são resolvidos pela camada de dados a partir da
//    sessão — o frontend não os envia no body nem na URL.
//
// ✅ Compatível com dois formatos de resposta:
//    1) Wrapper: { success: true, data: ... }  (e { success:false, error:"..." })
//    2) JSON direto: array/objeto
//
// ✅ Suporte a anexos: upload via base64 (arquivo → BD) ou via URL externa (S3, etc.)
// ✅ Sync de anexos no PATCH: anexos_add[] + anexos_remove[]
// ✅ Cascade automático de anexos no DELETE (feito pelo backend)

import useSWR, { mutate as swrMutate } from "swr"

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "/api/db"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — Anexos
// ─────────────────────────────────────────────────────────────────────────────

export interface Anexo {
  id: string
  public_id: string
  file_name: string
  content_type: string | null
  file_size_bytes: number | null
  file_url: string | null
  storage_provider: string | null
  created_at: string | null
}

/**
 * Objeto usado para adicionar um novo anexo via PATCH ou POST.
 * Escolha UM dos dois: file_url (armazenamento externo) ou
 * file_data_base64 (grava o binário direto no banco de dados).
 */
export interface AnexoInput {
  file_name: string
  content_type?: string | null
  file_size_bytes?: number | null
  file_hash_sha256?: string | null
  storage_provider?: string | null
  storage_bucket?: string | null
  storage_path?: string | null
  /** URL pública ou assinada do arquivo (S3, Azure, Cloudinary…) */
  file_url?: string | null
  /** Conteúdo do arquivo codificado em base64 — armazenado no BD */
  file_data_base64?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — Anotações
// ─────────────────────────────────────────────────────────────────────────────

export interface Anotacao {
  id: string
  data_hora: string | null
  texto: string
  centro_trabalho_id: string | null
  centro_trabalho_nome: string | null
  usuario_nome: string | null
  created_at: string | null
}

/** Anotação com anexos embutidos — retornado pelo GET ?anotacao_id=xxx */
export interface AnotacaoComAnexos extends Anotacao {
  anexos: Anexo[]
}

export interface CreateAnotacaoPayload {
  texto: string
  centro_trabalho_id?: string | null
  data_hora?: string | null
  /** Anexos para já criar junto com a anotação */
  anexos?: AnexoInput[]
}

export interface UpdateAnotacaoPayload {
  anotacao_id: string
  texto?: string
  centro_trabalho_id?: string | null
  data_hora?: string | null
  /** Novos anexos a adicionar */
  anexos_add?: AnexoInput[]
  /** IDs dos anexos a remover */
  anexos_remove?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — Planos de Ação
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanoAcao {
  id: string
  item_id: string
  quando: string | null
  onde_nome: string | null
  centro_trabalho_id: string | null
  o_que: string
  como: string | null
  por_que: string | null
  estado: string
  quem_id: string | null
  quem_nome: string | null
  observacoes: string | null
  created_at: string | null
  updated_at: string | null
}

/** Plano com anexos embutidos — retornado pelo GET ?plano_acao_id=xxx */
export interface PlanoAcaoComAnexos extends PlanoAcao {
  anexos: Anexo[]
}

export interface CreatePlanoAcaoPayload {
  o_que: string
  como?: string | null
  por_que?: string | null
  centro_trabalho_id?: string | null
  responsavel_id?: string | null
  quando?: string | null
  estado?: string
  observacoes?: string | null
  /** Anexos para já criar junto com o plano */
  anexos?: AnexoInput[]
}

export interface UpdatePlanoAcaoPayload {
  plano_acao_id: string
  estado?: string | null
  o_que?: string | null
  como?: string | null
  por_que?: string | null
  quando?: string | null
  observacoes?: string | null
  /** Novos anexos a adicionar */
  anexos_add?: AnexoInput[]
  /** IDs dos anexos a remover */
  anexos_remove?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — Auxiliares
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiCentroTrabalhoBase {
  id: string
  nome: string | null
  codigo: string | null
}

export interface Usuario {
  id: string
  nome: string
  email: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos — parsing e normalização de resposta
// ─────────────────────────────────────────────────────────────────────────────

type ApiWrappedSuccess<T> = { success: true; data: T }
type ApiWrappedError = { success: false; error?: string; message?: string }
type ApiWrapped<T> = ApiWrappedSuccess<T> | ApiWrappedError

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null
}

function isWrappedResponse<T>(json: unknown): json is ApiWrapped<T> {
  return isObject(json) && Object.prototype.hasOwnProperty.call(json, "success")
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (isObject(json)) {
    const msg =
      (typeof json.error === "string" && json.error) ||
      (typeof json.message === "string" && json.message)
    if (msg) return msg
  }
  return fallback
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function handleAuthRedirect(): never {
  if (typeof window !== "undefined") window.location.href = "/login"
  throw new Error("Sessão expirada. Redirecionando para login...")
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetcher SWR — cookie enviado automaticamente via credentials: "include"
// ─────────────────────────────────────────────────────────────────────────────

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })

  if (res.status === 401 || res.status === 403) handleAuthRedirect()

  const json = await safeJson(res)

  if (!res.ok) {
    throw new Error(extractErrorMessage(json, `Erro ${res.status}`))
  }

  if (isWrappedResponse<T>(json)) {
    if (!json.success) throw new Error(extractErrorMessage(json, `Erro ${res.status}`))
    return json.data as T
  }

  return json as T
}

// ─────────────────────────────────────────────────────────────────────────────
// authFetch — fetch autenticado para POST / PATCH / DELETE (apenas JSON)
// ─────────────────────────────────────────────────────────────────────────────

async function authFetch<T = any>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, any>
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 || res.status === 403) handleAuthRedirect()

  const json = await safeJson(res)

  if (!res.ok) {
    throw new Error(extractErrorMessage(json, `Erro ${res.status} em ${method} ${url}`))
  }

  if (isWrappedResponse<T>(json)) {
    if (!json.success) {
      throw new Error(extractErrorMessage(json, `Erro ${res.status} em ${method} ${url}`))
    }
    return json.data as T
  }

  return json as T
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitário — converte File → base64 string
// Usado para enviar arquivos via JSON (file_data_base64)
// ─────────────────────────────────────────────────────────────────────────────

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // result: "data:application/pdf;base64,AAAA..." → pega só após a vírgula
      const result = reader.result as string
      resolve(result.includes(",") ? result.split(",")[1] : result)
    }
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."))
    reader.readAsDataURL(file)
  })
}

/**
 * Converte um File em AnexoInput pronto para enviar ao backend.
 * Usa base64 para armazenar o binário diretamente no banco.
 */
export async function fileToAnexoInput(file: File): Promise<AnexoInput> {
  const base64 = await fileToBase64(file)
  return {
    file_name:       file.name,
    content_type:    file.type || null,
    file_size_bytes: file.size,
    file_data_base64: base64,
    storage_provider: "db",
  }
}

/**
 * Converte um File para AnexoInput usando uma URL externa já hospedada.
 * Ideal quando o arquivo foi previamente enviado para S3, Azure, Cloudinary etc.
 */
export function urlToAnexoInput(
  file_name: string,
  file_url: string,
  opts?: {
    content_type?: string
    file_size_bytes?: number
    storage_provider?: string
    storage_path?: string
  }
): AnexoInput {
  return {
    file_name,
    file_url,
    content_type:     opts?.content_type     ?? null,
    file_size_bytes:  opts?.file_size_bytes   ?? null,
    storage_provider: opts?.storage_provider  ?? null,
    storage_path:     opts?.storage_path      ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANOTAÇÕES — hooks e funções
// ─────────────────────────────────────────────────────────────────────────────

export interface UseAnotacoesParams {
  centro_trabalho_id?: string | null
  data_inicio?: string | null
  data_fim?: string | null
  search?: string | null
}

/** Lista todas as anotações (sem anexos embutidos). */
export function useAnotacoes(params?: UseAnotacoesParams) {
  const sp = new URLSearchParams()
  if (params?.centro_trabalho_id) sp.set("centro_trabalho_id", params.centro_trabalho_id)
  if (params?.data_inicio)        sp.set("data_inicio",        params.data_inicio)
  if (params?.data_fim)           sp.set("data_fim",           params.data_fim)
  if (params?.search)             sp.set("search",             params.search)

  const query = sp.toString()
  const key   = `${API_BASE}/anotacoes${query ? `?${query}` : ""}`

  return useSWR<Anotacao[]>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })
}

/**
 * Busca uma anotação específica com seus anexos embutidos.
 * GET /api/db/anotacoes?anotacao_id=xxx
 */
export function useAnotacaoComAnexos(anotacao_id: string | null) {
  const key = anotacao_id
    ? `${API_BASE}/anotacoes?anotacao_id=${anotacao_id}`
    : null

  return useSWR<AnotacaoComAnexos>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })
}

/** Cria uma nova anotação, com ou sem anexos. */
export async function apiCreateAnotacao(
  payload: CreateAnotacaoPayload
): Promise<AnotacaoComAnexos> {
  return authFetch<AnotacaoComAnexos>(`${API_BASE}/anotacoes`, "POST", payload)
}

/**
 * Atualiza uma anotação existente.
 * Só envia o que realmente mudou — campos não enviados são preservados (COALESCE no SQL).
 * Inclua `anexos_add` e/ou `anexos_remove` apenas se houver mudança de anexos.
 */
export async function apiUpdateAnotacao(
  payload: UpdateAnotacaoPayload
): Promise<AnotacaoComAnexos> {
  return authFetch<AnotacaoComAnexos>(`${API_BASE}/anotacoes`, "PATCH", payload)
}

/**
 * Exclui uma anotação + todos os anexos vinculados (cascade automático no backend).
 */
export async function apiDeleteAnotacao(anotacao_id: string): Promise<void> {
  await authFetch(`${API_BASE}/anotacoes`, "DELETE", { anotacao_id })
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANOS DE AÇÃO — hooks e funções
// ─────────────────────────────────────────────────────────────────────────────

export interface UsePlanosAcaoParams {
  centro_trabalho_id?: string | null
  estado?: string | null
  data_inicio?: string | null
  data_fim?: string | null
  search?: string | null
}

/** Lista todos os planos de ação (sem anexos embutidos). */
export function usePlanosAcao(params?: UsePlanosAcaoParams) {
  const sp = new URLSearchParams()
  if (params?.centro_trabalho_id) sp.set("centro_trabalho_id", params.centro_trabalho_id)
  if (params?.estado)             sp.set("estado",             params.estado)
  if (params?.data_inicio)        sp.set("data_inicio",        params.data_inicio)
  if (params?.data_fim)           sp.set("data_fim",           params.data_fim)
  if (params?.search)             sp.set("search",             params.search)

  const query = sp.toString()
  const key   = `${API_BASE}/planos-acao${query ? `?${query}` : ""}`

  return useSWR<PlanoAcao[]>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })
}

/**
 * Busca um plano de ação específico com seus anexos embutidos.
 * GET /api/db/planos-acao?plano_acao_id=xxx
 */
export function usePlanoAcaoComAnexos(plano_acao_id: string | null) {
  const key = plano_acao_id
    ? `${API_BASE}/planos-acao?plano_acao_id=${plano_acao_id}`
    : null

  return useSWR<PlanoAcaoComAnexos>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })
}

/** Cria um novo plano de ação, com ou sem anexos. */
export async function apiCreatePlanoAcao(
  payload: CreatePlanoAcaoPayload
): Promise<PlanoAcaoComAnexos> {
  return authFetch<PlanoAcaoComAnexos>(`${API_BASE}/planos-acao`, "POST", payload)
}

/**
 * Atualiza um plano de ação existente.
 * Só envia o que realmente mudou — campos não enviados são preservados (COALESCE no SQL).
 * Inclua `anexos_add` e/ou `anexos_remove` apenas se houver mudança de anexos.
 */
export async function apiUpdatePlanoAcao(
  payload: UpdatePlanoAcaoPayload
): Promise<PlanoAcaoComAnexos> {
  return authFetch<PlanoAcaoComAnexos>(`${API_BASE}/planos-acao`, "PATCH", payload)
}

/**
 * Exclui um plano de ação, seus itens e todos os anexos vinculados (cascade automático).
 */
export async function apiDeletePlanoAcao(plano_acao_id: string): Promise<void> {
  await authFetch(`${API_BASE}/planos-acao`, "DELETE", { plano_acao_id })
}

// ─────────────────────────────────────────────────────────────────────────────
// ANEXOS — hooks e funções
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os anexos de uma entidade.
 * Útil quando se quer buscar apenas os anexos sem recarregar a entidade inteira.
 */
export function useAnexos(
  entidade: "anotacao" | "plano_acao",
  entidade_id: string | null
) {
  const key = entidade_id
    ? `${API_BASE}/anexos?entidade=${entidade}&entidade_id=${entidade_id}`
    : null

  return useSWR<Anexo[]>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })
}

/**
 * Cria um único anexo e o vincula a uma entidade.
 *
 * Exemplos de uso:
 *
 * // Via base64 (armazenado no BD):
 * const input = await fileToAnexoInput(file)
 * await apiCreateAnexo("anotacao", anotacao_id, input)
 *
 * // Via URL externa (S3, Cloudinary…):
 * const input = urlToAnexoInput(file.name, "https://…/arquivo.pdf", { content_type: "application/pdf" })
 * await apiCreateAnexo("plano_acao", plano_id, input)
 */
export async function apiCreateAnexo(
  entidade: "anotacao" | "plano_acao",
  entidade_id: string,
  input: AnexoInput
): Promise<Anexo> {
  return authFetch<Anexo>(`${API_BASE}/anexos`, "POST", {
    entidade,
    entidade_id,
    ...input,
  })
}

/**
 * Faz upload de múltiplos arquivos (File[]) para uma entidade,
 * convertendo cada um para base64 antes de enviar.
 *
 * Para arquivos grandes prefira hospedar no storage externo e usar
 * `apiCreateAnexo` com `file_url` em vez de base64.
 */
export async function apiUploadAnexos(
  entidade: "anotacao" | "plano_acao",
  entidade_id: string,
  files: File[]
): Promise<Anexo[]> {
  const results: Anexo[] = []
  for (const file of files) {
    const input = await fileToAnexoInput(file)
    const anexo = await apiCreateAnexo(entidade, entidade_id, input)
    results.push(anexo)
  }
  return results
}

/** Remove um anexo individual (soft-delete). */
export async function apiDeleteAnexo(anexo_id: string): Promise<void> {
  await authFetch(`${API_BASE}/anexos`, "DELETE", { anexo_id })
}

// ─────────────────────────────────────────────────────────────────────────────
// GENÉRICOS — mantidos para compatibilidade com código existente
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Prefira apiCreateAnotacao ou apiCreatePlanoAcao com tipagem forte. */
export async function apiCreate(
  resource: "anotacoes" | "planos-acao" | string,
  body: Record<string, any>
): Promise<any> {
  return authFetch(`${API_BASE}/${resource}`, "POST", body)
}

/** @deprecated Prefira apiDeleteAnotacao ou apiDeletePlanoAcao. */
export async function apiDelete(
  resource: "anotacoes" | "planos-acao" | string,
  id: string | number
): Promise<void> {
  const idField =
    resource === "anotacoes"   ? "anotacao_id"    :
    resource === "planos-acao" ? "plano_acao_id"  :
    "id"

  await authFetch(`${API_BASE}/${resource}`, "DELETE", { [idField]: String(id) })
}

/** @deprecated Prefira apiUpdateAnotacao ou apiUpdatePlanoAcao com tipagem forte. */
export async function apiUpdate(
  resource: "anotacoes" | "planos-acao" | string,
  body: Record<string, any>
): Promise<any> {
  return authFetch(`${API_BASE}/${resource}`, "PATCH", body)
}

// ─────────────────────────────────────────────────────────────────────────────
// AUXILIARES — centros de trabalho e usuários
// ─────────────────────────────────────────────────────────────────────────────

export function useCentrosTrabalhoBase() {
  return useSWR<ApiCentroTrabalhoBase[]>(
    `${API_BASE}/centros-trabalho?fields=base`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )
}

export function useUsuarios() {
  return useSWR<Usuario[]>(
    `${API_BASE}/usuarios`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// revalidateByPrefix — força recarregamento de todos os SWR keys por prefixo
// ─────────────────────────────────────────────────────────────────────────────

export async function revalidateByPrefix(prefix: string): Promise<void> {
  await swrMutate(
    (key: any) => typeof key === "string" && key.includes(prefix),
    undefined,
    { revalidate: true }
  )
}

/**
 * Revalida todas as chaves SWR relacionadas às notas (anotações, planos e anexos).
 * Chame após qualquer mutação que afete múltiplos recursos.
 */
export async function revalidateNotes(): Promise<void> {
  await Promise.all([
    revalidateByPrefix(`${API_BASE}/anotacoes`),
    revalidateByPrefix(`${API_BASE}/planos-acao`),
    revalidateByPrefix(`${API_BASE}/anexos`),
  ])
}
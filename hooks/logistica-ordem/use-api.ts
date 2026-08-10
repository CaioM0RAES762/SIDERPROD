/**
 * hooks/logistica-ordem/use-api.ts
 *
 * Hook layer completo para o módulo de Logística de Ordens.
 * Cobre: Kanban, Fila, Carga por CT, Ordens Executadas, Filtros, Status de CTs,
 *        Mutações e o módulo de Planejamento (Templates, Itens, Execuções, Plano Semanal).
 *
 * Inclui: syncEstadoRealParaPlanejamento (seção 16 do service),
 *         iniciarItemExecucao, concluirItemExecucao, pularItemExecucao (seções 17-19).
 *
 * Requisitos: swr  →  npm i swr
 *
 * Mapeamento de métodos HTTP (alinhado com route.ts):
 *   GET    → leituras
 *   POST   → criações + ações (reorder, mover, adicionar, criar-*, materializar,
 *             ensure-*, sync-*, iniciar-*, concluir-*, pular-*)
 *   PUT    → atualizações de registros (atualizar-template, atualizar-item-planejado)
 *   PATCH  → atualização parcial de status (atualizar-status-execucao-item)
 *   DELETE → remoções
 */

"use client";

import useSWR, { type KeyedMutator } from "swr";
import useSWRMutation from "swr/mutation";
import { useCallback, useMemo } from "react";

// ─────────────────────────────────────────────
// TIPAGEM (CLIENT-SAFE)
// ─────────────────────────────────────────────

export type StatusOrdem =
  | "RELEASED"
  | "RUNNING"
  | "PAUSED"
  | "FINISHED"
  | "CANCELED"
  | "PLANNED";

export type StatusUi =
  | "Liberada"
  | "Em Execução"
  | "Interrompida"
  | "Encerrada"
  | "Planejada";

export type StatusLogisticaItem =
  | "PLANNED"
  | "RELEASED"
  | "RUNNING"
  | "INTERRUPTED"
  | "FINISHED"
  | "SKIPPED";

export interface CentroTrabalhoResumo {
  public_id: string;
  nome: string;
  sequencia?: number;
}

/** Status em tempo real de um CT — espelha CTStatusParaPlanejamento do service */
export interface CTStatusParaPlanejamento {
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  status_ct: string | null;
  ordem_atual_id: string | null;
  ordem_codigo: string | null;
  produto_descricao: string | null;
  total_good: number;
  total_scrap: number;
  total_rework: number;
  last_event_time_utc: string | Date | null;
}

/** Card usado pelo Kanban */
export interface OrdemResumo {
  empresa_id: string;
  ordem_id: string;
  ordem_public_id: string;
  ordem_codigo: string;
  status_ordem: StatusOrdem;
  status_ui: StatusUi;
  produto_public_id: string;
  produto_codigo: string;
  produto_descricao: string;
  meta_planejada: number;
  total_good: number;
  total_scrap: number;
  total_rework: number;
  diferenca: number;
  pct_completa: number | null;
  inicio_planejado_utc: string | Date | null;
  fim_planejado_utc: string | Date | null;
  inicio_real_utc: string | Date | null;
  fim_real_utc: string | Date | null;
  /** CTs RUNNING com esta ordem agora */
  cts_executando: CentroTrabalhoResumo[];
  /** CTs STOPPED (interrompidos) com esta ordem */
  cts_interrompidos: CentroTrabalhoResumo[];
  /** Primeiro CT RUNNING (compatibilidade) */
  ct_executando_agora: CentroTrabalhoResumo | null;
  /** Alias de cts_executando — compatibilidade com componentes antigos */
  centros_executados: CentroTrabalhoResumo[];
  /** Sempre vazio no kanban em tempo real */
  centros_planejados: CentroTrabalhoResumo[];
}

/** Item de fila por CT */
export interface FilaItem {
  empresa_id: string;
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  fila_item_id: string;
  posicao: number;
  condicao_fim_tipo: string;
  condicao_fim_qtd: number | null;
  condicao_fim_inicio_utc: string | Date | null;
  condicao_fim_fim_utc: string | Date | null;
  ordem_id: string;
  ordem_codigo: string;
  produto_descricao: string;
  status_ui: StatusUi;
  meta_planejada: number;
  total_good: number;
  pct_completa: number | null;
  inicio_real_utc: string | Date | null;
  inicio_planejado_utc: string | Date | null;
  fim_real_utc: string | Date | null;
  fim_planejado_utc: string | Date | null;
  /** true = CT está RUNNING com esta ordem agora (posição 0) */
  is_executando_agora: boolean;
}

/** Agrupamento de fila por CT */
export interface FilaPorCT {
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  itens: FilaItem[];
}

/** Linha da aba Ordens Executadas (fonte: mes.corridas) */
export interface OrdemExecutada {
  empresa_id: string;
  execucao_item_id: string;
  status_item: string;
  ordem_id: string;
  ordem_public_id: string;
  ordem_codigo: string;
  centro_trabalho_id: string;
  ct_public_id: string;
  ct_codigo: string;
  turno_id: string;
  turno_public_id: string;
  turno_nome: string;
  inicio_planejado_utc: string | Date;
  fim_planejado_utc: string | Date;
  meta_planejada: number;
  inicio_real_utc: string | Date | null;
  fim_real_utc: string | Date | null;
  planejado: number;
  realizado: number;
  diferenca: number;
  pct_completa: number | null;
  total_scrap: number;
  total_rework: number;
  produto_descricao: string;
}

/** Carga por CT */
export interface CargaCT {
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  total_ordens: number;
  total_meta: number;
  total_good: number;
  pct_completa: number | null;
  ordens: OrdemResumo[];
}

/** Stats do Kanban */
export interface KanbanStats {
  status_ui: StatusUi;
  total_ordens: number;
  total_meta: number;
  total_good: number;
  pct_completa: number | null;
}

/** Status em tempo real dos CTs */
export interface StatusCTResumo {
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  status_ct: string;
  ordem_atual_id: string | null;
  ordem_codigo: string | null;
  produto_descricao: string | null;
  meta_corrida: number | null;
  total_good: number;
  total_scrap: number;
  total_rework: number;
  last_event_time_utc: string | Date | null;
  condicao_fim_tipo: string;
  condicao_fim_qtd: number | null;
  condicao_fim_fim_utc: string | Date | null;
}

export interface ProdutoFiltro {
  produto_id: string;
  public_id: string;
  codigo: string;
  descricao: string;
}

export interface CTFiltro {
  centro_trabalho_id: string;
  public_id: string;
  codigo: string;
  nome: string;
}

export interface TurnoFiltro {
  turno_id: string;
  public_id: string;
  nome: string;
  hora_inicio: string;
  hora_fim: string;
}

// ─────────────────────────────────────────────
// TIPAGEM — PLANEJAMENTO
// ─────────────────────────────────────────────

/** Template de planejamento de produção */
export interface Template {
  template_id: string;
  empresa_id: string;
  public_id: string;
  nome: string;
  regra_recorrencia: string;
  is_active: boolean;
  total_itens?: number;
  created_at: string | Date;
  updated_at: string | Date | null;
}

/** Item planejado dentro de um template */
export interface ItemPlanejado {
  item_planejado_id: string;
  empresa_id: string;
  template_id: string;
  template_nome: string;
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  turno_id: string;
  turno_nome: string;
  ordem_id: string;
  ordem_codigo: string;
  produto_descricao: string;
  inicio_planejado_utc: string | Date;
  fim_planejado_utc: string | Date;
  meta_planejada: number | null;
  status_item: StatusLogisticaItem;
  created_at: string | Date;
}

/** Execução — instância de um template para um período */
export interface Execucao {
  execucao_id: string;
  empresa_id: string;
  template_id: string;
  template_nome: string;
  periodo_inicio_utc: string | Date;
  periodo_fim_utc: string | Date;
  status_execucao: string;
  total_itens: number;
  itens_concluidos: number;
  itens_running: number;
  total_meta: number;
  total_good: number;
  pct_completa: number | null;
}

/** Execução com itens detalhados */
export interface ExecucaoComItens extends Execucao {
  itens: ExecucaoItem[];
}

/** Item de execução (realizado vs planejado) */
export interface ExecucaoItem {
  execucao_item_id: string;
  empresa_id: string;
  execucao_id: string;
  item_planejado_id: string | null;
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  turno_id: string;
  turno_nome: string;
  ordem_id: string;
  ordem_codigo: string;
  produto_descricao: string;
  inicio_planejado_utc: string | Date;
  fim_planejado_utc: string | Date;
  meta_planejada: number | null;
  inicio_real_utc: string | Date | null;
  fim_real_utc: string | Date | null;
  status_item: StatusLogisticaItem;
  total_good: number;
  total_scrap: number;
  total_rework: number;
  pct_completa: number | null;
  diferenca: number;
}

/** Slot do plano semanal/diário (agrupado por CT e dia) */
export interface SlotPlano {
  data_local: string;
  dia_semana: number;
  turno_id: string;
  turno_nome: string;
  itens: ItemPlanejado[];
  itens_execucao: ExecucaoItem[];
}

export interface PlanoCT {
  centro_trabalho_id: string;
  ct_nome: string;
  ct_public_id: string;
  /** Status em tempo real do CT — alimentado por getResumoExecucaoPorCT no service */
  status_atual: CTStatusParaPlanejamento | null;
  slots: SlotPlano[];
}

// ─────────────────────────────────────────────
// INPUTS DE MUTAÇÃO — FILA
// ─────────────────────────────────────────────

export interface ReorderFilaInput {
  empresa_id: string;
  centro_trabalho_id: string;
  ordered_ids: string[];
}

export interface MoverOrdemFilaInput {
  empresa_id: string;
  fila_item_id: string;
  novo_centro_trabalho_id: string;
  nova_posicao: number;
}

export interface AdicionarFilaInput {
  empresa_id: string;
  centro_trabalho_id: string;
  ordem_id: string;
  posicao?: number;
  condicao_fim_tipo?: string;
  condicao_fim_qtd?: number;
  condicao_fim_inicio_utc?: string | Date | null;
  condicao_fim_fim_utc?: string | Date | null;
}

export interface RemoverFilaInput {
  empresa_id: string;
  fila_item_id: string;
}

// ─────────────────────────────────────────────
// INPUTS DE MUTAÇÃO — PLANEJAMENTO
// ─────────────────────────────────────────────

export interface CriarTemplateInput {
  empresa_id: string;
  nome: string;
  regra_recorrencia?: string;
  usuario_id?: string | null;
}

export interface AtualizarTemplateInput {
  empresa_id: string;
  template_id: string;
  nome?: string;
  regra_recorrencia?: string;
  is_active?: boolean;
  usuario_id?: string | null;
}

export interface ExcluirTemplateInput {
  empresa_id: string;
  template_id: string;
  usuario_id?: string | null;
}

export interface AdicionarItemPlanejadoInput {
  empresa_id: string;
  template_id: string;
  centro_trabalho_id: string;
  turno_id: string;
  ordem_id: string;
  inicio_planejado_utc: string | Date;
  fim_planejado_utc: string | Date;
  meta_planejada?: number | null;
  usuario_id?: string | null;
}

export interface AtualizarItemPlanejadoInput {
  empresa_id: string;
  item_planejado_id: string;
  inicio_planejado_utc?: string | Date;
  fim_planejado_utc?: string | Date;
  meta_planejada?: number | null;
  ordem_id?: string;
  status_item?: StatusLogisticaItem;
  usuario_id?: string | null;
}

export interface RemoverItemPlanejadoInput {
  empresa_id: string;
  item_planejado_id: string;
  /** usuario_id aceito pela UI mas não repassado ao service (assinatura sem ele) */
  usuario_id?: string | null;
}

export interface CriarExecucaoInput {
  empresa_id: string;
  template_id: string;
  periodo_inicio_utc: string | Date;
  periodo_fim_utc: string | Date;
  materializar_itens?: boolean;
  usuario_id?: string | null;
}

export interface MaterializarExecucaoInput {
  empresa_id: string;
  execucao_id: string;
  usuario_id?: string | null;
}

export interface AtualizarStatusExecucaoItemInput {
  empresa_id: string;
  execucao_item_id: string;
  status_item: StatusLogisticaItem;
  /** usuario_id aceito pela UI mas não repassado ao service (assinatura sem ele) */
  usuario_id?: string | null;
}

export interface EnsureExecucaoAbertaInput {
  empresa_id: string;
  turno_id: string;
  turno_inicio_utc: string | Date;
  turno_fim_utc: string | Date;
}

/** Input para sincronização bidirecional real → planejamento (seção 16) */
export interface SyncEstadoRealInput {
  empresa_id: string;
  centro_trabalho_id: string;
  /** Opcional: restringe a sync ao turno corrente */
  turno_id?: string | null;
}

/** Input para iniciar um item de execução (seção 17) */
export interface IniciarItemExecucaoInput {
  empresa_id: string;
  execucao_item_id: string;
  usuario_id?: string | null;
}

/** Input para concluir um item de execução (seção 18) */
export interface ConcluirItemExecucaoInput {
  empresa_id: string;
  execucao_item_id: string;
  usuario_id?: string | null;
}

/** Input para pular um item de execução (seção 19) */
export interface PularItemExecucaoInput {
  empresa_id: string;
  execucao_item_id: string;
  motivo?: string | null;
  usuario_id?: string | null;
}

// ─────────────────────────────────────────────
// FILTROS UI
// ─────────────────────────────────────────────

export interface FiltrosKanbanUI {
  search?: string;
  produto_ids?: string[];
  centro_trabalho_ids?: string[];
  status?: StatusUi[];
}

export interface FiltrosFilaUI {
  search?: string;
  centro_trabalho_ids?: string[];
  status?: StatusUi[];
}

export interface FiltrosExecutadasUI {
  periodo_inicio: Date;
  periodo_fim: Date;
  ordem_codigo?: string;
  centro_trabalho_ids?: string[];
  status_item?: string[];
  produto_ids?: string[];
}

export interface FiltrosPlanoUI {
  periodo_inicio: Date;
  periodo_fim: Date;
  centro_trabalho_ids?: string[];
  turno_ids?: string[];
  template_ids?: string[];
  status_item?: StatusLogisticaItem[];
}

export interface FiltrosExecucoesUI {
  periodo_inicio?: Date;
  periodo_fim?: Date;
  template_ids?: string[];
  status?: string[];
}

// ─────────────────────────────────────────────
// TIPOS AUXILIARES
// ─────────────────────────────────────────────

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface UseQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isValidating: boolean;
  error: string | null;
  mutate: KeyedMutator<T>;
}

// ─────────────────────────────────────────────
// FETCHER BASE
// ─────────────────────────────────────────────

const BASE = "/api/db/logistica-ordem";

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  const json: ApiResponse<T> = await res.json().catch(() => {
    throw new Error("Resposta inválida do servidor (não-JSON).");
  });

  if (!res.ok) {
    const msg =
      json && "success" in json && !json.success
        ? json.error
        : `Erro HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (!json.success) throw new Error(json.error);
  return json.data;
}

async function apiMutate<TResult, TBody = unknown>(
  url: string,
  method: "POST" | "DELETE" | "PUT" | "PATCH",
  body: TBody,
): Promise<TResult> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const json: ApiResponse<TResult> = await res.json().catch(() => {
    throw new Error("Resposta inválida do servidor (não-JSON).");
  });

  if (!res.ok) {
    const msg =
      json && "success" in json && !json.success
        ? json.error
        : `Erro HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (!json.success) throw new Error(json.error);
  return json.data;
}

// ─────────────────────────────────────────────
// BUILDERS DE URL
// ─────────────────────────────────────────────

function serializeArray(arr?: string[]): string | undefined {
  return arr?.length ? JSON.stringify(arr) : undefined;
}

function buildUrl(
  action: string,
  empresa_id: string,
  extra?: Record<string, string | undefined>,
): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";

  const url = new URL(BASE, origin);
  url.searchParams.set("action", action);
  url.searchParams.set("empresa_id", empresa_id);

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  return url.pathname + url.search;
}

/** URL para mutações (empresa_id vai no body, não na query) */
function mutationUrl(action: string): string {
  return `${BASE}?action=${action}`;
}

// ─────────────────────────────────────────────
// SWR OPTIONS DEFAULT
// ─────────────────────────────────────────────

const swrOpts = (refreshInterval = 0, dedup = 2_000) => ({
  refreshInterval,
  keepPreviousData: true,
  revalidateOnFocus: false,
  dedupingInterval: dedup,
});

// ═══════════════════════════════════════════════════════════════
// HOOKS DE LEITURA (GET)
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// 1. KANBAN
// ─────────────────────────────────────────────

export function useKanbanOrdens(
  empresa_id: string,
  filtros: FiltrosKanbanUI = {},
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<OrdemResumo[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("kanban", empresa_id, {
      search: filtros.search,
      produto_ids: serializeArray(filtros.produto_ids),
      centro_trabalho_ids: serializeArray(filtros.centro_trabalho_ids),
      status: serializeArray(filtros.status),
    });
  }, [
    empresa_id,
    filtros.search,
    filtros.produto_ids,
    filtros.centro_trabalho_ids,
    filtros.status,
    options?.disabled,
  ]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    OrdemResumo[]
  >(key, apiFetch, swrOpts(options?.refreshInterval ?? 30_000));

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 2. KANBAN STATS
// ─────────────────────────────────────────────

export function useKanbanStats(
  empresa_id: string,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<KanbanStats[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("kanban-stats", empresa_id);
  }, [empresa_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    KanbanStats[]
  >(key, apiFetch, swrOpts(options?.refreshInterval ?? 30_000));

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 3. FILA POR CT
// ─────────────────────────────────────────────

export function useFilaPorCT(
  empresa_id: string,
  filtros: FiltrosFilaUI = {},
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<FilaPorCT[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("fila", empresa_id, {
      search: filtros.search,
      centro_trabalho_ids: serializeArray(filtros.centro_trabalho_ids),
      status: serializeArray(filtros.status),
    });
  }, [
    empresa_id,
    filtros.search,
    filtros.centro_trabalho_ids,
    filtros.status,
    options?.disabled,
  ]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<FilaPorCT[]>(
    key,
    apiFetch,
    swrOpts(options?.refreshInterval ?? 15_000, 1_500),
  );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 4. ORDENS EXECUTADAS
// ─────────────────────────────────────────────

export function useOrdensExecutadas(
  empresa_id: string,
  filtros: FiltrosExecutadasUI,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<OrdemExecutada[]> {
  const key = useMemo(() => {
    if (
      !empresa_id ||
      options?.disabled ||
      !filtros?.periodo_inicio ||
      !filtros?.periodo_fim
    )
      return null;
    return buildUrl("executadas", empresa_id, {
      periodo_inicio: filtros.periodo_inicio.toISOString(),
      periodo_fim: filtros.periodo_fim.toISOString(),
      ordem_codigo: filtros.ordem_codigo,
      centro_trabalho_ids: serializeArray(filtros.centro_trabalho_ids),
      status_item: serializeArray(filtros.status_item),
      produto_ids: serializeArray(filtros.produto_ids),
    });
  }, [empresa_id, filtros, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    OrdemExecutada[]
  >(key, apiFetch, swrOpts(options?.refreshInterval ?? 0));

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 5. CARGA POR CT
// ─────────────────────────────────────────────

export function useCargaPorCT(
  empresa_id: string,
  centro_trabalho_ids?: string[],
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<CargaCT[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("carga", empresa_id, {
      centro_trabalho_ids: serializeArray(centro_trabalho_ids),
    });
  }, [empresa_id, centro_trabalho_ids, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<CargaCT[]>(
    key,
    apiFetch,
    swrOpts(options?.refreshInterval ?? 30_000),
  );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 6. DETALHE DE ORDEM
// ─────────────────────────────────────────────

export function useOrdemDetalhe(
  empresa_id: string,
  ordem_public_id: string | null | undefined,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<OrdemResumo | null> {
  const key = useMemo(() => {
    if (!empresa_id || !ordem_public_id || options?.disabled) return null;
    return buildUrl("detalhe", empresa_id, { ordem_public_id });
  }, [empresa_id, ordem_public_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } =
    useSWR<OrdemResumo | null>(
      key,
      apiFetch,
      swrOpts(options?.refreshInterval ?? 10_000),
    );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 7. STATUS DOS CTs (tempo real)
// ─────────────────────────────────────────────

export function useStatusCTs(
  empresa_id: string,
  centro_trabalho_ids?: string[],
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<StatusCTResumo[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("status-cts", empresa_id, {
      centro_trabalho_ids: serializeArray(centro_trabalho_ids),
    });
  }, [empresa_id, centro_trabalho_ids, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    StatusCTResumo[]
  >(key, apiFetch, swrOpts(options?.refreshInterval ?? 5_000, 1_000));

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 8. FILTROS (listas de opções)
// ─────────────────────────────────────────────

export function useProdutosFiltro(
  empresa_id: string,
  options?: { disabled?: boolean },
): UseQueryResult<ProdutoFiltro[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("filtros-produtos", empresa_id);
  }, [empresa_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    ProdutoFiltro[]
  >(key, apiFetch, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

export function useCentrosTrabalhoFiltro(
  empresa_id: string,
  options?: { disabled?: boolean },
): UseQueryResult<CTFiltro[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("filtros-cts", empresa_id);
  }, [empresa_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<CTFiltro[]>(
    key,
    apiFetch,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      keepPreviousData: true,
    },
  );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

export function useTurnosFiltro(
  empresa_id: string,
  options?: { disabled?: boolean },
): UseQueryResult<TurnoFiltro[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("filtros-turnos", empresa_id);
  }, [empresa_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    TurnoFiltro[]
  >(key, apiFetch, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 9. TEMPLATES DE PLANEJAMENTO
// ─────────────────────────────────────────────

export function useTemplates(
  empresa_id: string,
  somente_ativos = true,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<Template[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("templates", empresa_id, {
      somente_ativos: somente_ativos ? "1" : "0",
    });
  }, [empresa_id, somente_ativos, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<Template[]>(
    key,
    apiFetch,
    swrOpts(options?.refreshInterval ?? 0, 5_000),
  );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 10. ITENS PLANEJADOS
// ─────────────────────────────────────────────

export function useItensPlanejados(
  empresa_id: string,
  filtros: FiltrosPlanoUI,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<ItemPlanejado[]> {
  const key = useMemo(() => {
    if (
      !empresa_id ||
      options?.disabled ||
      !filtros?.periodo_inicio ||
      !filtros?.periodo_fim
    )
      return null;
    return buildUrl("itens-planejados", empresa_id, {
      periodo_inicio: filtros.periodo_inicio.toISOString(),
      periodo_fim: filtros.periodo_fim.toISOString(),
      centro_trabalho_ids: serializeArray(filtros.centro_trabalho_ids),
      turno_ids: serializeArray(filtros.turno_ids),
      template_ids: serializeArray(filtros.template_ids),
      status_item: serializeArray(filtros.status_item),
    });
  }, [empresa_id, filtros, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    ItemPlanejado[]
  >(key, apiFetch, swrOpts(options?.refreshInterval ?? 30_000));

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 11. EXECUÇÕES
// ─────────────────────────────────────────────

export function useExecucoes(
  empresa_id: string,
  filtros?: FiltrosExecucoesUI,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<Execucao[]> {
  const key = useMemo(() => {
    if (!empresa_id || options?.disabled) return null;
    return buildUrl("execucoes", empresa_id, {
      periodo_inicio: filtros?.periodo_inicio?.toISOString(),
      periodo_fim: filtros?.periodo_fim?.toISOString(),
      template_ids: serializeArray(filtros?.template_ids),
      status: serializeArray(filtros?.status),
    });
  }, [
    empresa_id,
    filtros?.periodo_inicio,
    filtros?.periodo_fim,
    filtros?.template_ids,
    filtros?.status,
    options?.disabled,
  ]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<Execucao[]>(
    key,
    apiFetch,
    swrOpts(options?.refreshInterval ?? 30_000),
  );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 12. DETALHE DE EXECUÇÃO
// ─────────────────────────────────────────────

export function useExecucaoDetalhe(
  empresa_id: string,
  execucao_id: string | null | undefined,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<ExecucaoComItens | null> {
  const key = useMemo(() => {
    if (!empresa_id || !execucao_id || options?.disabled) return null;
    return buildUrl("execucao-detalhe", empresa_id, { execucao_id });
  }, [empresa_id, execucao_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } =
    useSWR<ExecucaoComItens | null>(
      key,
      apiFetch,
      swrOpts(options?.refreshInterval ?? 15_000),
    );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 13. PLANO SEMANAL / POR CT
// ─────────────────────────────────────────────

export function usePlanoCT(
  empresa_id: string,
  periodo_inicio: Date | null,
  periodo_fim: Date | null,
  centro_trabalho_ids?: string[],
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<PlanoCT[]> {
  const key = useMemo(() => {
    if (!empresa_id || !periodo_inicio || !periodo_fim || options?.disabled)
      return null;
    return buildUrl("plano-semanal", empresa_id, {
      periodo_inicio: periodo_inicio.toISOString(),
      periodo_fim: periodo_fim.toISOString(),
      centro_trabalho_ids: serializeArray(centro_trabalho_ids),
    });
  }, [
    empresa_id,
    periodo_inicio,
    periodo_fim,
    centro_trabalho_ids,
    options?.disabled,
  ]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<PlanoCT[]>(
    key,
    apiFetch,
    swrOpts(options?.refreshInterval ?? 30_000),
  );

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ─────────────────────────────────────────────
// 14. CTs EXECUTANDO UMA ORDEM
// ─────────────────────────────────────────────

export function useCTsExecutandoOrdem(
  empresa_id: string,
  ordem_id: string | null | undefined,
  options?: { refreshInterval?: number; disabled?: boolean },
): UseQueryResult<CentroTrabalhoResumo[]> {
  const key = useMemo(() => {
    if (!empresa_id || !ordem_id || options?.disabled) return null;
    return buildUrl("cts-executando-ordem", empresa_id, { ordem_id });
  }, [empresa_id, ordem_id, options?.disabled]);

  const { data, isLoading, isValidating, error, mutate } = useSWR<
    CentroTrabalhoResumo[]
  >(key, apiFetch, swrOpts(options?.refreshInterval ?? 5_000, 1_000));

  return {
    data,
    isLoading,
    isValidating,
    error: error?.message ?? null,
    mutate,
  };
}

// ═══════════════════════════════════════════════════════════════
// HOOKS DE MUTAÇÃO
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// MUTAÇÕES — FILA  (POST / DELETE)
// ─────────────────────────────────────────────

export type ReorderResult = { reordenado: boolean; total_itens: number };

export function useReorderFila() {
  const url = mutationUrl("reorder-fila");
  const { trigger, isMutating, error } = useSWRMutation<
    ReorderResult,
    Error,
    string,
    ReorderFilaInput
  >(url, (_url, { arg }) =>
    apiMutate<ReorderResult, ReorderFilaInput>(url, "POST", arg),
  );
  return {
    reorderFila: trigger,
    isReordering: isMutating,
    reorderError: error?.message ?? null,
  };
}

export type MoverResult = {
  movido: boolean;
  fila_item_id: string;
  novo_centro_trabalho_id: string;
  nova_posicao: number;
};

export function useMoverOrdemFila() {
  const url = mutationUrl("mover-ordem");
  const { trigger, isMutating, error } = useSWRMutation<
    MoverResult,
    Error,
    string,
    MoverOrdemFilaInput
  >(url, (_url, { arg }) =>
    apiMutate<MoverResult, MoverOrdemFilaInput>(url, "POST", arg),
  );
  return {
    moverOrdem: trigger,
    isMoving: isMutating,
    moverError: error?.message ?? null,
  };
}

export type AdicionarFilaResult = { adicionado: boolean; fila_item_id: string };

export function useAdicionarOrdemFila() {
  const url = mutationUrl("adicionar-fila");
  const { trigger, isMutating, error } = useSWRMutation<
    AdicionarFilaResult,
    Error,
    string,
    AdicionarFilaInput
  >(url, (_url, { arg }) =>
    apiMutate<AdicionarFilaResult, AdicionarFilaInput>(url, "POST", arg),
  );
  return {
    adicionarOrdem: trigger,
    isAdicionando: isMutating,
    adicionarError: error?.message ?? null,
  };
}

export type RemoverFilaResult = { removido: boolean; fila_item_id: string };

export function useRemoverOrdemFila() {
  const url = mutationUrl("remover-fila");
  const { trigger, isMutating, error } = useSWRMutation<
    RemoverFilaResult,
    Error,
    string,
    RemoverFilaInput
  >(url, (_url, { arg }) =>
    apiMutate<RemoverFilaResult, RemoverFilaInput>(url, "DELETE", arg),
  );
  return {
    removerOrdem: trigger,
    isRemoving: isMutating,
    removerError: error?.message ?? null,
  };
}

// ─────────────────────────────────────────────
// MUTAÇÕES — TEMPLATES  (POST / PUT / DELETE)
// ─────────────────────────────────────────────

export type CriarTemplateResult = Template;

export function useCriarTemplate() {
  const url = mutationUrl("criar-template");
  const { trigger, isMutating, error } = useSWRMutation<
    CriarTemplateResult,
    Error,
    string,
    CriarTemplateInput
  >(url, (_url, { arg }) =>
    apiMutate<CriarTemplateResult, CriarTemplateInput>(url, "POST", arg),
  );
  return {
    criarTemplate: trigger,
    isCriando: isMutating,
    criarError: error?.message ?? null,
  };
}

export type AtualizarTemplateResult = {
  atualizado: boolean;
  template_id: string;
};

export function useAtualizarTemplate() {
  const url = mutationUrl("atualizar-template");
  const { trigger, isMutating, error } = useSWRMutation<
    AtualizarTemplateResult,
    Error,
    string,
    AtualizarTemplateInput
  >(url, (_url, { arg }) =>
    apiMutate<AtualizarTemplateResult, AtualizarTemplateInput>(url, "PUT", arg),
  );
  return {
    atualizarTemplate: trigger,
    isAtualizando: isMutating,
    atualizarError: error?.message ?? null,
  };
}

export type ExcluirTemplateResult = { removido: boolean; template_id: string };

export function useExcluirTemplate() {
  const url = mutationUrl("excluir-template");
  const { trigger, isMutating, error } = useSWRMutation<
    ExcluirTemplateResult,
    Error,
    string,
    ExcluirTemplateInput
  >(url, (_url, { arg }) =>
    apiMutate<ExcluirTemplateResult, ExcluirTemplateInput>(url, "DELETE", arg),
  );
  return {
    excluirTemplate: trigger,
    isExcluindo: isMutating,
    excluirError: error?.message ?? null,
  };
}

// ─────────────────────────────────────────────
// MUTAÇÕES — ITENS PLANEJADOS  (POST / PUT / DELETE)
// ─────────────────────────────────────────────

export type AdicionarItemResult = ItemPlanejado;

export function useAdicionarItemPlanejado() {
  const url = mutationUrl("adicionar-item-planejado");
  const { trigger, isMutating, error } = useSWRMutation<
    AdicionarItemResult,
    Error,
    string,
    AdicionarItemPlanejadoInput
  >(url, (_url, { arg }) =>
    apiMutate<AdicionarItemResult, AdicionarItemPlanejadoInput>(
      url,
      "POST",
      arg,
    ),
  );
  return {
    adicionarItem: trigger,
    isAdicionando: isMutating,
    adicionarError: error?.message ?? null,
  };
}

export type AtualizarItemResult = {
  atualizado: boolean;
  item_planejado_id: string;
};

export function useAtualizarItemPlanejado() {
  const url = mutationUrl("atualizar-item-planejado");
  const { trigger, isMutating, error } = useSWRMutation<
    AtualizarItemResult,
    Error,
    string,
    AtualizarItemPlanejadoInput
  >(url, (_url, { arg }) =>
    apiMutate<AtualizarItemResult, AtualizarItemPlanejadoInput>(
      url,
      "PUT",
      arg,
    ),
  );
  return {
    atualizarItem: trigger,
    isAtualizando: isMutating,
    atualizarError: error?.message ?? null,
  };
}

export type RemoverItemResult = {
  removido: boolean;
  item_planejado_id: string;
};

export function useRemoverItemPlanejado() {
  const url = mutationUrl("remover-item-planejado");
  const { trigger, isMutating, error } = useSWRMutation<
    RemoverItemResult,
    Error,
    string,
    RemoverItemPlanejadoInput
  >(url, (_url, { arg }) =>
    apiMutate<RemoverItemResult, RemoverItemPlanejadoInput>(url, "DELETE", arg),
  );
  return {
    removerItem: trigger,
    isRemoving: isMutating,
    removerError: error?.message ?? null,
  };
}

// ─────────────────────────────────────────────
// MUTAÇÕES — EXECUÇÕES  (POST / PATCH)
// ─────────────────────────────────────────────

export type CriarExecucaoResult = Execucao;

export function useCriarExecucao() {
  const url = mutationUrl("criar-execucao");
  const { trigger, isMutating, error } = useSWRMutation<
    CriarExecucaoResult,
    Error,
    string,
    CriarExecucaoInput
  >(url, (_url, { arg }) =>
    apiMutate<CriarExecucaoResult, CriarExecucaoInput>(url, "POST", arg),
  );
  return {
    criarExecucao: trigger,
    isCriando: isMutating,
    criarError: error?.message ?? null,
  };
}

export type MaterializarResult = { criados: number };

export function useMaterializarExecucao() {
  const url = mutationUrl("materializar-execucao");
  const { trigger, isMutating, error } = useSWRMutation<
    MaterializarResult,
    Error,
    string,
    MaterializarExecucaoInput
  >(url, (_url, { arg }) =>
    apiMutate<MaterializarResult, MaterializarExecucaoInput>(url, "POST", arg),
  );
  return {
    materializar: trigger,
    isMaterializando: isMutating,
    materializarError: error?.message ?? null,
  };
}

export type AtualizarStatusItemResult = {
  atualizado: boolean;
  execucao_item_id: string;
  status_item: StatusLogisticaItem;
};

export function useAtualizarStatusExecucaoItem() {
  const url = mutationUrl("atualizar-status-execucao-item");
  const { trigger, isMutating, error } = useSWRMutation<
    AtualizarStatusItemResult,
    Error,
    string,
    AtualizarStatusExecucaoItemInput
  >(url, (_url, { arg }) =>
    apiMutate<AtualizarStatusItemResult, AtualizarStatusExecucaoItemInput>(
      url,
      "PATCH",
      arg,
    ),
  );
  return {
    atualizarStatus: trigger,
    isAtualizando: isMutating,
    atualizarError: error?.message ?? null,
  };
}

// ─────────────────────────────────────────────
// MUTAÇÕES — AÇÕES DE ITEM DE EXECUÇÃO (seções 17-19)
// ─────────────────────────────────────────────

export type IniciarItemResult = {
  ok: true;
  ordem_id: string;
  centro_trabalho_id: string;
};

export function useIniciarItemExecucao() {
  const url = mutationUrl("iniciar-item-execucao");
  const { trigger, isMutating, error } = useSWRMutation<
    IniciarItemResult,
    Error,
    string,
    IniciarItemExecucaoInput
  >(url, (_url, { arg }) =>
    apiMutate<IniciarItemResult, IniciarItemExecucaoInput>(url, "POST", arg),
  );
  return {
    iniciarItem: trigger,
    isIniciando: isMutating,
    iniciarError: error?.message ?? null,
  };
}

export type ConcluirItemResult = {
  ok: true;
  ordem_finalizada: boolean;
};

export function useConcluirItemExecucao() {
  const url = mutationUrl("concluir-item-execucao");
  const { trigger, isMutating, error } = useSWRMutation<
    ConcluirItemResult,
    Error,
    string,
    ConcluirItemExecucaoInput
  >(url, (_url, { arg }) =>
    apiMutate<ConcluirItemResult, ConcluirItemExecucaoInput>(url, "POST", arg),
  );
  return {
    concluirItem: trigger,
    isConcluindo: isMutating,
    concluirError: error?.message ?? null,
  };
}

export type PularItemResult = { ok: true };

export function usePularItemExecucao() {
  const url = mutationUrl("pular-item-execucao");
  const { trigger, isMutating, error } = useSWRMutation<
    PularItemResult,
    Error,
    string,
    PularItemExecucaoInput
  >(url, (_url, { arg }) =>
    apiMutate<PularItemResult, PularItemExecucaoInput>(url, "POST", arg),
  );
  return {
    pularItem: trigger,
    isPulando: isMutating,
    pularError: error?.message ?? null,
  };
}

// ─────────────────────────────────────────────
// MUTAÇÃO — ENSURE EXECUÇÃO ABERTA
// ─────────────────────────────────────────────

export type EnsureExecucaoAbertaResult = {
  ensured: boolean;
  empresa_id: string;
  turno_id: string;
};

export function useEnsureExecucaoAberta() {
  const url = mutationUrl("ensure-execucao-aberta");
  const { trigger, isMutating, error } = useSWRMutation<
    EnsureExecucaoAbertaResult,
    Error,
    string,
    EnsureExecucaoAbertaInput
  >(url, (_url, { arg }) =>
    apiMutate<EnsureExecucaoAbertaResult, EnsureExecucaoAbertaInput>(
      url,
      "POST",
      arg,
    ),
  );
  return {
    ensureExecucao: trigger,
    isEnsuring: isMutating,
    ensureError: error?.message ?? null,
  };
}

// ─────────────────────────────────────────────
// MUTAÇÃO — SYNC ESTADO REAL → PLANEJAMENTO (seção 16)
// ─────────────────────────────────────────────

export type SyncEstadoRealResult = {
  itens_atualizados: number;
  ordens_finalizadas: number;
};

export function useSyncEstadoReal() {
  const url = mutationUrl("sync-estado-real");
  const { trigger, isMutating, error } = useSWRMutation<
    SyncEstadoRealResult,
    Error,
    string,
    SyncEstadoRealInput
  >(url, (_url, { arg }) =>
    apiMutate<SyncEstadoRealResult, SyncEstadoRealInput>(url, "POST", arg),
  );
  return {
    syncEstadoReal: trigger,
    isSyncing: isMutating,
    syncError: error?.message ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════
// HOOKS COMPOSTOS
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// Kanban Completo
// ─────────────────────────────────────────────

export function useKanbanCompleto(
  empresa_id: string,
  filtros: FiltrosKanbanUI = {},
  options?: { refreshInterval?: number; disabled?: boolean },
) {
  const ordens = useKanbanOrdens(empresa_id, filtros, options);
  const stats = useKanbanStats(empresa_id, options);
  const produtos = useProdutosFiltro(empresa_id);
  const centros = useCentrosTrabalhoFiltro(empresa_id);

  const ordensMutate = ordens.mutate;
  const statsMutate = stats.mutate;

  const invalidate = useCallback(async () => {
    await Promise.all([ordensMutate(), statsMutate()]);
  }, [ordensMutate, statsMutate]);

  return { ordens, stats, produtos, centros, invalidate };
}

// ─────────────────────────────────────────────
// Fila Completa
// ─────────────────────────────────────────────

export function useFilaCompleta(
  empresa_id: string,
  filtros: FiltrosFilaUI = {},
  options?: { refreshInterval?: number; disabled?: boolean },
) {
  const fila = useFilaPorCT(empresa_id, filtros, options);
  const centros = useCentrosTrabalhoFiltro(empresa_id);

  const { reorderFila, isReordering, reorderError } = useReorderFila();
  const { moverOrdem, isMoving, moverError } = useMoverOrdemFila();
  const { adicionarOrdem, isAdicionando, adicionarError } =
    useAdicionarOrdemFila();
  const { removerOrdem, isRemoving, removerError } = useRemoverOrdemFila();

  const filaMutate = fila.mutate;

  const reorderEInvalidar = useCallback(
    async (input: ReorderFilaInput) => {
      await reorderFila(input);
      await filaMutate();
    },
    [reorderFila, filaMutate],
  );

  const moverEInvalidar = useCallback(
    async (input: MoverOrdemFilaInput) => {
      await moverOrdem(input);
      await filaMutate();
    },
    [moverOrdem, filaMutate],
  );

  const adicionarEInvalidar = useCallback(
    async (input: AdicionarFilaInput) => {
      const result = await adicionarOrdem(input);
      await filaMutate();
      return result;
    },
    [adicionarOrdem, filaMutate],
  );

  const removerEInvalidar = useCallback(
    async (input: RemoverFilaInput) => {
      await removerOrdem(input);
      await filaMutate();
    },
    [removerOrdem, filaMutate],
  );

  return {
    fila,
    centros,
    reorderFila: reorderEInvalidar,
    moverOrdem: moverEInvalidar,
    adicionarOrdem: adicionarEInvalidar,
    removerOrdem: removerEInvalidar,
    isMutating: isReordering || isMoving || isAdicionando || isRemoving,
    mutationError: reorderError ?? moverError ?? adicionarError ?? removerError,
  };
}

// ─────────────────────────────────────────────
// Ordens Executadas Completo
// ─────────────────────────────────────────────

export function useOrdensExecutadasCompleto(
  empresa_id: string,
  filtros: FiltrosExecutadasUI,
  options?: { disabled?: boolean },
) {
  const executadas = useOrdensExecutadas(empresa_id, filtros, options);
  const produtos = useProdutosFiltro(empresa_id);
  const centros = useCentrosTrabalhoFiltro(empresa_id);
  return { executadas, produtos, centros };
}

// ─────────────────────────────────────────────
// Planejamento Completo
// ─────────────────────────────────────────────

export function usePlanejamentoCompleto(
  empresa_id: string,
  periodo_inicio: Date | null,
  periodo_fim: Date | null,
  centro_trabalho_ids?: string[],
  options?: { refreshInterval?: number; disabled?: boolean },
) {
  const plano = usePlanoCT(
    empresa_id,
    periodo_inicio,
    periodo_fim,
    centro_trabalho_ids,
    options,
  );
  const templates = useTemplates(empresa_id, true, options);
  const centros = useCentrosTrabalhoFiltro(empresa_id);
  const turnos = useTurnosFiltro(empresa_id);
  const execucoes = useExecucoes(
    empresa_id,
    {
      periodo_inicio: periodo_inicio ?? undefined,
      periodo_fim: periodo_fim ?? undefined,
    },
    options,
  );

  const { criarTemplate, isCriando: isCriandoTemplate } = useCriarTemplate();
  const { atualizarTemplate, isAtualizando: isAtualizandoTemplate } =
    useAtualizarTemplate();
  const { excluirTemplate, isExcluindo: isExcluindoTemplate } =
    useExcluirTemplate();
  const { adicionarItem, isAdicionando: isAdicionandoItem } =
    useAdicionarItemPlanejado();
  const { atualizarItem, isAtualizando: isAtualizandoItem } =
    useAtualizarItemPlanejado();
  const { removerItem, isRemoving: isRemovendoItem } =
    useRemoverItemPlanejado();
  const { criarExecucao, isCriando: isCriandoExecucao } = useCriarExecucao();
  const { materializar, isMaterializando } = useMaterializarExecucao();
  const { atualizarStatus, isAtualizando: isAtualizandoStatus } =
    useAtualizarStatusExecucaoItem();
  const { iniciarItem, isIniciando } = useIniciarItemExecucao();
  const { concluirItem, isConcluindo } = useConcluirItemExecucao();
  const { pularItem, isPulando } = usePularItemExecucao();
  const { syncEstadoReal, isSyncing } = useSyncEstadoReal();

  const planoMutate = plano.mutate;
  const templatesMutate = templates.mutate;
  const execucoesMutate = execucoes.mutate;

  const invalidate = useCallback(async () => {
    await Promise.all([planoMutate(), templatesMutate(), execucoesMutate()]);
  }, [planoMutate, templatesMutate, execucoesMutate]);

  const criarTemplateEInvalidar = useCallback(
    async (input: CriarTemplateInput) => {
      const result = await criarTemplate(input);
      await templatesMutate();
      return result;
    },
    [criarTemplate, templatesMutate],
  );

  const atualizarTemplateEInvalidar = useCallback(
    async (input: AtualizarTemplateInput) => {
      const result = await atualizarTemplate(input);
      await templatesMutate();
      return result;
    },
    [atualizarTemplate, templatesMutate],
  );

  const excluirTemplateEInvalidar = useCallback(
    async (input: ExcluirTemplateInput) => {
      await excluirTemplate(input);
      await Promise.all([templatesMutate(), planoMutate()]);
    },
    [excluirTemplate, templatesMutate, planoMutate],
  );

  const adicionarItemEInvalidar = useCallback(
    async (input: AdicionarItemPlanejadoInput) => {
      const result = await adicionarItem(input);
      await planoMutate();
      return result;
    },
    [adicionarItem, planoMutate],
  );

  const atualizarItemEInvalidar = useCallback(
    async (input: AtualizarItemPlanejadoInput) => {
      const result = await atualizarItem(input);
      await planoMutate();
      return result;
    },
    [atualizarItem, planoMutate],
  );

  const removerItemEInvalidar = useCallback(
    async (input: RemoverItemPlanejadoInput) => {
      await removerItem(input);
      await planoMutate();
    },
    [removerItem, planoMutate],
  );

  const criarExecucaoEInvalidar = useCallback(
    async (input: CriarExecucaoInput) => {
      const result = await criarExecucao(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [criarExecucao, execucoesMutate, planoMutate],
  );

  const materializarEInvalidar = useCallback(
    async (input: MaterializarExecucaoInput) => {
      const result = await materializar(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [materializar, execucoesMutate, planoMutate],
  );

  const atualizarStatusItemEInvalidar = useCallback(
    async (input: AtualizarStatusExecucaoItemInput) => {
      const result = await atualizarStatus(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [atualizarStatus, execucoesMutate, planoMutate],
  );

  /**
   * Inicia a execução de um item e invalida o plano.
   * Usado pelo botão "Iniciar" nos cards do plano semanal.
   */
  const iniciarItemEInvalidar = useCallback(
    async (input: IniciarItemExecucaoInput) => {
      const result = await iniciarItem(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [iniciarItem, execucoesMutate, planoMutate],
  );

  /**
   * Conclui a execução de um item e invalida o plano.
   * Usado pelo botão "Concluir" nos cards do plano semanal.
   */
  const concluirItemEInvalidar = useCallback(
    async (input: ConcluirItemExecucaoInput) => {
      const result = await concluirItem(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [concluirItem, execucoesMutate, planoMutate],
  );

  /**
   * Pula um item de execução e invalida o plano.
   * Usado pelo botão "Pular" nos cards do plano semanal.
   */
  const pularItemEInvalidar = useCallback(
    async (input: PularItemExecucaoInput) => {
      const result = await pularItem(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [pularItem, execucoesMutate, planoMutate],
  );

  /**
   * Dispara a sincronização bidirecional (seção 16) e invalida o plano ao concluir.
   * Use em background ou em um botão "Sincronizar".
   */
  const syncEInvalidar = useCallback(
    async (input: SyncEstadoRealInput) => {
      const result = await syncEstadoReal(input);
      await Promise.all([execucoesMutate(), planoMutate()]);
      return result;
    },
    [syncEstadoReal, execucoesMutate, planoMutate],
  );

  const isMutating =
    isCriandoTemplate ||
    isAtualizandoTemplate ||
    isExcluindoTemplate ||
    isAdicionandoItem ||
    isAtualizandoItem ||
    isRemovendoItem ||
    isCriandoExecucao ||
    isMaterializando ||
    isAtualizandoStatus ||
    isIniciando ||
    isConcluindo ||
    isPulando ||
    isSyncing;

  return {
    // dados
    plano,
    templates,
    centros,
    turnos,
    execucoes,
    // ações — templates
    invalidate,
    criarTemplate: criarTemplateEInvalidar,
    atualizarTemplate: atualizarTemplateEInvalidar,
    excluirTemplate: excluirTemplateEInvalidar,
    // ações — itens planejados
    adicionarItem: adicionarItemEInvalidar,
    atualizarItem: atualizarItemEInvalidar,
    removerItem: removerItemEInvalidar,
    // ações — execuções
    criarExecucao: criarExecucaoEInvalidar,
    materializar: materializarEInvalidar,
    atualizarStatusItem: atualizarStatusItemEInvalidar,
    // ações — itens de execução (seções 17-19)
    iniciarItem: iniciarItemEInvalidar,
    concluirItem: concluirItemEInvalidar,
    pularItem: pularItemEInvalidar,
    // sync
    syncEstadoReal: syncEInvalidar,
    // flags
    isMutating,
    isSyncing,
    isIniciando,
    isConcluindo,
    isPulando,
  };
}

// ═══════════════════════════════════════════════════════════════
// UTILS EXPORTADOS
// ═══════════════════════════════════════════════════════════════

/** Agrupa ordens do Kanban por status_ui */
export function agruparOrdensPorStatus(
  ordens: OrdemResumo[],
): Record<StatusUi, OrdemResumo[]> {
  const grupos: Record<StatusUi, OrdemResumo[]> = {
    Liberada: [],
    "Em Execução": [],
    Interrompida: [],
    Encerrada: [],
    Planejada: [],
  };

  for (const o of ordens) {
    const col = (o.status_ui || "Liberada") as StatusUi;
    (grupos[col] ?? grupos.Liberada).push(o);
  }

  return grupos;
}

/** Calcula totais rápidos para o header do Kanban */
export function calcularTotaisKanban(ordens: OrdemResumo[]) {
  return ordens.reduce(
    (acc, o) => ({
      total_ordens: acc.total_ordens + 1,
      total_meta: acc.total_meta + (o.meta_planejada ?? 0),
      total_good: acc.total_good + (o.total_good ?? 0),
      total_scrap: acc.total_scrap + (o.total_scrap ?? 0),
      total_rework: acc.total_rework + (o.total_rework ?? 0),
    }),
    {
      total_ordens: 0,
      total_meta: 0,
      total_good: 0,
      total_scrap: 0,
      total_rework: 0,
    },
  );
}

/** Retorna label amigável para StatusLogisticaItem */
export function labelStatusItem(status: StatusLogisticaItem): string {
  const map: Record<StatusLogisticaItem, string> = {
    PLANNED: "Planejado",
    RELEASED: "Liberado",
    RUNNING: "Em Execução",
    INTERRUPTED: "Interrompido",
    FINISHED: "Concluído",
    SKIPPED: "Pulado",
  };
  return map[status] ?? status;
}

/** Classes Tailwind para badge de StatusLogisticaItem */
export function colorStatusItem(status: StatusLogisticaItem): string {
  const map: Record<StatusLogisticaItem, string> = {
    PLANNED: "text-slate-600 bg-slate-100 border-slate-300",
    RELEASED: "text-sky-700 bg-sky-50 border-sky-200",
    RUNNING: "text-emerald-700 bg-emerald-50 border-emerald-200",
    INTERRUPTED: "text-amber-800 bg-amber-50 border-amber-200",
    FINISHED: "text-violet-700 bg-violet-50 border-violet-200",
    SKIPPED: "text-rose-700 bg-rose-50 border-rose-200",
  };
  return map[status] ?? "text-slate-600 bg-slate-100 border-slate-300";
}

/** Gera array de datas entre início e fim (por dia, formato YYYY-MM-DD) */
export function getDiasSemana(inicio: Date, fim: Date): string[] {
  const dias: string[] = [];
  const cur = new Date(inicio);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(fim);
  end.setHours(23, 59, 59, 999);

  while (cur <= end) {
    dias.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

/** Início da semana corrente (segunda-feira, meia-noite local) */
export function inicioSemanaAtual(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fim da semana corrente (domingo, 23:59:59.999 local) */
export function fimSemanaAtual(): Date {
  const d = inicioSemanaAtual();
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

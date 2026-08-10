// hooks/posto/use-api.ts
"use client";

import { useCallback, useMemo } from "react";
import useSWR, { mutate as swrMutateGlobal, type SWRConfiguration, type SWRResponse } from "swr";

/** =========================================================
 * Bases de API
 * =========================================================
 * GET  /api/db/posto?op=...
 * POST /api/db/posto  { action: "..." }
 */
const API_POSTO = "/api/db/posto";
const API_DB = "/api/db";

/** =========================================================
 * Tipos de envelope (route.ts)
 * =========================================================
 * route.ts responde:
 * - { ok: true, data: ... }
 * - { ok: false, error: string, details?: any }
 */
type JsonOk<T> = { ok: true; data: T };
type JsonErr = { ok: false; error: string; details?: any };
type JsonEnvelope<T> = JsonOk<T> | JsonErr;

/** =========================================================
 * Utils
 * ========================================================= */
function buildUrl(base: string, params?: Record<string, any>) {
  const sp = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
}

function safeParseJson(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function unwrapEnvelope<T>(raw: any): T {
  // compat: se o backend responder "cru" (sem ok/data), devolve como est�
  if (!raw || typeof raw !== "object") return raw as T;
  if (raw.ok === true) return (raw as JsonOk<T>).data;
  if (raw.ok === false) {
    const err = raw as JsonErr;
    const msg = err?.error || "Erro inesperado";
    const e: any = new Error(msg);
    e.details = err?.details;
    throw e;
  }
  return raw as T;
}

function safeNum(v: any, fallback = 0) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** 0..1 -> 0..100 (1 casa) */
function pct01to100(v01: number) {
  return Math.round(clamp01(v01) * 1000) / 10;
}

/** normaliza valores que podem vir como 0..1 ou 0..100 */
function normalizePctMaybe(v: any): number | null {
  if (v == null) return null;
  const n = safeNum(v, NaN);
  if (!Number.isFinite(n)) return null;
  // se vier 0..1 (ou 0..1.2 por ru�do), converte
  if (n >= 0 && n <= 1.2) return pct01to100(n);
  // se vier 0..100 (ou 0..120 por ru�do), mant�m e limita
  if (n >= 0 && n <= 120)
    return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
  return null;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ymdFromIso(isoUtc?: string | null): string | null {
  const d = isoToDate(isoUtc);
  if (!d) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtHourLabelFromIsoUtc(isoUtc: string) {
  const d = new Date(isoUtc);
  if (!Number.isFinite(d.getTime())) return "--h";
  return `${pad2(d.getHours())}h`;
}

function formatHMS(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return null;
  const s = Math.max(0, Math.floor(Number(totalSeconds)));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`;
}

function minutesFromSeconds(sec: number | null | undefined) {
  if (sec == null) return 0;
  return Math.round((Math.max(0, sec) / 60) * 100) / 100;
}

/**
 * Fallback robusto para empresa_id:
 * - localStorage.empresa_id / localStorage.empresaId / localStorage.empresa
 * - env NEXT_PUBLIC_EMPRESA_ID
 * - "1" (�ltimo fallback)
 */
export function getEmpresaIdFallback(): string {
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : null;
    const v =
      ls?.getItem("empresa_id") ||
      ls?.getItem("empresaId") ||
      ls?.getItem("empresa") ||
      (process.env.NEXT_PUBLIC_EMPRESA_ID as string | undefined) ||
      "";
    return String(v || "1");
  } catch {
    return String(
      (process.env.NEXT_PUBLIC_EMPRESA_ID as string | undefined) || "1",
    );
  }
}

function resolveEmpresaId(empresaId?: string | null) {
  return String(empresaId || getEmpresaIdFallback() || "1");
}

/**
 * Opcional: tenta pegar usuario_id do localStorage (se voc� j� salva isso).
 * Se n�o existir, retorna null.
 */
export function getUsuarioIdFallback(): string | null {
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : null;
    const v =
      ls?.getItem("usuario_id") ||
      ls?.getItem("usuarioId") ||
      ls?.getItem("user_id") ||
      ls?.getItem("userId");
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

/** =========================================================
 * Fetchers (compat�veis com o route.ts)
 * ========================================================= */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  const text = await res.text();
  const raw: any = safeParseJson(text);

  if (!res.ok) {
    // tenta entender envelope do route.ts
    try {
      unwrapEnvelope<any>(raw);
    } catch (e: any) {
      throw e;
    }
    const msg =
      typeof raw === "string"
        ? raw
        : raw?.error || raw?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return unwrapEnvelope<T>(raw);
}

export async function apiPost<T>(body: Record<string, any>): Promise<T> {
  const res = await fetch(API_POSTO, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  const raw: any = safeParseJson(text);

  if (!res.ok) {
    try {
      unwrapEnvelope<any>(raw);
    } catch (e: any) {
      throw e;
    }
    const msg =
      typeof raw === "string"
        ? raw
        : raw?.error || raw?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return unwrapEnvelope<T>(raw);
}

/** POST gen�rico para rotas /api/db/... (mantido por compat) */
export async function apiDbPost<T>(endpoint: string, body: any): Promise<T> {
  const res = await fetch(`${API_DB}/${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  const raw: any = safeParseJson(text);

  if (!res.ok) {
    const msg =
      typeof raw === "string"
        ? raw
        : raw?.error || raw?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  // compat: pode (ou n�o) usar envelope ok/data; se tiver, desembrulha
  try {
    return unwrapEnvelope<T>(raw);
  } catch {
    return raw as T;
  }
}

/** =========================================================
 * Generic hook
 * ========================================================= */
export function useApiData<T>(
  url: string | null,
  options?: SWRConfiguration<T, Error>,
): SWRResponse<T, Error> {
  return useSWR<T, Error>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    ...options,
  });
}

/** =========================================================
 * Types (dados crus vindos do backend)
 * ========================================================= */
export type ApiTurnoInfo = {
  calendario_turno_id?: string;
  turno_id?: string;
  turno_public_id?: string | null;
  turno_nome?: string | null;
  inicio_utc?: string | null;
  fim_utc?: string | null;
};

export type ApiDashboardCard = {
  // ids
  empresa_id?: string;
  centro_trabalho_id?: string;

  // Centro de trabalho
  ct_codigo?: string | null;
  ct_nome?: string | null;
  ct_public_id?: string | null;

  // Status
  status_ct?: string | null;
  status_descricao?: string | null;
  motivo_parada_id?: string | null;
  motivo_codigo?: string | null;
  motivo_descricao?: string | null;
  motivo_grupo_perda?: string | null;
  motivo_is_planejada?: boolean | null;
  parada_inicio_utc?: string | null;
  parada_duracao_seg?: number | null;

  // Ordem / Produto
  ordem_atual_id?: string | null;
  ordem_codigo?: string | null;
  ordem_public_id?: string | null;

  produto_atual_id?: string | null;
  produto_public_id?: string | null;
  produto_descricao?: string | null;
  produto_ciclo_ideal_seg?: number | null;

  // ? NOVA VARI�VEL HIST�RICA DO BACKEND
  produto_total_good_historico?: number | null;

  // Modo de contagem do posto: 'GOOD' (peça boa, padrão) | 'REWORK' (retrabalho)
  modo_contagem?: string | null;

  // Totais "agora"
  total_good?: number | null;
  total_scrap?: number | null;
  total_rework?: number | null;

  // Totais do turno
  turno_good?: number | null;
  turno_scrap?: number | null;
  turno_rework?: number | null;
  turno_paradas_duracao_seg?: number | null;

  // tempos/oee (LEGADO - agora n�o � fonte principal)
  planned_time_seg?: number | null;
  unplanned_stop_seg?: number | null;
  run_time_seg?: number | null;

  // Metas
  meta_corrida?: number | null;

  // OEE (no header) � pode vir como 0..1 OU 0..100 (LEGADO)
  oee?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;

  // Turno
  turno?: ApiTurnoInfo | null;

  // Rebarbador atribuído ao posto (NULL/ausente = Indefinido)
  rebarbador?: RebarbadorAtribuido | null;

  // Apontador atribuído ao posto (NULL/ausente = Indefinido)
  apontador?: ApontadorAtribuido | null;
};

export type ProducaoPorHoraPoint = {
  empresa_id?: string;
  centro_trabalho_id?: string;
  ct_public_id?: string | null;
  ct_codigo?: string | null;

  corrida_id?: string | null;
  bucket_time_utc: string;
  bucket_hour_utc?: string | null;

  good_count?: number | null;
  scrap_count?: number | null;
  rework_count?: number | null;

  produced_target?: number | null;
  capacidade?: number | null;
  meta?: number | null;

  ciclo_medio_seg?: number | null;
};

export type OeePorPeriodoRow = {
  empresa_id?: string;
  centro_trabalho_id?: string;
  ct_public_id?: string | null;
  ct_codigo?: string | null;

  turno_id?: string | null;
  turno_public_id?: string | null;
  turno_nome?: string | null;

  ordem_id?: string | null;
  ordem_public_id?: string | null;
  ordem_codigo?: string | null;

  produto_id?: string | null;
  produto_public_id?: string | null;
  produto_descricao?: string | null;

  dia_utc?: string | null;
  inicio_utc?: string | null;
  fim_utc?: string | null;

  meta_corrida?: number | null;
  total_good?: number | null;
  total_scrap?: number | null;
  total_rework?: number | null;

  planned_time_seg?: number | null;
  unplanned_stop_seg?: number | null;
  run_time_seg?: number | null;
  ideal_time_seg?: number | null;

  // pode vir como 0..1 OU 0..100
  oee?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
};

export type PerdasPorPeriodoRow = {
  empresa_id?: string;
  centro_trabalho_id?: string;
  ct_public_id?: string | null;
  ct_codigo?: string | null;

  corrida_id?: string | null;

  motivo_id?: string | null;
  motivo_codigo?: string | null;
  motivo_descricao?: string | null;
  grupo_perda?: string | null;
  is_planejada?: boolean | null;

  dia_utc?: string | null;
  ocorrencias?: number | null;

  perda_tempo_seg?: number | null;
  perda_quantidade_scrap?: number | null;
  perda_quantidade_rework?: number | null;

  // compat UI legado
  perda_qtd?: number | null;
};

export type ParadaTurnoRow = {
  parada_id: string | number;

  empresa_id?: string;
  centro_trabalho_id?: string;
  corrida_id?: string | null;

  motivo_id?: string | null;
  motivo_codigo?: string | null;
  motivo_descricao?: string | null;
  grupo_perda?: string | null;
  is_planejada?: boolean | null;
  exige_justificativa?: boolean | null;

  inicio_utc: string;
  fim_utc?: string | null;
  duracao_seg?: number | null;

  is_justificada?: boolean | null;
  justificativa_texto?: string | null;
  justificativa_usuario_id?: string | null;
  justificativa_time_utc?: string | null;

  /** último UPDATE na linha — diferente de justificativa_time_utc indica edição posterior do motivo */
  updated_at?: string | null;
};

export type MotivoParadaRow = {
  motivo_id: string;
  empresa_id: string;
  public_id?: string | null;
  codigo?: string | null;
  descricao?: string | null;
  grupo_perda?: string | null;
  is_planejada?: boolean | null;
  exige_justificativa?: boolean | null;
  sla_minutos?: number | null;
  is_ativo?: boolean | null;
};

/** Funcionário (rebarbador) — cadastro */
export type FuncionarioRow = {
  funcionario_id: string;
  empresa_id: string;
  public_id?: string | null;
  nome: string;
  registro?: string | null;
  cargo?: string | null;
  is_active?: boolean | null;
};

/** Rebarbador atribuído ao posto (vem no header) */
export type RebarbadorAtribuido = {
  funcionario_id: string;
  nome: string;
  registro: string | null;
  cargo: string | null;
};

/** Apontador atribuído ao posto (vem no header) — mesmo shape do rebarbador */
export type ApontadorAtribuido = RebarbadorAtribuido;

/** Turno cadastrado (mes.turnos) */
export type TurnoRow = {
  turno_id: string;
  public_id?: string | null;
  nome: string;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  ordem_exibicao?: number | null;
};

/** Apontador padrão configurado para um turno (funcionario_id/nome nulos = sem padrão definido) */
export type ApontadorPadraoRow = {
  turno_id: string;
  turno_nome: string;
  ordem_exibicao?: number | null;
  funcionario_id: string | null;
  nome: string | null;
  registro?: string | null;
};

/** Um período do histórico de apontador do CT (funcionario_id/nome nulos = "Indefinido") */
export type ApontadorLogRow = {
  funcionario_id: string | null;
  nome: string | null;
  inicio_utc: string;
  fim_utc: string | null;
};

/** =========================================================
 * NOVOS Types (FILA / LOG�STICA) � shape flex�vel (compat-safe)
 * ========================================================= */

/** item retornado por available-orders */
export type AvailableOrderRow = Record<string, any> & {
  ordem_id?: string | number | null;
  ordem_public_id?: string | null;
  ordem_codigo?: string | null;
  produto_descricao?: string | null;
  produto_public_id?: string | null;
  prioridade?: number | null;
  saldo?: number | null;
};

/** ? FIX #1: Tipagem da regra de fim alinhada ao backend */
export type FinishRuleTipo = "SEM" | "QTD" | "HORARIO";

export type FinishRule = {
  tipo: FinishRuleTipo;
  qtd?: number | null;
  fim_utc?: string | null;
} & Record<string, any>;

/** item retornado por queue (fila) */
export type QueueItemRow = Record<string, any> & {
  fila_item_id?: string | number | null;
  ordem_id?: string | number | null;
  ordem_codigo?: string | null;
  ordem_public_id?: string | null;
  posicao?: number | null;
  is_current?: boolean | null;

  // pode vir como objeto livre tamb�m (compat)
  finish_rule?: FinishRule | null;
};

/** ? FIX #2: estado da fila (backend retorna { current, queue }) */
export type QueueState = {
  current: {
    ordem_atual_id: string | null;
    ordem_codigo: string | null;
    produto_descricao: string | null;
    status_ct: string | null;
    total_good: number;
    condicao_fim_tipo: FinishRuleTipo;
    condicao_fim_qtd: number | null;
    condicao_fim_fim_utc: string | null;
  } | null;
  queue: QueueItemRow[];
};

/** payload de paradas pendentes (modal) */
export type ParadaPendenteRow = ParadaTurnoRow & Record<string, any>;

/** =========================================================
 * Types (dados j� "prontos" pro UI do page.tsx)
 * ========================================================= */
export type UiProductionPoint = {
  hour: string;
  /** produzido (good) */
  value: number;
  /** capacidade (UN/h) */
  capacity: number;
  /** meta (UN/h) */
  meta: number;
  /** refugo + retrabalho */
  rejected: number;
};

export type UiCyclePoint = {
  hour: string;
  /** ciclo m�dio (s) */
  value: number;
  /** ciclo nominal/ideal (s) */
  nominal: number;
};

export type UiLossBar = {
  label: string;
  value: number; // minutos (ou % no caso doeeBars)
  color: string;
};

export type UiPendingStop = {
  date: string;
  time: string;
  duration: string;
  status?: string | null;
  row: ParadaTurnoRow;
};

/** =========================================================
 * Internals: /api/db/posto (op=...)
 * ========================================================= */
function postoUrl(op: string, params?: Record<string, any>) {
  return buildUrl(API_POSTO, { op, ...params });
}

/** =========================================================
 * Hooks (dados crus) - DASHBOARD
 * ========================================================= */
export function useDashboardHeader(
  centroTrabalhoId: string | null | undefined,
  empresaId?: string | null,
) {
  const enabled = !!centroTrabalhoId;
  const url = enabled
    ? postoUrl("header", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
      })
    : null;
  return useApiData<ApiDashboardCard>(url);
}

export function useDashboardProducaoPorHora(args: {
  centroTrabalhoId: string | null | undefined;
  dataInicio: string | null | undefined;
  dataFim: string | null | undefined;
  empresaId?: string | null | undefined;
}) {
  const { centroTrabalhoId, dataInicio, dataFim, empresaId } = args;
  const enabled = !!centroTrabalhoId && !!dataInicio && !!dataFim;

  const url = enabled
    ? postoUrl("producao-por-hora", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
        dataInicio,
        dataFim,
      })
    : null;

  return useApiData<ProducaoPorHoraPoint[]>(url);
}

/**
 * ? Agora este hook � "por turno" (vw_oee_por_turno), mas mantemos o nome
 * para compatibilidade com a UI que j� chama "oee-por-periodo".
 */
export function useDashboardOeePorPeriodo(args: {
  centroTrabalhoId: string | null | undefined;
  dataInicio: string | null | undefined;
  dataFim: string | null | undefined;
  empresaId?: string | null | undefined;
}) {
  const { centroTrabalhoId, dataInicio, dataFim, empresaId } = args;
  const enabled = !!centroTrabalhoId && !!dataInicio && !!dataFim;

  const url = enabled
    ? postoUrl("oee-por-periodo", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
        dataInicio,
        dataFim,
      })
    : null;

  return useApiData<OeePorPeriodoRow[]>(url);
}

/**
 * ? Agora este hook � "perdas por turno" (vw_oee_por_turno -> linhas sint�ticas),
 * mas mantemos o nome para compatibilidade.
 */
export function useDashboardPerdasPorPeriodo(args: {
  centroTrabalhoId: string | null | undefined;
  dataInicio: string | null | undefined;
  dataFim: string | null | undefined;
  empresaId?: string | null | undefined;
  /** compat route.ts: is_exact_time=1 para janelas ISO exatas */
  isExactTime?: boolean;
}) {
  const { centroTrabalhoId, dataInicio, dataFim, empresaId, isExactTime } =
    args;
  const enabled = !!centroTrabalhoId && !!dataInicio && !!dataFim;

  const url = enabled
    ? postoUrl("perdas-por-periodo", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
        dataInicio,
        dataFim,
        is_exact_time: isExactTime ? 1 : undefined,
      })
    : null;

  return useApiData<PerdasPorPeriodoRow[]>(url);
}

export function useDashboardParadasDoTurno(args: {
  centroTrabalhoId: string | null | undefined;
  turnoInicio: string | null | undefined;
  turnoFim: string | null | undefined;
  empresaId?: string | null | undefined;
}) {
  const { centroTrabalhoId, turnoInicio, turnoFim, empresaId } = args;
  const enabled = !!centroTrabalhoId && (!!turnoInicio || !!turnoFim);
  const url = enabled
    ? postoUrl("paradas-turno", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
        turnoInicio,
        turnoFim,
      })
    : null;

  return useApiData<ParadaTurnoRow[]>(url);
}

export function usePostoMotivosParada(args?: {
  empresaId?: string | null;
  somenteAtivos?: boolean;
}) {
  const empresa_id = resolveEmpresaId(args?.empresaId ?? null);
  const somente_ativos = args?.somenteAtivos ?? true;

  const url = postoUrl("motivos-parada", {
    empresa_id,
    somente_ativos: somente_ativos ? 1 : 0,
  });

  return useApiData<MotivoParadaRow[]>(url);
}

export function usePostoFuncionarios(args?: {
  empresaId?: string | null;
  q?: string | null;
  somenteAtivos?: boolean;
  /** Filtra por cargo exato (ex.: "Apontador"). Omitido = sem filtro (comportamento do Rebarbador). */
  cargo?: string | null;
  /** Exclui um cargo exato (ex.: "Apontador"). Usado pelo modal de Rebarbador
   *  para não listar funcionários cadastrados como apontador. */
  excluirCargo?: string | null;
}) {
  const empresa_id = resolveEmpresaId(args?.empresaId ?? null);
  const somente_ativos = args?.somenteAtivos ?? true;

  const url = postoUrl("funcionarios", {
    empresa_id,
    q: args?.q ?? undefined,
    somente_ativos: somente_ativos ? 1 : 0,
    cargo: args?.cargo ?? undefined,
    excluir_cargo: args?.excluirCargo ?? undefined,
  });

  return useApiData<FuncionarioRow[]>(url);
}

export function usePostoTurnos(args?: { empresaId?: string | null }) {
  const empresa_id = resolveEmpresaId(args?.empresaId ?? null);
  const url = postoUrl("turnos", { empresa_id });
  return useApiData<TurnoRow[]>(url);
}

export function usePostoApontadoresPadrao(args: {
  centroTrabalhoId: string | null | undefined;
  empresaId?: string | null;
}) {
  const empresa_id = resolveEmpresaId(args?.empresaId ?? null);
  const url = args.centroTrabalhoId
    ? postoUrl("apontadores-padrao", {
        empresa_id,
        centro_trabalho_id: args.centroTrabalhoId,
      })
    : null;
  return useApiData<ApontadorPadraoRow[]>(url);
}

/** Histórico de apontador do CT numa janela — para a timeline mostrar quem operou em cada turno. */
export function usePostoApontadorHistorico(args: {
  centroTrabalhoId: string | null | undefined;
  empresaId?: string | null;
  fromIsoUtc?: string | null;
  toIsoUtc?: string | null;
}) {
  const empresa_id = resolveEmpresaId(args?.empresaId ?? null);
  const enabled = !!args.centroTrabalhoId && !!args.fromIsoUtc && !!args.toIsoUtc;
  const url = enabled
    ? postoUrl("apontador-historico", {
        empresa_id,
        centro_trabalho_id: args.centroTrabalhoId,
        from_utc: args.fromIsoUtc,
        to_utc: args.toIsoUtc,
      })
    : null;
  return useApiData<ApontadorLogRow[]>(url);
}

/**
 * Força a revalidação de QUALQUER cache SWR de histórico de apontador
 * (op=apontador-historico), em qualquer CT/janela. Necessário porque o
 * histórico é lido por um componente (timeline) separado do hook central
 * do posto — sem isto, atribuir/definir padrão só atualiza os hooks do
 * cabeçalho e a timeline (se já montada) continua mostrando dado velho até
 * a próxima janela de dedupe do SWR expirar. Best-effort: nunca lança erro.
 */
export function revalidatePostoApontadorHistorico(): void {
  try {
    swrMutateGlobal(
      (key: unknown) => typeof key === "string" && key.includes("op=apontador-historico"),
      undefined,
      { revalidate: true },
    );
  } catch {
    /* no-op */
  }
}

/** =========================================================
 * RETRABALHO MULTI-PEÇA (modo de contagem + fila cíclica)
 * ========================================================= */

export type RetrabalhoPecaRow = {
  retrabalho_peca_id: string;
  produto_id: string | null;
  produto_codigo: string;
  produto_descricao: string | null;
  posicao: number;
  total_rework: number;
  ativo: boolean;
  /** Retrabalho distribuído para esta peça no turno atual. */
  turno_rework?: number;
};

export type RetrabalhoPecasState = {
  modo_contagem: "GOOD" | "REWORK";
  pecas: RetrabalhoPecaRow[];
  /** Posição da peça que recebe o PRÓXIMO apontamento (rodízio). */
  proxima_posicao: number | null;
  /** true = migração do banco ainda não rodou (só o modo funciona). */
  migracao_pendente: boolean;
};

export type ProdutoPecaRow = {
  produto_id: string;
  produto_codigo: string;
  produto_descricao: string | null;
  familia: string | null;
};

/** Modo de contagem + conjunto de peças em retrabalho do posto. */
export function usePostoRetrabalhoPecas(args: {
  centroTrabalhoId: string | null | undefined;
  empresaId?: string | null;
  /** desliga o fetch (ex.: modal fechado) */
  enabled?: boolean;
}) {
  const enabled = (args.enabled ?? true) && !!args.centroTrabalhoId;
  const url = enabled
    ? postoUrl("retrabalho-pecas", {
        empresa_id: resolveEmpresaId(args.empresaId ?? null),
        centro_trabalho_id: args.centroTrabalhoId,
      })
    : null;
  return useApiData<RetrabalhoPecasState>(url);
}

/** Catálogo de peças para escolher quais estão em retrabalho. */
export function usePostoProdutos(args: {
  empresaId?: string | null;
  q?: string | null;
  limit?: number | null;
  enabled?: boolean;
}) {
  const enabled = args.enabled ?? true;
  const url = enabled
    ? postoUrl("produtos", {
        empresa_id: resolveEmpresaId(args.empresaId ?? null),
        q: args.q ?? undefined,
        limit: args.limit ?? undefined,
      })
    : null;
  return useApiData<ProdutoPecaRow[]>(url);
}

/** =========================================================
 * NOVOS Hooks (FILA / LOG�STICA)
 * ========================================================= */

export function usePostoAvailableOrders(args: {
  centroTrabalhoId: string | null | undefined;
  empresaId?: string | null | undefined;
  q?: string | null | undefined;
}) {
  const { centroTrabalhoId, empresaId, q } = args;
  const enabled = !!centroTrabalhoId;

  const url = enabled
    ? postoUrl("available-orders", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
        q: q ?? undefined,
      })
    : null;

  return useApiData<AvailableOrderRow[]>(url);
}

/** ? FIX #2 (PATCH): agora retorna QueueState (objeto { current, queue })
 *  + mapeia condicao_fim_* -> finish_rule para a UI n�o mostrar "Sem condi��o"
 */
export function usePostoQueue(args: {
  centroTrabalhoId: string | null | undefined;
  empresaId?: string | null | undefined;
}) {
  const { centroTrabalhoId, empresaId } = args;
  const enabled = !!centroTrabalhoId;

  const url = enabled
    ? postoUrl("queue", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
      })
    : null;

  const swr = useApiData<QueueState>(url);

  const data = useMemo<QueueState | undefined>(() => {
    const d = swr.data;
    if (!d) return d;

    const normalizeTipo = (x: any): FinishRuleTipo => {
      const t = String(x || "SEM")
        .trim()
        .toUpperCase();
      if (t === "QTD" || t === "HORARIO" || t === "SEM")
        return t as FinishRuleTipo;
      return "SEM";
    };

    const toIsoOrNull = (v: any): string | null => {
      if (!v) return null;
      // pode vir ISO string, Date, ou string do SQL
      const dt = v instanceof Date ? v : new Date(v);
      return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
    };

    const queueMapped: QueueItemRow[] = (d.queue || []).map((it: any) => {
      // se j� vier finish_rule do backend algum dia, respeita
      if (it?.finish_rule && typeof it.finish_rule === "object")
        return it as QueueItemRow;

      const tipo = normalizeTipo(it?.condicao_fim_tipo);
      const qtd = it?.condicao_fim_qtd ?? null;
      const fim_utc = toIsoOrNull(it?.condicao_fim_fim_utc);

      return {
        ...it,
        finish_rule: { tipo, qtd, fim_utc },
      } as QueueItemRow;
    });

    // opcional: tamb�m exp�e current.finish_rule (ajuda no header da OP atual)
    const currentMapped = d.current
      ? ({
          ...d.current,
          // garante normaliza��o
          condicao_fim_tipo: normalizeTipo(d.current.condicao_fim_tipo),
          condicao_fim_fim_utc: toIsoOrNull(d.current.condicao_fim_fim_utc),
          finish_rule: {
            tipo: normalizeTipo(d.current.condicao_fim_tipo),
            qtd: d.current.condicao_fim_qtd ?? null,
            fim_utc: toIsoOrNull(d.current.condicao_fim_fim_utc),
          },
        } as any)
      : null;

    return {
      ...d,
      current: currentMapped,
      queue: queueMapped,
    };
  }, [swr.data]);

  // devolve tudo do SWR, mas com data "corrigida"
  return {
    ...swr,
    data,
  };
}

export function usePostoParadasPendentes(args: {
  centroTrabalhoId: string | null | undefined;
  empresaId?: string | null | undefined;
}) {
  const { centroTrabalhoId, empresaId } = args;
  const enabled = !!centroTrabalhoId;

  const url = enabled
    ? postoUrl("paradas-pendentes", {
        empresa_id: resolveEmpresaId(empresaId),
        centro_trabalho_id: centroTrabalhoId,
      })
    : null;

  return useApiData<ParadaPendenteRow[]>(url);
}

/** =========================================================
 * A��es (POST) � /api/db/posto (route.ts)
 * ========================================================= */
export type PostoActionCommon = {
  empresa_id?: string;
  usuario_id?: string | number | null;
  event_time_utc?: string | null;
  observacao?: string | null;
  source_system?: string | null;
};

export async function postoApontarProducao(
  input: PostoActionCommon & { centro_trabalho_id: string; good: number },
) {
  return apiPost<{ bucket_time_utc?: string } & Record<string, any>>({
    action: "apontar-producao",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    good: input.good,
    event_time_utc: input.event_time_utc ?? null,
    usuario_id: input.usuario_id ?? null,
    observacao: input.observacao ?? null,
    source_system: input.source_system ?? null,
  });
}

export async function postoApontarRefugoRetrabalho(
  input: PostoActionCommon & {
    centro_trabalho_id: string;
    scrap?: number;
    rework?: number;
    motivo_id?: string | number | null;
  },
) {
  return apiPost<{ bucket_time_utc?: string } & Record<string, any>>({
    action: "apontar-refugo-retrabalho",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    scrap: input.scrap,
    rework: input.rework,
    motivo_id: input.motivo_id ?? null,
    event_time_utc: input.event_time_utc ?? null,
    usuario_id: input.usuario_id ?? null,
    observacao: input.observacao ?? null,
    source_system: input.source_system ?? null,
  });
}

export async function postoIniciarParada(
  input: PostoActionCommon & {
    centro_trabalho_id: string;
    motivo_id?: string | number | null;
  },
) {
  return apiPost<
    { parada_id: string; ja_estava_parado: boolean } & Record<string, any>
  >({
    action: "iniciar-parada",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    motivo_id: input.motivo_id ?? null,
    event_time_utc: input.event_time_utc ?? null,
    usuario_id: input.usuario_id ?? null,
    observacao: input.observacao ?? null,
    source_system: input.source_system ?? null,
  });
}

export async function postoJustificarParada(input: {
  empresa_id?: string;
  parada_id: string | number;
  motivo_id?: string | number | null;
  justificativa_texto?: string | null;
  usuario_id?: string | number | null;
}) {
  return apiPost<{ ok: true; rowsAffected: number }>({
    action: "justificar-parada",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    parada_id: String(input.parada_id),
    motivo_id: input.motivo_id ?? null,
    justificativa_texto: input.justificativa_texto ?? null,
    usuario_id: input.usuario_id ?? null,
  });
}

/** Edita motivo/observação de uma parada QUE JÁ FOI justificada (não altera quando/quem justificou pela 1ª vez). */
export async function postoEditarParadaMotivo(input: {
  empresa_id?: string;
  parada_id: string | number;
  motivo_id: string | number;
  justificativa_texto?: string | null;
  usuario_id?: string | number | null;
}) {
  return apiPost<{ ok: true; rowsAffected: number }>({
    action: "editar-parada-motivo",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    parada_id: String(input.parada_id),
    motivo_id: String(input.motivo_id),
    justificativa_texto: input.justificativa_texto ?? null,
    usuario_id: input.usuario_id ?? null,
  });
}

/** Justifica várias paradas de uma vez com o mesmo motivo/observação. */
export async function postoJustificarParadasEmMassa(input: {
  empresa_id?: string;
  parada_ids: Array<string | number>;
  motivo_id: string | number;
  justificativa_texto?: string | null;
  usuario_id?: string | number | null;
}) {
  return apiPost<{ ok: true; succeeded: string[]; failed: string[] }>({
    action: "justificar-paradas-em-massa",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    parada_ids: input.parada_ids.map((id) => String(id)),
    motivo_id: String(input.motivo_id),
    justificativa_texto: input.justificativa_texto ?? null,
    usuario_id: input.usuario_id ?? null,
  });
}

export async function postoAdicionarPecaHack(input: {
  empresa_id?: string;
  codigo_ct: string;
  delta?: number;
  usuario_id?: string | number | null;
  event_time_utc?: string | null;
  source_system?: string | null;
}) {
  return apiPost<{
    centro_trabalho_id: string;
    corrida_atual_id: string | null;
    produto_atual_id: string | null;
    corrida_hist_id: string | null;
    delta: number;
    mensagem: string;
  }>({
    action: "adicionar-peca-hack",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    codigo_ct: input.codigo_ct,
    delta: input.delta,
    usuario_id: input.usuario_id ?? null,
    event_time_utc: input.event_time_utc ?? null,
    source_system: input.source_system ?? null,
  });
}

/** ? usa o action NOVO do seu route.ts (sem depender de /dashboard) */
export async function postoRetomarProducao(
  input: PostoActionCommon & { centro_trabalho_id: string },
) {
  return apiPost<Record<string, any>>({
    action: "retomar-producao",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    event_time_utc: input.event_time_utc ?? null,
    usuario_id: input.usuario_id ?? null,
    source_system: input.source_system ?? null,
  });
}

/** Mantido por compat (se voc� ainda usa em outros lugares) */
export async function dashboardRetomarProducao(input: {
  centroTrabalhoId: string;
}) {
  return apiDbPost<any>("dashboard/retomar-producao", input);
}

/** =========================================================
 * MOTIVOS DE PARADA (CRUD)
 * ========================================================= */

export async function postoCriarMotivo(input: {
  empresa_id: string;
  codigo: string;
  descricao: string;
  grupo_perda?: string | null;
  is_planejada: 0 | 1;
  exige_justificativa?: 0 | 1 | null;
}) {
  return apiPost<{ motivo_id: string }>({ action: "criar-motivo-parada", ...input });
}

export async function postoEditarMotivo(input: {
  empresa_id: string;
  motivo_id: string;
  codigo: string;
  descricao: string;
  grupo_perda?: string | null;
  is_planejada: 0 | 1;
  exige_justificativa?: 0 | 1 | null;
}) {
  return apiPost<{ ok: true }>({ action: "editar-motivo-parada", ...input });
}

export async function postoExcluirMotivo(input: {
  empresa_id: string;
  motivo_id: string;
}) {
  return apiPost<{ ok: true }>({ action: "excluir-motivo-parada", ...input });
}

/** =========================================================
 * FUNCIONARIOS (REBARBADORES) — CRUD + atribuição
 * ========================================================= */

export async function postoCriarFuncionario(input: {
  empresa_id: string;
  nome: string;
  registro?: string | null;
  cargo?: string | null;
}) {
  return apiPost<{ funcionario_id: string }>({ action: "criar-funcionario", ...input });
}

export async function postoEditarFuncionario(input: {
  empresa_id: string;
  funcionario_id: string;
  nome: string;
  registro?: string | null;
  cargo?: string | null;
}) {
  return apiPost<{ ok: true }>({ action: "editar-funcionario", ...input });
}

export async function postoExcluirFuncionario(input: {
  empresa_id: string;
  funcionario_id: string;
}) {
  return apiPost<{ ok: true }>({ action: "excluir-funcionario", ...input });
}

export async function postoAtribuirRebarbador(input: {
  empresa_id: string;
  centro_trabalho_id: string;
  funcionario_id: string | null;
}) {
  return apiPost<{ ok: true }>({ action: "atribuir-rebarbador", ...input });
}

export async function postoAtribuirApontador(input: {
  empresa_id: string;
  centro_trabalho_id: string;
  funcionario_id: string | null;
}) {
  return apiPost<{ ok: true }>({ action: "atribuir-apontador", ...input });
}

export async function postoDefinirApontadorPadrao(input: {
  empresa_id: string;
  centro_trabalho_id: string;
  turno_id: string;
  funcionario_id: string | null;
}) {
  return apiPost<{ ok: true }>({ action: "definir-apontador-padrao", ...input });
}

/** Define o modo de contagem do posto: 'GOOD' (peça boa) ou 'REWORK' (retrabalho). */
export async function postoSetModoContagem(input: {
  empresa_id: string;
  centro_trabalho_id: string;
  modo: "GOOD" | "REWORK";
  usuario_id?: string | number | null;
}) {
  return apiPost<{ ok: true; modo_contagem: "GOOD" | "REWORK" }>({
    action: "set-modo-contagem",
    empresa_id: input.empresa_id,
    centro_trabalho_id: input.centro_trabalho_id,
    modo: input.modo,
    usuario_id: input.usuario_id ?? null,
  });
}

/**
 * Substitui o conjunto de peças em retrabalho do posto.
 * A ORDEM do array é a ordem do rodízio (fila cíclica): cada contagem do
 * sensor vai para a peça seguinte. O total de retrabalho do posto não
 * depende do rateio — ele é sempre a soma cheia dos apontamentos.
 */
export async function postoSetRetrabalhoPecas(input: {
  empresa_id: string;
  centro_trabalho_id: string;
  pecas: Array<{
    produto_codigo: string;
    produto_id?: string | null;
    produto_descricao?: string | null;
  }>;
  usuario_id?: string | number | null;
}) {
  return apiPost<{ ok: true; pecas: number }>({
    action: "set-retrabalho-pecas",
    empresa_id: input.empresa_id,
    centro_trabalho_id: input.centro_trabalho_id,
    pecas: input.pecas,
    usuario_id: input.usuario_id ?? null,
  });
}

/** =========================================================
 * NOVAS a��es: FILA / LOG�STICA (route.ts)
 * ========================================================= */

export async function postoAddToQueue(input: {
  empresa_id?: string;
  centro_trabalho_id: string;
  ordem_id: string | number;
  rule?: FinishRule | null;
}) {
  return apiPost<Record<string, any>>({
    action: "add-to-queue",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    ordem_id: String(input.ordem_id),
    rule: input.rule ?? null,
  });
}

export async function postoReorderQueue(input: {
  empresa_id?: string;
  centro_trabalho_id: string;
  ids: Array<string | number>;
}) {
  return apiPost<Record<string, any>>({
    action: "reorder-queue",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    ids: input.ids,
  });
}

export async function postoUpdateFinishRule(input: {
  empresa_id?: string;
  fila_item_id: string | number;
  rule: FinishRule;
}) {
  return apiPost<Record<string, any>>({
    action: "update-finish-rule",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    fila_item_id: String(input.fila_item_id),
    rule: input.rule,
  });
}

export async function postoRemoveFromQueue(input: {
  empresa_id?: string;
  centro_trabalho_id: string;
  fila_item_id: string | number;
}) {
  return apiPost<Record<string, any>>({
    action: "remove-from-queue",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    fila_item_id: String(input.fila_item_id),
  });
}

export async function postoClearQueue(input: {
  empresa_id?: string;
  centro_trabalho_id: string;
}) {
  return apiPost<Record<string, any>>({
    action: "clear-queue",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
  });
}

export async function postoSetCurrentOrder(input: {
  empresa_id?: string;
  centro_trabalho_id: string;
  ordem_id: string | number;
  rule?: FinishRule | null;
  usuario_id?: string | number | null;
  source_system?: string | null;
}) {
  return apiPost<Record<string, any>>({
    action: "set-current-order",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    ordem_id: String(input.ordem_id),
    rule: input.rule ?? null,
    usuario_id: input.usuario_id ?? null,
    source_system: input.source_system ?? null,
  });
}

export async function postoAdvanceQueue(input: {
  empresa_id?: string;
  centro_trabalho_id: string;
  usuario_id?: string | number | null;
  source_system?: string | null;
}) {
  return apiPost<Record<string, any>>({
    action: "advance-queue",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    centro_trabalho_id: input.centro_trabalho_id,
    usuario_id: input.usuario_id ?? null,
    source_system: input.source_system ?? "RULE_ENGINE_MANUAL",
  });
}

/** =========================================================
 * BROADCAST: lista CTs e envia fila para m�ltiplos CTs
 * ========================================================= */

export type CTBroadcastRow = {
  centro_trabalho_id: string;
  codigo: string;
  nome: string;
};

export function usePostoCentrosTrabalhoList(args: { empresaId?: string | null }) {
  const empresa_id = resolveEmpresaId(args.empresaId);
  const url = empresa_id ? postoUrl("list-cts", { empresa_id }) : null;
  return useApiData<CTBroadcastRow[]>(url, { revalidateOnFocus: false, dedupingInterval: 60_000 });
}

export async function postoBroadcastQueue(input: {
  empresa_id?: string;
  source_ct_id: string;
  target_ct_ids: string[];
  ordem_ids: string[];
  substituir: boolean;
}) {
  return apiPost<{ results: Array<{ centro_trabalho_id: string; inserted: number; error?: string }> }>({
    action: "broadcast-queue",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    source_ct_id: input.source_ct_id,
    target_ct_ids: input.target_ct_ids,
    ordem_ids: input.ordem_ids,
    substituir: input.substituir,
  });
}

/** =========================================================
 * EXECUTAR 1ª ORDEM: lista CTs com fila e executa ordens em massa
 * ========================================================= */

export type CTFilaItem = {
  fila_item_id: string;
  ordem_id: string;
  ordem_codigo: string | null;
  produto_descricao: string | null;
  posicao: number;
};

export type CTComFilaRow = {
  centro_trabalho_id: string;
  codigo: string;
  nome: string;
  ordem_atual_id: string | null;
  ordem_atual_codigo: string | null;
  fila: CTFilaItem[];
};

/** Lista todos os CTs ativos com a ordem atual + fila. Fetch sob demanda
 *  (passe enabled=false para não buscar enquanto o modal está fechado). */
export function usePostoCTsComFila(args: {
  empresaId?: string | null;
  enabled?: boolean;
}) {
  const empresa_id = resolveEmpresaId(args.empresaId);
  const enabled = args.enabled ?? true;
  const url = empresa_id && enabled ? postoUrl("list-cts-fila", { empresa_id }) : null;
  return useApiData<CTComFilaRow[]>(url, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });
}

export type ExecuteOrdersResult = {
  results: Array<{
    centro_trabalho_id: string;
    ordem_id: string;
    ok: boolean;
    error?: string;
  }>;
};

export async function postoExecuteOrders(input: {
  empresa_id?: string;
  items: Array<{ centro_trabalho_id: string; ordem_id: string }>;
  usuario_id?: string | null;
  source_system?: string | null;
}) {
  return apiPost<ExecuteOrdersResult>({
    action: "execute-orders",
    empresa_id: input.empresa_id || resolveEmpresaId(null),
    items: input.items,
    usuario_id: input.usuario_id ?? getUsuarioIdFallback(),
    source_system: input.source_system ?? "APP",
  });
}

/** =========================================================
 * ? Hook "completo" do Posto (produ��o/OEE/perdas/paradas)
 * ========================================================= */
export function usePostoStationDetail(args: {
  stationId: string | null | undefined;
  empresaId?: string | null;
  usuarioId?: string | number | null;
  sourceSystem?: string | null;
  /** cores do chart de perdas (top 3) � mant�m o mesmo visual do page */
  lossColors?: string[];
  /** por padr�o: motivos ativos */
  somenteMotivosAtivos?: boolean;
}) {
  const {
    stationId,
    empresaId,
    usuarioId,
    sourceSystem,
    lossColors,
    somenteMotivosAtivos,
  } = args;
  const colors = lossColors || ["#ef4444", "#f59e0b", "#3b82f6"];

  const empresaIdResolved = useMemo(
    () => resolveEmpresaId(empresaId),
    [empresaId],
  );
  const usuarioIdResolved = useMemo(
    () => usuarioId ?? getUsuarioIdFallback(),
    [usuarioId],
  );
  const sourceSystemResolved = sourceSystem ?? "APP";

  /** Header (REAL) */
  const headerHook = useDashboardHeader(stationId, empresaIdResolved);
  const stationHeader = headerHook.data;

  /** Turno ISO */
  const turnoInicioIso = stationHeader?.turno?.inicio_utc || null;
  const turnoFimIso = stationHeader?.turno?.fim_utc || null;

  /** Dia inteiro (YYYY-MM-DD) */
  const dataInicio = useMemo(() => {
    const d = ymdFromIso(turnoInicioIso);
    if (d) return d;
    const hoje = new Date();
    return `${hoje.getFullYear()}-${pad2(hoje.getMonth() + 1)}-${pad2(hoje.getDate())}`;
  }, [turnoInicioIso]);

  const dataFim = useMemo(() => {
    const d = ymdFromIso(turnoFimIso);
    return d || dataInicio;
  }, [turnoFimIso, dataInicio]);

  /** S�ries (dia inteiro) */
  const prodHook = useDashboardProducaoPorHora({
    centroTrabalhoId: stationId,
    dataInicio,
    dataFim,
    empresaId: empresaIdResolved,
  });

  /** OEE por TURNO (janela exata) */
  const oeeHook = useDashboardOeePorPeriodo({
    centroTrabalhoId: stationId,
    dataInicio: turnoInicioIso || dataInicio,
    dataFim: turnoFimIso || dataFim,
    empresaId: empresaIdResolved,
  });

  /** Perdas por TURNO (janela exata) */
  const perdasHook = useDashboardPerdasPorPeriodo({
    centroTrabalhoId: stationId,
    dataInicio: turnoInicioIso || dataInicio,
    dataFim: turnoFimIso || dataFim,
    empresaId: empresaIdResolved,
    isExactTime: true,
  });

  /** Paradas do turno */
  const paradasHook = useDashboardParadasDoTurno({
    centroTrabalhoId: stationId,
    turnoInicio: turnoInicioIso,
    turnoFim: turnoFimIso,
    empresaId: empresaIdResolved,
  });

  /** Motivos */
  const motivosHook = usePostoMotivosParada({
    empresaId: empresaIdResolved,
    somenteAtivos: somenteMotivosAtivos ?? true,
  });

  /** UI computed (header) */
  const stationName = useMemo(() => {
    return (
      stationHeader?.ct_nome ||
      stationHeader?.ct_codigo ||
      stationHeader?.ct_public_id ||
      (stationId ? `CT ${stationId}` : "CT")
    );
  }, [
    stationHeader?.ct_nome,
    stationHeader?.ct_codigo,
    stationHeader?.ct_public_id,
    stationId,
  ]);

  const statusText = useMemo(() => {
    return (
      stationHeader?.status_descricao ||
      stationHeader?.motivo_descricao ||
      stationHeader?.motivo_grupo_perda ||
      stationHeader?.status_ct ||
      "--"
    );
  }, [
    stationHeader?.status_descricao,
    stationHeader?.motivo_descricao,
    stationHeader?.motivo_grupo_perda,
    stationHeader?.status_ct,
  ]);

  const isStopped = useMemo(() => {
    const s = (stationHeader?.status_ct || "").toLowerCase();
    return s.includes("stop") || s.includes("parad");
  }, [stationHeader?.status_ct]);

  const statusTime = useMemo(
    () => (isStopped ? formatHMS(stationHeader?.parada_duracao_seg) : null),
    [isStopped, stationHeader?.parada_duracao_seg],
  );

  const ordemCodigo = useMemo(
    () => stationHeader?.ordem_codigo || stationHeader?.ordem_public_id || "--",
    [stationHeader?.ordem_codigo, stationHeader?.ordem_public_id],
  );
  const produtoCodigo = useMemo(
    () => stationHeader?.produto_public_id || "--",
    [stationHeader?.produto_public_id],
  );
  const produtoNome = useMemo(
    () => stationHeader?.produto_descricao || "--",
    [stationHeader?.produto_descricao],
  );

  const metaCorrida = useMemo(
    () => safeNum(stationHeader?.meta_corrida, 0),
    [stationHeader?.meta_corrida],
  );

  /** progressNow: produção global da peça (todos os CTs e turnos) */
  const progressNow = useMemo(() => {
    const globalTot = safeNum((stationHeader as any)?.produto_producao_total_good, -1);
    if (globalTot >= 0) return globalTot;
    // fallback: corrida no turno atual
    const corridaTurno = safeNum((stationHeader as any)?.corrida_turno_good, -1);
    if (corridaTurno >= 0) return corridaTurno;
    return safeNum(stationHeader?.turno_good, 0);
  }, [
    (stationHeader as any)?.produto_producao_total_good,
    (stationHeader as any)?.corrida_turno_good,
    stationHeader?.turno_good,
  ]);

  const progressMax = useMemo(() => {
    const metaGlobal = safeNum((stationHeader as any)?.produto_meta_planejada, 0);
    if (metaGlobal > 0) return metaGlobal;
    return metaCorrida > 0 ? metaCorrida : Math.max(progressNow, 1);
  }, [(stationHeader as any)?.produto_meta_planejada, metaCorrida, progressNow]);

  const progressPercent = useMemo(
    () => Math.min(100, (progressNow / Math.max(1, progressMax)) * 100),
    [progressNow, progressMax],
  );

  /** Modo de contagem do posto (peça boa vs retrabalho). Autoritativo: valor
   *  explícito da coluna vence; NULL => fallback pelo nome do CT. */
  const modoContagem = useMemo<"GOOD" | "REWORK">(() => {
    const m = String(stationHeader?.modo_contagem ?? "").trim().toUpperCase();
    if (m === "REWORK") return "REWORK";
    if (m === "GOOD") return "GOOD";
    return String(stationHeader?.ct_nome ?? "").toLowerCase().includes("retrabalho")
      ? "REWORK"
      : "GOOD";
  }, [stationHeader?.modo_contagem, stationHeader?.ct_nome]);
  const isRework = modoContagem === "REWORK";

  // Em modo retrabalho, "produzido" reflete as peças de retrabalho e o refugo
  // deixa de somar retrabalho (evita contagem dupla). Em modo peça boa, mantém
  // o comportamento clássico (produzido = boas; refugo = scrap + retrabalho).
  const producedTurno = useMemo(
    () =>
      isRework
        ? safeNum(stationHeader?.turno_rework, 0)
        : safeNum(stationHeader?.turno_good, 0),
    [isRework, stationHeader?.turno_rework, stationHeader?.turno_good],
  );
  const rejectedTurno = useMemo(
    () =>
      isRework
        ? safeNum(stationHeader?.turno_scrap, 0)
        : safeNum(stationHeader?.turno_scrap, 0) +
          safeNum(stationHeader?.turno_rework, 0),
    [isRework, stationHeader?.turno_scrap, stationHeader?.turno_rework],
  );

  /** UI computed (series) */
  const sortedProducaoRows = useMemo(() => {
    const rows = (prodHook.data || []) as ProducaoPorHoraPoint[];
    if (!rows.length) return [];
    return rows
      .slice()
      .sort(
        (a, b) =>
          (new Date(a.bucket_time_utc).getTime() || 0) -
          (new Date(b.bucket_time_utc).getTime() || 0),
      );
  }, [prodHook.data]);

  const productionPoints: UiProductionPoint[] = useMemo(() => {
    if (!sortedProducaoRows.length) return [];

    // ciclo ideal do header � da OP atual; mas cada bucket j� traz ciclo_medio_seg
    // que foi calculado na view para aquela corrida espec�fica.
    const idealFromHeader = safeNum(stationHeader?.produto_ciclo_ideal_seg, 0);
    const metaHoraFallback =
      metaCorrida > 0
        ? Math.ceil(metaCorrida / Math.max(1, sortedProducaoRows.length))
        : 0;

    return sortedProducaoRows.map((r) => {
      const value = safeNum(r.good_count, 0);
      const rejected = safeNum(r.scrap_count, 0) + safeNum(r.rework_count, 0);

      // ? Usa ciclo_medio_seg do pr�prio bucket como estimativa de ciclo hist�rico
      // e s� cai no ideal do header se n�o tiver nada do bucket.
      // ? DEPOIS � capFallback sempre usa ciclo ideal
      const capFallback =
        idealFromHeader > 0
          ? Math.floor(3600 / Math.max(1, idealFromHeader))
          : Math.max(0, value);

      const capacity =
        r.capacidade != null
          ? Math.max(0, safeNum(r.capacidade, capFallback))
          : capFallback;

      // ciclo_medio_seg continua dispon�vel s� para cyclePoints (gr�fico de ciclo)
      const cicloMedioParaCycle = safeNum(r.ciclo_medio_seg, 0);

      let meta = 0;
      if (r.meta != null) meta = Math.max(0, safeNum(r.meta, 0));
      else if (r.produced_target != null)
        meta = Math.max(0, safeNum(r.produced_target, 0));
      else if (metaHoraFallback > 0) meta = metaHoraFallback;
      else meta = Math.max(0, capacity);

      const hourLabel = r.bucket_hour_utc
        ? fmtHourLabelFromIsoUtc(r.bucket_hour_utc)
        : fmtHourLabelFromIsoUtc(r.bucket_time_utc);

      return { hour: hourLabel, value, capacity, meta, rejected };
    });
  }, [sortedProducaoRows, stationHeader?.produto_ciclo_ideal_seg, metaCorrida]);

  const cyclePoints: UiCyclePoint[] = useMemo(() => {
    if (!sortedProducaoRows.length) return [];
    const ideal = safeNum(stationHeader?.produto_ciclo_ideal_seg, 0);

    return sortedProducaoRows.map((r) => {
      const hourLabel = r.bucket_hour_utc
        ? fmtHourLabelFromIsoUtc(r.bucket_hour_utc)
        : fmtHourLabelFromIsoUtc(r.bucket_time_utc);
      const value = Math.max(0, safeNum(r.ciclo_medio_seg, 0));
      const nominal = ideal > 0 ? ideal : Math.max(1, value);
      return { hour: hourLabel, value, nominal };
    });
  }, [sortedProducaoRows, stationHeader?.produto_ciclo_ideal_seg]);

  /** perdas (top 3) */
  const lossBars: UiLossBar[] = useMemo(() => {
    const rows = (perdasHook.data || []) as PerdasPorPeriodoRow[];
    if (!rows.length) return [];

    const map = new Map<string, number>();
    for (const r of rows) {
      const key = (
        r.grupo_perda ||
        r.motivo_descricao ||
        r.motivo_codigo ||
        "Outros"
      ).trim();
      const sec = safeNum(r.perda_tempo_seg, 0);
      map.set(key, (map.get(key) || 0) + sec);
    }

    const sorted = Array.from(map.entries())
      .map(([label, sec]) => ({ label, min: minutesFromSeconds(sec) }))
      .sort((a, b) => b.min - a.min)
      .slice(0, 3);

    return sorted.map((s, i) => ({
      label: s.label.length > 10 ? s.label.slice(0, 10) + "�" : s.label,
      value: s.min,
      color: colors[i] || "#94a3b8",
    }));
  }, [perdasHook.data, colors]);

  const pendingStops: UiPendingStop[] = useMemo(() => {
    const rows = (paradasHook.data || []) as ParadaTurnoRow[];

    const pend = rows.filter(
      (p) =>
        p.motivo_id == null || (p.exige_justificativa && !p.is_justificada),
    );

    return pend
      .slice()
      .sort(
        (a, b) =>
          (isoToDate(b.inicio_utc)?.getTime() || 0) -
          (isoToDate(a.inicio_utc)?.getTime() || 0),
      )
      .map((p, idx) => {
        const d = isoToDate(p.inicio_utc);
        const date = d
          ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
          : "--/--/----";
        const time = d
          ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
          : "--:--";
        const duration = formatHMS(p.duracao_seg) || "--:--:--";
        return {
          date,
          time,
          duration,
          status: idx === 0 ? "Atual" : null,
          row: p,
        };
      });
  }, [paradasHook.data]);

  const totalParadasMin = useMemo(
    () =>
      minutesFromSeconds(safeNum(stationHeader?.turno_paradas_duracao_seg, 0)),
    [stationHeader?.turno_paradas_duracao_seg],
  );
  const runTimeMin = useMemo(
    () => minutesFromSeconds(safeNum(stationHeader?.run_time_seg, 0)),
    [stationHeader?.run_time_seg],
  );

  /** Linha mais recente (só a corrida ATUAL) — mantida à parte para quem
   * precisar de informação por-corrida, mas NÃO deve alimentar o OEE
   * exibido no header (ver oeeTurnoAgregado abaixo). */
  const oeePeriodoAtual = useMemo(() => {
    const rows = (oeeHook.data || []) as OeePorPeriodoRow[];
    if (!rows.length) return null;
    const sorted = rows
      .slice()
      .sort(
        (a, b) =>
          (isoToDate(b.inicio_utc)?.getTime() || 0) -
          (isoToDate(a.inicio_utc)?.getTime() || 0),
      );
    return sorted[0] || null;
  }, [oeeHook.data]);

  /** OEE do TURNO inteiro — agrega TODAS as corridas que rodaram no turno.
   * oeeHook (getOeePorPeriodo) retorna 1 linha por corrida dentro da janela
   * do turno (ex: corrida anterior + corrida em curso). O código antigo
   * pegava só a linha mais recente (oeePeriodoAtual = sorted[0]), então o
   * header mostrava o OEE só da corrida ATUAL em vez do turno inteiro —
   * daí a discrepância com o card do dashboard, que sempre agrega o turno
   * completo. ideal_time_seg de cada linha já vem ponderado pelo ciclo da
   * própria corrida (não um ciclo único aplicado a tudo), então basta somar.
   */
  const oeeTurnoAgregado = useMemo(() => {
    const rows = (oeeHook.data || []) as OeePorPeriodoRow[];
    if (!rows.length) return null;

    let planned = 0, run = 0, idealTime = 0, good = 0, scrap = 0, rework = 0;
    for (const r of rows) {
      planned += Math.max(0, safeNum(r.planned_time_seg, 0));
      run += Math.max(0, safeNum(r.run_time_seg, 0));
      idealTime += Math.max(0, safeNum(r.ideal_time_seg, 0));
      good += Math.max(0, safeNum(r.total_good, 0));
      scrap += Math.max(0, safeNum(r.total_scrap, 0));
      rework += Math.max(0, safeNum(r.total_rework, 0));
    }

    return { planned, run, idealTime, good, scrap, rework };
  }, [oeeHook.data]);

  const computedOeeFromRow = useMemo(() => {
    const agg = oeeTurnoAgregado;
    if (!agg) return null;

    const { planned, run, idealTime, good, scrap, rework } = agg;
    const total = good + scrap + rework;

    const availability01 = planned > 0 ? run / planned : 0;
    const quality01 = total > 0 ? good / total : 0;
    // Performance = tempo ideal já ponderado por corrida (soma de cada
    // corrida × seu próprio ciclo_ideal_seg) / run_time do turno inteiro.
    const performance01 = run > 0 && idealTime > 0 ? Math.min(1, idealTime / run) : 0;
    const oee01 = availability01 * quality01 * performance01;

    return {
      availability01: clamp01(availability01),
      quality01: clamp01(quality01),
      performance01: clamp01(performance01),
      oee01: clamp01(oee01),
    };
  }, [oeeTurnoAgregado]);

  // NOTA: removida a prioridade "directRow" (oeePeriodoAtual?.oee/etc), que
  // vinha só da corrida mais recente — computedOeeFromRow agora já é o
  // agregado do turno inteiro (oeeTurnoAgregado), fonte correta para o header.
  const oee = useMemo(() => {
    const fromComputed = computedOeeFromRow
      ? pct01to100(computedOeeFromRow.oee01)
      : null;
    if (fromComputed != null) return fromComputed;

    const legacyHeader = normalizePctMaybe(stationHeader?.oee);
    return legacyHeader != null ? legacyHeader : null;
  }, [computedOeeFromRow, stationHeader?.oee]);

  const availability = useMemo(() => {
    const fromComputed = computedOeeFromRow
      ? pct01to100(computedOeeFromRow.availability01)
      : null;
    if (fromComputed != null) return fromComputed;

    const legacyHeader = normalizePctMaybe(stationHeader?.availability);
    return legacyHeader != null ? legacyHeader : null;
  }, [computedOeeFromRow, stationHeader?.availability]);

  const performance = useMemo(() => {
    const fromComputed = computedOeeFromRow
      ? pct01to100(computedOeeFromRow.performance01)
      : null;
    if (fromComputed != null) return fromComputed;

    const legacyHeader = normalizePctMaybe(stationHeader?.performance);
    return legacyHeader != null ? legacyHeader : null;
  }, [computedOeeFromRow, stationHeader?.performance]);

  const quality = useMemo(() => {
    const fromComputed = computedOeeFromRow
      ? pct01to100(computedOeeFromRow.quality01)
      : null;
    if (fromComputed != null) return fromComputed;

    const legacyHeader = normalizePctMaybe(stationHeader?.quality);
    return legacyHeader != null ? legacyHeader : null;
  }, [computedOeeFromRow, stationHeader?.quality]);

  // ? FIX: For�ar a exibi��o do Turno Atual com base no rel�gio caso a m�quina esteja parada h� horas
  const turnoNome = useMemo(() => {
    // 1. Tenta pegar o turno que est� vindo din�mico do Header (que � atualizado em tempo real pelo backend)
    if (stationHeader?.turno?.turno_nome) return stationHeader.turno.turno_nome;

    // 2. Se o header falhar, faz um fallback com base no hor�rio local (garante que n�o fique preso)
    const h = new Date().getHours();
    if (h >= 6 && h < 14) return "Manh�";
    if (h >= 14 && h < 21) return "Tarde";
    return "Noite";
  }, [stationHeader?.turno?.turno_nome]);

  const oeeBars: UiLossBar[] = useMemo(() => {
    const a = availability ?? 0;
    const p = performance ?? 0;
    const q = quality ?? 0;
    const o = oee ?? 0;

    const has = [a, p, q, o].some((v) => Number.isFinite(v) && v > 0);
    if (!has) return [];

    return [
      { label: "OEE", value: o, color: "#2563eb" },
      { label: "Disp.", value: a, color: "#10b981" },
      { label: "Perf.", value: p, color: "#f59e0b" },
      { label: "Qual.", value: q, color: "#ef4444" },
    ];
  }, [availability, performance, quality, oee]);

  /** estados */
  const hasAnyError = !!(
    headerHook.error ||
    prodHook.error ||
    perdasHook.error ||
    paradasHook.error ||
    oeeHook.error ||
    motivosHook.error
  );
  const isLoadingHeader = !stationHeader && !headerHook.error;

  const refreshAll = useCallback(() => {
    headerHook.mutate?.();
    prodHook.mutate?.();
    perdasHook.mutate?.();
    paradasHook.mutate?.();
    oeeHook.mutate?.();
    motivosHook.mutate?.();
  }, [headerHook, prodHook, perdasHook, paradasHook, oeeHook, motivosHook]);

  /** a��es */
  const apontarProducao = useCallback(
    async (input: {
      good: number;
      event_time_utc?: string | null;
      observacao?: string | null;
    }) => {
      if (!stationId) throw new Error("stationId inv�lido");
      const good = Number(input.good ?? 0);
      if (!Number.isFinite(good) || good <= 0)
        throw new Error("Quantidade (good) inv�lida.");

      await postoApontarProducao({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        good,
        event_time_utc: input.event_time_utc ?? null,
        usuario_id: usuarioIdResolved ?? null,
        observacao: input.observacao ?? null,
        source_system: sourceSystemResolved,
      });

      refreshAll();
    },
    [
      stationId,
      empresaIdResolved,
      usuarioIdResolved,
      sourceSystemResolved,
      refreshAll,
    ],
  );

  const apontarRefugoRetrabalho = useCallback(
    async (input: {
      scrap?: number;
      rework?: number;
      motivo_id?: string | number | null;
      event_time_utc?: string | null;
      observacao?: string | null;
    }) => {
      if (!stationId) throw new Error("stationId inv�lido");

      const scrap = input.scrap === undefined ? undefined : Number(input.scrap);
      const rework =
        input.rework === undefined ? undefined : Number(input.rework);

      if (scrap !== undefined && (!Number.isFinite(scrap) || scrap < 0))
        throw new Error("scrap inv�lido");
      if (rework !== undefined && (!Number.isFinite(rework) || rework < 0))
        throw new Error("rework inv�lido");
      if ((scrap ?? 0) + (rework ?? 0) <= 0)
        throw new Error("Informe scrap e/ou rework.");

      await postoApontarRefugoRetrabalho({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        scrap,
        rework,
        motivo_id: input.motivo_id ?? null,
        event_time_utc: input.event_time_utc ?? null,
        usuario_id: usuarioIdResolved ?? null,
        observacao: input.observacao ?? null,
        source_system: sourceSystemResolved,
      });

      refreshAll();
    },
    [
      stationId,
      empresaIdResolved,
      usuarioIdResolved,
      sourceSystemResolved,
      refreshAll,
    ],
  );

  const iniciarParada = useCallback(
    async (input: {
      motivo_id?: string | number | null;
      event_time_utc?: string | null;
      observacao?: string | null;
    }) => {
      if (!stationId) throw new Error("stationId inv�lido");

      const res = await postoIniciarParada({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        motivo_id: input.motivo_id ?? null,
        event_time_utc: input.event_time_utc ?? null,
        usuario_id: usuarioIdResolved ?? null,
        observacao: input.observacao ?? null,
        source_system: sourceSystemResolved,
      });

      refreshAll();
      return res;
    },
    [
      stationId,
      empresaIdResolved,
      usuarioIdResolved,
      sourceSystemResolved,
      refreshAll,
    ],
  );

  const justificarParada = useCallback(
    async (input: {
      parada_id: string | number;
      motivo_id?: string | number | null;
      justificativa_texto?: string | null;
    }) => {
      const parada_id = input.parada_id;
      if (!parada_id) throw new Error("parada_id inv�lido");

      await postoJustificarParada({
        empresa_id: empresaIdResolved,
        parada_id,
        motivo_id: input.motivo_id ?? null,
        justificativa_texto: input.justificativa_texto ?? null,
        usuario_id: usuarioIdResolved ?? null,
      });

      refreshAll();
    },
    [empresaIdResolved, usuarioIdResolved, refreshAll],
  );

  const editarParadaMotivo = useCallback(
    async (input: {
      parada_id: string | number;
      motivo_id: string | number;
      justificativa_texto?: string | null;
    }) => {
      if (!input.parada_id) throw new Error("parada_id inv�lido");
      if (!input.motivo_id) throw new Error("motivo_id inv�lido");

      await postoEditarParadaMotivo({
        empresa_id: empresaIdResolved,
        parada_id: input.parada_id,
        motivo_id: input.motivo_id,
        justificativa_texto: input.justificativa_texto ?? null,
        usuario_id: usuarioIdResolved ?? null,
      });

      refreshAll();
    },
    [empresaIdResolved, usuarioIdResolved, refreshAll],
  );

  const justificarParadasEmMassa = useCallback(
    async (input: {
      parada_ids: Array<string | number>;
      motivo_id: string | number;
      justificativa_texto?: string | null;
    }) => {
      if (!input.parada_ids?.length) throw new Error("Nenhuma parada selecionada.");
      if (!input.motivo_id) throw new Error("motivo_id inv�lido");

      const res = await postoJustificarParadasEmMassa({
        empresa_id: empresaIdResolved,
        parada_ids: input.parada_ids,
        motivo_id: input.motivo_id,
        justificativa_texto: input.justificativa_texto ?? null,
        usuario_id: usuarioIdResolved ?? null,
      });

      refreshAll();
      return res;
    },
    [empresaIdResolved, usuarioIdResolved, refreshAll],
  );

  const adicionarPecaHack = useCallback(
    async (input: {
      codigo_ct: string;
      delta?: number;
      event_time_utc?: string | null;
    }) => {
      const codigo_ct = String(input.codigo_ct || "").trim();
      if (!codigo_ct) throw new Error("codigo_ct inv�lido");

      const res = await postoAdicionarPecaHack({
        empresa_id: empresaIdResolved,
        codigo_ct,
        delta: input.delta,
        usuario_id: usuarioIdResolved ?? null,
        event_time_utc: input.event_time_utc ?? null,
        source_system: sourceSystemResolved,
      });

      refreshAll();
      return res;
    },
    [empresaIdResolved, usuarioIdResolved, sourceSystemResolved, refreshAll],
  );

  const retomarProducao = useCallback(async () => {
    if (!stationId) throw new Error("stationId inv�lido");

    await postoRetomarProducao({
      empresa_id: empresaIdResolved,
      centro_trabalho_id: stationId,
      usuario_id: usuarioIdResolved ?? null,
      source_system: sourceSystemResolved,
    });

    refreshAll();
  }, [
    stationId,
    empresaIdResolved,
    usuarioIdResolved,
    sourceSystemResolved,
    refreshAll,
  ]);

  const setModoContagem = useCallback(
    async (modo: "GOOD" | "REWORK") => {
      if (!stationId) throw new Error("stationId inv�lido");

      const res = await postoSetModoContagem({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        modo,
        usuario_id: usuarioIdResolved ?? null,
      });

      // Atualiza header imediatamente para refletir o novo modo no UI.
      await headerHook.mutate?.();
      refreshAll();
      return res;
    },
    [stationId, empresaIdResolved, usuarioIdResolved, headerHook, refreshAll],
  );

  return {
    /** ids / range */
    stationId: stationId || null,
    empresaId: empresaIdResolved,
    dataInicio,
    dataFim,
    turnoInicioIso,
    turnoFimIso,

    /** hooks crus */
    headerHook,
    prodHook,
    oeeHook,
    perdasHook,
    paradasHook,
    motivosHook,

    /** dados crus */
    stationHeader: stationHeader || null,
    producaoPorHora: (prodHook.data || null) as ProducaoPorHoraPoint[] | null,
    oeePorPeriodo: (oeeHook.data || null) as OeePorPeriodoRow[] | null,
    perdasPorPeriodo: (perdasHook.data || null) as PerdasPorPeriodoRow[] | null,
    paradasDoTurno: (paradasHook.data || null) as ParadaTurnoRow[] | null,
    motivosParada: (motivosHook.data || null) as MotivoParadaRow[] | null,

    /** linha "atual" do oee por turno */
    oeePeriodoAtual,

    /** UI-ready */
    stationName,
    statusText,
    isStopped,
    statusTime,

    ordemCodigo,
    produtoCodigo,
    produtoNome,

    metaCorrida,
    progressNow,
    progressMax,
    progressPercent,

    producedTurno,
    rejectedTurno,

    /** modo de contagem do posto */
    modoContagem,
    isRework,

    productionPoints,
    cyclePoints,
    lossBars,
    pendingStops,

    totalParadasMin,
    runTimeMin,

    /** OEE calculado e normalizado (0..100) � agora por TURNO */
    oee,
    availability,
    performance,
    quality,
    turnoNome,

    /** barras (OEE/Disp/Perf/Qual) para usar no chartType="oee" */
    oeeBars,

    /** estados */
    isLoadingHeader,
    hasAnyError,

    /** refresh */
    refreshAll,

    /** a��es */
    actions: {
      apontarProducao,
      apontarRefugoRetrabalho,
      iniciarParada,
      justificarParada,
      editarParadaMotivo,
      justificarParadasEmMassa,
      adicionarPecaHack,
      retomarProducao,
      setModoContagem,
    },
  };
}

/** =========================================================
 * ? Hook extra: log�stica/fila
 * ========================================================= */
export function usePostoQueueDetail(args: {
  stationId: string | null | undefined;
  empresaId?: string | null;
  usuarioId?: string | number | null;
  sourceSystem?: string | null;
  q?: string | null;
}) {
  const { stationId, empresaId, usuarioId, sourceSystem, q } = args;
  const empresaIdResolved = useMemo(
    () => resolveEmpresaId(empresaId),
    [empresaId],
  );
  const usuarioIdResolved = useMemo(
    () => usuarioId ?? getUsuarioIdFallback(),
    [usuarioId],
  );
  const sourceSystemResolved = sourceSystem ?? "APP";

  const queueHook = usePostoQueue({
    centroTrabalhoId: stationId,
    empresaId: empresaIdResolved,
  });
  const availableOrdersHook = usePostoAvailableOrders({
    centroTrabalhoId: stationId,
    empresaId: empresaIdResolved,
    q,
  });
  const paradasPendentesHook = usePostoParadasPendentes({
    centroTrabalhoId: stationId,
    empresaId: empresaIdResolved,
  });
  const retrabalhoHook = usePostoRetrabalhoPecas({
    centroTrabalhoId: stationId,
    empresaId: empresaIdResolved,
  });

  const refreshAll = useCallback(() => {
    queueHook.mutate?.();
    availableOrdersHook.mutate?.();
    paradasPendentesHook.mutate?.();
    retrabalhoHook.mutate?.();
  }, [queueHook, availableOrdersHook, paradasPendentesHook, retrabalhoHook]);

  const addToQueue = useCallback(
    async (input: { ordem_id: string | number; rule?: FinishRule | null }) => {
      if (!stationId) throw new Error("stationId inv�lido");
      await postoAddToQueue({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        ordem_id: input.ordem_id,
        rule: input.rule ?? null,
      });
      refreshAll();
    },
    [stationId, empresaIdResolved, refreshAll],
  );

  const reorderQueue = useCallback(
    async (ids: Array<string | number>) => {
      if (!stationId) throw new Error("stationId inv�lido");
      await postoReorderQueue({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        ids,
      });
      refreshAll();
    },
    [stationId, empresaIdResolved, refreshAll],
  );

  const updateFinishRule = useCallback(
    async (input: { fila_item_id: string | number; rule: FinishRule }) => {
      await postoUpdateFinishRule({
        empresa_id: empresaIdResolved,
        fila_item_id: input.fila_item_id,
        rule: input.rule,
      });
      refreshAll();
    },
    [empresaIdResolved, refreshAll],
  );

  const removeFromQueue = useCallback(
    async (fila_item_id: string | number) => {
      if (!stationId) throw new Error("stationId inv�lido");
      await postoRemoveFromQueue({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        fila_item_id,
      });
      refreshAll();
    },
    [stationId, empresaIdResolved, refreshAll],
  );

  const clearQueue = useCallback(async () => {
    if (!stationId) throw new Error("stationId inv�lido");
    await postoClearQueue({
      empresa_id: empresaIdResolved,
      centro_trabalho_id: stationId,
    });
    refreshAll();
  }, [stationId, empresaIdResolved, refreshAll]);

  const setCurrentOrder = useCallback(
    async (input: { ordem_id: string | number; rule?: FinishRule | null }) => {
      if (!stationId) throw new Error("stationId inv�lido");
      await postoSetCurrentOrder({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        ordem_id: input.ordem_id,
        rule: input.rule ?? null,
        usuario_id: usuarioIdResolved ?? null,
        source_system: sourceSystemResolved,
      });
      refreshAll();
    },
    [
      stationId,
      empresaIdResolved,
      usuarioIdResolved,
      sourceSystemResolved,
      refreshAll,
    ],
  );

  const advanceQueue = useCallback(async () => {
    if (!stationId) throw new Error("stationId inv�lido");
    await postoAdvanceQueue({
      empresa_id: empresaIdResolved,
      centro_trabalho_id: stationId,
      usuario_id: usuarioIdResolved ?? null,
      source_system: sourceSystemResolved ?? "RULE_ENGINE_MANUAL",
    });
    refreshAll();
  }, [
    stationId,
    empresaIdResolved,
    usuarioIdResolved,
    sourceSystemResolved,
    refreshAll,
  ]);

  /** Modo de contagem do posto: 'GOOD' (peça boa) | 'REWORK' (retrabalho). */
  const setModoContagem = useCallback(
    async (modo: "GOOD" | "REWORK") => {
      if (!stationId) throw new Error("stationId inválido");
      await postoSetModoContagem({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        modo,
        usuario_id: usuarioIdResolved ?? null,
      });
      refreshAll();
    },
    [stationId, empresaIdResolved, usuarioIdResolved, refreshAll],
  );

  /** Substitui o conjunto (e a ordem do rodízio) das peças em retrabalho. */
  const setRetrabalhoPecas = useCallback(
    async (
      pecas: Array<{
        produto_codigo: string;
        produto_id?: string | null;
        produto_descricao?: string | null;
      }>,
    ) => {
      if (!stationId) throw new Error("stationId inválido");
      await postoSetRetrabalhoPecas({
        empresa_id: empresaIdResolved,
        centro_trabalho_id: stationId,
        pecas,
        usuario_id: usuarioIdResolved ?? null,
      });
      refreshAll();
    },
    [stationId, empresaIdResolved, usuarioIdResolved, refreshAll],
  );

  const hasAnyError = !!(
    queueHook.error ||
    availableOrdersHook.error ||
    paradasPendentesHook.error
  );

  return {
    stationId: stationId || null,
    empresaId: empresaIdResolved,

    queueHook,
    availableOrdersHook,
    paradasPendentesHook,
    retrabalhoHook,

    /** modo de contagem + peças em retrabalho (do backend) */
    modoContagem: (retrabalhoHook.data?.modo_contagem ?? null) as
      | "GOOD"
      | "REWORK"
      | null,
    retrabalhoPecas: (retrabalhoHook.data?.pecas ?? null) as
      | RetrabalhoPecaRow[]
      | null,
    retrabalhoProximaPosicao: retrabalhoHook.data?.proxima_posicao ?? null,
    retrabalhoMigracaoPendente: !!retrabalhoHook.data?.migracao_pendente,

    /** ? FIX #3: exp�e current separado e queue como array */
    queueCurrent: queueHook.data?.current || null,
    queue: queueHook.data?.queue || [],

    availableOrders: (availableOrdersHook.data || null) as
      | AvailableOrderRow[]
      | null,
    paradasPendentes: (paradasPendentesHook.data || null) as
      | ParadaPendenteRow[]
      | null,

    hasAnyError,
    refreshAll,

    actions: {
      addToQueue,
      reorderQueue,
      updateFinishRule,
      removeFromQueue,
      clearQueue,
      setCurrentOrder,
      advanceQueue,
      setModoContagem,
      setRetrabalhoPecas,
    },
  };
}

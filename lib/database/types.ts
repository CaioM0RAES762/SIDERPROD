// =====================================================
// SIDERPROD — tipos de domínio compartilhados pela interface
// =====================================================
// Descrevem as entidades do chão de fábrica (centros de trabalho, ordens,
// paradas, planos). São apenas tipos: nenhuma conexão ou consulta vive aqui.

// Enums
export type UserRole = "admin" | "supervisor" | "operador" | "visualizador"
export type CentroTrabalhoStatus = "producing" | "stopped" | "sensor" | "warning" | "offline" | "maintenance"
export type OrdemEstado = "planejada" | "liberada" | "em_execucao" | "interrompida" | "encerrada" | "cancelada"
export type FilaOrdemEstado = "aguardando" | "em_execucao" | "concluida" | "cancelada"
export type TipoProducao = "automatico" | "manual" | "ajuste"
export type TipoPerda = "disponibilidade" | "performance" | "qualidade" | "planejada"
export type PlanoMelhoriaEstado = "em_planejamento" | "em_execucao" | "em_avaliacao" | "finalizado" | "cancelado"
export type PlanoAcaoEstado = "pendente" | "em_andamento" | "concluido" | "cancelado" | "atrasado"
export type TipoMeta = "ocorrencias" | "horas" | "mttr" | "mtbf" | "financeira"
export type CategoriaIshikawa = "maquina" | "material" | "metodo" | "mao_obra" | "ambiente" | "medicao"
export type TipoNotificacao = "info" | "warning" | "error" | "success"

// =====================================================
// Interfaces das Tabelas
// =====================================================

export interface Empresa {
  id: string
  nome: string
  cnpj?: string
  endereco?: string
  telefone?: string
  email?: string
  logo_url?: string
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface Usuario {
  id: string
  empresa_id: string
  nome: string
  email: string
  senha_hash?: string
  cargo?: string
  telefone?: string
  avatar_url?: string
  role: UserRole
  ativo: boolean
  ultimo_acesso?: string
  created_at: string
  updated_at: string
}

export interface Sessao {
  id: string
  usuario_id: string
  token: string
  ip_address?: string
  user_agent?: string
  expires_at: string
  created_at: string
}

export interface GrupoCentroTrabalho {
  id: string
  empresa_id: string
  nome: string
  descricao?: string
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface CentroTrabalho {
  id: string
  empresa_id: string
  grupo_id?: string
  codigo: string
  nome: string
  descricao?: string
  capacidade_hora: number
  meta_oee: number
  custo_hora: number
  ip_sensor?: string
  status: CentroTrabalhoStatus
  ativo: boolean
  created_at: string
  updated_at: string
  // Campos calculados/joins
  grupo_nome?: string
  producao_hoje?: number
  oee_hoje?: number
  paradas_ativas?: number
  paradas_pendentes?: number
}

export interface Turno {
  id: string
  empresa_id: string
  nome: string
  hora_inicio: string
  hora_fim: string
  dias_semana: number[]
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface Produto {
  id: string
  empresa_id: string
  codigo: string
  nome: string
  descricao?: string
  unidade_medida: string
  tempo_ciclo_padrao?: number
  custo_unitario: number
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface ProdutoCentroTrabalho {
  id: string
  produto_id: string
  centro_trabalho_id: string
  tempo_ciclo?: number
  capacidade_hora?: number
  ativo: boolean
  created_at: string
}

export interface OrdemProducao {
  id: string
  empresa_id: string
  codigo: string
  produto_id: string
  quantidade_planejada: number
  quantidade_produzida: number
  quantidade_refugo: number
  quantidade_retrabalho: number
  data_inicio_planejado?: string
  data_fim_planejado?: string
  data_inicio_real?: string
  data_fim_real?: string
  prioridade: number
  estado: OrdemEstado
  observacoes?: string
  created_at: string
  updated_at: string
  // Campos calculados/joins
  produto?: Produto
  produto_nome?: string
  percentual_completo?: number
  diferenca?: number
}

export interface FilaOrdem {
  id: string
  ordem_id: string
  centro_trabalho_id: string
  sequencia: number
  quantidade_planejada?: number
  quantidade_produzida: number
  estado: FilaOrdemEstado
  data_inicio?: string
  data_fim?: string
  created_at: string
  updated_at: string
  // Campos calculados/joins
  ordem?: OrdemProducao
  centro_trabalho?: CentroTrabalho
}

export interface Producao {
  id: string
  empresa_id: string
  centro_trabalho_id: string
  ordem_id?: string
  produto_id?: string
  turno_id?: string
  usuario_id?: string
  quantidade: number
  unidade: string
  data_hora: string
  tipo: TipoProducao
  observacoes?: string
  created_at: string
}

export interface Refugo {
  id: string
  empresa_id: string
  centro_trabalho_id: string
  ordem_id?: string
  produto_id?: string
  turno_id?: string
  usuario_id?: string
  quantidade: number
  motivo_id?: string
  descricao?: string
  data_hora: string
  created_at: string
}

export interface Retrabalho {
  id: string
  empresa_id: string
  centro_trabalho_id: string
  ordem_id?: string
  produto_id?: string
  turno_id?: string
  usuario_id?: string
  quantidade: number
  motivo_id?: string
  descricao?: string
  data_hora: string
  created_at: string
}

export interface CategoriaParada {
  id: string
  empresa_id: string
  codigo: string
  nome: string
  tipo: TipoPerda
  cor: string
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface MotivoParada {
  id: string
  empresa_id: string
  categoria_id?: string
  codigo: string
  nome: string
  descricao?: string
  tipo_perda: TipoPerda
  planejada: boolean
  ativo: boolean
  created_at: string
  updated_at: string
  // Joins
  categoria?: CategoriaParada
}

export interface Parada {
  id: string
  empresa_id: string
  centro_trabalho_id: string
  ordem_id?: string
  turno_id?: string
  motivo_id?: string
  usuario_id?: string
  data_inicio: string
  data_fim?: string
  duracao_segundos?: number
  justificativa?: string
  justificada: boolean
  automatica: boolean
  created_at: string
  updated_at: string
  // Joins
  centro_trabalho?: CentroTrabalho
  motivo?: MotivoParada
  usuario?: Usuario
}

export interface OEEHora {
  id: string
  empresa_id: string
  centro_trabalho_id: string
  turno_id?: string
  data_hora: string
  tempo_disponivel_seg: number
  tempo_operacional_seg: number
  tempo_parada_planejada_seg: number
  tempo_parada_nao_planejada_seg: number
  quantidade_produzida: number
  quantidade_refugo: number
  quantidade_retrabalho: number
  ciclos_totais: number
  tempo_ciclo_real?: number
  tempo_ciclo_padrao?: number
  disponibilidade?: number
  performance?: number
  qualidade?: number
  oee?: number
  created_at: string
}

export interface OEEDia {
  id: string
  empresa_id: string
  centro_trabalho_id: string
  data: string
  tempo_disponivel_seg: number
  tempo_operacional_seg: number
  tempo_parada_planejada_seg: number
  tempo_parada_nao_planejada_seg: number
  quantidade_produzida: number
  quantidade_refugo: number
  quantidade_retrabalho: number
  ciclos_totais: number
  disponibilidade?: number
  performance?: number
  qualidade?: number
  oee?: number
  mtbf_minutos?: number
  mttr_minutos?: number
  created_at: string
}

export interface PlanoMelhoria {
  id: string
  empresa_id: string
  nome: string
  descricao?: string
  perda_id?: string
  tipo_perda?: string
  causa_raiz?: string
  periodo_inicio?: string
  periodo_fim?: string
  centros_trabalho?: string[]
  turnos?: string[]
  produtos?: string[]
  tipo_meta?: TipoMeta
  valor_meta?: number
  valor_inicial?: number
  valor_atual?: number
  responsavel_id?: string
  data_inicio_execucao?: string
  data_inicio_avaliacao?: string
  data_fim?: string
  estado: PlanoMelhoriaEstado
  resultado?: string
  created_at: string
  updated_at: string
  // Joins
  responsavel?: Usuario
  perda?: MotivoParada
}

export interface Ishikawa {
  id: string
  plano_id: string
  categoria: CategoriaIshikawa
  causa: string
  created_at: string
}

export interface CincoPorques {
  id: string
  plano_id: string
  hipotese: string
  porque_1?: string
  porque_2?: string
  porque_3?: string
  porque_4?: string
  porque_5?: string
  conclusao?: string
  created_at: string
}

export interface PlanoAcao {
  id: string
  empresa_id: string
  plano_melhoria_id?: string
  centro_trabalho_id?: string
  o_que: string
  como?: string
  por_que?: string
  onde?: string
  quem_id?: string
  quando?: string
  quanto?: number
  estado: PlanoAcaoEstado
  prioridade: number
  observacoes?: string
  data_conclusao?: string
  created_at: string
  updated_at: string
  // Joins
  quem?: Usuario
  centro_trabalho?: CentroTrabalho
  plano_melhoria?: PlanoMelhoria
}

export interface AlertaPlanoAcao {
  id: string
  plano_acao_id: string
  data_alerta: string
  mensagem?: string
  enviado: boolean
  created_at: string
}

export interface Anotacao {
  id: string
  empresa_id: string
  centro_trabalho_id?: string
  usuario_id?: string
  texto: string
  data_hora: string
  anexo_url?: string
  created_at: string
  updated_at: string
  // Joins
  centro_trabalho?: CentroTrabalho
  usuario?: Usuario
}

export interface Configuracao {
  id: string
  empresa_id: string
  chave: string
  valor?: string
  tipo: string
  descricao?: string
  created_at: string
  updated_at: string
}

export interface LogAtividade {
  id: string
  empresa_id: string
  usuario_id?: string
  acao: string
  tabela?: string
  registro_id?: string
  dados_anteriores?: Record<string, unknown>
  dados_novos?: Record<string, unknown>
  ip_address?: string
  created_at: string
}

export interface Notificacao {
  id: string
  usuario_id: string
  titulo: string
  mensagem?: string
  tipo: TipoNotificacao
  lida: boolean
  link?: string
  created_at: string
}

// =====================================================
// Tipos para Filtros e Queries
// =====================================================

export interface DateRange {
  start: string
  end: string
}

export interface PaginationParams {
  page: number
  limit: number
}

export interface SortParams {
  field: string
  direction: "asc" | "desc"
}

export interface FilterParams {
  empresa_id?: string
  centro_trabalho_ids?: string[]
  grupo_ids?: string[]
  turno_ids?: string[]
  produto_ids?: string[]
  date_range?: DateRange
  estado?: string[]
  search?: string
}

// =====================================================
// Tipos para Respostas da API
// =====================================================

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// =====================================================
// Tipos para Dashboard e Relatórios
// =====================================================

export interface DashboardStats {
  producao_total: number
  producao_hora: number
  oee_medio: number
  disponibilidade: number
  performance: number
  qualidade: number
  postos_ativos: number
  postos_parados: number
  paradas_ativas: number
  paradas_pendentes: number
}

export interface ProducaoPorHora {
  hora: string
  quantidade: number
  capacidade: number
}

export interface ProducaoPorDia {
  data: string
  quantidade: number
  capacidade: number
}

export interface ProducaoPorOrdem {
  ordem_codigo: string
  produto_codigo: string
  produto_nome: string
  quantidade_produzida: number
  quantidade_planejada: number
}

export interface PerdasConsolidadas {
  motivo: string
  tipo_perda: TipoPerda
  disponibilidade: number
  performance: number
  qualidade: number
  total_horas: number
  total_quantidade: number
}

export interface ParadaReportada {
  id: string
  motivo: string
  centro_trabalho: string
  equipamento?: string
  duracao_formatada: string
  duracao_segundos: number
}

export interface OEEConsolidado {
  oee: number
  meta: number
  disponibilidade: number
  performance: number
  qualidade: number
  media_pessoas_turno: number
  producao_pessoa_hora: number
  taxa_producao: number
}

// =====================================================
// Tipos para Formulários
// =====================================================

export interface CreatePlanoAcaoInput {
  o_que: string
  como?: string
  por_que?: string
  onde?: string
  quem_id?: string
  quando?: string
  quanto?: number
  estado?: PlanoAcaoEstado
  centro_trabalho_id?: string
  observacoes?: string
  alertas?: { data_alerta: string; mensagem?: string }[]
}

export interface CreateAnotacaoInput {
  centro_trabalho_id?: string
  texto: string
  data_hora: string
  anexo_url?: string
}

export interface CreateParadaInput {
  centro_trabalho_id: string
  motivo_id?: string
  data_inicio: string
  data_fim?: string
  justificativa?: string
}

export interface JustificarParadaInput {
  parada_id: string
  motivo_id: string
  justificativa?: string
}

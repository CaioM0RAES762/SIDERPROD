// lib/demo/store.ts
//
// Estado mutável da demonstração.
//
// A fábrica gerada em factory.ts é imutável (é função do tempo e da semente).
// Tudo que o visitante faz na tela — justificar uma parada, apontar produção,
// criar um plano de ação, trocar o rebarbador do posto — é gravado AQUI, numa
// camada de sobreposição em memória.
//
// Consequências, propositais e documentadas na interface:
//   • nada sai do navegador;
//   • as alterações valem enquanto a aba estiver aberta;
//   • um F5 devolve a fábrica ao estado gerado.

import {
  CENTROS,
  MOTIVOS,
  PRODUTOS,
  USUARIOS,
  type DemoMotivo,
} from "./catalog"
import { makeRng, stableId } from "./rng"
import { DEMO_SEED } from "./config"
import { demoNow, HOUR_MS, operationalDayIndex } from "./time"

export type StatusOverride =
  | { tipo: "STOPPED"; motivo_id: string; inicio: number }
  | { tipo: "RUNNING"; desde: number }

export type ParadaOverride = {
  motivo_id?: string
  is_justificada?: boolean
  justificativa_texto?: string | null
  justificativa_time_utc?: string
  fim?: number
}

export type DemoFuncionario = {
  funcionario_id: string
  nome: string
  registro: string | null
  cargo: string | null
  is_active: boolean
}

export type DemoAnotacao = {
  id: string
  texto: string
  data_hora: string
  centro_trabalho_id: string | null
  usuario_nome: string
  created_at: string
  anexos: { id: string; public_id: string; file_name: string; content_type: string | null; file_size_bytes: number | null; file_url: string | null; storage_provider: string | null; created_at: string }[]
}

export type DemoPlanoAcao = {
  id: string
  item_id: string
  o_que: string
  como: string | null
  por_que: string | null
  quando: string | null
  estado: string
  centro_trabalho_id: string | null
  onde_nome: string | null
  quem_id: string | null
  quem_nome: string | null
  observacoes: string | null
  created_at: string
  updated_at: string | null
  anexos: DemoAnotacao["anexos"]
}

export type DemoPlanoMelhoria = {
  id: string
  public_id: string
  titulo: string
  descricao: string
  problema: string
  meta: string
  resultado: string | null
  estado: string
  grupo_perda: string | null
  data_inicio: string | null
  data_conclusao: string | null
  criado_em: string
  centro_trabalho_id: string | null
  centro_trabalho_nome: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
}

export type DemoQueueItem = {
  fila_item_id: string
  ordem_id: string
  ordem_codigo: string
  ordem_public_id: string
  produto_descricao: string
  posicao: number
  is_current: boolean
  finish_rule: { tipo: "SEM" | "QTD" | "HORARIO"; qtd: number | null; fim_utc: string | null }
}

type DemoStore = {
  statusOverride: Map<string, StatusOverride>
  paradaOverride: Map<string, ParadaOverride>
  paradasManuais: Map<string, { parada_id: string; centro_trabalho_id: string; motivo_id: string; inicio: number; fim: number | null; is_justificada: boolean; justificativa_texto: string | null }[]>
  contagemExtra: Map<string, { good: number; scrap: number; rework: number }>
  modoContagem: Map<string, "GOOD" | "REWORK">
  retrabalhoPecas: Map<string, string[]>
  rebarbadorPorCt: Map<string, string | null>
  apontadorPorCt: Map<string, string | null>
  apontadorPadrao: Map<string, string | null>
  motivos: DemoMotivo[]
  funcionarios: DemoFuncionario[]
  anotacoes: DemoAnotacao[]
  planosAcao: DemoPlanoAcao[]
  planosMelhoria: DemoPlanoMelhoria[]
  filas: Map<string, DemoQueueItem[]>
}

let store: DemoStore | null = null

// ─── Sementes de conteúdo textual ────────────────────────────────────────────

const ANOTACOES_SEED = [
  "Ruído anormal no eixo durante a partida; manutenção acionada para inspeção.",
  "Lote de matéria-prima com variação dimensional; ajuste fino no dispositivo.",
  "Operador reportou vibração acima do normal após a troca de ferramenta.",
  "Fluxo de refrigeração restabelecido depois da limpeza do filtro.",
  "Peças da OP anterior segregadas para reinspeção dimensional.",
  "Ajuste de parâmetro reduziu o tempo de ciclo em cerca de 6%.",
  "Troca de turno concluída sem pendências; posto entregue produzindo.",
  "Aguardando liberação da qualidade para retomar a produção do lote.",
]

const PLANO_ACAO_SEED = [
  { o_que: "Padronizar o setup de troca de ferramental", como: "Elaborar checklist com sequência e torque de aperto", por_que: "Setup responde por parte relevante da indisponibilidade" },
  { o_que: "Reduzir refugo no acabamento", como: "Revisar gabarito de inspeção e treinar operadores", por_que: "Taxa de refugo acima da meta nas últimas semanas" },
  { o_que: "Antecipar abastecimento de insumos", como: "Programar kanban de reposição a cada 4 horas", por_que: "Falta de material aparece no topo do Pareto" },
  { o_que: "Revisar plano de manutenção preventiva", como: "Ajustar periodicidade conforme horas de operação", por_que: "Quebras concentradas em dois equipamentos" },
  { o_que: "Implantar apontamento de parada em tempo real", como: "Treinar operadores no uso do terminal do posto", por_que: "Paradas não justificadas prejudicam a análise" },
]

const PLANO_MELHORIA_SEED = [
  {
    titulo: "Redução do tempo de setup na moldagem",
    problema: "O setup entre ordens consome em média 32 minutos, impactando a disponibilidade da célula.",
    meta: "Reduzir o tempo médio de setup para 18 minutos em 90 dias.",
    grupo: "Setup e Ajustes",
    estado: "Em execução",
  },
  {
    titulo: "Estabilização do ciclo na usinagem",
    problema: "Variação do tempo de ciclo entre turnos indica diferença de método operacional.",
    meta: "Reduzir o desvio-padrão do ciclo em 40%.",
    grupo: "Ajustes de Processo",
    estado: "Em execução",
  },
  {
    titulo: "Plano de contenção de refugo no acabamento",
    problema: "Refugo acumulado acima de 2% no posto de acabamento.",
    meta: "Trazer o refugo para menos de 1,2% até o fim do trimestre.",
    grupo: "Qualidade",
    estado: "Planejado",
  },
  {
    titulo: "Confiabilidade do forno de indução",
    problema: "Duas paradas por quebra no último mês somaram mais de 4 horas.",
    meta: "Zerar paradas por quebra não programada no equipamento.",
    grupo: "Falha de Equipamento",
    estado: "Concluído",
  },
  {
    titulo: "Eliminação de paradas sem justificativa",
    problema: "Parte das paradas registradas segue sem motivo apontado pelo operador.",
    meta: "Reduzir paradas não justificadas a menos de 5% do tempo parado.",
    grupo: "Não Justificada",
    estado: "Planejado",
  },
]

const FUNCIONARIOS_SEED = [
  { nome: "A. Ribeiro", registro: "DEMO-1041", cargo: "Rebarbador" },
  { nome: "C. Nogueira", registro: "DEMO-1077", cargo: "Rebarbador" },
  { nome: "D. Fontes", registro: "DEMO-1092", cargo: "Rebarbador" },
  { nome: "E. Salgado", registro: "DEMO-1118", cargo: "Rebarbador" },
  { nome: "F. Quintana", registro: "DEMO-1126", cargo: "Rebarbador" },
  { nome: "G. Bastos", registro: "DEMO-1203", cargo: "Apontador" },
  { nome: "H. Vilela", registro: "DEMO-1247", cargo: "Apontador" },
  { nome: "I. Moura", registro: "DEMO-1288", cargo: "Operador" },
  { nome: "J. Peixoto", registro: "DEMO-1310", cargo: "Operador" },
  { nome: "L. Tavares", registro: "DEMO-1352", cargo: "Operador" },
]

// ─── Construção do estado inicial ────────────────────────────────────────────

function buildInitialStore(): DemoStore {
  const now = demoNow()
  const rng = makeRng(DEMO_SEED, "store")

  const funcionarios: DemoFuncionario[] = FUNCIONARIOS_SEED.map((f) => ({
    funcionario_id: stableId("funcionario", f.registro),
    nome: f.nome,
    registro: f.registro,
    cargo: f.cargo,
    is_active: true,
  }))

  const anotacoes: DemoAnotacao[] = ANOTACOES_SEED.map((texto, i) => {
    const ct = CENTROS[i % CENTROS.length]
    const ts = now - (i * 7 + 2) * HOUR_MS
    return {
      id: stableId("anotacao", i),
      texto,
      data_hora: new Date(ts).toISOString(),
      centro_trabalho_id: ct.centro_trabalho_id,
      usuario_nome: USUARIOS[(i + 1) % USUARIOS.length].nome,
      created_at: new Date(ts).toISOString(),
      anexos: [],
    }
  })

  const estados = ["Pendente", "Em andamento", "Concluído"]
  const planosAcao: DemoPlanoAcao[] = PLANO_ACAO_SEED.map((p, i) => {
    const ct = CENTROS[(i * 3) % CENTROS.length]
    const responsavel = USUARIOS[(i + 1) % USUARIOS.length]
    const criado = now - (i + 1) * 30 * HOUR_MS
    return {
      id: stableId("plano-acao", i),
      item_id: stableId("plano-acao-item", i),
      o_que: p.o_que,
      como: p.como,
      por_que: p.por_que,
      quando: new Date(now + (i + 2) * 24 * HOUR_MS).toISOString(),
      estado: estados[i % estados.length],
      centro_trabalho_id: ct.centro_trabalho_id,
      onde_nome: ct.nome,
      quem_id: responsavel.usuario_id,
      quem_nome: responsavel.nome,
      observacoes: null,
      created_at: new Date(criado).toISOString(),
      updated_at: null,
      anexos: [],
    }
  })

  const planosMelhoria: DemoPlanoMelhoria[] = PLANO_MELHORIA_SEED.map((p, i) => {
    const ct = CENTROS[(i * 4) % CENTROS.length]
    const responsavel = USUARIOS[(i + 1) % USUARIOS.length]
    const inicio = now - (20 + i * 9) * 24 * HOUR_MS
    const concluido = p.estado === "Concluído"
    return {
      id: stableId("plano-melhoria", i),
      public_id: `PM-DEMO-${100 + i}`,
      titulo: p.titulo,
      descricao: p.problema,
      problema: p.problema,
      meta: p.meta,
      resultado: concluido ? "Meta atingida; indicador estabilizado nas últimas quatro semanas." : null,
      estado: p.estado,
      grupo_perda: p.grupo,
      data_inicio: new Date(inicio).toISOString(),
      data_conclusao: concluido ? new Date(inicio + 25 * 24 * HOUR_MS).toISOString() : null,
      criado_em: new Date(inicio).toISOString(),
      centro_trabalho_id: ct.centro_trabalho_id,
      centro_trabalho_nome: ct.nome,
      responsavel_id: responsavel.usuario_id,
      responsavel_nome: responsavel.nome,
    }
  })

  // Rebarbador / apontador iniciais por posto.
  const rebarbadorPorCt = new Map<string, string | null>()
  const apontadorPorCt = new Map<string, string | null>()
  const rebarbadores = funcionarios.filter((f) => f.cargo === "Rebarbador")
  const apontadores = funcionarios.filter((f) => f.cargo === "Apontador")
  CENTROS.forEach((ct, i) => {
    rebarbadorPorCt.set(ct.centro_trabalho_id, ct.rebarbador ? rebarbadores[i % rebarbadores.length].funcionario_id : null)
    apontadorPorCt.set(ct.centro_trabalho_id, i % 3 === 0 ? apontadores[i % apontadores.length].funcionario_id : null)
  })

  // Fila de ordens de cada posto.
  const filas = new Map<string, DemoQueueItem[]>()
  const dia = operationalDayIndex(now)
  CENTROS.forEach((ct, ctIndex) => {
    const itens: DemoQueueItem[] = []
    const qtd = rng.int(2, 4)
    for (let i = 0; i < qtd; i++) {
      const produto = PRODUTOS[(ctIndex + i) % PRODUTOS.length]
      itens.push({
        fila_item_id: stableId("fila", ct.codigo, i),
        ordem_id: stableId("fila-ordem", ct.codigo, dia, i),
        ordem_codigo: `OP-DEMO-${2000 + ctIndex * 10 + i}`,
        ordem_public_id: `OP-DEMO-${2000 + ctIndex * 10 + i}`,
        produto_descricao: produto.descricao,
        posicao: i + 1,
        is_current: i === 0,
        finish_rule:
          i === 0
            ? { tipo: "QTD", qtd: produto.meta_turno, fim_utc: null }
            : { tipo: "SEM", qtd: null, fim_utc: null },
      })
    }
    filas.set(ct.centro_trabalho_id, itens)
  })

  return {
    statusOverride: new Map(),
    paradaOverride: new Map(),
    paradasManuais: new Map(),
    contagemExtra: new Map(),
    modoContagem: new Map(CENTROS.map((c) => [c.centro_trabalho_id, c.modo_contagem])),
    retrabalhoPecas: new Map(),
    rebarbadorPorCt,
    apontadorPorCt,
    apontadorPadrao: new Map(),
    motivos: [...MOTIVOS],
    funcionarios,
    anotacoes,
    planosAcao,
    planosMelhoria,
    filas,
  }
}

/** Estado mutável da demo (criado sob demanda). */
export function getStore(): DemoStore {
  if (!store) store = buildInitialStore()
  return store
}

/** Volta a demonstração ao estado gerado. */
export function resetStore(): void {
  store = null
}

// ─── Helpers de escrita ──────────────────────────────────────────────────────

export function addContagem(
  centroId: string,
  delta: Partial<{ good: number; scrap: number; rework: number }>,
): void {
  const s = getStore()
  const atual = s.contagemExtra.get(centroId) ?? { good: 0, scrap: 0, rework: 0 }
  s.contagemExtra.set(centroId, {
    good: atual.good + (delta.good ?? 0),
    scrap: atual.scrap + (delta.scrap ?? 0),
    rework: atual.rework + (delta.rework ?? 0),
  })
}

export function getContagemExtra(centroId: string): { good: number; scrap: number; rework: number } {
  return getStore().contagemExtra.get(centroId) ?? { good: 0, scrap: 0, rework: 0 }
}

export function getMotivo(motivoId: string): DemoMotivo | undefined {
  return getStore().motivos.find((m) => m.motivo_id === motivoId)
}

export function getFuncionario(id: string | null | undefined): DemoFuncionario | null {
  if (!id) return null
  return getStore().funcionarios.find((f) => f.funcionario_id === id) ?? null
}

export function novoId(prefixo: string): string {
  return stableId(prefixo, Date.now(), Math.random())
}

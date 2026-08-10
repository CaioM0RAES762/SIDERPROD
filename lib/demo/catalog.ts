// lib/demo/catalog.ts
//
// Cadastros fictícios da fábrica de demonstração.
//
// Nada aqui reflete uma planta, produto, pessoa ou código real: é uma siderúrgica
// inventada, dimensionada para que os painéis fiquem visualmente interessantes
// (mistura de postos rápidos e lentos, turnos completos, motivos de parada dos
// dois tipos e produtos com ciclos bem diferentes entre si).

import { stableId } from "./rng"

export type DemoSetor = {
  setor_id: string
  nome: string
}

export type DemoCentro = {
  centro_trabalho_id: string
  codigo: string
  nome: string
  nome_curto: string
  setor_id: string
  /** GOOD = conta peças boas. REWORK = posto de retrabalho. */
  modo_contagem: "GOOD" | "REWORK"
  /** Perfil de comportamento usado pelo gerador. */
  perfil: "estavel" | "irregular" | "gargalo"
  rebarbador?: { nome: string; registro: string; cargo: string } | null
}

export type DemoProduto = {
  produto_id: string
  codigo: string
  descricao: string
  familia: string
  unidade: string
  ciclo_ideal_seg: number
  meta_turno: number
  /** Meta do programa mensal — alimenta a barra de progresso da peça. */
  meta_planejada: number
}

export type DemoTurno = {
  turno_id: string
  nome: string
  hora_inicio: string
  hora_fim: string
  ordem_exibicao: number
}

export type DemoMotivo = {
  motivo_id: string
  codigo: string
  descricao: string
  grupo_perda: string
  is_planejada: boolean
  exige_justificativa: boolean
  sla_minutos: number | null
}

export type DemoUsuario = {
  usuario_id: string
  nome: string
  email: string
  cargo: string
  perfil: "Administrador" | "Gestor" | "Operador"
  is_active: boolean
}

export const EMPRESA_ID = stableId("empresa", "siderprod")
export const EMPRESA_NOME = "Siderúrgica Demonstração S.A."
export const PLANTA_NOME = "Unidade Industrial — Planta Demo"

// ─── Setores ─────────────────────────────────────────────────────────────────

export const SETORES: DemoSetor[] = [
  { setor_id: stableId("setor", "fundicao"), nome: "Fundição" },
  { setor_id: stableId("setor", "usinagem"), nome: "Usinagem" },
  { setor_id: stableId("setor", "acabamento"), nome: "Acabamento" },
  { setor_id: stableId("setor", "rebarbacao"), nome: "Rebarbação" },
]

const [SETOR_FUNDICAO, SETOR_USINAGEM, SETOR_ACABAMENTO, SETOR_REBARBACAO] = SETORES

// ─── Centros de trabalho ─────────────────────────────────────────────────────

function ct(
  codigo: string,
  nome: string,
  nome_curto: string,
  setor: DemoSetor,
  perfil: DemoCentro["perfil"],
  modo: DemoCentro["modo_contagem"] = "GOOD",
  rebarbador: DemoCentro["rebarbador"] = null,
): DemoCentro {
  return {
    centro_trabalho_id: stableId("ct", codigo),
    codigo,
    nome,
    nome_curto,
    setor_id: setor.setor_id,
    modo_contagem: modo,
    perfil,
    rebarbador,
  }
}

export const CENTROS: DemoCentro[] = [
  ct("FND-01", "Forno de Indução 01", "Forno 01", SETOR_FUNDICAO, "estavel"),
  ct("FND-02", "Forno de Indução 02", "Forno 02", SETOR_FUNDICAO, "irregular"),
  ct("MOL-01", "Moldagem Automática 01", "Moldagem 01", SETOR_FUNDICAO, "estavel"),
  ct("MOL-02", "Moldagem Automática 02", "Moldagem 02", SETOR_FUNDICAO, "gargalo"),
  ct("USN-01", "Centro de Usinagem 01", "Usinagem 01", SETOR_USINAGEM, "estavel"),
  ct("USN-02", "Centro de Usinagem 02", "Usinagem 02", SETOR_USINAGEM, "irregular"),
  ct("USN-03", "Centro de Usinagem 03", "Usinagem 03", SETOR_USINAGEM, "estavel"),
  ct("ACB-01", "Acabamento Posto 01", "Acab 01", SETOR_ACABAMENTO, "estavel", "GOOD", {
    nome: "A. Ribeiro",
    registro: "DEMO-1041",
    cargo: "Rebarbador",
  }),
  ct("ACB-02", "Acabamento Posto 02", "Acab 02", SETOR_ACABAMENTO, "irregular", "GOOD", {
    nome: "C. Nogueira",
    registro: "DEMO-1077",
    cargo: "Rebarbador",
  }),
  ct("ACB-03", "Acabamento Posto 03", "Acab 03", SETOR_ACABAMENTO, "gargalo", "GOOD", {
    nome: "D. Fontes",
    registro: "DEMO-1092",
    cargo: "Rebarbador",
  }),
  ct("REB-01", "Rebarbação Manual 01", "Rebarba 01", SETOR_REBARBACAO, "estavel", "REWORK", {
    nome: "E. Salgado",
    registro: "DEMO-1118",
    cargo: "Rebarbador",
  }),
  ct("REB-02", "Rebarbação Manual 02", "Rebarba 02", SETOR_REBARBACAO, "irregular", "REWORK", null),
]

export const CENTROS_BY_ID = new Map(CENTROS.map((c) => [c.centro_trabalho_id, c]))

// ─── Produtos ────────────────────────────────────────────────────────────────

function produto(
  codigo: string,
  descricao: string,
  familia: string,
  ciclo_ideal_seg: number,
  meta_planejada: number,
): DemoProduto {
  return {
    produto_id: stableId("produto", codigo),
    codigo,
    descricao,
    familia,
    unidade: "PC",
    ciclo_ideal_seg,
    meta_turno: Math.round((8 * 3600) / ciclo_ideal_seg * 0.72),
    meta_planejada,
  }
}

export const PRODUTOS: DemoProduto[] = [
  produto("A-120", "Componente Fundido A-120", "Fundidos", 42, 180_000),
  produto("B-240", "Suporte Estrutural B-240", "Estruturais", 58, 96_000),
  produto("C-310", "Flange Usinada C-310", "Usinados", 95, 54_000),
  produto("D-080", "Bucha de Aço D-080", "Usinados", 26, 240_000),
  produto("E-450", "Cubo de Roda E-450", "Fundidos", 120, 42_000),
  produto("F-150", "Braço Oscilante F-150", "Estruturais", 75, 68_000),
  produto("G-220", "Carcaça de Redutor G-220", "Fundidos", 145, 30_000),
  produto("H-090", "Anel de Retenção H-090", "Usinados", 33, 210_000),
]

export const PRODUTOS_BY_ID = new Map(PRODUTOS.map((p) => [p.produto_id, p]))

/** Produtos que cada centro é capaz de processar (mantém a demo plausível). */
export const PRODUTOS_POR_CENTRO: Record<string, string[]> = {
  "FND-01": ["A-120", "E-450", "G-220"],
  "FND-02": ["A-120", "G-220"],
  "MOL-01": ["A-120", "B-240", "F-150"],
  "MOL-02": ["B-240", "E-450"],
  "USN-01": ["C-310", "D-080", "H-090"],
  "USN-02": ["D-080", "H-090"],
  "USN-03": ["C-310", "F-150"],
  "ACB-01": ["A-120", "B-240", "D-080"],
  "ACB-02": ["F-150", "H-090"],
  "ACB-03": ["C-310", "E-450"],
  "REB-01": ["A-120", "B-240"],
  "REB-02": ["D-080", "H-090"],
}

// ─── Turnos ──────────────────────────────────────────────────────────────────

export const TURNOS: DemoTurno[] = [
  { turno_id: stableId("turno", "A"), nome: "Turno A · Manhã", hora_inicio: "06:00", hora_fim: "14:00", ordem_exibicao: 1 },
  { turno_id: stableId("turno", "B"), nome: "Turno B · Tarde", hora_inicio: "14:00", hora_fim: "22:00", ordem_exibicao: 2 },
  { turno_id: stableId("turno", "C"), nome: "Turno C · Noite", hora_inicio: "22:00", hora_fim: "06:00", ordem_exibicao: 3 },
]

// ─── Motivos de parada ───────────────────────────────────────────────────────

function motivo(
  codigo: string,
  descricao: string,
  grupo_perda: string,
  is_planejada: boolean,
  exige_justificativa = true,
  sla_minutos: number | null = null,
): DemoMotivo {
  return {
    motivo_id: stableId("motivo", codigo),
    codigo,
    descricao,
    grupo_perda,
    is_planejada,
    exige_justificativa,
    sla_minutos,
  }
}

export const MOTIVOS: DemoMotivo[] = [
  // Planejadas
  motivo("SETUP", "Setup / troca de ferramental", "Setup e Ajustes", true, true, 30),
  motivo("MANPREV", "Manutenção preventiva", "Manutenção Programada", true, true, 90),
  motivo("REFEICAO", "Intervalo de refeição", "Paradas Programadas", true, false, 60),
  motivo("REUNIAO", "Reunião de passagem de turno", "Paradas Programadas", true, false, 15),
  // Não planejadas
  motivo("QUEBRA", "Quebra de equipamento", "Falha de Equipamento", false, true, 120),
  motivo("FALTAMAT", "Falta de material", "Falta de Insumo", false, true, 45),
  motivo("AJUSTE", "Ajuste de processo", "Ajustes de Processo", false, true, 20),
  motivo("QUALID", "Desvio de qualidade", "Qualidade", false, true, 30),
  motivo("FALTAOP", "Falta de operador", "Mão de Obra", false, true, 30),
  motivo("ENERGIA", "Oscilação de energia", "Utilidades", false, true, 60),
  motivo("FERRAM", "Troca de ferramenta por desgaste", "Ferramental", false, true, 25),
  motivo("SEMJUST", "Parada não justificada", "Não Justificada", false, true, null),
]

export const MOTIVOS_BY_ID = new Map(MOTIVOS.map((m) => [m.motivo_id, m]))
export const MOTIVO_SEM_JUSTIFICATIVA = MOTIVOS.find((m) => m.codigo === "SEMJUST")!
export const MOTIVO_SETUP = MOTIVOS.find((m) => m.codigo === "SETUP")!
export const MOTIVO_REFEICAO = MOTIVOS.find((m) => m.codigo === "REFEICAO")!

/** Motivos sorteáveis para paradas não planejadas, com pesos realistas. */
export const MOTIVOS_NAO_PLANEJADOS_PESO = [
  { codigo: "QUEBRA", weight: 10 },
  { codigo: "FALTAMAT", weight: 16 },
  { codigo: "AJUSTE", weight: 20 },
  { codigo: "QUALID", weight: 12 },
  { codigo: "FALTAOP", weight: 8 },
  { codigo: "ENERGIA", weight: 5 },
  { codigo: "FERRAM", weight: 14 },
  { codigo: "SEMJUST", weight: 15 },
] as const

// ─── Usuários fictícios ──────────────────────────────────────────────────────

export const USUARIO_DEMO: DemoUsuario = {
  usuario_id: stableId("usuario", "demo"),
  nome: "Usuário Demonstração",
  email: "User_teste@gmail.com",
  cargo: "Analista de Produção",
  perfil: "Administrador",
  is_active: true,
}

export const USUARIOS: DemoUsuario[] = [
  USUARIO_DEMO,
  {
    usuario_id: stableId("usuario", "gestor"),
    nome: "M. Andrade",
    email: "m.andrade@exemplo.com",
    cargo: "Coordenador de Produção",
    perfil: "Gestor",
    is_active: true,
  },
  {
    usuario_id: stableId("usuario", "pcp"),
    nome: "R. Camargo",
    email: "r.camargo@exemplo.com",
    cargo: "Analista de PCP",
    perfil: "Gestor",
    is_active: true,
  },
  {
    usuario_id: stableId("usuario", "op1"),
    nome: "J. Peixoto",
    email: "j.peixoto@exemplo.com",
    cargo: "Operador de Máquina",
    perfil: "Operador",
    is_active: true,
  },
  {
    usuario_id: stableId("usuario", "op2"),
    nome: "L. Tavares",
    email: "l.tavares@exemplo.com",
    cargo: "Operador de Máquina",
    perfil: "Operador",
    is_active: false,
  },
]

/** Grupos de perda usados nos gráficos de Pareto. */
export const GRUPOS_PERDA = Array.from(new Set(MOTIVOS.map((m) => m.grupo_perda)))

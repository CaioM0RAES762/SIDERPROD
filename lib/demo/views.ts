// lib/demo/views.ts
//
// Projeções de leitura: transformam o plano gerado em factory.ts nos formatos
// que a interface já esperava do backend original. Cada função aqui responde a
// uma pergunta de tela ("como está o posto agora?", "quanto produziu por hora?",
// "qual o Pareto de paradas do turno?") sempre a partir da MESMA fonte, o que
// mantém os números coerentes entre painéis.

import {
  CENTROS,
  CENTROS_BY_ID,
  MOTIVOS_BY_ID,
  PRODUTOS_BY_ID,
  type DemoCentro,
} from "./catalog"
import {
  aggregate,
  bucketsDoDia,
  bucketsNaJanela,
  corridaEm,
  getDayPlan,
  paradaAbertaEm,
  paradasNaJanela,
  pecasRetrabalho,
  progressoProduto,
  type Aggregate,
  type HourBucket,
  type ParadaView,
} from "./factory"
import { getContagemExtra, getFuncionario, getStore } from "./store"
import {
  demoNow,
  HOUR_MS,
  iso,
  isoOrNull,
  operationalDayIndex,
  operationalDayStart,
  overlapSeconds,
  shiftAt,
  shiftsOfDay,
} from "./time"

// ─── Paradas com sobreposição do estado editado pelo visitante ───────────────

/** Aplica justificativas/edições feitas na demo sobre uma parada gerada. */
export function applyOverride(p: ParadaView): ParadaView {
  const ov = getStore().paradaOverride.get(p.parada_id)
  if (!ov) return p
  const fim = ov.fim ?? p.fim_efetivo
  return {
    ...p,
    motivo_id: ov.motivo_id ?? p.motivo_id,
    is_justificada: ov.is_justificada ?? p.is_justificada,
    justificativa_texto:
      ov.justificativa_texto !== undefined ? ov.justificativa_texto : p.justificativa_texto,
    fim_efetivo: fim ?? null,
    duracao_seg: p.duracao_seg,
  }
}

/** Paradas de um centro numa janela, já com sobreposições e paradas manuais. */
export function paradasView(
  centroId: string,
  from: number,
  to: number,
  nowMs = demoNow(),
): ParadaView[] {
  const geradas = paradasNaJanela(centroId, from, to, nowMs).map(applyOverride)

  const manuais = (getStore().paradasManuais.get(centroId) ?? [])
    .filter((p) => {
      const fim = p.fim ?? nowMs
      return fim > from && p.inicio < to
    })
    .map<ParadaView>((p) => ({
      parada_id: p.parada_id,
      centro_trabalho_id: p.centro_trabalho_id,
      motivo_id: p.motivo_id,
      inicio: p.inicio,
      fim: p.fim ?? nowMs,
      is_justificada: p.is_justificada,
      justificativa_texto: p.justificativa_texto,
      fim_efetivo: p.fim,
      duracao_seg: Math.max(0, Math.round(((p.fim ?? nowMs) - p.inicio) / 1000)),
    }))

  return [...geradas, ...manuais].sort((a, b) => a.inicio - b.inicio)
}

export function paradaRow(p: ParadaView) {
  const motivo = MOTIVOS_BY_ID.get(p.motivo_id) ?? getStore().motivos.find((m) => m.motivo_id === p.motivo_id)
  return {
    parada_id: p.parada_id,
    id: p.parada_id,
    empresa_id: undefined,
    centro_trabalho_id: p.centro_trabalho_id,
    corrida_id: corridaEm(p.centro_trabalho_id, p.inicio)?.corrida_id ?? null,
    motivo_id: p.motivo_id,
    motivo_codigo: motivo?.codigo ?? null,
    motivo_descricao: motivo?.descricao ?? null,
    grupo_perda: motivo?.grupo_perda ?? null,
    is_planejada: motivo?.is_planejada ?? null,
    exige_justificativa: motivo?.exige_justificativa ?? null,
    inicio_utc: iso(p.inicio),
    fim_utc: isoOrNull(p.fim_efetivo),
    data_hora_inicio: iso(p.inicio),
    data_hora_fim: isoOrNull(p.fim_efetivo),
    duracao_seg: p.duracao_seg,
    is_justificada: p.is_justificada,
    justificada: p.is_justificada,
    justificativa_texto: p.justificativa_texto,
    observacoes: p.justificativa_texto,
    justificativa_usuario_id: null,
    justificativa_time_utc: p.is_justificada ? iso(p.inicio + 60_000) : null,
    updated_at: null,
  }
}

// ─── Status atual de um centro ───────────────────────────────────────────────

export type StatusAtual = {
  status_ct: "RUNNING" | "STOPPED"
  descricao: string
  desde: number
  parada: ParadaView | null
}

export function statusAtual(centroId: string, nowMs = demoNow()): StatusAtual {
  const override = getStore().statusOverride.get(centroId)

  if (override?.tipo === "STOPPED") {
    const motivo = MOTIVOS_BY_ID.get(override.motivo_id) ?? getStore().motivos.find((m) => m.motivo_id === override.motivo_id)
    return {
      status_ct: "STOPPED",
      descricao: motivo?.descricao ?? "Parada",
      desde: override.inicio,
      parada: {
        parada_id: `demo-manual-${centroId}`,
        centro_trabalho_id: centroId,
        motivo_id: override.motivo_id,
        inicio: override.inicio,
        fim: nowMs,
        is_justificada: Boolean(motivo && motivo.codigo !== "SEMJUST"),
        justificativa_texto: null,
        fim_efetivo: null,
        duracao_seg: Math.max(0, Math.round((nowMs - override.inicio) / 1000)),
      },
    }
  }

  if (override?.tipo === "RUNNING") {
    return { status_ct: "RUNNING", descricao: "Produzindo", desde: override.desde, parada: null }
  }

  const aberta = paradaAbertaEm(centroId, nowMs)
  if (aberta) {
    const p = applyOverride(aberta)
    const motivo = MOTIVOS_BY_ID.get(p.motivo_id)
    return {
      status_ct: "STOPPED",
      descricao: motivo?.descricao ?? "Parada não justificada",
      desde: p.inicio,
      parada: p,
    }
  }

  // Produzindo desde o fim da última parada (ou desde o início da corrida).
  const dia = operationalDayIndex(nowMs)
  const anteriores = paradasView(centroId, operationalDayStart(dia), nowMs, nowMs)
  const ultima = anteriores.filter((p) => (p.fim_efetivo ?? 0) <= nowMs).pop()
  const corrida = corridaEm(centroId, nowMs)
  const desde = Math.max(ultima?.fim_efetivo ?? 0, corrida?.inicio ?? 0) || operationalDayStart(dia)

  return { status_ct: "RUNNING", descricao: "Produzindo", desde, parada: null }
}

// ─── Card do dashboard ───────────────────────────────────────────────────────

function somaContagem(agg: Aggregate, extra: { good: number; scrap: number; rework: number }) {
  return {
    good: agg.good + extra.good,
    scrap: agg.scrap + extra.scrap,
    rework: agg.rework + extra.rework,
  }
}

export function buildCard(ct: DemoCentro, nowMs = demoNow()) {
  const store = getStore()
  const turno = shiftAt(nowMs)
  const dia = operationalDayIndex(nowMs)
  const diaInicio = operationalDayStart(dia)

  const corrida = corridaEm(ct.centro_trabalho_id, nowMs)
  const produto = corrida ? PRODUTOS_BY_ID.get(corrida.produto_id) ?? null : null

  const status = statusAtual(ct.centro_trabalho_id, nowMs)
  const extra = getContagemExtra(ct.centro_trabalho_id)

  const aggTurno = aggregate(bucketsNaJanela(ct.centro_trabalho_id, turno.inicio, nowMs, nowMs))
  const aggCorrida = corrida
    ? aggregate(bucketsNaJanela(ct.centro_trabalho_id, corrida.inicio, nowMs, nowMs))
    : aggTurno
  const aggCorridaTurno = corrida
    ? aggregate(bucketsNaJanela(ct.centro_trabalho_id, Math.max(corrida.inicio, turno.inicio), nowMs, nowMs))
    : aggTurno

  const turnoTotais = somaContagem(aggTurno, extra)
  const corridaTotais = somaContagem(aggCorrida, extra)

  const paradasTurno = paradasView(ct.centro_trabalho_id, turno.inicio, nowMs, nowMs)
  const paradasDia = paradasView(ct.centro_trabalho_id, diaInicio, nowMs, nowMs)

  const somaParadas = (list: ParadaView[], janelaInicio: number) =>
    list.reduce(
      (acc, p) => acc + overlapSeconds(p.inicio, p.fim_efetivo ?? nowMs, janelaInicio, nowMs),
      0,
    )

  const paradasTurnoSeg = Math.round(somaParadas(paradasTurno, turno.inicio))
  const paradasDiaSeg = Math.round(somaParadas(paradasDia, diaInicio))
  const decorridoDiaSeg = Math.max(0, Math.round((nowMs - diaInicio) / 1000))

  const motivo = status.parada ? MOTIVOS_BY_ID.get(status.parada.motivo_id) ?? null : null

  // OP anterior encerrada.
  const plan = getDayPlan(ct.centro_trabalho_id, dia)
  const idx = corrida ? plan.corridas.findIndex((c) => c.corrida_id === corrida.corrida_id) : -1
  const anterior = idx > 0 ? plan.corridas[idx - 1] : null
  const aggAnterior = anterior
    ? aggregate(bucketsNaJanela(ct.centro_trabalho_id, anterior.inicio, anterior.fim, nowMs))
    : null

  const progresso = produto ? progressoProduto(produto.produto_id, nowMs) : null
  const modo = store.modoContagem.get(ct.centro_trabalho_id) ?? ct.modo_contagem
  const rebarbador = getFuncionario(store.rebarbadorPorCt.get(ct.centro_trabalho_id))
  const apontador = getFuncionario(store.apontadorPorCt.get(ct.centro_trabalho_id))

  return {
    empresa_id: undefined,
    centro_trabalho_id: ct.centro_trabalho_id,
    ct_public_id: ct.codigo,
    ct_codigo: ct.codigo,
    ct_nome: ct.nome,

    status_ct: status.status_ct,
    status_descricao: status.descricao,
    status_updated_at_utc: iso(status.desde),
    last_event_time_utc: iso(nowMs),

    corrida_atual_id: corrida?.corrida_id ?? null,
    corrida_inicio_utc: isoOrNull(corrida?.inicio ?? null),
    corrida_fim_utc: null,

    ordem_atual_id: corrida?.ordem_id ?? null,
    ordem_public_id: corrida?.ordem_codigo ?? null,
    ordem_codigo: corrida?.ordem_codigo ?? null,

    produto_atual_id: produto?.produto_id ?? null,
    produto_public_id: produto?.codigo ?? null,
    produto_descricao: produto?.descricao ?? null,
    produto_ciclo_ideal_seg: produto?.ciclo_ideal_seg ?? null,

    meta_corrida: corrida?.meta ?? null,

    total_good: corridaTotais.good,
    total_scrap: corridaTotais.scrap,
    total_rework: corridaTotais.rework,

    turno: {
      turno_id: `turno-${turno.index}`,
      turno_nome: turno.nome,
      inicio_utc: iso(turno.inicio),
      fim_utc: iso(turno.fim),
    },
    turno_good: turnoTotais.good,
    turno_scrap: turnoTotais.scrap,
    turno_rework: turnoTotais.rework,

    motivo_parada_id: status.parada?.motivo_id ?? null,
    motivo_codigo: motivo?.codigo ?? null,
    motivo_descricao: motivo?.descricao ?? null,
    motivo_grupo_perda: motivo?.grupo_perda ?? null,
    motivo_is_planejada: motivo?.is_planejada ?? null,
    parada_inicio_utc: status.parada ? iso(status.parada.inicio) : null,
    parada_duracao_seg: status.parada ? status.parada.duracao_seg : null,

    produzindo_segmento_inicio_utc: status.status_ct === "RUNNING" ? iso(status.desde) : null,
    produzindo_segmento_seg:
      status.status_ct === "RUNNING" ? Math.max(0, Math.round((nowMs - status.desde) / 1000)) : null,

    planned_time_seg: aggTurno.planned_time_seg,
    unplanned_stop_seg: aggTurno.unplanned_stop_seg,
    run_time_seg: aggTurno.run_time_seg,

    availability: aggTurno.availability,
    performance: aggTurno.performance,
    quality: aggTurno.quality,
    oee: aggTurno.oee,

    produto_total_good_historico: progresso?.total_good ?? null,
    produto_producao_total_good: progresso?.total_good ?? null,
    produto_meta_planejada: progresso?.meta ?? null,
    produto_progresso_pct: progresso?.pct ?? null,

    paradas_turno_qtd: paradasTurno.length,
    paradas_turno_tempo_seg: paradasTurnoSeg,
    paradas_dia_qtd: paradasDia.length,
    paradas_dia_tempo_seg: paradasDiaSeg,
    produzindo_dia_tempo_seg: Math.max(0, decorridoDiaSeg - paradasDiaSeg),

    ordem_anterior_codigo: anterior?.ordem_codigo ?? null,
    ordem_anterior_public_id: anterior?.ordem_codigo ?? null,
    ordem_anterior_good: aggAnterior?.good ?? null,

    corrida_turno_good: aggCorridaTurno.good + extra.good,

    modo_contagem: modo,
    retrabalho_pecas:
      store.retrabalhoPecas.get(ct.centro_trabalho_id) ?? pecasRetrabalho(ct.centro_trabalho_id),

    rebarbador: rebarbador
      ? {
          funcionario_id: rebarbador.funcionario_id,
          nome: rebarbador.nome,
          registro: rebarbador.registro,
          cargo: rebarbador.cargo,
        }
      : null,
    apontador: apontador
      ? {
          funcionario_id: apontador.funcionario_id,
          nome: apontador.nome,
          registro: apontador.registro,
          cargo: apontador.cargo,
        }
      : null,
  }
}

export function listCards(centrosIds?: string[], nowMs = demoNow()) {
  const alvo = centrosIds?.length
    ? CENTROS.filter((c) => centrosIds.includes(c.centro_trabalho_id))
    : CENTROS
  return alvo.map((ct) => buildCard(ct, nowMs))
}

// ─── Produção por hora ───────────────────────────────────────────────────────

export function producaoPorHora(centroId: string, from: number, to: number, nowMs = demoNow()) {
  const ct = CENTROS_BY_ID.get(centroId)
  return bucketsNaJanela(centroId, from, to, nowMs).map((b) => {
    const capacidade = b.ciclo_ideal_seg > 0 ? Math.floor(3600 / b.ciclo_ideal_seg) : 0
    const disponivel = Math.max(0, b.elapsed_seg - b.parada_planejada_seg - b.parada_nao_planejada_seg)
    return {
      centro_trabalho_id: centroId,
      ct_codigo: ct?.codigo ?? null,
      ct_public_id: ct?.codigo ?? null,
      corrida_id: b.corrida_id,
      bucket_time_utc: iso(b.inicio),
      bucket_hour_utc: iso(b.inicio),
      good_count: b.good,
      scrap_count: b.scrap,
      rework_count: b.rework,
      produced_target: Math.floor((disponivel / b.ciclo_ideal_seg) * 0.8),
      capacidade,
      meta: Math.floor((disponivel / b.ciclo_ideal_seg) * 0.8),
      ciclo_medio_seg: b.total > 0 ? Math.round((b.run_time_seg / b.total) * 10) / 10 : null,
    }
  })
}

// ─── OEE por período (uma linha por turno) ───────────────────────────────────

export function oeePorPeriodo(centroId: string, from: number, to: number, nowMs = demoNow()) {
  const ct = CENTROS_BY_ID.get(centroId)
  const rows: Record<string, unknown>[] = []
  const primeiro = operationalDayIndex(from)
  const ultimo = operationalDayIndex(Math.min(to, nowMs))

  for (let d = primeiro; d <= ultimo; d++) {
    for (const turno of shiftsOfDay(d)) {
      if (turno.inicio >= nowMs || turno.fim <= from || turno.inicio >= to) continue
      const buckets = bucketsNaJanela(centroId, turno.inicio, Math.min(turno.fim, nowMs), nowMs)
      if (!buckets.length) continue
      const agg = aggregate(buckets)
      const corrida = corridaEm(centroId, turno.inicio + HOUR_MS)
      const produto = corrida ? PRODUTOS_BY_ID.get(corrida.produto_id) : null
      rows.push({
        centro_trabalho_id: centroId,
        ct_codigo: ct?.codigo ?? null,
        ct_public_id: ct?.codigo ?? null,
        turno_id: `turno-${turno.index}`,
        turno_nome: turno.nome,
        ordem_id: corrida?.ordem_id ?? null,
        ordem_codigo: corrida?.ordem_codigo ?? null,
        ordem_public_id: corrida?.ordem_codigo ?? null,
        produto_id: produto?.produto_id ?? null,
        produto_descricao: produto?.descricao ?? null,
        produto_public_id: produto?.codigo ?? null,
        meta_corrida: corrida?.meta ?? null,
        dia_utc: iso(operationalDayStart(d)).slice(0, 10),
        inicio_utc: iso(turno.inicio),
        fim_utc: iso(Math.min(turno.fim, nowMs)),
        total_good: agg.good,
        total_scrap: agg.scrap,
        total_rework: agg.rework,
        planned_time_seg: agg.planned_time_seg,
        unplanned_stop_seg: agg.unplanned_stop_seg,
        run_time_seg: agg.run_time_seg,
        ideal_time_seg: agg.ideal_time_seg,
        availability: agg.availability,
        performance: agg.performance,
        quality: agg.quality,
        oee: agg.oee,
      })
    }
  }
  return rows
}

// ─── Perdas agregadas por motivo ─────────────────────────────────────────────

export function perdasPorPeriodo(centroId: string, from: number, to: number, nowMs = demoNow()) {
  const paradas = paradasView(centroId, from, to, nowMs)
  const buckets = bucketsNaJanela(centroId, from, to, nowMs)
  const agg = aggregate(buckets)

  const porMotivo = new Map<string, { ocorrencias: number; seg: number }>()
  for (const p of paradas) {
    const cur = porMotivo.get(p.motivo_id) ?? { ocorrencias: 0, seg: 0 }
    cur.ocorrencias += 1
    cur.seg += overlapSeconds(p.inicio, p.fim_efetivo ?? nowMs, from, Math.min(to, nowMs))
    porMotivo.set(p.motivo_id, cur)
  }

  const totalSeg = Array.from(porMotivo.values()).reduce((a, m) => a + m.seg, 0) || 1

  return Array.from(porMotivo.entries())
    .map(([motivoId, v]) => {
      const motivo = MOTIVOS_BY_ID.get(motivoId)
      const fracao = v.seg / totalSeg
      return {
        centro_trabalho_id: centroId,
        motivo_id: motivoId,
        motivo_codigo: motivo?.codigo ?? null,
        motivo_descricao: motivo?.descricao ?? null,
        grupo_perda: motivo?.grupo_perda ?? null,
        is_planejada: motivo?.is_planejada ?? null,
        ocorrencias: v.ocorrencias,
        perda_tempo_seg: Math.round(v.seg),
        perda_quantidade_scrap: Math.round(agg.scrap * fracao),
        perda_quantidade_rework: Math.round(agg.rework * fracao),
        perda_qtd: Math.round((agg.scrap + agg.rework) * fracao),
      }
    })
    .sort((a, b) => b.perda_tempo_seg - a.perda_tempo_seg)
}

/** Formato usado pelo Pareto do dashboard (um registro por CT × motivo). */
export function paradasAgregadasPorMotivo(
  centrosIds: string[] | undefined,
  from: number,
  to: number,
  nowMs = demoNow(),
) {
  const alvo = centrosIds?.length
    ? CENTROS.filter((c) => centrosIds.includes(c.centro_trabalho_id))
    : CENTROS

  const out: Record<string, unknown>[] = []
  for (const ct of alvo) {
    const paradas = paradasView(ct.centro_trabalho_id, from, to, nowMs)
    const porMotivo = new Map<string, { ocorrencias: number; seg: number; just: number; naoJust: number }>()
    for (const p of paradas) {
      const cur = porMotivo.get(p.motivo_id) ?? { ocorrencias: 0, seg: 0, just: 0, naoJust: 0 }
      cur.ocorrencias += 1
      cur.seg += overlapSeconds(p.inicio, p.fim_efetivo ?? nowMs, from, Math.min(to, nowMs))
      if (p.is_justificada) cur.just += 1
      else cur.naoJust += 1
      porMotivo.set(p.motivo_id, cur)
    }
    for (const [motivoId, v] of porMotivo) {
      const motivo = MOTIVOS_BY_ID.get(motivoId)
      out.push({
        centro_trabalho_id: ct.centro_trabalho_id,
        ct_codigo: ct.codigo,
        ct_nome: ct.nome,
        motivo_id: motivoId,
        motivo_codigo: motivo?.codigo ?? null,
        motivo_descricao: motivo?.descricao ?? null,
        grupo_perda: motivo?.grupo_perda ?? null,
        is_planejada: motivo?.is_planejada ?? null,
        exige_justificativa: motivo?.exige_justificativa ?? null,
        ocorrencias: v.ocorrencias,
        tempo_total_seg: Math.round(v.seg),
        justificadas_qtd: v.just,
        nao_justificadas_qtd: v.naoJust,
      })
    }
  }
  return out.sort((a, b) => (b.tempo_total_seg as number) - (a.tempo_total_seg as number))
}

// ─── Produção do dia operacional por CT × hora ───────────────────────────────

export function producaoDiaOperacional(
  centrosIds: string[] | undefined,
  from: number,
  to: number,
  nowMs = demoNow(),
) {
  const alvo = centrosIds?.length
    ? CENTROS.filter((c) => centrosIds.includes(c.centro_trabalho_id))
    : CENTROS

  const rows: { hora_op_utc: string; centro_trabalho_id: string; ct_codigo: string; total_good: number; meta_hora: number }[] = []

  for (const ct of alvo) {
    for (const b of bucketsNaJanela(ct.centro_trabalho_id, from, to, nowMs)) {
      const disponivel = Math.max(0, b.elapsed_seg - b.parada_planejada_seg - b.parada_nao_planejada_seg)
      rows.push({
        // O front soma +6h para exibir o rótulo do dia operacional.
        hora_op_utc: iso(b.inicio - 6 * HOUR_MS),
        centro_trabalho_id: ct.centro_trabalho_id,
        ct_codigo: ct.codigo,
        total_good: b.good,
        meta_hora: Math.floor((disponivel / b.ciclo_ideal_seg) * 0.8),
      })
    }
  }

  return rows.sort((a, b) => a.hora_op_utc.localeCompare(b.hora_op_utc) || a.ct_codigo.localeCompare(b.ct_codigo))
}

// ─── OEE consolidado por turno do dia operacional ────────────────────────────

export function oeeConsolidadoTurnos(nowMs = demoNow()) {
  const dia = operationalDayIndex(nowMs)
  return shiftsOfDay(dia)
    .filter((t) => t.inicio < nowMs)
    .map((turno) => {
      const fim = Math.min(turno.fim, nowMs)
      const buckets: HourBucket[] = []
      for (const ct of CENTROS) {
        buckets.push(...bucketsNaJanela(ct.centro_trabalho_id, turno.inicio, fim, nowMs))
      }
      const agg = aggregate(buckets)
      return {
        turno_id: `turno-${turno.index}`,
        turno_nome: turno.nome,
        inicio_utc: iso(turno.inicio),
        fim_utc: iso(fim),
        turno_good: agg.good,
        turno_scrap: agg.scrap,
        turno_rework: agg.rework,
        total_pecas: agg.total,
        run_time_seg: agg.run_time_seg,
        planned_time_seg: agg.planned_time_seg,
        ideal_time_seg: agg.ideal_time_seg,
        availability: agg.availability,
        performance: agg.performance,
        quality: agg.quality,
        oee: agg.oee,
      }
    })
}

// ─── Histórico do dia de um centro ───────────────────────────────────────────

export function historicoDia(centroId: string, nowMs = demoNow()) {
  const dia = operationalDayIndex(nowMs)
  const plan = getDayPlan(centroId, dia)
  const corridaAtual = corridaEm(centroId, nowMs)

  const anteriorCorrida = [...plan.corridas].reverse().find((c) => c.fim <= nowMs) ?? null
  const aggAnterior = anteriorCorrida
    ? aggregate(bucketsNaJanela(centroId, anteriorCorrida.inicio, anteriorCorrida.fim, nowMs))
    : null

  const historico_turnos = shiftsOfDay(dia)
    .filter((t) => t.inicio < nowMs)
    .map((turno) => {
      const fim = Math.min(turno.fim, nowMs)
      const agg = aggregate(bucketsNaJanela(centroId, turno.inicio, fim, nowMs))

      const corridas = plan.corridas
        .filter((c) => c.inicio < fim && c.fim > turno.inicio)
        .map((c) => {
          const ini = Math.max(c.inicio, turno.inicio)
          const f = Math.min(c.fim, fim)
          const a = aggregate(bucketsNaJanela(centroId, ini, f, nowMs))
          const emCurso = corridaAtual?.corrida_id === c.corrida_id && f >= nowMs - 60_000
          return {
            corrida_id: c.corrida_id,
            ordem_codigo: c.ordem_codigo,
            ordem_public_id: c.ordem_codigo,
            total_good_clipped: a.good,
            clip_ini_utc: iso(ini),
            clip_fim_utc: emCurso ? null : iso(f),
            em_curso: emCurso,
            elapsed_seg: Math.max(0, Math.round((f - ini) / 1000)),
            availability: a.availability,
            performance: a.performance,
          }
        })

      return {
        turno_id: `turno-${turno.index}`,
        turno_nome: turno.nome,
        inicio_utc: iso(turno.inicio),
        fim_utc: iso(fim),
        turno_good: agg.good,
        availability: agg.availability,
        performance: agg.performance,
        quality: agg.quality,
        oee: agg.oee,
        corridas,
      }
    })

  return {
    centro_trabalho_id: centroId,
    ordem_anterior: anteriorCorrida
      ? {
          corrida_id: anteriorCorrida.corrida_id,
          ordem_codigo: anteriorCorrida.ordem_codigo,
          ordem_public_id: anteriorCorrida.ordem_codigo,
          total_good: aggAnterior?.good ?? 0,
          fim_utc: iso(anteriorCorrida.fim),
        }
      : null,
    historico_turnos,
  }
}

// ─── Ciclo instantâneo ───────────────────────────────────────────────────────

export function cicloInstantaneo(centroId: string, nowMs = demoNow()) {
  const buckets = bucketsDoDia(centroId, operationalDayIndex(nowMs), nowMs)
  const ultimo = buckets[buckets.length - 1]
  const corrida = corridaEm(centroId, nowMs)
  const janela = buckets.slice(-3)
  const aggJanela = aggregate(janela)

  return {
    centro_trabalho_id: centroId,
    corrida_id: corrida?.corrida_id ?? null,
    ciclo_instantaneo_seg:
      ultimo && ultimo.total > 0 ? Math.round((ultimo.run_time_seg / ultimo.total) * 10) / 10 : null,
    ciclo_medio_janela_seg:
      aggJanela.total > 0 ? Math.round((aggJanela.run_time_seg / aggJanela.total) * 10) / 10 : null,
    updated_at_utc: iso(nowMs),
  }
}

// ─── Perdas por minuto (linha do tempo de paradas) ───────────────────────────

export function perdasPorMinuto(centroId: string, from: number, to: number, nowMs = demoNow()) {
  const paradas = paradasView(centroId, from, to, nowMs)
  const porMinuto = new Map<string, { grupo: string | null; minutos: number; ocorrencias: number }>()

  for (const p of paradas) {
    const motivo = MOTIVOS_BY_ID.get(p.motivo_id)
    const ini = Math.max(p.inicio, from)
    const fim = Math.min(p.fim_efetivo ?? nowMs, Math.min(to, nowMs))
    for (let t = Math.floor(ini / 60_000) * 60_000; t < fim; t += 60_000) {
      const key = `${t}|${motivo?.grupo_perda ?? ""}`
      const cur = porMinuto.get(key) ?? { grupo: motivo?.grupo_perda ?? null, minutos: 0, ocorrencias: 0 }
      cur.minutos += Math.min(1, overlapSeconds(t, t + 60_000, ini, fim) / 60)
      cur.ocorrencias = 1
      porMinuto.set(key, cur)
    }
  }

  return Array.from(porMinuto.entries())
    .map(([key, v]) => ({
      minute_utc: iso(Number(key.split("|")[0])),
      grupo_perda: v.grupo,
      perda_minutos: Math.round(v.minutos * 100) / 100,
      ocorrencias: v.ocorrencias,
    }))
    .sort((a, b) => a.minute_utc.localeCompare(b.minute_utc))
}

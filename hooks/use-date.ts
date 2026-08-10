"use client"

// =====================================================
// LIVEMES - Hooks para Dados
// =====================================================
// Hooks usando SWR para cache e revalidação automática
// =====================================================

import useSWR from "swr"
import type {
  CentroTrabalho,
  OrdemProducao,
  PlanoAcao,
  Anotacao,
  MotivoParada,
  Turno,
  GrupoCentroTrabalho,
  Produto,
  Usuario,
  PlanoMelhoria,
  Parada,
  DashboardStats,
  ProducaoPorHora,
  ProducaoPorDia,
  PerdasConsolidadas,
  ParadaReportada,
  OEEHora,
  OEEDia,
} from "@/lib/database/types"

// =====================================================
// FETCHER PARA SWR
// =====================================================

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) {
    throw new Error("Erro ao buscar dados")
  }
  return res.json()
}

// =====================================================
// HOOKS DE DADOS ESTÁTICOS
// =====================================================

export function useCentrosTrabalho() {
  const { data, error, isLoading, mutate } = useSWR<CentroTrabalho[]>(
    "/api/centros-trabalho",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 30000, // 30 segundos
    }
  )

  return {
    centrosTrabalho: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function useGruposCentroTrabalho() {
  const { data, error, isLoading } = useSWR<GrupoCentroTrabalho[]>(
    "/api/grupos",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minuto
    }
  )

  return {
    grupos: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useTurnos() {
  const { data, error, isLoading } = useSWR<Turno[]>(
    "/api/turnos",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  return {
    turnos: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useProdutos() {
  const { data, error, isLoading } = useSWR<Produto[]>(
    "/api/produtos",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  return {
    produtos: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useMotivosParada() {
  const { data, error, isLoading } = useSWR<MotivoParada[]>(
    "/api/motivos-parada",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  return {
    motivos: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useUsuarios() {
  const { data, error, isLoading } = useSWR<Usuario[]>(
    "/api/usuarios",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  return {
    usuarios: data || [],
    isLoading,
    isError: !!error,
  }
}

// =====================================================
// HOOKS DE DADOS DINÂMICOS
// =====================================================

export function useDashboardStats() {
  const { data, error, isLoading, mutate } = useSWR<DashboardStats>(
    "/api/dashboard/stats",
    fetcher,
    {
      refreshInterval: 30000, // Atualiza a cada 30 segundos
      revalidateOnFocus: true,
    }
  )

  return {
    stats: data,
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function useOrdens(estado?: OrdemProducao["estado"]) {
  const url = estado ? `/api/ordens?estado=${estado}` : "/api/ordens"
  
  const { data, error, isLoading, mutate } = useSWR<OrdemProducao[]>(
    url,
    fetcher,
    {
      refreshInterval: 60000, // 1 minuto
      revalidateOnFocus: true,
    }
  )

  return {
    ordens: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function useOrdensByCentroTrabalho(centroTrabalhoId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<OrdemProducao[]>(
    centroTrabalhoId ? `/api/centros-trabalho/${centroTrabalhoId}/ordens` : null,
    fetcher,
    {
      refreshInterval: 30000,
    }
  )

  return {
    ordens: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function useParadasAtivas() {
  const { data, error, isLoading, mutate } = useSWR<Parada[]>(
    "/api/paradas/ativas",
    fetcher,
    {
      refreshInterval: 15000, // 15 segundos
      revalidateOnFocus: true,
    }
  )

  return {
    paradas: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function useParadasNaoJustificadas(page: number = 1, limit: number = 25) {
  const { data, error, isLoading, mutate } = useSWR<{
    data: Parada[]
    total: number
    totalPages: number
  }>(
    `/api/paradas/nao-justificadas?page=${page}&limit=${limit}`,
    fetcher,
    {
      refreshInterval: 30000,
    }
  )

  return {
    paradas: data?.data || [],
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function usePlanosAcao(dataInicio?: string, dataFim?: string) {
  const params = new URLSearchParams()
  if (dataInicio) params.set("dataInicio", dataInicio)
  if (dataFim) params.set("dataFim", dataFim)
  
  const url = `/api/planos-acao${params.toString() ? `?${params}` : ""}`

  const { data, error, isLoading, mutate } = useSWR<PlanoAcao[]>(
    url,
    fetcher,
    {
      revalidateOnFocus: true,
    }
  )

  return {
    planosAcao: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function useAnotacoes(dataInicio?: string, dataFim?: string) {
  const params = new URLSearchParams()
  if (dataInicio) params.set("dataInicio", dataInicio)
  if (dataFim) params.set("dataFim", dataFim)
  
  const url = `/api/anotacoes${params.toString() ? `?${params}` : ""}`

  const { data, error, isLoading, mutate } = useSWR<Anotacao[]>(
    url,
    fetcher,
    {
      revalidateOnFocus: true,
    }
  )

  return {
    anotacoes: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

export function usePlanosMelhoria() {
  const { data, error, isLoading, mutate } = useSWR<PlanoMelhoria[]>(
    "/api/planos-melhoria",
    fetcher,
    {
      revalidateOnFocus: true,
    }
  )

  return {
    planosMelhoria: data || [],
    isLoading,
    isError: !!error,
    mutate,
  }
}

// =====================================================
// HOOKS DE RELATÓRIOS
// =====================================================

interface RelatorioParams {
  centroTrabalhoIds?: string[]
  dataInicio: string
  dataFim: string
}

export function useProducaoPorHora(params: RelatorioParams | null) {
  const url = params
    ? `/api/relatorios/producao-hora?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
      })}`
    : null

  const { data, error, isLoading } = useSWR<ProducaoPorHora[]>(url, fetcher)

  return {
    producao: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useProducaoPorDia(params: RelatorioParams | null) {
  const url = params
    ? `/api/relatorios/producao-dia?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
      })}`
    : null

  const { data, error, isLoading } = useSWR<ProducaoPorDia[]>(url, fetcher)

  return {
    producao: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useOEEPorHora(params: RelatorioParams | null) {
  const url = params
    ? `/api/relatorios/oee-hora?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
      })}`
    : null

  const { data, error, isLoading } = useSWR<OEEHora[]>(url, fetcher)

  return {
    oee: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useOEEPorDia(params: RelatorioParams | null) {
  const url = params
    ? `/api/relatorios/oee-dia?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
      })}`
    : null

  const { data, error, isLoading } = useSWR<OEEDia[]>(url, fetcher)

  return {
    oee: data || [],
    isLoading,
    isError: !!error,
  }
}

export function usePerdasConsolidadas(params: RelatorioParams | null) {
  const url = params
    ? `/api/relatorios/perdas?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
      })}`
    : null

  const { data, error, isLoading } = useSWR<PerdasConsolidadas[]>(url, fetcher)

  return {
    perdas: data || [],
    isLoading,
    isError: !!error,
  }
}

export function useParadasReportadas(
  params: RelatorioParams | null,
  page: number = 1,
  limit: number = 25
) {
  const url = params
    ? `/api/relatorios/paradas-reportadas?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
        page: page.toString(),
        limit: limit.toString(),
      })}`
    : null

  const { data, error, isLoading } = useSWR<ParadaReportada[]>(url, fetcher)

  return {
    paradas: data || [],
    isLoading,
    isError: !!error,
  }
}

// =====================================================
// HOOK PARA CENTRO DE TRABALHO INDIVIDUAL
// =====================================================

export function useCentroTrabalho(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CentroTrabalho>(
    id ? `/api/centros-trabalho/${id}` : null,
    fetcher,
    {
      refreshInterval: 10000, // 10 segundos para dados em tempo real
    }
  )

  return {
    centroTrabalho: data,
    isLoading,
    isError: !!error,
    mutate,
  }
}

// =====================================================
// HOOK PARA OEE CONSOLIDADO
// =====================================================

export function useOEEConsolidado(params: RelatorioParams | null) {
  const url = params
    ? `/api/relatorios/oee-consolidado?${new URLSearchParams({
        centrosTrabalho: params.centroTrabalhoIds?.join(",") || "",
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
      })}`
    : null

  const { data, error, isLoading } = useSWR<{
    oee: number
    disponibilidade: number
    performance: number
    qualidade: number
    producao_total: number
  }>(url, fetcher)

  return {
    oee: data,
    isLoading,
    isError: !!error,
  }
}

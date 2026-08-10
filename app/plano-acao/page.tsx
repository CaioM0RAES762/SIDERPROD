"use client"
// app/plano-acao/page.tsx

import { useMemo, useRef, useState } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import {
  Plus,
  Calendar,
  X,
  Filter,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Copy,
  Loader2,
  AlertCircle,
  Trash2,
  RefreshCw,
  Eye,
  Pencil,
  Save,
  Download,
  FileText, // Novo ícone para fallback de arquivo
} from "lucide-react"
import {
  usePlanosAcao,
  useCentrosTrabalhoBase,
  useUsuarios,
  useAnexos,
  apiCreate,
  apiDelete,
  apiUpdate,
  apiUploadAnexos,
  apiDeleteAnexo,
  type PlanoAcao,
  type ApiCentroTrabalhoBase,
  type Usuario,
} from "@/hooks/notes/use-api"

const API_BASE = "/api/db"

const ESTADOS = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" },
  { value: "atrasado", label: "Atrasado" },
] as const

type EstadoValue = (typeof ESTADOS)[number]["value"]
type ModalMode = "create" | "view" | "edit"

interface FormState {
  o_que: string
  como: string
  por_que: string
  onde: string
  estado: EstadoValue
  quem: string
  quando: string
  observacoes: string
}

const FORM_INITIAL: FormState = {
  o_que: "",
  como: "",
  por_que: "",
  onde: "",
  estado: "pendente",
  quem: "",
  quando: "",
  observacoes: "",
}

// ---- Funções Auxiliares ----
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function toDateTimeLocalInput(iso?: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

function formatDate(v?: string | Date | null): string {
  if (!v) return "-"
  const d = typeof v === "string" ? new Date(v) : v
  if (!Number.isFinite(d.getTime())) return "-"
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

function getEstadoColor(e: string): string {
  return e === "pendente" ? "bg-amber-100 text-amber-700"
    : e === "em_andamento" ? "bg-sky-100 text-sky-700"
      : e === "concluido" ? "bg-emerald-100 text-emerald-700"
        : e === "cancelado" ? "bg-slate-100 text-slate-600"
          : "bg-rose-100 text-rose-700"
}

function getEstadoLabel(e: string): string {
  return ESTADOS.find((x) => x.value === e)?.label ?? e
}

function escapeCsvCell(v: any): string {
  const s = String(v ?? "")
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.position = "fixed"
  ta.style.left = "-9999px"
  document.body.appendChild(ta)
  ta.select()
  document.execCommand("copy")
  document.body.removeChild(ta)
}

type Attachment = { id: string; file: File }
function uid(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }

export default function PlanoAcaoPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [sortColumn, setSortColumn] = useState<keyof PlanoAcao>("quando")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const [localError, setLocalError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [showFilters, setShowFilters] = useState(false)
  const [filterEstado, setFilterEstado] = useState<string>("")
  const [filterCentro, setFilterCentro] = useState<string>("")

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>("create")
  const [selectedPlan, setSelectedPlan] = useState<PlanoAcao | null>(null)

  const [form, setForm] = useState<FormState>(FORM_INITIAL)
  const [showOndeDD, setShowOndeDD] = useState(false)
  const [showEstadoDD, setShowEstadoDD] = useState(false)
  const [showQuemDD, setShowQuemDD] = useState(false)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDownloading, setIsDownloading] = useState<string | null>(null)

  // ---- Estados do Visualizador de Arquivos ----
  const [isPreviewLoading, setIsPreviewLoading] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: string; anexoId: string } | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [dateRange, setDateRange] = useState(() => {
    const now = new Date()
    return {
      start: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }
  })

  // Chamadas à API
  const planosRes = usePlanosAcao()
  const centrosRes = useCentrosTrabalhoBase()
  const usuariosRes = useUsuarios()
  const anexosRes = useAnexos("plano_acao", selectedPlan?.id || null)

  const plans = (planosRes.data ?? []) as PlanoAcao[]
  const centros = (centrosRes.data ?? []) as ApiCentroTrabalhoBase[]
  const usuarios = (usuariosRes.data ?? []) as Usuario[]
  const anexosSalvos = anexosRes.data || []

  const selectedCentroNome = useMemo(() => {
    if (!form.onde) return ""
    const c = centros.find((x) => String(x.id) === form.onde)
    return c?.nome ?? c?.codigo ?? ""
  }, [centros, form.onde])

  const selectedUsuarioNome = useMemo(() => {
    if (!form.quem) return ""
    const u = usuarios.find((x) => String(x.id) === form.quem)
    return u?.nome ?? ""
  }, [usuarios, form.quem])

  const displayError =
    localError ??
    (planosRes.error instanceof Error ? planosRes.error.message : null) ??
    (centrosRes.error instanceof Error ? centrosRes.error.message : null) ??
    (usuariosRes.error instanceof Error ? usuariosRes.error.message : null)

  const handleSort = (col: keyof PlanoAcao) => {
    if (sortColumn === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortColumn(col); setSortDir("asc") }
  }

  const filteredPlans = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const startMs = dateRange.start ? new Date(`${dateRange.start}T00:00:00`).getTime() : null
    const endMs = dateRange.end ? new Date(`${dateRange.end}T23:59:59`).getTime() : null
    const estadoFilter = filterEstado.trim()
    const centroFilter = filterCentro.trim()

    return plans
      .filter((p) => {
        if (!term) return true
        return ((p.o_que ?? "").toLowerCase().includes(term) || (p.onde_nome ?? "").toLowerCase().includes(term) || (p.quem_nome ?? "").toLowerCase().includes(term))
      })
      .filter((p) => {
        if (!startMs && !endMs) return true
        const t = p.quando ? new Date(p.quando).getTime() : NaN
        if (!Number.isFinite(t)) return false
        if (startMs && t < startMs) return false
        if (endMs && t > endMs) return false
        return true
      })
      .filter((p) => (!estadoFilter ? true : String(p.estado) === estadoFilter))
      .filter((p) => {
        if (!centroFilter) return true
        const ct = centros.find((x) => String(x.id) === centroFilter)
        return (p.onde_nome ?? "").toLowerCase() === (ct?.nome ?? ct?.codigo ?? "").toLowerCase()
      })
      .sort((a, b) => {
        let av: any = (a as any)[sortColumn]
        let bv: any = (b as any)[sortColumn]
        if (sortColumn === "quando" || sortColumn === "created_at" || sortColumn === "updated_at") {
          av = av ? new Date(av).getTime() : 0
          bv = bv ? new Date(bv).getTime() : 0
        } else {
          av = typeof av === "string" ? av.toLowerCase() : av ?? ""
          bv = typeof bv === "string" ? bv.toLowerCase() : bv ?? ""
        }
        return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
      })
  }, [plans, searchTerm, dateRange, sortColumn, sortDir, filterEstado, filterCentro, centros])

  function resetForm() {
    setForm(FORM_INITIAL)
    setShowOndeDD(false); setShowEstadoDD(false); setShowQuemDD(false); setLocalError(null); setAttachments([])
  }

  function openCreateModal() {
    setSelectedPlan(null); setModalMode("create"); resetForm(); setModalOpen(true)
  }

  function openViewModal(p: PlanoAcao) {
    setSelectedPlan(p); setModalMode("view"); setLocalError(null); setAttachments([])
    const matchedCentro = centros.find((c) => (c.nome ?? c.codigo ?? "").toLowerCase() === (p.onde_nome ?? "").toLowerCase()) ?? null
    const matchedUser = usuarios.find((u) => u.nome === (p.quem_nome ?? "")) ?? null

    setForm({
      o_que: p.o_que ?? "", como: p.como ?? "", por_que: p.por_que ?? "",
      onde: matchedCentro ? String(matchedCentro.id) : "",
      estado: (ESTADOS.find((e) => e.value === (p.estado as any))?.value ?? "pendente") as EstadoValue,
      quem: matchedUser ? String(matchedUser.id) : "",
      quando: toDateTimeLocalInput(p.quando),
      observacoes: p.observacoes ?? "",
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false); setSelectedPlan(null); setModalMode("create"); resetForm()
  }

  async function handleRefresh() {
    setRefreshing(true); setLocalError(null)
    try {
      await planosRes.mutate()
      setToast("Lista atualizada."); setTimeout(() => setToast(null), 2000)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Erro ao atualizar.")
    } finally { setRefreshing(false) }
  }

  async function handleCopyCsv() {
    const header = ["Quando", "Onde", "O que", "Estado", "Quem", "Criado em"]
    const rows = filteredPlans.map((p) => [
      formatDate(p.quando), p.onde_nome ?? "", p.o_que ?? "", getEstadoLabel(p.estado), p.quem_nome ?? "", formatDate(p.created_at),
    ])
    const csv = header.map(escapeCsvCell).join(",") + "\n" + rows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")
    try {
      await copyTextToClipboard(csv)
      setToast("CSV copiado."); setTimeout(() => setToast(null), 2200)
    } catch { setLocalError("Não foi possível copiar.") }
  }

  function onPickFiles() { fileInputRef.current?.click() }

  function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return
    const next: Attachment[] = []
    for (const f of Array.from(files)) { next.push({ id: uid(), file: f }) }
    setAttachments((prev) => [...prev, ...next])
  }

  function removeAttachment(id: string) { setAttachments((prev) => prev.filter((a) => a.id !== id)) }

  async function uploadAttachments(planoAcaoId: string, files: File[]) {
    if (!files.length) return
    try { await apiUploadAnexos("plano_acao", planoAcaoId, files) }
    catch (e: any) { throw new Error(e.message || "Falha ao enviar anexos.") }
  }

  // ---- FETCH DO ARQUIVO GENÉRICO (Usado tanto no Download quanto no View) ----
  async function fetchAnexoData(anexoId: string) {
    const res = await fetch(`/api/db/anexos?anexo_id=${anexoId}`)
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.error || "Erro ao buscar dados do anexo.")
    return json.data
  }

  async function buildAnexoBlobUrl(anexoData: any) {
    if (anexoData.file_url) return { url: anexoData.file_url, isUrl: true }
    const binario = anexoData.file_data_base64 || anexoData.file_data
    if (!binario) throw new Error("Conteúdo do arquivo não encontrado no banco de dados.")

    let blob: Blob
    const mimeType = anexoData.content_type || 'application/octet-stream'

    if (typeof binario === 'object' && binario.type === 'Buffer') {
      const bytes = new Uint8Array(binario.data)
      blob = new Blob([bytes], { type: mimeType })
    } else {
      const resBase64 = await fetch(`data:${mimeType};base64,${binario}`)
      blob = await resBase64.blob()
    }
    return { url: URL.createObjectURL(blob), isUrl: false }
  }

  // ---- Ação: Baixar Anexo ----
  async function handleDownloadSavedAnexo(anexoId: string, fileName: string) {
    setIsDownloading(anexoId)
    try {
      const anexoData = await fetchAnexoData(anexoId)
      if (anexoData.file_url) {
        window.open(anexoData.file_url, "_blank")
        return
      }
      const { url } = await buildAnexoBlobUrl(anexoData)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName || "download"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setLocalError(e.message || "Erro ao fazer download do anexo.")
    } finally {
      setIsDownloading(null)
    }
  }

  // ---- Ação: Visualizar Anexo (Modal Fundo Desfocado) ----
  async function handlePreviewAnexo(anexoId: string, fileName: string) {
    setIsPreviewLoading(anexoId)
    try {
      const anexoData = await fetchAnexoData(anexoId)
      const { url } = await buildAnexoBlobUrl(anexoData)

      setPreviewFile({
        url,
        name: fileName,
        type: anexoData.content_type || '',
        anexoId: anexoId
      })
    } catch (e: any) {
      setLocalError(e.message || "Erro ao carregar visualização.")
    } finally {
      setIsPreviewLoading(null)
    }
  }

  function closePreview() {
    if (previewFile && previewFile.url.startsWith('blob:')) {
      URL.revokeObjectURL(previewFile.url) // Limpa a memória
    }
    setPreviewFile(null)
  }

  async function handleDeleteSavedAnexo(anexoId: string) {
    if (!confirm("Tem certeza que deseja excluir este anexo permanentemente?")) return
    try {
      await apiDeleteAnexo(anexoId)
      await anexosRes.mutate()
      setToast("Anexo excluído."); setTimeout(() => setToast(null), 2000)
    } catch (e: any) { setLocalError(e.message || "Erro ao excluir anexo.") }
  }

  function validateCreate() {
    if (!form.o_que.trim()) return "O campo 'O que' é obrigatório."
    if (!form.onde) return "Selecione o 'Onde' (centro de trabalho)."
    if (!form.por_que.trim()) return "O campo 'Por que' é obrigatório."
    if (!form.quando) return "O campo 'Quando' é obrigatório."
    return null
  }

  async function handleSave() {
    setLocalError(null)
    const isCreate = modalMode === "create"
    const isEdit = modalMode === "edit"

    if (isCreate) {
      const err = validateCreate()
      if (err) { setLocalError(err); return }
    }

    if (isEdit && !selectedPlan?.id) { setLocalError("Plano selecionado inválido para edição."); return }

    setSaving(true)
    try {
      if (isCreate) {
        const created = await apiCreate("planos-acao", {
          centro_trabalho_id: form.onde, o_que: form.o_que.trim(), como: form.como.trim() || null,
          por_que: form.por_que.trim() || null, responsavel_id: form.quem || null, quando: new Date(form.quando).toISOString(),
          estado: form.estado, observacoes: form.observacoes.trim() || null,
        })
        const createdId = created?.id ?? created?.plano_acao_id ?? created?.data?.id ?? created?.data?.plano_acao_id

        if (!createdId) { setToast("Plano criado, erro ao identificar ID."); setTimeout(() => setToast(null), 2500) }
        else if (attachments.length) {
          try { await uploadAttachments(String(createdId), attachments.map((a) => a.file)); setToast("Plano salvo com anexos."); setTimeout(() => setToast(null), 2500) }
          catch (e: any) { setToast(`Plano salvo. Erro anexos: ${e.message}`); setTimeout(() => setToast(null), 4000) }
        } else { setToast("Plano salvo."); setTimeout(() => setToast(null), 2000) }

        await planosRes.mutate(); closeModal(); return
      }

      if (isEdit && selectedPlan?.id) {
        await apiUpdate("planos-acao", {
          plano_acao_id: selectedPlan.id, estado: form.estado, o_que: form.o_que.trim() || null,
          como: form.como.trim() || null, por_que: form.por_que.trim() || null, quando: form.quando ? new Date(form.quando).toISOString() : null,
          observacoes: form.observacoes.trim() || null,
        })

        if (attachments.length) {
          try { await uploadAttachments(String(selectedPlan.id), attachments.map((a) => a.file)); setToast("Alterações salvas com anexos."); setTimeout(() => setToast(null), 2500) }
          catch (e: any) { setToast(`Alterações salvas. Erro anexos: ${e.message}`); setTimeout(() => setToast(null), 4000) }
        } else { setToast("Alterações salvas."); setTimeout(() => setToast(null), 2000) }

        await planosRes.mutate(); await anexosRes.mutate(); setModalMode("view"); setAttachments([]); return
      }
    } catch (err) { setLocalError(err instanceof Error ? err.message : "Erro ao salvar."); } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm("Tem certeza que deseja excluir este plano de ação?")) return
    setDeletingId(id); setLocalError(null)
    try { await apiDelete("planos-acao", id); await planosRes.mutate(); setToast("Plano excluído."); setTimeout(() => setToast(null), 2000) }
    catch (err) { setLocalError(err instanceof Error ? err.message : "Erro ao excluir.") }
    finally { setDeletingId(null) }
  }

  const modalTitle = modalMode === "create" ? "Adicionar plano de ação" : modalMode === "edit" ? "Editar plano de ação" : "Detalhes do plano"
  const isView = modalMode === "view"
  const isEdit = modalMode === "edit"
  const isCreate = modalMode === "create"

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-h-screen">
        <Header onMenuClick={() => setSidebarOpen(true)} title="Plano de Ação" />

        <div className="p-4 lg:p-6">
          {!!toast && (
            <div className="mb-4 p-3 bg-slate-900 text-white rounded-xl text-sm flex items-center gap-2">
              <span className="flex-1">{toast}</span>
              <button className="p-1 rounded hover:bg-white/10" onClick={() => setToast(null)} type="button"><X className="w-4 h-4" /></button>
            </div>
          )}

          {displayError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{displayError}</span>
              <button type="button" onClick={() => setLocalError(null)} className="ml-auto hover:bg-red-100 p-1 rounded"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* Top controls */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <button type="button" onClick={openCreateModal} className="px-4 py-2.5 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Adicionar plano de ação</span><span className="sm:hidden">Adicionar</span>
              </button>

              <div className="flex items-center gap-2">
                <input type="date" value={dateRange.start} onChange={(e) => setDateRange((r) => ({ ...r, start: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <span className="text-slate-500">-</span>
                <input type="date" value={dateRange.end} onChange={(e) => setDateRange((r) => ({ ...r, end: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>

              <div className="flex-1" />

              <button type="button" onClick={() => setShowFilters((v) => !v)} className={`p-2 rounded-lg transition-colors ${showFilters ? "bg-slate-100 text-slate-700" : "hover:bg-slate-100 text-slate-500"}`} title="Filtros">
                <Filter className="w-5 h-5" />
              </button>

              <button type="button" onClick={handleRefresh} disabled={refreshing} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-50" title="Atualizar">
                <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>

            {showFilters && (
              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Estado</label>
                  <select value={filterEstado} onChange={(e) => setFilterEstado(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                    <option value="">Todos</option>
                    {ESTADOS.map((e) => (<option key={e.value} value={e.value}>{e.label}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Centro de trabalho</label>
                  <select value={filterCentro} onChange={(e) => setFilterCentro(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" disabled={centrosRes.isLoading}>
                    <option value="">Todos</option>
                    {centros.map((ct) => (<option key={ct.id} value={ct.id}>{ct.nome ?? ct.codigo ?? ct.id}</option>))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => { setFilterEstado(""); setFilterCentro(""); setSearchTerm(""); }} className="px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Limpar</button>
                </div>
              </div>
            )}

            <div className="mt-4 relative">
              <input type="text" placeholder="Procurar" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
              {searchTerm && (<button type="button" onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>)}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-end gap-2 p-3 border-b border-slate-200">
              <button type="button" onClick={handleCopyCsv} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500" title="Copiar CSV"><Copy className="w-4 h-4" /></button>
            </div>

            {planosRes.isLoading ? (
              <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {([
                        { key: "quando", label: "Quando" }, { key: "onde_nome", label: "Onde" }, { key: "o_que", label: "O que" },
                        { key: "estado", label: "Estado" }, { key: "quem_nome", label: "Quem" }, { key: "created_at", label: "Criado em" },
                      ] as const).map((col) => (
                        <th key={col.key} onClick={() => handleSort(col.key as keyof PlanoAcao)} className="px-4 py-3 text-left text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors">
                          <div className="flex items-center gap-1">{col.label}
                            <div className="flex flex-col">
                              <ChevronUp className={`w-3 h-3 -mb-1 ${sortColumn === col.key && sortDir === "asc" ? "text-slate-800" : "text-slate-400"}`} />
                              <ChevronDown className={`w-3 h-3 ${sortColumn === col.key && sortDir === "desc" ? "text-slate-800" : "text-slate-400"}`} />
                            </div>
                          </div>
                        </th>
                      ))}
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-600 w-24">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlans.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-500"><AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-400" />Nenhum plano encontrado</td></tr>
                    ) : (
                      filteredPlans.map((p) => (
                        <tr key={p.id} onClick={() => openViewModal(p)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                          <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{formatDate(p.quando)}</td>
                          <td className="px-4 py-3 text-sm text-slate-700">{p.onde_nome ?? "-"}</td>
                          <td className="px-4 py-3 text-sm text-slate-700 max-w-xs truncate">{p.o_que}</td>
                          <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${getEstadoColor(p.estado)}`}>{getEstadoLabel(p.estado)}</span></td>
                          <td className="px-4 py-3 text-sm text-slate-700">{p.quem_nome ?? "-"}</td>
                          <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{formatDate(p.created_at)}</td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => openViewModal(p)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Visualizar"><Eye className="w-4 h-4" /></button>
                              <button type="button" onClick={() => handleDelete(p.id)} disabled={deletingId === p.id} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors disabled:opacity-50" title="Excluir">
                                {deletingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* MODAL PRINCIPAL (Criação/Edição) */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <h2 className="text-xl font-semibold text-slate-800 flex-1">{modalTitle}</h2>
                {modalMode === "view" && (
                  <button type="button" onClick={() => setModalMode("edit")} className="px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                    <Pencil className="w-4 h-4" /> Editar
                  </button>
                )}
                <button type="button" onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
              </div>

              {localError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{localError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-rose-600 mb-1">O que {isCreate ? "*" : ""}</label>
                  <input type="text" value={form.o_que} onChange={(e) => setForm((f) => ({ ...f, o_que: e.target.value }))} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Como</label>
                  <textarea value={form.como} onChange={(e) => setForm((f) => ({ ...f, como: e.target.value }))} rows={3} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-rose-600 mb-1">Por que {isCreate ? "*" : ""}</label>
                  <textarea value={form.por_que} onChange={(e) => setForm((f) => ({ ...f, por_que: e.target.value }))} rows={3} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none disabled:bg-slate-50" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="block text-sm font-medium text-rose-600 mb-1">Onde {isCreate ? "*" : ""}</label>
                    <button type="button" onClick={() => !isView && setShowOndeDD((v) => !v)} disabled={centrosRes.isLoading || isView} className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm hover:border-slate-400 transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed">
                      <span className={form.onde ? "text-slate-800" : "text-slate-400"}>{centrosRes.isLoading ? "Carregando..." : selectedCentroNome || (selectedPlan?.onde_nome ?? "Selecione")}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                    {showOndeDD && !centrosRes.isLoading && !isView && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                        {centros.map((ct) => (<button key={ct.id} type="button" onClick={() => { setForm((f) => ({ ...f, onde: String(ct.id) })); setShowOndeDD(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{ct.nome ?? ct.codigo ?? ct.id}</button>))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <label className="block text-sm font-medium text-rose-600 mb-1">Estado *</label>
                    <button type="button" onClick={() => !isView && setShowEstadoDD((v) => !v)} disabled={isView} className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm hover:border-slate-400 transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed">
                      <span className="text-slate-800">{getEstadoLabel(form.estado)}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                    {showEstadoDD && !isView && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
                        {ESTADOS.map((e) => (<button key={e.value} type="button" onClick={() => { setForm((f) => ({ ...f, estado: e.value })); setShowEstadoDD(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{e.label}</button>))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="block text-sm font-medium text-rose-600 mb-1">Quem {isCreate ? "*" : ""}</label>
                    <button type="button" onClick={() => !isView && setShowQuemDD((v) => !v)} disabled={usuariosRes.isLoading || isView} className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm hover:border-slate-400 transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed">
                      <span className={form.quem ? "text-slate-800" : "text-slate-400"}>{usuariosRes.isLoading ? "Carregando..." : selectedUsuarioNome || (selectedPlan?.quem_nome ?? "Selecione")}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                    {showQuemDD && !usuariosRes.isLoading && !isView && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                        {usuarios.map((u) => (<button key={u.id} type="button" onClick={() => { setForm((f) => ({ ...f, quem: String(u.id) })); setShowQuemDD(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{u.nome}</button>))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-rose-600 mb-1">Quando {isCreate ? "*" : ""}</label>
                    <input type="datetime-local" value={form.quando} onChange={(e) => setForm((f) => ({ ...f, quando: e.target.value }))} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-50" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
                  <textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={3} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none disabled:bg-slate-50" />
                </div>

                {/* Anexos */}
                <div className="pt-1">
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => onFilesSelected(e.target.files)} />
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700">Anexos</div>
                    <button type="button" onClick={onPickFiles} disabled={isView} className="flex items-center gap-2 text-slate-600 hover:text-slate-800 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed" title="Anexar arquivos">
                      <Paperclip className="w-4 h-4" /> Anexar
                    </button>
                  </div>

                  {attachments.length === 0 && anexosSalvos.length === 0 ? (
                    <div className="mt-2 text-sm text-slate-500">{anexosRes.isLoading ? "Carregando anexos..." : "Nenhum anexo salvo ou selecionado."}</div>
                  ) : (
                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden">
                      {/* Anexos Salvos */}
                      {anexosSalvos.map((anexoBanco) => (
                        <div key={anexoBanco.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 bg-slate-50">
                          <span className="text-sm text-slate-700 flex-1 truncate">
                            {anexoBanco.file_name} <span className="text-slate-400 ml-1">({Math.ceil((anexoBanco.file_size_bytes || 0) / 1024)} KB)</span>
                          </span>

                          <button
                            type="button"
                            onClick={() => handlePreviewAnexo(anexoBanco.id, anexoBanco.file_name)}
                            disabled={isPreviewLoading === anexoBanco.id}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 disabled:opacity-50"
                            title="Visualizar anexo"
                          >
                            {isPreviewLoading === anexoBanco.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadSavedAnexo(anexoBanco.id, anexoBanco.file_name)}
                            disabled={isDownloading === anexoBanco.id}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 disabled:opacity-50"
                            title="Baixar anexo"
                          >
                            {isDownloading === anexoBanco.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          </button>

                          {!isView && (
                            <button type="button" onClick={() => handleDeleteSavedAnexo(anexoBanco.id)} className="p-1.5 rounded hover:bg-rose-100 text-rose-500" title="Excluir do banco">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}

                      {/* Anexos Novos (Pendente de Salvar) */}
                      {attachments.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0">
                          <span className="text-sm text-slate-700 flex-1 truncate">
                            {a.file.name} <span className="text-slate-400">({Math.ceil(a.file.size / 1024)} KB)</span>
                            <span className="ml-2 text-xs text-amber-600 italic">Pendente envio</span>
                          </span>
                          {!isView && (
                            <button type="button" onClick={() => removeAttachment(a.id)} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="Remover">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-200">
                <button type="button" onClick={closeModal} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">
                  {isView ? "Fechar" : "Cancelar"}
                </button>
                <div className="flex items-center gap-2">
                  {modalMode === "view" && selectedPlan?.id && (
                    <button type="button" onClick={() => { setModalMode("edit"); setToast("Modo edição."); setTimeout(() => setToast(null), 1500) }} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <Pencil className="w-4 h-4" /> Editar
                    </button>
                  )}
                  {(modalMode === "create" || modalMode === "edit") && (
                    <button type="button" onClick={handleSave} disabled={saving || (modalMode === "create" && (!form.o_que.trim() || !form.onde || !form.por_que.trim() || !form.quando))} className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-2">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL VISUALIZADOR DE ARQUIVOS */}
      {previewFile && (
        <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

            {/* Header do Visualizador */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h3 className="font-medium text-slate-800 truncate pr-4">{previewFile.name}</h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleDownloadSavedAnexo(previewFile.anexoId, previewFile.name)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Baixar Arquivo</span>
                </button>
                <button onClick={closePreview} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg transition-colors" title="Fechar">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Corpo do Visualizador */}
            <div className="flex-1 bg-slate-100 flex items-center justify-center p-4 overflow-auto relative">

              {previewFile.type.startsWith("image/") ? (
                // Se for Imagem
                <img src={previewFile.url} alt={previewFile.name} className="max-w-full max-h-full object-contain rounded drop-shadow-sm" />

              ) : previewFile.type === "application/pdf" ? (
                // Se for PDF
                <iframe src={previewFile.url} className="w-full h-full rounded bg-white shadow-sm border border-slate-200" title={previewFile.name} />

              ) : (
                // Fallback para Excel, Word, etc. (O navegador não renderiza blob disso nativamente)
                <div className="flex flex-col items-center justify-center text-center max-w-sm">
                  <div className="w-20 h-20 bg-slate-200 text-slate-400 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                    <FileText className="w-10 h-10" />
                  </div>
                  <h4 className="text-lg font-semibold text-slate-800 mb-2">Visualização não suportada</h4>
                  <p className="text-slate-600 text-sm mb-6">
                    O seu navegador não suporta a pré-visualização direta de arquivos do tipo <span className="font-semibold text-slate-700">{previewFile.type || "Documento"}</span>.
                    Faça o download para abrir o arquivo em seu computador.
                  </p>
                  <button
                    onClick={() => handleDownloadSavedAnexo(previewFile.anexoId, previewFile.name)}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 transition-all shadow-sm hover:shadow active:scale-95"
                  >
                    <Download className="w-5 h-5" />
                    Baixar Agora
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  )
}
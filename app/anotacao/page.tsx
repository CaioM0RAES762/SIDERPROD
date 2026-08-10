"use client"
// app/anotacao/page.tsx

import { useMemo, useState, useRef } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import {
  Plus, Calendar, X, Filter, ChevronDown, ChevronUp,
  Paperclip, Printer, Trash2, Loader2, AlertCircle, Eye, Download, Pencil, Save,
  File as FileIcon, Image as ImageIcon, FileSpreadsheet, FileText
} from "lucide-react"
import {
  useAnotacoes, useCentrosTrabalhoBase, useAnexos, apiCreate, apiUpdate, apiDelete,
  apiUploadAnexos, apiDeleteAnexo,
  type Anotacao, type ApiCentroTrabalhoBase,
} from "@/hooks/notes/use-api"

type SortKey = "data_hora" | "centro_trabalho_nome" | "texto" | "usuario_nome"
type ModalMode = "create" | "view" | "edit"

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function toDateTimeLocalInput(d: Date | string | null): string {
  if (!d) return ""
  const date = typeof d === "string" ? new Date(d) : d
  if (!Number.isFinite(date.getTime())) return ""
  return `${toDateInput(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}
function parseDateMs(v?: string | null): number {
  if (!v) return 0; const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0
}
function formatDate(v?: string | null): string {
  if (!v) return "-"; const d = new Date(v); if (!Number.isFinite(d.getTime())) return "-"
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function getFileIcon(type: string = "", name: string = "") {
  const t = type.toLowerCase()
  const n = name.toLowerCase()
  if (t.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
  if (t.includes('spreadsheet') || t.includes('excel') || n.endsWith('.csv') || n.endsWith('.xlsx') || n.endsWith('.xls')) return <FileSpreadsheet className="w-4 h-4 text-emerald-500 flex-shrink-0" />
  if (t.includes('pdf') || t.includes('word') || t.includes('text') || n.endsWith('.doc') || n.endsWith('.docx') || n.endsWith('.txt')) return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
  return <FileIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
}

export default function AnotacaoPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Controle de Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>("create")
  const [selectedAnotacao, setSelectedAnotacao] = useState<Anotacao | null>(null)

  // Filtros
  const [searchTerm, setSearchTerm] = useState("")
  const [sortColumn, setSortColumn] = useState<SortKey>("data_hora")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [dateStart, setDateStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return toDateInput(d) })
  const [dateEnd, setDateEnd] = useState(() => toDateInput(new Date()))

  // Estados de Carregamento/Erros
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Formulário
  const [showCentroDD, setShowCentroDD] = useState(false)
  const [form, setForm] = useState({ centroId: "", data: toDateTimeLocalInput(new Date()), texto: "" })
  const [files, setFiles] = useState<{ id: string, file: File }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Visualizador
  const [isDownloading, setIsDownloading] = useState<string | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: string; anexoId: string } | null>(null)

  // API Hooks
  const anotacoesRes = useAnotacoes()
  const centrosRes = useCentrosTrabalhoBase()
  const anexosRes = useAnexos("anotacao", selectedAnotacao?.id || null)

  const anotacoes = (anotacoesRes.data ?? []) as Anotacao[]
  const centros = (centrosRes.data ?? []) as ApiCentroTrabalhoBase[]
  const anexosSalvos = anexosRes.data || []

  const handleSort = (col: SortKey) => {
    if (sortColumn === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortColumn(col); setSortDir("asc") }
  }

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const startMs = dateStart ? new Date(`${dateStart}T00:00:00`).getTime() : null
    const endMs = dateEnd ? new Date(`${dateEnd}T23:59:59`).getTime() : null
    return anotacoes
      .filter(a => !term || (a.texto ?? "").toLowerCase().includes(term) || (a.centro_trabalho_nome ?? "").toLowerCase().includes(term) || (a.usuario_nome ?? "").toLowerCase().includes(term))
      .filter(a => { const t = parseDateMs(a.data_hora); if (startMs && t < startMs) return false; if (endMs && t > endMs) return false; return true })
      .sort((a, b) => {
        let av: any = "", bv: any = ""
        if (sortColumn === "data_hora") { av = parseDateMs(a.data_hora); bv = parseDateMs(b.data_hora) }
        else if (sortColumn === "centro_trabalho_nome") { av = (a.centro_trabalho_nome ?? "").toLowerCase(); bv = (b.centro_trabalho_nome ?? "").toLowerCase() }
        else if (sortColumn === "texto") { av = (a.texto ?? "").toLowerCase(); bv = (b.texto ?? "").toLowerCase() }
        else { av = (a.usuario_nome ?? "").toLowerCase(); bv = (b.usuario_nome ?? "").toLowerCase() }
        return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
      })
  }, [anotacoes, searchTerm, dateStart, dateEnd, sortColumn, sortDir])

  const selectedCentroNome = useMemo(() => {
    if (!form.centroId) return ""
    const ct = centros.find(c => String(c.id) === form.centroId)
    return ct?.nome ?? ct?.codigo ?? ""
  }, [centros, form.centroId])

  const displayError = localError ?? (anotacoesRes.error instanceof Error ? anotacoesRes.error.message : null) ?? (centrosRes.error instanceof Error ? centrosRes.error.message : null)

  // Handlers do Modal
  function openCreateModal() {
    setSelectedAnotacao(null)
    setModalMode("create")
    setForm({ centroId: "", data: toDateTimeLocalInput(new Date()), texto: "" })
    setFiles([])
    setLocalError(null)
    setModalOpen(true)
  }

  function openViewModal(a: Anotacao) {
    setSelectedAnotacao(a)
    setModalMode("view")
    setForm({
      centroId: a.centro_trabalho_id ?? "",
      data: toDateTimeLocalInput(a.data_hora),
      texto: a.texto ?? ""
    })
    setFiles([])
    setLocalError(null)
    setModalOpen(true)
  }

  function handleCloseModal() {
    setModalOpen(false)
    setShowCentroDD(false)
    setSelectedAnotacao(null)
    setFiles([])
  }

  // Handlers de Arquivos Locais
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(f => ({ id: Math.random().toString(36).substr(2, 9), file: f }))
      setFiles(prev => [...prev, ...newFiles])
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }
  const handleRemoveFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id))

  async function uploadAttachments(anotacaoId: string, filesToUpload: File[]) {
    if (!filesToUpload.length) return
    try {
      await apiUploadAnexos("anotacao", anotacaoId, filesToUpload)
    } catch (e: any) {
      throw new Error(e.message || "Falha ao enviar anexos.")
    }
  }

  // Handlers do Anexo do Banco
  async function fetchAnexoData(anexoId: string) {
    const res = await fetch(`/api/db/anexos?anexo_id=${anexoId}`)
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.error || "Erro ao buscar dados.")
    return json.data
  }

  async function buildAnexoBlobUrl(anexoData: any) {
    if (anexoData.file_url) return { url: anexoData.file_url, isUrl: true }
    const binario = anexoData.file_data_base64 || anexoData.file_data
    if (!binario) throw new Error("Conteúdo vazio.")

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

  async function handleDownloadSavedAnexo(anexoId: string, fileName: string) {
    setIsDownloading(anexoId)
    try {
      const anexoData = await fetchAnexoData(anexoId)
      if (anexoData.file_url) { window.open(anexoData.file_url, "_blank"); return }
      const { url } = await buildAnexoBlobUrl(anexoData)
      const link = document.createElement('a')
      link.href = url; link.download = fileName || "download"
      document.body.appendChild(link); link.click(); document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (e: any) { setLocalError(e.message || "Erro no download.") }
    finally { setIsDownloading(null) }
  }

  async function handlePreviewAnexo(anexoId: string, fileName: string) {
    setIsPreviewLoading(anexoId)
    try {
      const anexoData = await fetchAnexoData(anexoId)
      const { url } = await buildAnexoBlobUrl(anexoData)
      setPreviewFile({ url, name: fileName, type: anexoData.content_type || '', anexoId })
    } catch (e: any) { setLocalError(e.message || "Erro na visualização.") }
    finally { setIsPreviewLoading(null) }
  }

  function closePreview() {
    if (previewFile && previewFile.url.startsWith('blob:')) URL.revokeObjectURL(previewFile.url)
    setPreviewFile(null)
  }

  async function handleDeleteSavedAnexo(anexoId: string) {
    if (!confirm("Tem certeza que deseja excluir este anexo permanentemente?")) return
    try {
      await apiDeleteAnexo(anexoId)
      await anexosRes.mutate()
      setToast("Anexo excluído."); setTimeout(() => setToast(null), 2000)
    } catch (e: any) { setLocalError(e.message) }
  }

  // Handlers CRUD
  const handleSave = async () => {
    if (!form.texto.trim()) { setLocalError("O texto é obrigatório."); return }
    setSaving(true); setLocalError(null)

    try {
      if (modalMode === "create") {
        const created: any = await apiCreate("anotacoes", {
          centro_trabalho_id: form.centroId || null, texto: form.texto.trim(), data_hora: new Date(form.data).toISOString()
        })
        const anotacaoId = created?.id || created?.data?.id
        if (!anotacaoId) throw new Error("Anotação criada, mas ID não encontrado.")
        if (files.length > 0) await uploadAttachments(String(anotacaoId), files.map(f => f.file))
        setToast("Anotação salva."); setTimeout(() => setToast(null), 2000)
        await anotacoesRes.mutate()
        handleCloseModal()
      } else if (modalMode === "edit" && selectedAnotacao?.id) {
        await apiUpdate("anotacoes", {
          anotacao_id: selectedAnotacao.id, centro_trabalho_id: form.centroId || null, texto: form.texto.trim(), data_hora: new Date(form.data).toISOString()
        })
        if (files.length > 0) await uploadAttachments(String(selectedAnotacao.id), files.map(f => f.file))
        setToast("Anotação atualizada."); setTimeout(() => setToast(null), 2000)
        await anotacoesRes.mutate()
        await anexosRes.mutate()
        setModalMode("view")
        setFiles([])
      }
    } catch (err: any) { setLocalError(err.message || "Erro ao salvar."); }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta anotação?")) return
    setDeletingId(id); setLocalError(null)
    try { await apiDelete("anotacoes", id); await anotacoesRes.mutate() }
    catch (err: any) { setLocalError(err.message) }
    finally { setDeletingId(null) }
  }

  const isView = modalMode === "view"
  const modalTitle = modalMode === "create" ? "Adicionar Anotação" : modalMode === "edit" ? "Editar Anotação" : "Detalhes da Anotação"

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-h-screen">
        <Header onMenuClick={() => setSidebarOpen(true)} title="Anotação" />
        <div className="p-4 lg:p-6">

          {!!toast && (
            <div className="mb-4 p-3 bg-slate-900 text-white rounded-xl text-sm flex items-center gap-2">
              <span className="flex-1">{toast}</span>
              <button className="p-1 hover:bg-white/10 rounded" onClick={() => setToast(null)}><X className="w-4 h-4" /></button>
            </div>
          )}

          {displayError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" /><span className="text-sm">{displayError}</span>
              <button type="button" onClick={() => setLocalError(null)} className="ml-auto hover:bg-red-100 p-1 rounded"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <button type="button" onClick={openCreateModal} className="px-4 py-2.5 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2">
                <Plus className="w-4 h-4" />Adicionar
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="text-sm text-slate-700 border-none outline-none bg-transparent" />
                </div>
                <span className="text-slate-400">até</span>
                <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="text-sm text-slate-700 border-none outline-none bg-transparent" />
                </div>
              </div>
              <div className="flex-1" />
              <button type="button" className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><Filter className="w-5 h-5" /></button>
            </div>
            <div className="mt-4 relative">
              <input type="text" placeholder="Procurar" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
              {searchTerm && <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-end gap-2 p-3 border-b border-slate-200">
              <button type="button" className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><Printer className="w-4 h-4" /></button>
            </div>
            {anotacoesRes.isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {([{ key: "data_hora", label: "Data" }, { key: "centro_trabalho_nome", label: "Centro de Trabalho" }, { key: "texto", label: "Texto da Anotação" }, { key: "usuario_nome", label: "Criado por" }, { key: "actions", label: "Ações" }] as const).map(col => (
                        <th key={col.key} onClick={() => col.key !== "actions" && handleSort(col.key as SortKey)} className={`px-4 py-3 text-left text-sm font-medium text-slate-600 transition-colors ${col.key !== "actions" ? "cursor-pointer hover:bg-slate-100" : ""}`}>
                          <div className="flex items-center gap-1">{col.label}
                            {col.key !== "actions" && <div className="flex flex-col">
                              <ChevronUp className={`w-3 h-3 -mb-1 ${sortColumn === col.key && sortDir === "asc" ? "text-slate-800" : "text-slate-400"}`} />
                              <ChevronDown className={`w-3 h-3 ${sortColumn === col.key && sortDir === "desc" ? "text-slate-800" : "text-slate-400"}`} />
                            </div>}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-14 text-center text-slate-500">Nenhuma anotação encontrada</td></tr>
                    ) : filtered.map(a => (
                      <tr key={a.id} onClick={() => openViewModal(a)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                        <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{formatDate(a.data_hora)}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{a.centro_trabalho_nome ?? "-"}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 max-w-xs truncate">{a.texto}</td>
                        <td className="px-4 py-3 text-sm text-slate-500">{a.usuario_nome ?? "-"}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button onClick={() => openViewModal(a)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg"><Eye className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(a.id)} disabled={deletingId === a.id} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50">
                              {deletingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-sm text-slate-500">{filtered.length} registro(s)</span>
              <button type="button" onClick={() => anotacoesRes.mutate()} className="px-3 py-1.5 border border-slate-300 rounded text-sm text-slate-600 hover:bg-slate-50">Atualizar</button>
            </div>
          </div>
        </div>
      </main>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="relative z-[101] bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
            <div className="p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-slate-800">{modalTitle}</h2>
                <div className="flex items-center gap-2">
                  {modalMode === "view" && (
                    <button type="button" onClick={() => setModalMode("edit")} className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <Pencil className="w-4 h-4" /> Editar
                    </button>
                  )}
                  <button onClick={handleCloseModal} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {localError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{localError}
                </div>
              )}

              <div className="space-y-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Centro de Trabalho</label>
                  <button type="button" onClick={() => !isView && setShowCentroDD(v => !v)} disabled={centrosRes.isLoading || isView} className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm hover:border-slate-400 disabled:bg-slate-50 disabled:cursor-not-allowed">
                    <span className={form.centroId ? "text-slate-800" : "text-slate-400"}>{centrosRes.isLoading ? "Carregando..." : selectedCentroNome || "Selecione (opcional)"}</span>
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </button>
                  {showCentroDD && !centrosRes.isLoading && !isView && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                      <button type="button" onClick={() => { setForm(f => ({ ...f, centroId: "" })); setShowCentroDD(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-500">Nenhum</button>
                      {centros.map(ct => (
                        <button key={ct.id} type="button" onClick={() => { setForm(f => ({ ...f, centroId: String(ct.id) })); setShowCentroDD(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{ct.nome ?? ct.codigo ?? ct.id}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-rose-600 mb-1">Data *</label>
                  <input type="datetime-local" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-rose-600 mb-1">Texto da Anotação *</label>
                  <textarea value={form.texto} onChange={e => setForm(f => ({ ...f, texto: e.target.value }))} rows={5} disabled={isView} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none disabled:bg-slate-50" />
                </div>

                {/* Anexos */}
                <div>
                  <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />

                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700">Anexos</div>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isView} className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                      <Paperclip className="w-4 h-4" /> Anexar
                    </button>
                  </div>

                  {files.length === 0 && anexosSalvos.length === 0 ? (
                    <div className="mt-2 text-sm text-slate-500">{anexosRes.isLoading ? "Carregando..." : "Nenhum anexo."}</div>
                  ) : (
                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                      {/* Salvos no Banco */}
                      {anexosSalvos.map((anexo) => (
                        <div key={anexo.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                          <div className="flex items-center gap-2 truncate text-slate-700 flex-1">
                            {getFileIcon(anexo.content_type || "", anexo.file_name)}
                            <span className="text-sm truncate">{anexo.file_name}</span>
                          </div>

                          <button onClick={() => handlePreviewAnexo(anexo.id, anexo.file_name)} disabled={isPreviewLoading === anexo.id} className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="Visualizar">
                            {isPreviewLoading === anexo.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                          </button>

                          <button onClick={() => handleDownloadSavedAnexo(anexo.id, anexo.file_name)} disabled={isDownloading === anexo.id} className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="Baixar">
                            {isDownloading === anexo.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          </button>

                          {!isView && (
                            <button onClick={() => handleDeleteSavedAnexo(anexo.id)} className="p-1.5 rounded hover:bg-rose-100 text-rose-500" title="Excluir">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}

                      {/* Novos (Pendente de Salvar) */}
                      {files.map((f) => (
                        <div key={f.id} className="flex items-center justify-between p-2 bg-white text-sm">
                          <div className="flex items-center gap-2 truncate text-slate-600">
                            {getFileIcon(f.file.type, f.file.name)}
                            <span className="truncate">{f.file.name}</span>
                            <span className="text-xs text-amber-600 italic px-1 bg-amber-50 rounded">Novo</span>
                          </div>
                          {!isView && (
                            <button onClick={() => handleRemoveFile(f.id)} className="text-slate-400 hover:text-red-500 p-1"><X className="w-4 h-4" /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              <div className="flex justify-between mt-6 pt-4 border-t border-slate-100">
                <button type="button" onClick={handleCloseModal} disabled={saving} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50">{isView ? "Fechar" : "Cancelar"}</button>
                {!isView && (
                  <button type="button" onClick={handleSave} disabled={saving || !form.texto.trim()} className="px-6 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Preview */}
      {previewFile && (
        <div className="fixed inset-0 z-[110] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="font-medium text-slate-800 truncate pr-4">{previewFile.name}</h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleDownloadSavedAnexo(previewFile.anexoId, previewFile.name)} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600">
                  <Download className="w-4 h-4" /> <span className="hidden sm:inline">Baixar</span>
                </button>
                <button onClick={closePreview} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 flex items-center justify-center p-4 overflow-auto">
              {previewFile.type.startsWith("image/") ? (
                <img src={previewFile.url} alt="Preview" className="max-w-full max-h-full object-contain rounded" />
              ) : previewFile.type === "application/pdf" ? (
                <iframe src={previewFile.url} className="w-full h-full rounded border border-slate-200" title="PDF Preview" />
              ) : (
                <div className="text-center">
                  <div className="w-16 h-16 bg-slate-200 rounded-xl flex items-center justify-center mx-auto mb-4"><FileText className="w-8 h-8 text-slate-400" /></div>
                  <p className="text-slate-600">O navegador não suporta visualização para este formato.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
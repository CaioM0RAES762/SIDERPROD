// components/posto/modal-apontador.tsx
"use client"

import React, { useEffect, useMemo, useState } from "react"
import { X, Search, Plus, Pencil, Trash2, UserCheck, UserX, Check, CalendarClock, ArrowLeft } from "lucide-react"
import {
    usePostoFuncionarios,
    usePostoTurnos,
    usePostoApontadoresPadrao,
    postoCriarFuncionario,
    postoEditarFuncionario,
    postoExcluirFuncionario,
    postoAtribuirApontador,
    postoDefinirApontadorPadrao,
    revalidatePostoApontadorHistorico,
    type FuncionarioRow,
    type ApontadorAtribuido,
} from "@/hooks/posto/use-api"

const CARGO_APONTADOR = "Apontador"

type View = "list" | "form" | "padrao"
type FormMode = "create" | "edit"

export function ApontadorModal({
    isOpen,
    onClose,
    centroTrabalhoId,
    stationName,
    empresaId,
    assigned,
    onChanged,
}: {
    isOpen: boolean
    onClose: () => void
    centroTrabalhoId: string
    stationName: string
    empresaId?: string | null
    /** apontador atualmente atribuído (vem do header) */
    assigned?: ApontadorAtribuido | null
    /** chamado após atribuir / desatribuir / CRUD / padrão para revalidar o header do posto */
    onChanged?: () => void
}) {
    const empresa_id = (empresaId || "").trim()

    const [view, setView] = useState<View>("list")
    const [formMode, setFormMode] = useState<FormMode>("create")
    const [editingId, setEditingId] = useState<string | null>(null)

    const [search, setSearch] = useState("")
    const [nome, setNome] = useState("")
    const [registro, setRegistro] = useState("")

    const [submitting, setSubmitting] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const [busyTurnoId, setBusyTurnoId] = useState<string | null>(null)
    const [padraoError, setPadraoError] = useState<string | null>(null)

    const funcHook = usePostoFuncionarios({ empresaId, somenteAtivos: true, cargo: CARGO_APONTADOR })
    const funcionarios = (funcHook.data || []) as FuncionarioRow[]

    const turnosHook = usePostoTurnos({ empresaId })
    const turnos = turnosHook.data || []

    const padraoHook = usePostoApontadoresPadrao({ centroTrabalhoId, empresaId })
    const padraoPorTurno = padraoHook.data || []

    // reset ao abrir/fechar
    useEffect(() => {
        if (!isOpen) return
        setView("list")
        setSearch("")
        setError(null)
        setPadraoError(null)
        setConfirmDeleteId(null)
    }, [isOpen])

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return funcionarios
        return funcionarios.filter((f) =>
            [f.nome, f.registro]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(term)),
        )
    }, [funcionarios, search])

    if (!isOpen) return null

    const handleClose = () => {
        setView("list")
        onClose()
    }

    const refresh = () => {
        funcHook.mutate?.()
        onChanged?.()
        revalidatePostoApontadorHistorico()
    }

    const openCreate = () => {
        setFormMode("create")
        setEditingId(null)
        setNome("")
        setRegistro("")
        setError(null)
        setView("form")
    }

    const openEdit = (f: FuncionarioRow) => {
        setFormMode("edit")
        setEditingId(f.funcionario_id)
        setNome(f.nome || "")
        setRegistro(f.registro || "")
        setError(null)
        setView("form")
    }

    const submitForm = async () => {
        if (!nome.trim()) {
            setError("Informe o nome.")
            return
        }
        if (!empresa_id) {
            setError("empresa_id não disponível.")
            return
        }
        setSubmitting(true)
        setError(null)
        try {
            if (formMode === "edit" && editingId) {
                await postoEditarFuncionario({
                    empresa_id,
                    funcionario_id: editingId,
                    nome: nome.trim(),
                    registro: registro.trim() || null,
                    cargo: CARGO_APONTADOR,
                })
            } else {
                await postoCriarFuncionario({
                    empresa_id,
                    nome: nome.trim(),
                    registro: registro.trim() || null,
                    cargo: CARGO_APONTADOR,
                })
            }
            refresh()
            setView("list")
        } catch (e: any) {
            setError(e?.message || "Falha ao salvar apontador.")
        } finally {
            setSubmitting(false)
        }
    }

    const doDelete = async (funcionario_id: string) => {
        if (!empresa_id) return
        setBusyId(funcionario_id)
        try {
            await postoExcluirFuncionario({ empresa_id, funcionario_id })
            refresh()
            padraoHook.mutate?.()
        } catch (e: any) {
            setError(e?.message || "Falha ao excluir.")
        } finally {
            setBusyId(null)
            setConfirmDeleteId(null)
        }
    }

    const doAssign = async (funcionario_id: string | null) => {
        if (!empresa_id || !centroTrabalhoId) return
        setBusyId(funcionario_id ?? "__none__")
        setError(null)
        try {
            await postoAtribuirApontador({
                empresa_id,
                centro_trabalho_id: centroTrabalhoId,
                funcionario_id,
            })
            refresh()
            if (funcionario_id) handleClose()
        } catch (e: any) {
            setError(e?.message || "Falha ao atribuir apontador.")
        } finally {
            setBusyId(null)
        }
    }

    const doDefinirPadrao = async (turno_id: string, funcionario_id: string | null) => {
        if (!empresa_id || !centroTrabalhoId) return
        setBusyTurnoId(turno_id)
        setPadraoError(null)
        try {
            await postoDefinirApontadorPadrao({
                empresa_id,
                centro_trabalho_id: centroTrabalhoId,
                turno_id,
                funcionario_id,
            })
            padraoHook.mutate?.()
            onChanged?.()
            revalidatePostoApontadorHistorico()
        } catch (e: any) {
            setPadraoError(e?.message || "Falha ao definir padrão.")
        } finally {
            setBusyTurnoId(null)
        }
    }

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
            <div className="bg-white rounded-t-2xl sm:rounded w-full sm:max-w-lg shadow-2xl max-h-[90dvh] sm:max-h-[90vh] overflow-hidden flex flex-col border border-slate-200/80">
                {/* Header escuro padronizado */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "#0f1117" }}>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Posto</p>
                        <h2 className="text-sm font-semibold text-white leading-tight">
                            {view === "padrao" ? `Apontador padrão — ${stationName}` : `Apontador — ${stationName}`}
                        </h2>
                    </div>
                    <button
                        className="p-1.5 rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                        onClick={handleClose}
                        aria-label="Fechar"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto flex-1 scrollbar-soft">
                    {view === "list" && (
                        <div className="space-y-4">
                            {!!error && (
                                <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">
                                    {error}
                                </div>
                            )}

                            {/* Atribuído atual */}
                            <div className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2.5">
                                <div className="min-w-0">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Atuando agora</div>
                                    <div className="text-sm font-semibold text-slate-900 truncate">
                                        {assigned?.nome || "Indefinido"}
                                    </div>
                                </div>
                                {assigned?.funcionario_id && (
                                    <button
                                        onClick={() => doAssign(null)}
                                        disabled={busyId === "__none__"}
                                        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-white transition-colors disabled:opacity-50"
                                    >
                                        <UserX className="w-3.5 h-3.5" /> Desatribuir
                                    </button>
                                )}
                            </div>

                            {/* Padrão por turno — atalho */}
                            <button
                                onClick={() => setView("padrao")}
                                className="w-full flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2.5 hover:bg-slate-50 transition-colors"
                            >
                                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                    <CalendarClock className="w-4 h-4 text-slate-400" />
                                    Configurar padrão por turno
                                </span>
                                <span className="text-xs text-slate-400">Manhã / Tarde / Noite</span>
                            </button>

                            {/* Busca + cadastrar */}
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por nome ou registro"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                    />
                                </div>
                                <button
                                    onClick={openCreate}
                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                                >
                                    <Plus className="w-4 h-4" /> Cadastrar
                                </button>
                            </div>

                            {/* Lista */}
                            {funcHook.isLoading ? (
                                <div className="text-center py-8 text-slate-400 text-sm">Carregando...</div>
                            ) : filtered.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 text-sm border border-slate-200 rounded bg-slate-50">
                                    {funcionarios.length === 0
                                        ? "Nenhum apontador cadastrado. Use “Cadastrar”."
                                        : "Nenhum resultado para a busca."}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filtered.map((f) => {
                                        const isCurrent = assigned?.funcionario_id === f.funcionario_id
                                        const isConfirming = confirmDeleteId === f.funcionario_id
                                        return (
                                            <div
                                                key={f.funcionario_id}
                                                className={`group flex items-center gap-3 rounded border px-3 py-2.5 transition-colors ${
                                                    isCurrent ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
                                                }`}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-semibold text-slate-900 truncate">{f.nome}</div>
                                                    <div className="text-xs text-slate-500 truncate">
                                                        {f.registro ? `Reg. ${f.registro}` : "Sem registro"}
                                                    </div>
                                                </div>

                                                {isConfirming ? (
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                            onClick={() => doDelete(f.funcionario_id)}
                                                            disabled={busyId === f.funcionario_id}
                                                            className="px-2 py-1 rounded text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                                                        >
                                                            Excluir
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmDeleteId(null)}
                                                            className="px-2 py-1 rounded text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-white"
                                                        >
                                                            Não
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            onClick={() => doAssign(f.funcionario_id)}
                                                            disabled={busyId === f.funcionario_id || isCurrent}
                                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-60 ${
                                                                isCurrent
                                                                    ? "border border-slate-200 text-slate-500"
                                                                    : "bg-slate-900 text-white hover:bg-slate-800"
                                                            }`}
                                                            title={isCurrent ? "Já atribuído" : "Atribuir a este posto"}
                                                        >
                                                            {isCurrent ? <Check className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                                                            {isCurrent ? "Atribuído" : "Atribuir"}
                                                        </button>
                                                        <button
                                                            onClick={() => openEdit(f)}
                                                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                                            aria-label="Editar"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmDeleteId(f.funcionario_id)}
                                                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                                            aria-label="Excluir"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {view === "form" && (
                        <div className="space-y-4">
                            <div className="text-sm font-semibold text-slate-900">
                                {formMode === "edit" ? "Editar apontador" : "Cadastrar apontador"}
                            </div>

                            {!!error && (
                                <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">
                                    {error}
                                </div>
                            )}

                            <div>
                                <label className="text-xs text-slate-600 mb-1 block">Nome *</label>
                                <input
                                    type="text"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    placeholder="Ex.: Maria Souza"
                                    className="w-full px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                    disabled={submitting}
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="text-xs text-slate-600 mb-1 block">Registro / Matrícula</label>
                                <input
                                    type="text"
                                    value={registro}
                                    onChange={(e) => setRegistro(e.target.value)}
                                    placeholder="Ex.: 12345"
                                    className="w-full px-4 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                                    disabled={submitting}
                                />
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={() => setView("list")}
                                    disabled={submitting}
                                    className="flex-1 py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={submitForm}
                                    disabled={submitting}
                                    className={`flex-1 py-2.5 text-sm font-semibold rounded transition-colors ${
                                        submitting
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                            : "bg-slate-900 text-white hover:bg-slate-800"
                                    }`}
                                >
                                    {submitting ? "Salvando..." : formMode === "edit" ? "Salvar" : "Cadastrar"}
                                </button>
                            </div>
                        </div>
                    )}

                    {view === "padrao" && (
                        <div className="space-y-4">
                            <button
                                onClick={() => setView("list")}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                            </button>

                            <div className="text-sm text-slate-600">
                                Defina quem é o apontador padrão de cada turno. Ao virar o turno, o posto
                                assume automaticamente o padrão configurado — mas pode ser trocado a
                                qualquer momento para o turno corrente na tela anterior.
                            </div>

                            {!!padraoError && (
                                <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">
                                    {padraoError}
                                </div>
                            )}

                            {turnosHook.isLoading || padraoHook.isLoading ? (
                                <div className="text-center py-8 text-slate-400 text-sm">Carregando...</div>
                            ) : turnos.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 text-sm border border-slate-200 rounded bg-slate-50">
                                    Nenhum turno cadastrado.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {turnos.map((t) => {
                                        const atual = padraoPorTurno.find((p) => p.turno_id === t.turno_id)
                                        const value = atual?.funcionario_id || ""
                                        const busy = busyTurnoId === t.turno_id
                                        return (
                                            <div
                                                key={t.turno_id}
                                                className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2.5"
                                            >
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-slate-900">{t.nome}</div>
                                                    {t.hora_inicio && t.hora_fim && (
                                                        <div className="text-xs text-slate-500">
                                                            {t.hora_inicio.slice(0, 5)} – {t.hora_fim.slice(0, 5)}
                                                        </div>
                                                    )}
                                                </div>
                                                <select
                                                    value={value}
                                                    disabled={busy}
                                                    onChange={(e) => doDefinirPadrao(t.turno_id, e.target.value || null)}
                                                    className="shrink-0 max-w-[55%] px-2.5 py-1.5 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 disabled:opacity-50"
                                                >
                                                    <option value="">— Nenhum —</option>
                                                    {funcionarios.map((f) => (
                                                        <option key={f.funcionario_id} value={f.funcionario_id}>
                                                            {f.nome}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={handleClose}
                        className="px-6 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    )
}

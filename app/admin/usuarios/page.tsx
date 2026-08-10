"use client"
// app/admin/usuarios/page.tsx

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
    Users,
    UserPlus,
    Trash2,
    RefreshCw,
    X,
    Search,
    ShieldAlert,
    CheckCircle2,
    XCircle,
    Loader2,
    Eye,
    EyeOff,
    AlertTriangle,
} from "lucide-react"
import { useAdminUsers, type AdminUser } from "@/hooks/use-admin-users"

// ─────────────────────────────────────────────────────────────────────────────
// Conta administradora — na demonstração é a própria conta pública
// ─────────────────────────────────────────────────────────────────────────────

import { DEMO_EMAIL as ADMIN_EMAIL } from "@/lib/demo/config"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formatação
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—"
    try {
        return new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(iso))
    } catch {
        return iso
    }
}

function getInitials(name: string): string {
    const parts = name.trim().split(" ").filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.substring(0, 2).toUpperCase()
}

function avatarColor(email: string | null): string {
    const colors = [
        "from-emerald-500 to-teal-600",
        "from-blue-500 to-indigo-600",
        "from-violet-500 to-purple-600",
        "from-rose-500 to-pink-600",
        "from-amber-500 to-orange-600",
        "from-cyan-500 to-sky-600",
    ]
    if (!email) return colors[0]
    const idx = email.charCodeAt(0) % colors.length
    return colors[idx]
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ user }: { user: AdminUser }) {
    if (user.deleted_at)
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <XCircle className="w-3 h-3" /> Deletado
            </span>
        )
    if (!user.is_active)
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <AlertTriangle className="w-3 h-3" /> Inativo
            </span>
        )
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Ativo
        </span>
    )
}

// ─── Modal de confirmação de delete ─────────────────────────────────────────

interface DeleteModalProps {
    user: AdminUser | null
    onConfirm: () => Promise<void>
    onClose: () => void
    loading: boolean
}

function DeleteModal({ user, onConfirm, onClose, loading }: DeleteModalProps) {
    if (!user) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                        <Trash2 className="w-6 h-6 text-rose-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-100">Deletar usuário?</h3>
                        <p className="text-sm text-slate-400 mt-1">
                            O usuário <span className="font-medium text-slate-200">{user.nome}</span> será
                            desativado. A operação pode ser revertida diretamente no banco de dados.
                        </p>
                    </div>

                    <div className="w-full bg-slate-800/50 rounded-xl p-3 text-left">
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1.5">Usuário</p>
                        <p className="text-sm font-medium text-slate-200">{user.nome}</p>
                        <p className="text-xs text-slate-400">{user.email ?? "sem e-mail"}</p>
                    </div>

                    <div className="flex gap-3 w-full mt-2">
                        <button
                            onClick={onClose}
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-rose-500/90 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Deletando…</>
                                : <><Trash2 className="w-4 h-4" /> Deletar</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Modal de criação de usuário ─────────────────────────────────────────────

interface CreateModalProps {
    onClose: () => void
    onCreate: (payload: { nome: string; email: string; senha: string }) => Promise<{ ok: boolean; error?: string }>
}

function CreateModal({ onClose, onCreate }: CreateModalProps) {
    const [nome, setNome] = useState("")
    const [email, setEmail] = useState("")
    const [senha, setSenha] = useState("")
    const [showPass, setShowPass] = useState(false)
    const [loading, setLoading] = useState(false)
    const [fieldError, setFieldError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async () => {
        setFieldError(null)

        const n = nome.trim()
        const e = email.trim().toLowerCase()
        const s = senha

        if (!n) return setFieldError("Nome é obrigatório.")
        if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))
            return setFieldError("Informe um e-mail válido.")
        if (s.length < 8) return setFieldError("Senha deve ter pelo menos 8 caracteres.")

        setLoading(true)
        const result = await onCreate({ nome: n, email: e, senha: s })
        setLoading(false)

        if (!result.ok) return setFieldError(result.error ?? "Erro ao criar usuário.")
        setSuccess(true)
        setTimeout(onClose, 1200)
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                            <UserPlus className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-slate-100">Novo Usuário</h3>
                            <p className="text-xs text-slate-500">Qualquer e-mail é aceito</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Sucesso */}
                {success && (
                    <div className="flex items-center gap-2 mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        Usuário criado com sucesso!
                    </div>
                )}

                {/* Erro */}
                {fieldError && (
                    <div className="flex items-center gap-2 mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {fieldError}
                    </div>
                )}

                {/* Campos */}
                <div className="space-y-4">
                    {/* Nome */}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Nome completo</label>
                        <input
                            type="text"
                            value={nome}
                            onChange={e => setNome(e.target.value)}
                            placeholder="Ex: João Silva"
                            className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all"
                        />
                    </div>

                    {/* E-mail */}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">E-mail</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="fulano@exemplo.com"
                            className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all"
                        />
                        <p className="text-xs text-slate-500 mt-1">Qualquer e-mail válido</p>
                    </div>

                    {/* Senha */}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Senha</label>
                        <div className="relative">
                            <input
                                type={showPass ? "text" : "password"}
                                value={senha}
                                onChange={e => setSenha(e.target.value)}
                                placeholder="Mínimo 8 caracteres"
                                onKeyDown={e => { if (e.key === "Enter") handleSubmit() }}
                                className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPass(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Botões */}
                <div className="flex gap-3 mt-6">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || success}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando…</>
                            : <><UserPlus className="w-4 h-4" /> Criar Usuário</>}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminUsuariosPage() {
    const router = useRouter()
    const { users, loading, error, fetchUsers, createUser, deleteUser } = useAdminUsers()

    const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
    const [authChecking, setAuthChecking] = useState(true)

    const [search, setSearch] = useState("")
    const [filterStatus, setFilterStatus] = useState<"all" | "active" | "deleted">("all")
    const [showCreate, setShowCreate] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
    const [deleteLoading, setDeleteLoading] = useState(false)
    const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null)

    // ── Verifica se é o admin ──────────────────────────────────────────────────
    useEffect(() => {
        ; (async () => {
            try {
                const res = await fetch("/api/auth/me", { credentials: "include" })
                const data = await res.json()
                if (!res.ok || !data?.user) { router.replace("/login"); return }
                if (data.user.email !== ADMIN_EMAIL) { router.replace("/"); return }
                setCurrentUserEmail(data.user.email)
            } catch {
                router.replace("/login")
            } finally {
                setAuthChecking(false)
            }
        })()
    }, [router])

    // ── Toast auto-dismiss ────────────────────────────────────────────────────
    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), 3500)
        return () => clearTimeout(t)
    }, [toast])

    // ── Filtro + busca ─────────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        const q = search.toLowerCase()
        return users.filter(u => {
            const matchSearch =
                !q ||
                u.nome.toLowerCase().includes(q) ||
                (u.email ?? "").toLowerCase().includes(q)

            const matchStatus =
                filterStatus === "all" ? true :
                    filterStatus === "active" ? (!u.deleted_at && u.is_active) :
        /* deleted */ !!u.deleted_at

            return matchSearch && matchStatus
        })
    }, [users, search, filterStatus])

    // ── Handlers ───────────────────────────────────────────────────────────────
    const handleCreate = async (payload: { nome: string; email: string; senha: string }) => {
        const r = await createUser(payload)
        if (r.ok) setToast({ msg: "Usuário criado com sucesso!", type: "ok" })
        else setToast({ msg: r.error ?? "Erro ao criar.", type: "err" })
        return r
    }

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return
        setDeleteLoading(true)
        const r = await deleteUser(deleteTarget.usuario_id)
        setDeleteLoading(false)
        setDeleteTarget(null)
        if (r.ok) setToast({ msg: "Usuário deletado.", type: "ok" })
        else setToast({ msg: r.error ?? "Erro ao deletar.", type: "err" })
    }

    // ── Loading de auth ────────────────────────────────────────────────────────
    if (authChecking) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            </div>
        )
    }

    // ── Contadores rápidos ─────────────────────────────────────────────────────
    const totalAtivos = users.filter(u => !u.deleted_at && u.is_active).length
    const totalInativos = users.filter(u => u.deleted_at).length

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* Toast */}
            {toast && (
                <div
                    className={`fixed top-4 right-4 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border animate-in fade-in slide-in-from-top-2 duration-300 ${toast.type === "ok"
                            ? "bg-emerald-900/80 border-emerald-500/30 text-emerald-300"
                            : "bg-rose-900/80 border-rose-500/30 text-rose-300"
                        }`}
                >
                    {toast.type === "ok"
                        ? <CheckCircle2 className="w-4 h-4" />
                        : <AlertTriangle className="w-4 h-4" />}
                    {toast.msg}
                </div>
            )}

            {/* Modais */}
            {showCreate && (
                <CreateModal
                    onClose={() => setShowCreate(false)}
                    onCreate={handleCreate}
                />
            )}
            <DeleteModal
                user={deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDeleteConfirm}
                loading={deleteLoading}
            />

            {/* Layout */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

                {/* ── Header ─────────────────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_0_20px_rgba(52,211,153,0.25)]">
                            <ShieldAlert className="w-5 h-5 text-slate-950" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-100 leading-none">
                                Administração de Usuários
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Acesso restrito · {currentUserEmail}
                            </p>
                        </div>
                    </div>

                    <div className="sm:ml-auto flex items-center gap-2">
                        <button
                            onClick={() => void fetchUsers()}
                            disabled={loading}
                            className="p-2.5 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/60 text-slate-400 hover:text-white transition-all disabled:opacity-50"
                            title="Recarregar"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                        </button>
                        <button
                            onClick={() => setShowCreate(true)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white transition-all shadow-[0_0_15px_rgba(52,211,153,0.15)] hover:shadow-[0_0_20px_rgba(52,211,153,0.25)]"
                        >
                            <UserPlus className="w-4 h-4" />
                            Novo Usuário
                        </button>
                    </div>
                </div>

                {/* ── Cards de estatísticas ─────────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                        { label: "Total", value: users.length, color: "text-slate-300" },
                        { label: "Ativos", value: totalAtivos, color: "text-emerald-400" },
                        { label: "Deletados", value: totalInativos, color: "text-rose-400" },
                    ].map(stat => (
                        <div
                            key={stat.label}
                            className="bg-slate-900/60 border border-slate-800/70 rounded-2xl p-4 text-center"
                        >
                            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
                        </div>
                    ))}
                </div>

                {/* ── Barra de busca + filtro ───────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por nome ou e-mail…"
                            className="w-full bg-slate-900/60 border border-slate-800/70 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/40 transition-all"
                        />
                    </div>
                    <div className="flex gap-2">
                        {(["all", "active", "deleted"] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilterStatus(f)}
                                className={`px-3.5 py-2.5 rounded-xl text-xs font-medium border transition-all ${filterStatus === f
                                        ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                                        : "bg-slate-900/60 border-slate-800/70 text-slate-400 hover:text-white hover:bg-slate-800/60"
                                    }`}
                            >
                                {{ all: "Todos", active: "Ativos", deleted: "Deletados" }[f]}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Tabela ───────────────────────────────────────────────────── */}
                {error && (
                    <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm mb-4">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                <div className="bg-slate-900/60 border border-slate-800/70 rounded-2xl overflow-hidden">
                    {/* Cabeçalho da tabela */}
                    <div className="hidden sm:grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 px-5 py-3 border-b border-slate-800/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <span className="w-9" />
                        <span>Nome</span>
                        <span>E-mail</span>
                        <span className="text-center">Status</span>
                        <span className="text-center">Ações</span>
                    </div>

                    {loading && users.length === 0 && (
                        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Carregando usuários…
                        </div>
                    )}

                    {!loading && filtered.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                            <Users className="w-10 h-10 opacity-30" />
                            <p className="text-sm">Nenhum usuário encontrado.</p>
                        </div>
                    )}

                    <div className="divide-y divide-slate-800/50">
                        {filtered.map(user => (
                            <div
                                key={user.usuario_id}
                                className={`grid sm:grid-cols-[auto_1fr_1fr_auto_auto] gap-4 items-center px-5 py-4 hover:bg-slate-800/30 transition-colors ${user.deleted_at ? "opacity-50" : ""
                                    }`}
                            >
                                {/* Avatar */}
                                <div
                                    className={`hidden sm:flex w-9 h-9 rounded-full bg-gradient-to-br ${avatarColor(user.email)} items-center justify-center text-xs font-bold text-white flex-shrink-0`}
                                >
                                    {getInitials(user.nome)}
                                </div>

                                {/* Nome + data */}
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-200 truncate">
                                        {user.nome}
                                        {user.email === currentUserEmail && (
                                            <span className="ml-2 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                                                Você
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Criado em {formatDate(user.created_at)}
                                    </p>
                                </div>

                                {/* E-mail */}
                                <div className="min-w-0">
                                    <p className="text-sm text-slate-400 truncate">{user.email ?? "—"}</p>
                                    <p className="text-xs text-slate-600 mt-0.5">{user.provider ?? "local"}</p>
                                </div>

                                {/* Status */}
                                <div className="flex justify-center">
                                    <StatusBadge user={user} />
                                </div>

                                {/* Ações */}
                                <div className="flex justify-center">
                                    {user.email !== currentUserEmail && !user.deleted_at ? (
                                        <button
                                            onClick={() => setDeleteTarget(user)}
                                            className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                                            title="Deletar usuário"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    ) : (
                                        <span className="w-8" />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Rodapé */}
                <p className="text-center text-xs text-slate-600 mt-6">
                    {filtered.length} de {users.length} usuário{users.length !== 1 ? "s" : ""}
                </p>
            </div>
        </div>
    )
}
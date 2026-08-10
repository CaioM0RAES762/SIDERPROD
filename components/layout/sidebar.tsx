"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  X,
  ChevronDown,
  LayoutDashboard,
  Clock,
  BarChart3,
  FileText,
  Edit,
  StickyNote,
  Settings,
  Gauge,
  Factory,
  PauseCircle,
  Trash2,
  RefreshCcw,
  Timer,
  TrendingDown,
  Users,
  LogOut,
  Layers,
  Grid3X3,
  CheckSquare,
  Truck,
  FileBarChart,
  ShieldCheck,
} from "lucide-react"

import { endDemoSession } from "@/lib/demo/auth"

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/" },
  {
    icon: Clock,
    label: "Histórico",
    href: "/historico",
    submenu: [
      { icon: Gauge,       label: "OEE",        href: "/historico?tab=oee"       },
      { icon: Factory,     label: "Produção",    href: "/historico?tab=producao"  },
      { icon: PauseCircle, label: "Paradas",     href: "/historico?tab=paradas"   },
      { icon: Trash2,      label: "Refugo",      href: "/historico?tab=refugo"    },
      { icon: RefreshCcw,  label: "Retrabalho",  href: "/historico?tab=retrabalho"},
      { icon: Timer,       label: "Ciclo",       href: "/historico?tab=ciclo"     },
      { icon: TrendingDown,label: "Perdas",      href: "/historico?tab=perdas"    },
      { icon: Users,       label: "Rebarbadores", href: "/historico?tab=pessoas"   },
    ],
  },
  {
    icon: BarChart3,
    label: "Analítico",
    href: "/analitico",
    submenu: [
      { icon: Gauge,       label: "OEE",        href: "/analitico?tab=oee"       },
      { icon: Factory,     label: "Produção",    href: "/analitico?tab=producao"  },
      { icon: PauseCircle, label: "Paradas",     href: "/analitico?tab=paradas"   },
      { icon: Trash2,      label: "Refugo",      href: "/analitico?tab=refugo"    },
      { icon: RefreshCcw,  label: "Retrabalho",  href: "/analitico?tab=retrabalho"},
      { icon: Timer,       label: "Ciclo",       href: "/analitico?tab=ciclo"     },
      { icon: TrendingDown,label: "Perdas",      href: "/analitico?tab=perdas"    },
      { icon: Users,       label: "Rebarbadores", href: "/analitico?tab=pessoas"   },
    ],
  },
  { icon: Edit,        label: "Plano de Ação",          href: "/plano-acao"              },
  { icon: StickyNote,  label: "Anotação",               href: "/anotacao"                },
  {
    icon: Truck,
    label: "Logística de Ordens",
    href: "/logistica-ordens",
    submenu: [
      { icon: Layers,      label: "Kanban",            href: "/logistica-ordens?tab=kanban"    },
      { icon: Settings,    label: "Fila",              href: "/logistica-ordens?tab=fila"      },
      { icon: Grid3X3,     label: "Planejamento",      href: "/logistica-ordens?tab=carga"     },
      { icon: CheckSquare, label: "Ordens Executadas", href: "/logistica-ordens?tab=executadas"},
    ],
  },
  { icon: FileBarChart, label: "Relatório Consolidado", href: "/relatorio-consolidado"   },
]

// ─── cores ────────────────────────────────────────────────────────────────────
const BG        = "#0f1117"
const BORDER    = "rgba(255,255,255,0.07)"
const TEXT_DIM  = "rgba(255,255,255,0.45)"
const TEXT_MID  = "rgba(255,255,255,0.65)"
const TEXT_ON   = "rgba(255,255,255,0.92)"
const HOVER_BG  = "rgba(255,255,255,0.04)"
const ACTIVE_BG = "rgba(255,255,255,0.07)"

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const [expandedMenus, setExpandedMenus] = useState<string[]>([])
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [user, setUser] = useState<{ nome: string; email: string }>({ nome: "Carregando...", email: "" })

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me")
        const data = await res.json()
        if (res.ok && data.user) {
          setUser({ nome: data.user.nome, email: data.user.email })
          localStorage.setItem("siderprod_user", JSON.stringify(data.user))
        } else fallback()
      } catch { fallback() }
    }
    function fallback() {
      const s = localStorage.getItem("siderprod_user")
      if (s) { const p = JSON.parse(s); setUser({ nome: p.nome || p.name, email: p.email }) }
      else setUser({ nome: "Usuário", email: "Não autenticado" })
    }
    fetchUser()
  }, [])

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true)
      await fetch("/api/auth/logout", { method: "POST" })
      endDemoSession()
      localStorage.removeItem("siderprod_user")
      window.location.href = "/login"
    } catch { setIsLoggingOut(false) }
  }

  const getInitials = (name: string) => {
    if (!name || name === "Carregando..." || name === "Usuário") return "…"
    const parts = name.trim().split(" ")
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
  }

  const toggleSubmenu = (label: string) =>
    setExpandedMenus(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label])

  const isActiveLink = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0])

  // Na demonstração a conta pública tem acesso a tudo que é visível.
  const isAdmin = Boolean(user.email)

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-screen flex flex-col z-50 transition-transform duration-300 w-64`}
        style={{
          background: BG,
          borderRight: `1px solid ${BORDER}`,
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          boxShadow: isOpen ? "4px 0 32px rgba(0,0,0,0.4)" : "none",
        }}
      >
        {/* ── Topo ─────────────────────────────────────── */}
        <div
          className="flex items-center gap-2.5 px-4"
          style={{ height: "48px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}
        >
          {/* Wordmark */}
          <div className="flex items-center select-none flex-1 min-w-0">
            <span style={{ fontSize: "15px", fontWeight: 300, color: "rgba(255,255,255,0.45)", letterSpacing: "-0.01em" }}></span>
            <span style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", letterSpacing: "-0.02em" }}></span>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="p-1 rounded-md transition-colors"
            style={{ color: TEXT_DIM }}
            onMouseEnter={e => { e.currentTarget.style.color = TEXT_ON; e.currentTarget.style.background = HOVER_BG }}
            onMouseLeave={e => { e.currentTarget.style.color = TEXT_DIM; e.currentTarget.style.background = "transparent" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Perfil ───────────────────────────────────── */}
        <div className="px-3 pt-3 pb-2" style={{ flexShrink: 0 }}>
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors text-left"
            style={{
              background: isProfileMenuOpen ? ACTIVE_BG : "transparent",
              border: `1px solid ${isProfileMenuOpen ? BORDER : "transparent"}`,
            }}
            onMouseEnter={e => { if (!isProfileMenuOpen) e.currentTarget.style.background = HOVER_BG }}
            onMouseLeave={e => { if (!isProfileMenuOpen) e.currentTarget.style.background = "transparent" }}
          >
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: "rgba(255,255,255,0.1)",
                fontSize: "11px",
                fontWeight: 700,
                color: TEXT_ON,
                letterSpacing: "0.02em",
              }}
            >
              {getInitials(user.nome)}
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: "13px", fontWeight: 600, color: TEXT_ON, letterSpacing: "-0.01em" }} className="truncate">
                {user.nome}
              </p>
              <p style={{ fontSize: "11px", color: TEXT_DIM }} className="truncate">
                {user.email}
              </p>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 shrink-0 ${isProfileMenuOpen ? "rotate-180" : ""}`}
              style={{ color: TEXT_DIM }}
            />
          </button>

          {/* Dropdown perfil */}
          <div
            className={`overflow-hidden transition-all duration-200 ${isProfileMenuOpen ? "max-h-24 opacity-100 mt-1" : "max-h-0 opacity-0"}`}
          >
            <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: "rgba(255,255,255,0.03)" }}>
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors disabled:opacity-50"
                style={{ color: "rgba(248,113,113,0.8)" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span style={{ fontSize: "13px", fontWeight: 500 }}>
                  {isLoggingOut ? "Saindo..." : "Sair do sistema"}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Navegação ────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto px-3 py-1 scrollbar-soft">
          <p
            className="px-3 mb-1 mt-1"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.22)",
              paddingTop: "6px",
              paddingBottom: "4px",
            }}
          >
            Menu Principal
          </p>

          {navItems.map(item => {
            const isActive  = isActiveLink(item.href)
            const isExpanded = expandedMenus.includes(item.label)
            const hasSubmenu = !!item.submenu?.length

            const itemStyle: React.CSSProperties = {
              color: isActive ? TEXT_ON : TEXT_MID,
              background: isActive ? ACTIVE_BG : "transparent",
              borderLeft: isActive ? "2px solid rgba(255,255,255,0.5)" : "2px solid transparent",
              borderRadius: "0 6px 6px 0",
            }

            return (
              <div key={item.label}>
                {hasSubmenu ? (
                  <button
                    onClick={() => toggleSubmenu(item.label)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 mb-0.5 text-sm font-medium transition-colors text-left"
                    style={itemStyle}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = HOVER_BG }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent" }}
                  >
                    <item.icon className="w-4 h-4 shrink-0 opacity-75" />
                    <span className="flex-1" style={{ fontSize: "13px", letterSpacing: "-0.01em" }}>
                      {item.label}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                      style={{ color: TEXT_DIM }}
                    />
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className="w-full flex items-center gap-2.5 px-3 py-2 mb-0.5 text-sm font-medium transition-colors"
                    style={itemStyle}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = HOVER_BG }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                  >
                    <item.icon className="w-4 h-4 shrink-0 opacity-75" />
                    <span style={{ fontSize: "13px", letterSpacing: "-0.01em" }}>{item.label}</span>
                  </Link>
                )}

                {/* Submenu */}
                {hasSubmenu && isExpanded && (
                  <div
                    className="ml-5 mb-1 mt-0.5"
                    style={{ borderLeft: "1px solid rgba(255,255,255,0.08)", paddingLeft: "10px" }}
                  >
                    {item.submenu!.map(sub => {
                      const isSubActive =
                        typeof window !== "undefined"
                          ? pathname === sub.href.split("?")[0] && window.location.search === "?" + sub.href.split("?")[1]
                          : false

                      return (
                        <Link
                          key={sub.label}
                          href={sub.href}
                          onClick={onClose}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-0.5 transition-colors"
                          style={{
                            fontSize: "12px",
                            fontWeight: isSubActive ? 600 : 400,
                            color: isSubActive ? TEXT_ON : TEXT_DIM,
                            background: isSubActive ? ACTIVE_BG : "transparent",
                          }}
                          onMouseEnter={e => { if (!isSubActive) (e.currentTarget as HTMLElement).style.background = HOVER_BG }}
                          onMouseLeave={e => { if (!isSubActive) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                        >
                          <sub.icon className="w-3.5 h-3.5 shrink-0 opacity-60" />
                          <span>{sub.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* Seção Admin */}
          {isAdmin && (
            <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <p
                className="px-3 mb-1"
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(251,191,36,0.5)",
                  paddingBottom: "4px",
                }}
              >
                Administração
              </p>
              <Link
                href="/admin/usuarios"
                onClick={onClose}
                className="flex items-center gap-2.5 px-3 py-2 mb-0.5 rounded-md transition-colors"
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: isActiveLink("/admin/usuarios") ? "rgba(251,191,36,0.9)" : "rgba(251,191,36,0.55)",
                  background: isActiveLink("/admin/usuarios") ? "rgba(251,191,36,0.08)" : "transparent",
                  letterSpacing: "-0.01em",
                }}
                onMouseEnter={e => { if (!isActiveLink("/admin/usuarios")) (e.currentTarget as HTMLElement).style.background = "rgba(251,191,36,0.05)" }}
                onMouseLeave={e => { if (!isActiveLink("/admin/usuarios")) (e.currentTarget as HTMLElement).style.background = "transparent" }}
              >
                <ShieldCheck className="w-4 h-4 shrink-0 opacity-75" />
                <span>Gerenciar Usuários</span>
              </Link>
            </div>
          )}
        </nav>

        {/* ── Rodapé ───────────────────────────────────── */}
        <div
          className="px-4 py-3"
          style={{ borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}
        >
          <p
            className="text-center"
            style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.28)", letterSpacing: "0.02em" }}
          >
            SIDERPROD
          </p>
          <p
            className="text-center mt-1"
            style={{ fontSize: "9.5px", fontWeight: 500, color: "rgba(255,255,255,0.18)", letterSpacing: "0.06em" }}
          >
            Ambiente demonstrativo · dados fictícios
          </p>
        </div>
      </aside>
    </>
  )
}

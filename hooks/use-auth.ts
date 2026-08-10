"use client"
// hooks/use-auth.ts

import * as React from "react"

import { endDemoSession, startDemoSession } from "@/lib/demo/auth"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type AuthUser = {
  usuario_id:  string
  empresa_id:  string
  public_id:   string | null
  nome:        string
  email:       string | null
  provider:    string | null
  provider_id: string | null
  is_active:   boolean
  created_at:  string
  updated_at:  string | null
}

export type EmailCodePurpose = "register" | "reset"

// Respostas da API de auth
type ApiOk<T>  = { ok: true  } & T
type ApiErr    = { ok: false; error: string }

type LoginResponse         = ApiOk<{ user: AuthUser }>      | ApiErr
type RegisterResponse      = ApiOk<{ user: AuthUser }>      | ApiErr
type MeResponse            = ApiOk<{ user: AuthUser }>      | ApiErr
type LogoutResponse        = ApiOk<{}>                      | ApiErr
type SendCodeResponse      = ApiOk<{ sent: true; expiresInSec: number }> | ApiErr
type VerifyCodeResponse    = ApiOk<{ verified: true }>      | ApiErr
type ForgotPasswordResponse= ApiOk<{ sent: true; expiresInSec: number }> | ApiErr
type ResetPasswordResponse = ApiOk<{ changed: true }>       | ApiErr

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_BASE = "/api/auth"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text()
  try { return text ? JSON.parse(text) : null }
  catch { return null }
}

function normalizeEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase()
}

/**
 * A versão pública aceita qualquer e-mail bem formado: a restrição a um domínio
 * corporativo não faz sentido numa demonstração aberta. Quem valida a credencial
 * é a camada de demonstração, que reconhece uma única conta pública.
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

const EMAIL_INVALIDO = "Informe um e-mail válido."

function code6(code: string): string {
  return String(code ?? "").trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAuth() {
  const [user,    setUser]    = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState<boolean>(true)
  const [error,   setError]   = React.useState<string | null>(null)

  // ── /api/auth/me ────────────────────────────────────────────────────────────
  /**
   * Valida sessão via cookie HTTP-only (livemes_session).
   * 401 é NORMAL quando não está logado — não seta error.
   * Chamado automaticamente ao montar o hook.
   */
  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    // Timeout explícito: em tablet/mobile com cookie presente, o /me bate no banco
    // para validar a sessão. Se o banco estiver lento ou a rede instável, o fetch
    // pode ficar pendente para sempre mantendo loading=true eternamente.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)

    const t0 = Date.now()
    console.debug(`[auth/me] iniciando validação de sessão — ${new Date().toISOString()}`)

    try {
      const res = await fetch(`${AUTH_BASE}/me`, {
        method:      "GET",
        credentials: "include",        // ← envia cookie livemes_session
        headers:     { Accept: "application/json" },
        cache:       "no-store",
        signal:      controller.signal,
      })
      clearTimeout(timeoutId)

      console.debug(`[auth/me] resposta recebida em ${Date.now() - t0}ms — status ${res.status}`)

      const data = (await readJsonSafe(res)) as MeResponse | null

      if (res.ok && data && (data as any).ok === true) {
        setUser((data as ApiOk<{ user: AuthUser }>).user)
        setError(null)
      } else {
        setUser(null)
        // 401 = não autenticado — comportamento esperado, não é erro de UI
        if (res.status !== 401) {
          setError(
            (data as any)?.error ??
            `Falha ao validar sessão (HTTP ${res.status}).`
          )
        }
      }
    } catch (e: any) {
      clearTimeout(timeoutId)
      setUser(null)
      console.warn(`[auth/me] falha após ${Date.now() - t0}ms — ${e?.name}: ${e?.message}`)
      // AbortError = timeout de 10s — não é erro que o usuário precisa ver
      if (e?.name !== "AbortError") {
        setError(e?.message ?? "Erro de rede ao validar sessão.")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // ── /api/auth/login ─────────────────────────────────────────────────────────
  /**
   * POST /api/auth/login  { email, senha, rememberMe }
   * Backend seta o cookie livemes_session na resposta.
   */
  const login = React.useCallback(
    async (emailInput: string, senha: string, rememberMe = false) => {
      setLoading(true)
      setError(null)

      const email = normalizeEmail(emailInput)

      if (!isValidEmail(email)) {
        setError(EMAIL_INVALIDO)
        setLoading(false)
        return { ok: false as const, error: EMAIL_INVALIDO }
      }

      // Timeout explícito no login: o /login bate em 2 queries SQL (getUsuarioPorEmail
      // + createSessionRow). Sem abort, se o banco travar, loading=true fica preso
      // indefinidamente no tablet — mesmo comportamento que causava spinner eterno no /me.
      const loginController = new AbortController()
      const loginTimeoutId = setTimeout(() => loginController.abort(), 15_000)

      const t0 = Date.now()
      console.debug(`[auth/login] iniciando login para ${email} — ${new Date().toISOString()}`)

      try {
        const res = await fetch(`${AUTH_BASE}/login`, {
          method:      "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept:         "application/json",
          },
          body: JSON.stringify({ email, senha, rememberMe }),
          signal: loginController.signal,
        })
        clearTimeout(loginTimeoutId)
        console.debug(`[auth/login] resposta em ${Date.now() - t0}ms — status ${res.status}`)

        const data = (await readJsonSafe(res)) as LoginResponse | null

        if (!res.ok || !data || (data as any).ok !== true) {
          const msg =
            (data as any)?.error ?? `Falha no login (HTTP ${res.status}).`
          setUser(null)
          setError(msg)
          return { ok: false as const, error: msg }
        }

        const u = (data as ApiOk<{ user: AuthUser }>).user
        // A sessão da demo é criada no cliente: um cookie opaco que o middleware
        // usa para liberar as rotas protegidas.
        startDemoSession(rememberMe)
        setUser(u)
        setError(null)
        return { ok: true as const, user: u }
      } catch (e: any) {
        clearTimeout(loginTimeoutId)
        setUser(null)
        console.warn(`[auth/login] falha após ${Date.now() - t0}ms — ${e?.name}: ${e?.message}`)
        // AbortError = timeout de 15s expirou sem resposta do servidor
        const msg = e?.name === "AbortError"
          ? "Servidor demorou demais para responder. Tente novamente."
          : (e?.message ?? "Erro de rede no login.")
        setError(msg)
        return { ok: false as const, error: msg }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // ── /api/auth/logout ────────────────────────────────────────────────────────
  /**
   * POST /api/auth/logout
   * Backend revoga sessão no banco e limpa o cookie.
   */
  const logout = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${AUTH_BASE}/logout`, {
        method:      "POST",
        credentials: "include",
        headers:     { Accept: "application/json" },
      })

      const data = (await readJsonSafe(res)) as LogoutResponse | null

      if (!res.ok || !data || (data as any).ok !== true) {
        const msg =
          (data as any)?.error ?? `Falha no logout (HTTP ${res.status}).`
        setError(msg)
        return { ok: false as const, error: msg }
      }

      endDemoSession()
      setUser(null)
      setError(null)
      return { ok: true as const }
    } catch (e: any) {
      const msg = e?.message ?? "Erro de rede no logout."
      setError(msg)
      return { ok: false as const, error: msg }
    } finally {
      setLoading(false)
    }
  }, [])

  // ── /api/auth/send-code ─────────────────────────────────────────────────────
  /**
   * POST /api/auth/send-code  { email, purpose }
   * Envia código OTP de 6 dígitos por e-mail.
   * purpose: "register" | "reset"
   */
  const sendEmailCode = React.useCallback(
    async (emailInput: string, purpose: EmailCodePurpose = "register") => {
      setError(null)

      const email = normalizeEmail(emailInput)

      if (!isValidEmail(email)) {
        setError(EMAIL_INVALIDO)
        return { ok: false as const, error: EMAIL_INVALIDO }
      }

      try {
        const res = await fetch(`${AUTH_BASE}/send-code`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            Accept:         "application/json",
          },
          body: JSON.stringify({ email, purpose }),
        })

        const data = (await readJsonSafe(res)) as SendCodeResponse | null

        if (!res.ok || !data || (data as any).ok !== true) {
          const msg =
            (data as any)?.error ?? `Falha ao enviar código (HTTP ${res.status}).`
          setError(msg)
          return { ok: false as const, error: msg }
        }

        return {
          ok:           true as const,
          expiresInSec: (data as ApiOk<{ sent: true; expiresInSec: number }>).expiresInSec,
        }
      } catch (e: any) {
        const msg = e?.message ?? "Erro de rede ao enviar código."
        setError(msg)
        return { ok: false as const, error: msg }
      }
    },
    []
  )

  // ── /api/auth/verify-code ───────────────────────────────────────────────────
  /**
   * POST /api/auth/verify-code  { email, code, purpose }
   * Valida e CONSOME o código (uso único).
   * Deve ser chamado antes de register ou reset-password.
   */
  const verifyEmailCode = React.useCallback(
    async (
      emailInput: string,
      code: string,
      purpose: EmailCodePurpose = "register"
    ) => {
      setError(null)

      const email = normalizeEmail(emailInput)
      const c     = code6(code)

      if (!isValidEmail(email)) {
        setError(EMAIL_INVALIDO)
        return { ok: false as const, error: EMAIL_INVALIDO }
      }
      if (!/^\d{6}$/.test(c)) {
        const msg = "Código inválido. Use os 6 dígitos enviados no e-mail."
        setError(msg)
        return { ok: false as const, error: msg }
      }

      try {
        const res = await fetch(`${AUTH_BASE}/verify-code`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            Accept:         "application/json",
          },
          body: JSON.stringify({ email, code: c, purpose }),
        })

        const data = (await readJsonSafe(res)) as VerifyCodeResponse | null

        if (!res.ok || !data || (data as any).ok !== true) {
          const msg =
            (data as any)?.error ?? `Falha ao verificar código (HTTP ${res.status}).`
          setError(msg)
          return { ok: false as const, error: msg }
        }

        return { ok: true as const }
      } catch (e: any) {
        const msg = e?.message ?? "Erro de rede ao verificar código."
        setError(msg)
        return { ok: false as const, error: msg }
      }
    },
    []
  )

  // ── /api/auth/register ──────────────────────────────────────────────────────
  /**
   * POST /api/auth/register  { nome, email, senha, rememberMe }
   *
   * ⚠️  O backend exige que verify-code (purpose="register")
   *     tenha sido consumido nos últimos 30 minutos.
   *
   * Em caso de sucesso, seta o cookie de sessão automaticamente.
   */
  const register = React.useCallback(
    async (input: {
      nome:        string
      email:       string
      senha:       string
      rememberMe?: boolean
    }) => {
      setLoading(true)
      setError(null)

      const nome  = String(input.nome ?? "").trim()
      const email = normalizeEmail(input.email)
      const senha = String(input.senha ?? "")

      if (!nome) {
        const msg = "Nome é obrigatório."
        setError(msg)
        setLoading(false)
        return { ok: false as const, error: msg }
      }
      if (!isValidEmail(email)) {
        setError(EMAIL_INVALIDO)
        setLoading(false)
        return { ok: false as const, error: EMAIL_INVALIDO }
      }
      if (!senha) {
        const msg = "Senha é obrigatória."
        setError(msg)
        setLoading(false)
        return { ok: false as const, error: msg }
      }

      try {
        const res = await fetch(`${AUTH_BASE}/register`, {
          method:      "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept:         "application/json",
          },
          body: JSON.stringify({
            nome,
            email,
            senha,
            rememberMe: Boolean(input.rememberMe ?? false),
          }),
        })

        const data = (await readJsonSafe(res)) as RegisterResponse | null

        if (!res.ok || !data || (data as any).ok !== true) {
          const msg =
            (data as any)?.error ?? `Falha no cadastro (HTTP ${res.status}).`
          setUser(null)
          setError(msg)
          return { ok: false as const, error: msg }
        }

        const u = (data as ApiOk<{ user: AuthUser }>).user
        setUser(u)
        setError(null)
        return { ok: true as const, user: u }
      } catch (e: any) {
        const msg = e?.message ?? "Erro de rede no cadastro."
        setUser(null)
        setError(msg)
        return { ok: false as const, error: msg }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // ── /api/auth/forgot-password ───────────────────────────────────────────────
  /**
   * POST /api/auth/forgot-password  { email }
   * Envia código OTP com purpose="reset".
   *
   * ⚠️  Backend responde ok:true mesmo se o e-mail não existir (anti-enumeração).
   */
  const forgotPassword = React.useCallback(async (emailInput: string) => {
    setLoading(true)
    setError(null)

    const email = normalizeEmail(emailInput)

    if (!isValidEmail(email)) {
      setError(EMAIL_INVALIDO)
      setLoading(false)
      return { ok: false as const, error: EMAIL_INVALIDO }
    }

    try {
      const res = await fetch(`${AUTH_BASE}/forgot-password`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Accept:         "application/json",
        },
        body: JSON.stringify({ email }),
      })

      const data = (await readJsonSafe(res)) as ForgotPasswordResponse | null

      if (!res.ok || !data || (data as any).ok !== true) {
        const msg =
          (data as any)?.error ??
          `Falha ao solicitar recuperação (HTTP ${res.status}).`
        setError(msg)
        return { ok: false as const, error: msg }
      }

      return {
        ok:           true as const,
        expiresInSec: (data as ApiOk<{ sent: true; expiresInSec: number }>).expiresInSec,
      }
    } catch (e: any) {
      const msg = e?.message ?? "Erro de rede ao solicitar recuperação."
      setError(msg)
      return { ok: false as const, error: msg }
    } finally {
      setLoading(false)
    }
  }, [])

  // ── /api/auth/reset-password ────────────────────────────────────────────────
  /**
   * POST /api/auth/reset-password  { email, code, newPassword }
   * Consome o código (purpose="reset") e redefine a senha.
   *
   * ⚠️  O código é consumido nesta chamada (não precisa de verify-code antes).
   */
  const resetPassword = React.useCallback(
    async (input: { email: string; code: string; newPassword: string }) => {
      setLoading(true)
      setError(null)

      const email       = normalizeEmail(input.email)
      const c           = code6(input.code)
      const newPassword = String(input.newPassword ?? "")

      if (!isValidEmail(email)) {
        setError(EMAIL_INVALIDO)
        setLoading(false)
        return { ok: false as const, error: EMAIL_INVALIDO }
      }
      if (!/^\d{6}$/.test(c)) {
        const msg = "Código inválido. Use os 6 dígitos enviados no e-mail."
        setError(msg)
        setLoading(false)
        return { ok: false as const, error: msg }
      }
      if (!newPassword) {
        const msg = "Nova senha é obrigatória."
        setError(msg)
        setLoading(false)
        return { ok: false as const, error: msg }
      }

      try {
        const res = await fetch(`${AUTH_BASE}/reset-password`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            Accept:         "application/json",
          },
          body: JSON.stringify({ email, code: c, newPassword }),
        })

        const data = (await readJsonSafe(res)) as ResetPasswordResponse | null

        if (!res.ok || !data || (data as any).ok !== true) {
          const msg =
            (data as any)?.error ??
            `Falha ao redefinir senha (HTTP ${res.status}).`
          setError(msg)
          return { ok: false as const, error: msg }
        }

        return { ok: true as const }
      } catch (e: any) {
        const msg = e?.message ?? "Erro de rede ao redefinir senha."
        setError(msg)
        return { ok: false as const, error: msg }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // ── Efeito inicial ──────────────────────────────────────────────────────────
  // Ao montar, verifica se já existe sessão válida (cookie presente no browser)
  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // ── Retorno ─────────────────────────────────────────────────────────────────
  return {
    /** Usuário autenticado (null se não logado) */
    user,
    /** true se há usuário autenticado */
    isAuthenticated: Boolean(user),
    /** true enquanto valida sessão ou processa login/logout */
    loading,
    /** Mensagem de erro da última operação (null se sem erro) */
    error,

    // Sessão
    refresh,
    login,
    logout,

    // Cadastro com verificação por e-mail
    sendEmailCode,
    verifyEmailCode,
    register,

    // Recuperação de senha
    forgotPassword,
    resetPassword,
  }
}
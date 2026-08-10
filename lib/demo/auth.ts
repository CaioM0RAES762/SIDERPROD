// lib/demo/auth.ts
//
// Autenticação da demonstração.
//
// Não existe banco de usuários, hash de senha ou token assinado: a versão
// pública reconhece UMA credencial, divulgada abertamente no README e na própria
// tela de login. A "sessão" é apenas um marcador opaco no cookie, suficiente
// para as rotas protegidas continuarem se comportando como no sistema real
// (redirecionar quem não entrou, manter o estado no refresh, sair no logout)
// sem nunca dar acesso a nada.

import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_VALUE,
} from "./config"
import { EMPRESA_ID, USUARIO_DEMO } from "./catalog"

export type SessionUser = {
  usuario_id: string
  empresa_id: string
  public_id: string | null
  nome: string
  email: string | null
  provider: string | null
  provider_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string | null
  cargo?: string | null
  perfil?: string | null
}

const CREATED_AT = "2026-01-05T12:00:00.000Z"

export function demoUserPayload(): SessionUser {
  return {
    usuario_id: USUARIO_DEMO.usuario_id,
    empresa_id: EMPRESA_ID,
    public_id: "USR-DEMO",
    nome: USUARIO_DEMO.nome,
    email: USUARIO_DEMO.email,
    provider: "demo",
    provider_id: null,
    is_active: true,
    created_at: CREATED_AT,
    updated_at: null,
    cargo: USUARIO_DEMO.cargo,
    perfil: USUARIO_DEMO.perfil,
  }
}

/** Comparação da credencial pública. O e-mail é tratado sem diferenciar caixa. */
export function isDemoCredential(email: string, password: string): boolean {
  return email.trim().toLowerCase() === DEMO_EMAIL.toLowerCase() && password === DEMO_PASSWORD
}

// ─── Sessão no navegador ─────────────────────────────────────────────────────

/** O cookie não é HTTP-only de propósito: quem cria a sessão aqui é o cliente. */
export function startDemoSession(remember = false): void {
  if (typeof document === "undefined") return
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12
  document.cookie = `${DEMO_SESSION_COOKIE}=${DEMO_SESSION_VALUE}; path=/; max-age=${maxAge}; samesite=lax`
  try {
    // Alguns painéis leem o identificador da empresa do armazenamento local.
    window.localStorage.setItem("empresa_id", EMPRESA_ID)
    window.localStorage.setItem(
      "siderprod_demo_auth",
      JSON.stringify({ empresa_id: EMPRESA_ID, usuario_id: USUARIO_DEMO.usuario_id }),
    )
  } catch {
    // Armazenamento local pode estar bloqueado; a sessão continua válida.
  }
}

export function endDemoSession(): void {
  if (typeof document === "undefined") return
  document.cookie = `${DEMO_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`
  try {
    window.localStorage.removeItem("siderprod_demo_auth")
  } catch {
    // ignorado
  }
}

export function hasDemoSessionCookie(cookieHeader?: string | null): boolean {
  const raw = cookieHeader ?? (typeof document !== "undefined" ? document.cookie : "")
  if (!raw) return false
  return raw.split(";").some((part) => part.trim() === `${DEMO_SESSION_COOKIE}=${DEMO_SESSION_VALUE}`)
}

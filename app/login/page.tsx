// app/login/page.tsx
"use client"

import React, { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff, Lock, Mail, AlertCircle, Sparkles } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { AuthLayout } from "@/components/auth/auth-layout"
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo/config"

export default function LoginPage() {
  const router = useRouter()
  const { isAuthenticated, loading: authLoading, error: authError, login } = useAuth()

  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState("")

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    remember: false,
  })

  useEffect(() => {
    if (!authLoading && isAuthenticated) router.replace("/")
  }, [authLoading, isAuthenticated, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError("")

    const email = String(formData.email ?? "").trim()
    const password = String(formData.password ?? "")

    if (!email || !password) {
      setLocalError("Email e senha são obrigatórios.")
      return
    }

    setIsSubmitting(true)
    const result = await login(email, password, formData.remember)
    setIsSubmitting(false)

    if (result.ok) {
      router.replace("/")
      return
    }

    setLocalError(result.error || "Falha no login.")
  }

  const error = localError || authError || ""

  return (
    <AuthLayout>
      {/* breadcrumb */}
      <p className="text-[9px] tracking-[0.22em] text-gray-400 uppercase font-semibold mb-5">
        Acesso · Operação
      </p>

      {/* heading */}
      <h1 className="text-[32px] font-bold text-gray-900 leading-tight tracking-tight">
        Bem-vindo ao SIDERPROD
      </h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Sistema Inteligente de Monitoramento da Produção.
      </p>

      {/* aviso de ambiente demonstrativo + credenciais públicas */}
      <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3.5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
          <span className="text-[10px] tracking-[0.16em] uppercase font-bold text-amber-800">
            Ambiente de demonstração
          </span>
        </div>
        <p className="text-[11.5px] leading-relaxed text-amber-900/80">
          Conta pública para avaliação — os dados exibidos são fictícios.
        </p>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px] font-mono text-amber-900">
          <dt className="text-amber-700/70">E-mail</dt>
          <dd className="break-all">{DEMO_EMAIL}</dd>
          <dt className="text-amber-700/70">Senha</dt>
          <dd>{DEMO_PASSWORD}</dd>
        </dl>
        <button
          type="button"
          onClick={() => setFormData((f) => ({ ...f, email: DEMO_EMAIL, password: DEMO_PASSWORD }))}
          className="mt-3 w-full rounded-md border border-amber-300 bg-white/70 px-3 py-2 text-[11px] font-semibold tracking-wide text-amber-900 transition-colors hover:bg-white"
        >
          Preencher dados de demonstração
        </button>
      </div>

      {/* error */}
      {error && !authLoading && (
        <div className="mb-6 flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {(authLoading || isAuthenticated) && (
        <div className="mb-6 text-gray-400 text-sm flex items-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          Verificando sessão...
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-7">
        {/* email */}
        <div>
          <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
            E-mail
            <span className="text-red-400">•</span>
          </label>
          <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
            <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="voce@exemplo.com"
              autoComplete="email"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
              disabled={authLoading || isSubmitting}
            />
          </div>
        </div>

        {/* senha */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold">
              Senha
              <span className="text-red-400">•</span>
            </label>
            <Link
              href="/recuperar-senha"
              className="text-[10px] tracking-[0.08em] text-gray-900 font-semibold underline underline-offset-2 hover:text-gray-700"
            >
              Esqueceu?
            </Link>
          </div>
          <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
            <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Digite sua senha"
              autoComplete="current-password"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
              disabled={authLoading || isSubmitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              disabled={authLoading || isSubmitting}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* lembrar */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.remember}
            onChange={(e) => setFormData({ ...formData, remember: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 accent-black"
            disabled={authLoading || isSubmitting}
          />
          <span className="text-[11px] tracking-[0.06em] text-gray-600">
            Manter conectado neste dispositivo
          </span>
        </label>

        {/* submit */}
        <button
          type="submit"
          disabled={authLoading || isSubmitting}
          className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <span>Entrando...</span>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </>
          ) : (
            <>
              <span>Entrar</span>
              <span className="text-base">→</span>
            </>
          )}
        </button>
      </form>

      {/* footer */}
      <p className="text-sm text-gray-500 mt-8">
        Quer conhecer o fluxo de cadastro?{" "}
        <Link href="/cadastro" className="font-bold text-gray-900 underline underline-offset-2 hover:text-gray-700">
          Ver tela de cadastro
        </Link>
      </p>

      <p className="text-[9px] tracking-widest text-gray-300 mt-10 uppercase">
        SIDERPROD · Projeto de portfólio · Dados fictícios
      </p>
    </AuthLayout>
  )
}

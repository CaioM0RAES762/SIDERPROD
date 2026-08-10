// app/cadastro/page.tsx
"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Eye, EyeOff, Lock, Mail, User, Phone, AlertCircle, Check, KeyRound,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { AuthLayout } from "@/components/auth/auth-layout"

function normalizeEmail(email: string) {
  return String(email ?? "").trim().toLowerCase()
}

/** A versão pública não restringe o domínio do e-mail. */
function isValidCompanyEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

const STEP_LABELS = ["Dados", "Verificação", "Senha"]

export default function RegisterPage() {
  const router = useRouter()
  const { isAuthenticated, loading: authLoading, error: authError, sendEmailCode, verifyEmailCode, register } = useAuth()

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // 1 = dados pessoais, 2 = verificar código, 3 = senha
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [isBusy, setIsBusy] = useState(false)
  const [localError, setLocalError] = useState("")
  const [emailVerified, setEmailVerified] = useState(false)
  const [expiresInSec, setExpiresInSec] = useState<number | null>(null)

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    code: "",
    password: "",
    confirmPassword: "",
    terms: false,
    remember: false,
  })

  const passwordRequirements = useMemo(
    () => [
      { label: "Mínimo 8 caracteres", met: formData.password.length >= 8 },
      { label: "Letra maiúscula", met: /[A-Z]/.test(formData.password) },
      { label: "Letra minúscula", met: /[a-z]/.test(formData.password) },
      { label: "Um número", met: /[0-9]/.test(formData.password) },
    ],
    [formData.password]
  )

  const error = localError || authError || ""

  useEffect(() => {
    if (!authLoading && isAuthenticated) router.replace("/")
  }, [authLoading, isAuthenticated, router])

  // Step 1 → 2: validate fields and send code
  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError("")
    const email = normalizeEmail(formData.email)

    if (!formData.name.trim()) { setLocalError("Informe seu nome completo."); return }
    if (!isValidCompanyEmail(email)) {
      setLocalError("Informe um e-mail válido.")
      return
    }
    if (!formData.phone.trim()) { setLocalError("Informe seu telefone."); return }

    setIsBusy(true)
    const res = await sendEmailCode(email)
    setIsBusy(false)

    if (!res.ok) { setLocalError(res.error); return }

    setExpiresInSec(res.expiresInSec)
    setStep(2)
  }

  // Step 2 → 3: verify code
  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError("")
    const email = normalizeEmail(formData.email)
    const code = String(formData.code ?? "").trim()

    if (!/^\d{6}$/.test(code)) {
      setLocalError("Código inválido — use os 6 dígitos do e-mail.")
      return
    }

    setIsBusy(true)
    const res = await verifyEmailCode(email, code)
    setIsBusy(false)

    if (!res.ok) { setLocalError(res.error); return }

    setEmailVerified(true)
    setStep(3)
  }

  // Step 3: create account
  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError("")

    if (!emailVerified) {
      setLocalError("Valide o e-mail antes de criar a conta.")
      setStep(1)
      return
    }
    if (formData.password !== formData.confirmPassword) {
      setLocalError("As senhas não coincidem.")
      return
    }
    if (!passwordRequirements.every((r) => r.met)) {
      setLocalError("A senha não atende aos requisitos mínimos.")
      return
    }
    if (!formData.terms) {
      setLocalError("Aceite os termos de uso para continuar.")
      return
    }

    setIsBusy(true)
    const result = await register({
      nome: formData.name,
      email: formData.email,
      senha: formData.password,
      rememberMe: formData.remember,
    })
    setIsBusy(false)

    if (result.ok) { router.replace("/"); return }
    setLocalError(result.error || "Falha ao criar conta.")
  }

  const stepHeadings = [
    "Criar sua conta",
    "Verificar e-mail",
    "Defina sua senha",
  ]
  const stepSubtitles = [
    "Preencha seus dados corporativos para continuar.",
    `Código de 6 dígitos enviado para ${normalizeEmail(formData.email) || "seu e-mail"}.`,
    "Crie uma senha segura para sua conta.",
  ]

  return (
    <AuthLayout>
      {/* step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEP_LABELS.map((label, i) => {
          const s = (i + 1) as 1 | 2 | 3
          const isActive = step === s
          const isDone = step > s
          return (
            <React.Fragment key={s}>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-7 h-7 flex items-center justify-center text-[11px] font-bold transition-all ${
                    isDone
                      ? "bg-black text-white"
                      : isActive
                      ? "bg-black text-white"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : s}
                </div>
              </div>
              {s < 3 && (
                <div
                  className={`flex-1 h-px mx-2 transition-colors ${
                    step > s ? "bg-black" : "bg-gray-200"
                  }`}
                  style={{ minWidth: 28 }}
                />
              )}
            </React.Fragment>
          )
        })}
        <span className="ml-3 text-[9px] tracking-[0.18em] text-gray-400 uppercase whitespace-nowrap font-semibold">
          Passo {step} de 3
        </span>
      </div>

      {/* breadcrumb */}
      <p className="text-[9px] tracking-[0.22em] text-gray-400 uppercase font-semibold mb-4">
        Nova Conta · Operação
      </p>

      {/* heading */}
      <h1 className="text-[30px] font-bold text-gray-900 leading-tight tracking-tight">
        {stepHeadings[step - 1]}
      </h1>
      <p className="text-sm text-gray-500 mt-1 mb-7">
        {stepSubtitles[step - 1]}
      </p>

      {/* error */}
      {error && (
        <div className="mb-6 flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── STEP 1: Dados pessoais ── */}
      {step === 1 && (
        <form onSubmit={handleStep1} className="space-y-6">
          {/* nome */}
          <div>
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
              Nome Completo <span className="text-red-400">•</span>
            </label>
            <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
              <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Seu nome completo"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                disabled={isBusy}
              />
            </div>
          </div>

          {/* email */}
          <div>
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
              Email Corporativo <span className="text-red-400">•</span>
            </label>
            <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
              <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="voce@exemplo.com"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                disabled={isBusy}
              />
            </div>
            <p className="text-[9px] tracking-[0.12em] uppercase text-gray-400 mt-1.5">
              Cadastro desativado nesta demonstração — use a conta pública indicada no login
            </p>
          </div>

          {/* telefone */}
          <div>
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
              Telefone <span className="text-red-400">•</span>
            </label>
            <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
              <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(00) 00000-0000"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                disabled={isBusy}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isBusy}
            className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <>
                <span>Enviando código...</span>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </>
            ) : (
              <>
                <span>Enviar código de verificação</span>
                <span className="text-base">→</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* ── STEP 2: Verificar código ── */}
      {step === 2 && (
        <form onSubmit={handleStep2} className="space-y-6">
          {expiresInSec && (
            <p className="text-[10px] text-gray-400 tracking-wide">
              Código válido por aprox. {Math.ceil(expiresInSec / 60)} min.
            </p>
          )}

          {/* code OTP input */}
          <div>
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
              Código (6 dígitos) <span className="text-red-400">•</span>
            </label>
            <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
              <KeyRound className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.replace(/\D/g, "").slice(0, 6) })
                }
                placeholder="000000"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none tracking-[0.35em] font-mono"
                disabled={isBusy}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isBusy || formData.code.length < 6}
            className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <>
                <span>Verificando...</span>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </>
            ) : (
              <>
                <span>Verificar e continuar</span>
                <span className="text-base">→</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => { setStep(1); setLocalError("") }}
            className="w-full text-center text-[11px] text-gray-400 hover:text-gray-700 transition-colors tracking-wide"
          >
            ← Voltar e editar dados
          </button>
        </form>
      )}

      {/* ── STEP 3: Senha ── */}
      {step === 3 && (
        <form onSubmit={handleStep3} className="space-y-6">
          {/* e-mail verificado badge */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <div className="w-4 h-4 rounded-full bg-black flex items-center justify-center flex-shrink-0">
              <Check className="w-2.5 h-2.5 text-white" />
            </div>
            <span>E-mail verificado: <strong className="text-gray-800">{normalizeEmail(formData.email)}</strong></span>
          </div>

          {/* senha */}
          <div>
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
              Senha <span className="text-red-400">•</span>
            </label>
            <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
              <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Crie uma senha forte"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                disabled={isBusy}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* requirements */}
          <div className="grid grid-cols-2 gap-2">
            {passwordRequirements.map((req, i) => (
              <div key={i} className={`flex items-center gap-1.5 text-[10px] ${req.met ? "text-gray-800" : "text-gray-400"}`}>
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${req.met ? "bg-black" : "bg-gray-200"}`}>
                  {req.met && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                {req.label}
              </div>
            ))}
          </div>

          {/* confirmar senha */}
          <div>
            <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
              Confirmar Senha <span className="text-red-400">•</span>
            </label>
            <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
              <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="Repita sua senha"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                disabled={isBusy}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* terms */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.terms}
              onChange={(e) => setFormData({ ...formData, terms: e.target.checked })}
              className="w-4 h-4 mt-0.5 rounded border-gray-300 accent-black"
              disabled={isBusy}
            />
            <span className="text-[11px] text-gray-600 leading-relaxed">
              Li e aceito os{" "}
              <a href="#" className="font-semibold text-gray-900 underline underline-offset-2">
                Termos de Uso
              </a>{" "}
              e a{" "}
              <a href="#" className="font-semibold text-gray-900 underline underline-offset-2">
                Política de Privacidade
              </a>
            </span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.remember}
              onChange={(e) => setFormData({ ...formData, remember: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 accent-black"
              disabled={isBusy}
            />
            <span className="text-[11px] text-gray-600">Manter conectado</span>
          </label>

          <button
            type="submit"
            disabled={isBusy}
            className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <>
                <span>Criando conta...</span>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </>
            ) : (
              <>
                <span>Criar conta</span>
                <span className="text-base">→</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* footer */}
      <p className="text-sm text-gray-500 mt-8">
        Já tem uma conta?{" "}
        <Link href="/login" className="font-bold text-gray-900 underline underline-offset-2 hover:text-gray-700">
          Faça login
        </Link>
      </p>

      <p className="text-[9px] tracking-widest text-gray-300 mt-8 uppercase">
        SIDERPROD · Projeto de portfólio · Dados fictícios
      </p>
    </AuthLayout>
  )
}

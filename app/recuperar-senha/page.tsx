"use client"

import React, { useState } from "react"
import { Mail, Lock, KeyRound, AlertCircle, Check, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { AuthLayout } from "@/components/auth/auth-layout"

export default function RecuperarSenhaPage() {
  const [step, setStep] = useState<"EMAIL" | "CODE_PASSWORD" | "SUCCESS">("EMAIL")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao solicitar recuperação.")
      setStep("CODE_PASSWORD")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao redefinir a senha.")
      setStep("SUCCESS")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      {/* back link */}
      {step !== "SUCCESS" && (
        <Link
          href="/login"
          onClick={() => step === "CODE_PASSWORD" ? setStep("EMAIL") : undefined}
          className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.2em] uppercase text-gray-400 font-semibold hover:text-gray-700 transition-colors mb-7"
        >
          <ArrowLeft className="w-3 h-3" />
          Voltar
        </Link>
      )}

      {/* error */}
      {error && (
        <div className="mb-6 flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── SUCCESS ── */}
      {step === "SUCCESS" && (
        <>
          <div className="w-14 h-14 rounded-full bg-black flex items-center justify-center mb-6">
            <Check className="w-6 h-6 text-white" />
          </div>
          <p className="text-[9px] tracking-[0.22em] text-gray-400 uppercase font-semibold mb-3">
            Recuperação · Concluída
          </p>
          <h1 className="text-[32px] font-bold text-gray-900 leading-tight tracking-tight">
            Senha alterada!
          </h1>
          <p className="text-sm text-gray-500 mt-2 mb-8">
            Sua senha foi redefinida com sucesso. Acesse com a nova credencial.
          </p>
          <Link
            href="/login"
            className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors"
          >
            <span>Ir para o login</span>
            <span className="text-base">→</span>
          </Link>
        </>
      )}

      {/* ── CODE + NEW PASSWORD ── */}
      {step === "CODE_PASSWORD" && (
        <>
          <p className="text-[9px] tracking-[0.22em] text-gray-400 uppercase font-semibold mb-5">
            Recuperação · Nova senha
          </p>
          <h1 className="text-[32px] font-bold text-gray-900 leading-tight tracking-tight">
            Nova senha
          </h1>
          <p className="text-sm text-gray-500 mt-1 mb-8">
            Código de 6 dígitos enviado para{" "}
            <span className="font-semibold text-gray-700">{email}</span>.
          </p>

          <form onSubmit={handleResetPassword} className="space-y-7">
            {/* código */}
            <div>
              <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
                Código de verificação
                <span className="text-red-400">•</span>
              </label>
              <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
                <KeyRound className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  required
                  className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none tracking-[0.3em]"
                />
              </div>
            </div>

            {/* nova senha */}
            <div>
              <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
                Nova Senha
                <span className="text-red-400">•</span>
              </label>
              <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
                <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || code.length < 6 || !newPassword}
              className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <span>Salvando...</span>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </>
              ) : (
                <>
                  <span>Salvar nova senha</span>
                  <span className="text-base">→</span>
                </>
              )}
            </button>
          </form>
        </>
      )}

      {/* ── EMAIL STEP ── */}
      {step === "EMAIL" && (
        <>
          <p className="text-[9px] tracking-[0.22em] text-gray-400 uppercase font-semibold mb-5">
            Recuperação · Acesso
          </p>
          <h1 className="text-[32px] font-bold text-gray-900 leading-tight tracking-tight">
            Recuperar senha
          </h1>
          <p className="text-sm text-gray-500 mt-1 mb-8">
            Digite seu e-mail corporativo para receber o código de recuperação.
          </p>

          <form onSubmit={handleRequestCode} className="space-y-7">
            <div>
              <label className="flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase text-gray-500 font-semibold mb-2">
                Email Corporativo
                <span className="text-red-400">•</span>
              </label>
              <div className="flex items-center gap-3 border-b border-gray-300 pb-2.5 focus-within:border-gray-900 transition-colors">
                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  required
                  className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-300 outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !email}
              className="w-full bg-black text-white py-4 px-6 flex items-center justify-between text-sm font-semibold tracking-wide hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <span>Enviando...</span>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </>
              ) : (
                <>
                  <span>Enviar código de recuperação</span>
                  <span className="text-base">→</span>
                </>
              )}
            </button>
          </form>

          <p className="text-sm text-gray-500 mt-8">
            Lembrou a senha?{" "}
            <Link href="/login" className="font-bold text-gray-900 underline underline-offset-2 hover:text-gray-700">
              Voltar ao login
            </Link>
          </p>
        </>
      )}

      <p className="text-[9px] tracking-widest text-gray-300 mt-10 uppercase">
        SIDERPROD · Projeto de portfólio · Dados fictícios
      </p>
    </AuthLayout>
  )
}

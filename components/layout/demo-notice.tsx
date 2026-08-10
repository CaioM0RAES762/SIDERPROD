"use client"

import { useState } from "react"
import { Info, X } from "lucide-react"

import { DEMO_EMAIL } from "@/lib/demo/config"

/**
 * Selo discreto de ambiente demonstrativo.
 *
 * Fica no cabeçalho, ao lado do indicador "ao vivo". Ao clicar, explica em uma
 * frase o que o visitante está vendo — sem faixas grandes em cima dos painéis,
 * que atrapalhariam a leitura das telas.
 */
export function DemoNotice() {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label="Sobre este ambiente"
        className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors"
        style={{
          background: "rgba(232,99,10,0.12)",
          border: "1px solid rgba(232,99,10,0.28)",
          color: "#f0a06a",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        <Info className="w-3 h-3" />
        <span className="hidden md:inline">Demo</span>
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} aria-hidden />
          <div
            className="absolute right-0 z-50 mt-2 w-[280px] rounded-lg p-3.5 shadow-xl"
            style={{ background: "#171a21", border: "1px solid rgba(255,255,255,0.09)" }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "0.06em" }}>
                AMBIENTE DEMONSTRATIVO
              </p>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="text-white/30 hover:text-white/70"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p style={{ fontSize: "11.5px", lineHeight: 1.6, color: "rgba(255,255,255,0.55)" }}>
              Versão de portfólio do SIDERPROD. Todos os números são gerados pela
              própria aplicação — não há banco de dados, ERP ou coleta de sensores
              por trás desta tela. As alterações que você fizer valem enquanto a
              aba estiver aberta.
            </p>
            <p
              className="mt-2.5 pt-2.5"
              style={{
                fontSize: "10.5px",
                color: "rgba(255,255,255,0.32)",
                borderTop: "1px solid rgba(255,255,255,0.07)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              conta pública · {DEMO_EMAIL}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// app/opengraph-image.tsx
//
// Imagem de compartilhamento (OpenGraph / Twitter). Gerada no build, sem
// dependências externas nem fontes remotas.

import { ImageResponse } from "next/og"

export const alt = "SIDERPROD — Plataforma demonstrativa de monitoramento da produção industrial"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0f1117",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 44 }}>
            <div style={{ width: 12, height: 20, background: "#E8630A", borderRadius: 3 }} />
            <div style={{ width: 12, height: 30, background: "#E8630A", borderRadius: 3, opacity: 0.85 }} />
            <div style={{ width: 12, height: 44, background: "#F0E8DC", borderRadius: 3 }} />
            <div style={{ width: 12, height: 26, background: "#F0E8DC", borderRadius: 3, opacity: 0.55 }} />
          </div>
          <div style={{ display: "flex", fontSize: 40, letterSpacing: -1 }}>
            <span style={{ color: "#E8630A", fontWeight: 800 }}>SIDER</span>
            <span style={{ color: "#F0E8DC", fontWeight: 300 }}>PROD</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 66, fontWeight: 800, color: "#F0E8DC", lineHeight: 1.05 }}>
            Chão de fábrica.
          </div>
          <div style={{ fontSize: 66, fontWeight: 200, color: "#6B5A4E", lineHeight: 1.05 }}>
            Sob controle total.
          </div>
          <div style={{ marginTop: 26, fontSize: 26, color: "#8A7A6C", maxWidth: 860, lineHeight: 1.4 }}>
            OEE em tempo real, apontamento de paradas, análise de perdas e planos de
            ação — em uma plataforma MES completa.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 20, color: "#4A3E34", letterSpacing: 4, textTransform: "uppercase" }}>
            Ambiente demonstrativo · dados fictícios
          </div>
          <div style={{ display: "flex", gap: 28 }}>
            {[
              ["OEE médio", "78,4%"],
              ["Postos", "12"],
              ["Turnos", "3"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 15, color: "#5A4A3C", letterSpacing: 2, textTransform: "uppercase" }}>
                  {label}
                </div>
                <div style={{ fontSize: 30, color: "#F0E8DC", fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  )
}

// app/layout.tsx
import React from "react"
import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { IBM_Plex_Mono } from "next/font/google"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import "./globals.css"

import { demoUserPayload, type SessionUser } from "@/lib/demo/auth"
import { DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE } from "@/lib/demo/config"
import { Providers } from "./providers"

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

const inter = localFont({
  src: [
    { path: "../public/fonts/inter/inter-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/inter/inter-500.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/inter/inter-600.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/inter/inter-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
})

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
}

export const metadata: Metadata = {
  title: {
    default: "SIDERPROD — Monitoramento da Produção Industrial",
    template: "%s · SIDERPROD",
  },
  description:
    "Plataforma demonstrativa de monitoramento e gestão da produção industrial: OEE em tempo real, apontamento de paradas, análise de perdas e planos de ação. Dados fictícios.",
  applicationName: "SIDERPROD",
  authors: [{ name: "Caio Moraes" }],
  keywords: ["MES", "OEE", "indústria 4.0", "monitoramento de produção", "dashboard industrial", "Next.js"],
  openGraph: {
    type: "website",
    siteName: "SIDERPROD",
    title: "SIDERPROD — Monitoramento da Produção Industrial",
    description:
      "Demonstração pública de uma plataforma MES: OEE por turno, status dos postos em tempo real, Pareto de paradas e relatórios consolidados.",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
    title: "SIDERPROD — Monitoramento da Produção Industrial",
    description: "Demonstração pública de uma plataforma MES industrial. Dados fictícios.",
  },
  robots: { index: true, follow: true },
}

const publicRoutes = ["/login", "/cadastro", "/recuperar-senha"]

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  // Sessão da demonstração: presença de um cookie opaco, sem consulta externa.
  const cookieStore = await cookies()
  const autenticado = cookieStore.get(DEMO_SESSION_COOKIE)?.value === DEMO_SESSION_VALUE
  const user: SessionUser | null = autenticado ? demoUserPayload() : null

  if (!user && !isPublicRoute) redirect("/login")
  if (user && isPublicRoute) redirect("/")

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.variable} ${ibmPlexMono.variable} font-sans antialiased bg-page text-slate-950`}>
        <Providers user={user}>{children}</Providers>
      </body>
    </html>
  )
}

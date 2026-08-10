// app/providers.tsx
"use client"

import React, { createContext, useContext } from "react"

import type { SessionUser } from "@/lib/demo/auth"
import { installDemoFetch } from "@/lib/demo/client"

// A troca do transporte acontece no escopo do módulo, antes de qualquer efeito
// de componente rodar — assim nenhum hook chega a disparar uma requisição de
// rede de verdade, nem no primeiro render.
installDemoFetch()

const SessionContext = createContext<SessionUser | null>(null)

export function useSession() {
  return useContext(SessionContext)
}

export function Providers({
  children,
  user,
}: {
  children: React.ReactNode
  user: SessionUser | null
}) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
}

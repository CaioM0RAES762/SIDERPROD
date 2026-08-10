// lib/demo/client.ts
//
// Interceptador de rede do modo demonstração.
//
// Em vez de reescrever cada tela para ler de um mock, a versão pública mantém a
// arquitetura original (componentes → hooks → `fetch("/api/...")`) e substitui
// apenas o transporte: toda chamada para `/api/**` é resolvida em memória pelo
// roteador de lib/demo/api.ts e nunca chega à rede.
//
// Duas consequências que interessam a quem avalia o projeto:
//   • a aba Network do navegador não mostra nenhuma requisição a servidor algum;
//   • as ações de escrita (justificar parada, apontar peça, criar plano) alteram
//     o estado da demo de verdade e a tela reflete a mudança na revalidação.

import { DEMO_WRITE_LATENCY_MS } from "./config"
import { handleDemoRequest, type DemoHttpResponse } from "./api"
import { hasDemoSessionCookie } from "./auth"

const MARKER = "__siderprodDemoFetch"

type PatchedFetch = typeof fetch & { [MARKER]?: boolean }

function toResponse(result: DemoHttpResponse, url: string): Response {
  if (result.redirect && typeof window !== "undefined") {
    window.location.href = result.redirect
  }

  const body = result.body === null || result.body === undefined ? "" : JSON.stringify(result.body)

  return new Response(body, {
    status: result.redirect ? 200 : result.status,
    statusText: result.status >= 400 ? "Demo error" : "OK",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-siderprod-demo": "1",
      "x-siderprod-demo-path": url,
    },
  })
}

async function readBody(init?: RequestInit): Promise<unknown> {
  const raw = init?.body
  if (raw == null) return undefined
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return undefined
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Instala o interceptador. Chamado no escopo de módulo do provider de sessão,
 * antes de qualquer efeito de componente disparar.
 */
export function installDemoFetch(): void {
  if (typeof window === "undefined") return

  const original = window.fetch as PatchedFetch
  if (original?.[MARKER]) return

  const patched: PatchedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL
    let method = (init?.method ?? "GET").toUpperCase()
    let body: unknown

    try {
      if (input instanceof Request) {
        url = new URL(input.url, window.location.origin)
        method = (init?.method ?? input.method ?? "GET").toUpperCase()
        body = init?.body != null ? await readBody(init) : await input.clone().json().catch(() => undefined)
      } else {
        url = new URL(String(input), window.location.origin)
        body = await readBody(init)
      }
    } catch {
      return original(input as RequestInfo, init)
    }

    const mesmaOrigem = url.origin === window.location.origin
    if (!mesmaOrigem || !url.pathname.startsWith("/api/")) {
      return original(input as RequestInfo, init)
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }

    // Latência curta apenas nas mutações, para a interface exercitar os
    // estados de carregamento como faria contra um servidor real.
    if (method !== "GET" && DEMO_WRITE_LATENCY_MS > 0) {
      await delay(DEMO_WRITE_LATENCY_MS)
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
    }

    const result = await handleDemoRequest({
      method,
      path: url.pathname.replace(/^\/api\//, ""),
      searchParams: url.searchParams,
      body,
      authenticated: hasDemoSessionCookie(),
    })

    return toResponse(result, url.pathname)
  }

  patched[MARKER] = true
  window.fetch = patched
}

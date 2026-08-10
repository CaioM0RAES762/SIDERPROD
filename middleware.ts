// middleware.ts
//
// Proteção de rotas da demonstração.
//
// Mantém o comportamento visual do sistema original — quem não entrou vai para
// /login e volta para a página pedida depois de autenticar — usando apenas a
// presença do cookie de sessão da demo. Não há consulta a banco, validação de
// token assinado ou chamada de rede: a versão pública não tem o que proteger.

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const SESSION_COOKIE = "siderprod_demo_session"
const SESSION_VALUE = "demo-session-v1"

const publicRoutes = ["/login", "/cadastro", "/recuperar-senha"]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // A API de demonstração é aberta: ela só devolve dados fictícios.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))
  const hasSession = req.cookies.get(SESSION_COOKIE)?.value === SESSION_VALUE

  if (!hasSession && !isPublicRoute) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (hasSession && isPublicRoute) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  // O layout usa este cabeçalho para saber a rota atual.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-pathname", pathname)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
}

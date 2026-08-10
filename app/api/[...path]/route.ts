// app/api/[...path]/route.ts
//
// Rota coringa da demonstração.
//
// No navegador as chamadas para `/api/**` já são resolvidas em memória pelo
// interceptador (lib/demo/client.ts) e nunca saem da aba. Esta rota existe para
// o caso de alguém chamar a API diretamente (curl, um teste, um link colado):
// ela responde o mesmo JSON fictício, a partir do mesmo gerador.
//
// Ela não conversa com banco de dados, fila ou serviço externo — o projeto
// público sequer traz driver de banco nas dependências.

import { NextResponse, type NextRequest } from "next/server"

import { handleDemoRequest } from "@/lib/demo/api"
import { DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE } from "@/lib/demo/config"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ path?: string[] }> }

async function resolve(req: NextRequest, ctx: Ctx, body?: unknown) {
  const { path } = await ctx.params
  const url = new URL(req.url)

  const result = await handleDemoRequest({
    method: req.method,
    path: (path ?? []).join("/"),
    searchParams: url.searchParams,
    body,
    authenticated: req.cookies.get(DEMO_SESSION_COOKIE)?.value === DEMO_SESSION_VALUE,
  })

  if (result.redirect) {
    return NextResponse.redirect(new URL(result.redirect, req.url))
  }

  return NextResponse.json(result.body ?? null, {
    status: result.status,
    headers: { "x-siderprod-demo": "1" },
  })
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return resolve(req, ctx)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return resolve(req, ctx, await readJson(req))
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return resolve(req, ctx, await readJson(req))
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  return resolve(req, ctx, await readJson(req))
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return resolve(req, ctx, await readJson(req))
}

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Guardas de isolamento.
 *
 * Esta versão é pública: os testes abaixo falham se alguém reintroduzir uma
 * dependência de infraestrutura real, uma credencial ou um endereço interno.
 */

const RAIZ = join(__dirname, "..")
const PASTAS = ["app", "components", "hooks", "lib", "tests"]
const EXTENSOES = [".ts", ".tsx", ".js", ".mjs", ".json", ".css"]

function listarArquivos(dir: string): string[] {
  const out: string[] = []
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) out.push(...listarArquivos(caminho))
    else if (EXTENSOES.some((e) => entrada.endsWith(e))) out.push(caminho)
  }
  return out
}

// Este próprio arquivo é excluído da varredura: ele contém, por necessidade,
// justamente os padrões que procura.
const ARQUIVOS = PASTAS.flatMap((p) => listarArquivos(join(RAIZ, p))).filter(
  (a) => !a.endsWith("isolation.test.ts"),
)

/** Caminho relativo com barras normais, independente do sistema operacional. */
function relativo(caminho: string): string {
  return caminho.slice(RAIZ.length + 1).split(sep).join("/")
}

function buscar(regex: RegExp): string[] {
  const achados: string[] = []
  for (const arquivo of ARQUIVOS) {
    const conteudo = readFileSync(arquivo, "utf8")
    if (regex.test(conteudo)) achados.push(relativo(arquivo))
  }
  return achados.sort()
}

describe("isolamento da infraestrutura", () => {
  const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  it("não declara driver de banco, cliente SMTP ou hash de senha", () => {
    for (const proibida of [
      "mssql",
      "@types/mssql",
      "tedious",
      "pg",
      "mysql",
      "mysql2",
      "sqlite3",
      "prisma",
      "@prisma/client",
      "mongodb",
      "redis",
      "ioredis",
      "nodemailer",
      "bcrypt",
      "bcryptjs",
      "@supabase/supabase-js",
    ]) {
      expect(Object.keys(deps)).not.toContain(proibida)
    }
  })

  it("não lê variáveis de conexão com banco de dados", () => {
    expect(buscar(/process\.env\.(DB_|DATABASE_URL|SQL_|SMTP_|JWT_SECRET|INTERNAL_API_SECRET)/)).toEqual([])
  })

  it("não contém endereços de rede privados", () => {
    expect(buscar(/\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/)).toEqual([])
  })

  it("não contém strings de conexão", () => {
    expect(buscar(/(sqlserver|postgres(ql)?|mysql|mongodb):\/\//i)).toEqual([])
    expect(buscar(/\b(Server|Data Source)\s*=.*(Password|Pwd)\s*=/i)).toEqual([])
  })

  it("só usa endereços de e-mail fictícios", () => {
    // Qualquer e-mail no código precisa ser o da conta pública ou de um domínio
    // reservado para exemplos (RFC 2606). Impede que um endereço corporativo
    // real entre junto com um trecho copiado de outro sistema.
    const permitidos = /^(user_teste@gmail\.com|[a-z0-9._-]+@(exemplo\.com|example\.(com|org|net)|noreply\.[a-z]+))$/i
    const encontrados = new Set<string>()

    for (const arquivo of ARQUIVOS) {
      const conteudo = readFileSync(arquivo, "utf8")
      for (const email of conteudo.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
        if (!permitidos.test(email)) encontrados.add(`${relativo(arquivo)} → ${email}`)
      }
    }

    expect([...encontrados]).toEqual([])
  })

  it("não faz chamadas para hosts externos", () => {
    // Toda requisição da aplicação é relativa (`/api/...`) e resolvida em memória.
    expect(buscar(/fetch\(\s*["'`]https?:\/\//)).toEqual([])
  })

  it("mantém a credencial da demo apenas como constante pública documentada", () => {
    expect(buscar(/Teste54321/)).toEqual(["lib/demo/config.ts"])
  })
})

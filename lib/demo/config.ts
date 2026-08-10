// lib/demo/config.ts
//
// Configuração única do modo demonstração.
//
// Esta versão pública do SIDERPROD roda SEMPRE em modo demonstração: não existe
// driver de banco, cliente SMTP ou chamada HTTP para qualquer serviço externo no
// bundle. As constantes abaixo existem para deixar isso explícito no código (e
// para permitir trocar a "fábrica" gerada apenas mudando a semente).

/** Modo demonstração. Nesta versão pública é sempre verdadeiro. */
export const DEMO_MODE = true

/** Semente do gerador determinístico. Muda a fábrica inteira. */
export const DEMO_SEED =
  process.env.NEXT_PUBLIC_DEMO_SEED?.trim() || "siderprod-2026"

/** Nome do produto exibido na interface. */
export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || "SIDERPROD"

export const APP_TAGLINE = "Sistema Inteligente de Monitoramento da Produção"

/** Cookie de sessão da demo. Não carrega dado sensível: só um marcador opaco. */
export const DEMO_SESSION_COOKIE = "siderprod_demo_session"

/** Valor gravado no cookie quando a sessão demo está ativa. */
export const DEMO_SESSION_VALUE = "demo-session-v1"

/** Credenciais públicas da demonstração — divulgadas no README e na tela de login. */
export const DEMO_EMAIL = "User_teste@gmail.com"
export const DEMO_PASSWORD = "Teste54321"

/** Fuso usado para recortar turnos e o "dia operacional" (06h → 06h). */
export const DEMO_TZ_OFFSET_HOURS = -3 // America/Sao_Paulo

/** Hora local em que começa o dia operacional. */
export const OPERATIONAL_DAY_START_HOUR = 6

/** Latência simulada nas mutações, para a UI exercitar estados de carregamento. */
export const DEMO_WRITE_LATENCY_MS = 320

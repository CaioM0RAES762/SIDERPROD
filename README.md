# SIDERPROD

**Sistema Inteligente de Monitoramento da Produção** — plataforma MES
demonstrativa para acompanhamento de chão de fábrica: OEE em tempo real,
apontamento de paradas, análise de perdas, histórico, planos de melhoria e
logística de ordens.

[![Demo online](https://img.shields.io/badge/demo-siderprod.vercel.app-E8630A?style=for-the-badge)](https://siderprod.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Licença MIT](https://img.shields.io/badge/licença-MIT-6B7280?style=for-the-badge)](LICENSE)

[![SIDERPROD](https://siderprod.vercel.app/opengraph-image)](https://siderprod.vercel.app)

> ⚠️ **Ambiente de demonstração.** Todos os dados exibidos são **fictícios** e
> gerados pela própria aplicação. Não há banco de dados, ERP, coleta de sensores
> ou qualquer infraestrutura industrial por trás desta versão.

---

## Sobre o projeto

O SIDERPROD é a versão pública de portfólio de um sistema MES (*Manufacturing
Execution System*) que acompanha a operação de uma planta industrial posto a
posto. A interface responde às perguntas que um supervisor de produção faz
durante o turno:

- **O que está rodando agora?** Grade de postos com status ao vivo, ordem em
  execução, produto, ciclo e tempo no estado atual.
- **Estamos no ritmo?** Produção real contra a meta hora a hora, no dia
  operacional (06h → 06h), consolidada e por centro de trabalho.
- **Onde estamos perdendo?** OEE decomposto em disponibilidade, performance e
  qualidade, com Pareto de causas de parada.
- **O que foi feito a respeito?** Anotações de turno, planos de ação 5W e planos
  de melhoria ligados aos grupos de perda.

A versão pública preserva integralmente a interface do sistema original: o que
mudou foi a **camada de dados**, substituída por um gerador determinístico que
roda inteiramente em memória.

---

## Demonstração online

**🔗 [Acesse a demonstração](https://siderprod.vercel.app)**

### Conta de demonstração

| Campo   | Valor                 |
| ------- | --------------------- |
| E-mail  | `User_teste@gmail.com` |
| Senha   | `Teste54321`          |

A tela de login traz um botão **“Preencher dados de demonstração”** que
preenche o formulário automaticamente.

> Estas credenciais são **públicas e propositais**: existem apenas nesta
> demonstração, não dão acesso a nenhum sistema real e não são reaproveitadas de
> nenhum ambiente de produção.

---

## Funcionalidades

### Dashboard operacional
- Grade de 12 postos com status ao vivo (produzindo / parado + causa).
- Indicadores do turno: total de postos, produzindo, parados, OEE médio.
- OEE consolidado por turno do dia operacional, decomposto em D × P × Q.
- Pareto de paradas do dia, por causa, com percentual acumulado.
- Real × meta por hora, empilhado por centro de trabalho.
- Filtros por setor e por centro, busca e alternância entre grade e lista.

### Tela do posto
- Cabeçalho ao vivo: ordem, produto, rebarbador, apontador e progresso do
  programa da peça.
- Produção por hora, ciclo médio × ciclo ideal e linha do tempo do turno.
- Apontamento manual de produção, refugo e retrabalho.
- Início e retomada de parada, justificativa individual e em massa.
- Fila de ordens do posto, com regra de encerramento por quantidade ou horário.

### Analítico e Histórico
- Abas de OEE, produção, paradas, refugo, retrabalho, ciclo, perdas e
  rebarbadores.
- Granularidade por hora, turno, dia operacional, dia, semana e mês.
- Filtros combináveis por período, setor, centro, turno, produto e ordem.
- Pareto de motivos e ranking de operadores por peças/hora e aderência à meta.

### Relatório consolidado
- Produção hora a hora e por dia, com detalhamento por centro.
- Cascata de perdas: capacidade teórica → disponibilidade → performance →
  qualidade → produção efetiva.
- Paradas reportadas e Pareto por motivo com abertura por centro.
- Produção por ordem, planos de ação e anotações do período.

### Gestão
- Anotações de turno com anexos.
- Planos de ação (5W) com responsável, prazo e estado.
- Planos de melhoria ligados a grupos de perda.
- Logística de ordens: Kanban, fila por posto, carga e ordens executadas.

---

## Tecnologias

| Camada        | Stack                                                      |
| ------------- | ---------------------------------------------------------- |
| Framework     | Next.js 16 (App Router, Turbopack) · React 19              |
| Linguagem     | TypeScript 5                                               |
| Estilo        | Tailwind CSS 4 · Radix UI · lucide-react                   |
| Dados (client)| SWR                                                        |
| Gráficos      | Recharts + canvas próprio nas visualizações do posto       |
| Formulários   | React Hook Form · Zod                                      |
| Testes        | Vitest                                                     |
| Qualidade     | ESLint 9 (flat config, `eslint-config-next`)               |
| Hospedagem    | Vercel                                                     |

Sem banco de dados, ORM, fila, cache externo ou cliente de e-mail — nem em
`dependencies`, nem em `devDependencies`.

---

## Modo demonstração

A aplicação pública roda **sempre** em modo demonstração. A arquitetura original
(componentes → hooks → `fetch("/api/...")`) foi preservada; o que mudou foi o
transporte:

```
componentes  →  hooks (SWR)  →  fetch("/api/...")
                                     │
                     ┌───────────────┴───────────────┐
                     │                               │
        lib/demo/client.ts                app/api/[...path]/route.ts
     (intercepta no navegador)          (mesma resposta no servidor)
                     │                               │
                     └───────────────┬───────────────┘
                                     ▼
                             lib/demo/api.ts
                          (roteador da demo)
                                     ▼
              views · reports · logistics  ──►  factory  ──►  catalog
                                                   │
                                              store (escritas)
```

- **`lib/demo/factory.ts`** gera o plano de produção de cada posto em cada dia
  operacional a partir de uma semente: ordens, paradas e buckets horários.
- **`lib/demo/views.ts`, `reports.ts`, `logistics.ts`** derivam desse plano
  todas as visões das telas — por isso os números **fecham entre os painéis**.
- **`lib/demo/store.ts`** guarda o que o visitante faz (apontar, justificar,
  criar plano). Vale enquanto a aba estiver aberta; um F5 devolve a fábrica ao
  estado gerado.
- **`lib/demo/client.ts`** troca `window.fetch` no escopo do módulo, antes de
  qualquer efeito de componente rodar. **A aba Network não mostra requisição
  alguma para servidor.**

### Coerência dos dados

O dataset não é uma coleção de números soltos — cada indicador é derivado do
mesmo plano, respeitando as identidades clássicas de OEE:

```
total          = boas + refugo + retrabalho
tempo planejado = tempo decorrido  − paradas planejadas
tempo operante  = tempo planejado  − paradas não planejadas
disponibilidade = tempo operante / tempo planejado
performance     = (ciclo ideal × total) / tempo operante
qualidade       = boas / total
OEE             = disponibilidade × performance × qualidade
```

Uma parada de 40 minutos aparece, ao mesmo tempo, na disponibilidade do turno,
no Pareto de causas, no histórico e no buraco da produção daquela hora. Essas
identidades são verificadas pelos testes automatizados.

### Dados fictícios gerados

Uma siderúrgica inventada, com 4 setores e 12 centros de trabalho:

- **Fundição** — 2 fornos de indução, 2 células de moldagem automática
- **Usinagem** — 3 centros de usinagem
- **Acabamento** — 3 postos
- **Rebarbação** — 2 postos em modo retrabalho

Mais 8 produtos com ciclos de 26 s a 145 s, 3 turnos de 8 h, 12 motivos de
parada (planejados e não planejados) divididos em grupos de perda, ordens de
produção, quadro de funcionários, anotações, planos de ação e planos de melhoria.

Trocar `NEXT_PUBLIC_DEMO_SEED` gera outra fábrica inteira.

---

## Executar localmente

Requisitos: **Node.js 20+**.

```bash
git clone https://github.com/CaioM0RAES762/SIDERPROD.git
cd SIDERPROD
npm ci
npm run dev
```

A aplicação sobe em `http://localhost:3000`. Não é necessário nenhum arquivo
`.env` — o projeto roda sem configuração. Entre com a conta de demonstração
acima.

### Scripts

| Comando          | O que faz                                      |
| ---------------- | ---------------------------------------------- |
| `npm run dev`    | Servidor de desenvolvimento                    |
| `npm run build`  | Build de produção (inclui verificação de tipos) |
| `npm start`      | Servidor de produção                           |
| `npm run lint`   | ESLint                                         |
| `npm test`       | Suíte Vitest                                   |

### Variáveis de ambiente

Todas são públicas e opcionais — veja [`.env.example`](.env.example).

| Variável                 | Padrão            | Para que serve                        |
| ------------------------ | ----------------- | ------------------------------------- |
| `NEXT_PUBLIC_DEMO_SEED`  | `siderprod-2026`  | Semente do gerador de dados           |
| `NEXT_PUBLIC_APP_NAME`   | `SIDERPROD`       | Nome exibido na interface             |

---

## Arquitetura

```
app/
  page.tsx                  Dashboard operacional
  posto/[id]/               Tela do posto
  analitico/                Análise por turno com filtros combináveis
  historico/                Séries históricas por granularidade
  relatorio-consolidado/    Relatório fechado do período
  plano-acao/               Planos de ação 5W
  anotacao/                 Anotações de turno
  planos-melhoria/          Planos de melhoria
  logistica-ordens/         Kanban, fila, carga e executadas
  admin/usuarios/           Quadro de usuários (somente leitura)
  api/[...path]/            Rota coringa que serve a API de demonstração
components/
  layout/                   Cabeçalho, menu lateral e selo de ambiente
  posto/                    Modais, gráficos e linha do tempo do posto
  ui/                       Kit de componentes (Radix + Tailwind)
hooks/                      Camada de acesso a dados (SWR) por domínio
lib/demo/                   Camada de dados da demonstração
tests/                      Vitest: dataset, contratos de API e isolamento
```

A autenticação é intencionalmente simples: um cookie opaco criado no cliente,
lido pelo `middleware.ts` para proteger as rotas. Não existe hash de senha,
token assinado ou tabela de usuários — porque não existe nada a proteger.

---

## Segurança e privacidade

Esta é uma cópia **pública** derivada de um sistema interno. O que foi feito
antes do primeiro commit:

- ✅ **Nenhum dado real.** Toda a massa de dados é gerada pela aplicação:
  centros, produtos, ordens, paradas, operadores e usuários são fictícios.
- ✅ **Nenhuma credencial.** Arquivos de ambiente, tokens, caches de sessão,
  chaves de API e segredos de integração não existem neste repositório — nem no
  estado atual, nem no histórico, que foi iniciado do zero.
- ✅ **Nenhuma infraestrutura.** Sem driver de banco, cliente SMTP, serviço de
  coleta de sensores ou integração corporativa; nem no código, nem nas
  dependências.
- ✅ **Nenhum endereço interno.** Sem IPs privados, hostnames, caminhos de rede,
  strings de conexão ou identificadores de tenant.
- ✅ **Nenhuma pessoa real.** Nomes, e-mails e registros de funcionários são
  inventados.
- ✅ **Verificação automatizada.** `tests/isolation.test.ts` falha o build se
  qualquer um desses itens for reintroduzido.

Funcionalidades que dependiam de infraestrutura corporativa — envio de e-mail,
cadastro de conta, planejamento semanal integrado ao ERP — continuam navegáveis,
mas informam com clareza que a operação existe apenas no ambiente de produção,
em vez de simular uma integração inexistente.

---

## Licença

[MIT](LICENSE)

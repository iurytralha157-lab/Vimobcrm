# Vimob CRM

CRM imobiliário multi-tenant. O workspace reúne o frontend Next.js, a API Go,
contratos HTTP, migrações e funções Supabase, testes e artefatos de deploy.

## Stack

- Next.js 16.3.4, React 19, TypeScript e React Query no frontend.
- API Go como fronteira principal de regras de negócio e acesso privilegiado.
- Supabase Auth, Postgres, Storage, Realtime e Edge Functions.
- Zod para contratos de entrada/saída no frontend e validação explícita na API.

## Rodar localmente no Windows

Pré-requisitos: Node.js 24, npm, Go, Docker Desktop e PowerShell.

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts/local/start-local.ps1
```

O script inicia ou reutiliza somente o Supabase local esperado, compila a API,
sobe frontend e backend e desliga workers e integrações externas por segurança.
Padrões: frontend `http://127.0.0.1:3000`, API
`http://127.0.0.1:8081`, Supabase `http://127.0.0.1:56321`. Os logs ficam em
`$env:TEMP\vimob-api-local-runtime`.

Para testar em outro dispositivo da mesma rede privada:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/local/start-local.ps1 -ExposeLan
```

Use `.env.example` como catálogo de variáveis. Nunca copie segredos reais para
o repositório ou exponha variáveis server-only com prefixo `NEXT_PUBLIC_`.

## Verificação local

```powershell
npm run validation:test
npm run validation:auth-admin
npm run typecheck
npm run lint
npm run audit:check
npm run build
npm run api:test
node scripts/supabase/verify-migrations.mjs
node scripts/supabase/verify-edge-functions.mjs
```

Os inventários em `docs/audits/` são gerados. Quando uma mudança legítima
altera rotas ou superfícies, regenere-os com os scripts correspondentes antes
de executar `npm run audit:check`.

## Organização do código

- `app/`: rotas do App Router; grupos `(auth)` e `(protected)` delimitam acesso.
- `components/features/`: UI específica de cada domínio.
- `components/shared/`: UI reutilizada por mais de um domínio.
- `hooks/`: estado assíncrono e efeitos por domínio.
- `lib/api/`: clientes da API Go e contratos de transporte.
- `lib/validation/`: schemas Zod e tipos derivados.
- `lib/supabase/`: clientes canônicos e fachada dos tipos gerados.
- `apps/api/`: API Go e composição das rotas HTTP.
- `packages/contracts/`: contrato OpenAPI versionado.
- `supabase/`: migrações e Edge Functions com manifesto de ciclo de vida.
- `scripts/`: execução local, gates, inventários, smoke e carga.

Autenticação e organização ativa são resolvidas pelo `AuthContext`; dados de
servidor usam React Query. Não há store Zustand ativo: estado local ou de
contexto permanece próximo de seu consumidor.

## Segurança e release

- Toda operação multi-tenant deve receber o contexto de organização validado.
- Credenciais e operações privilegiadas pertencem ao servidor.
- Migrações aplicadas não são reescritas; correções entram em uma nova migração.
- Edge Functions precisam declarar ciclo de vida, autenticação e hash no
  manifesto verificado.
- O workflow de imagens só publica depois de audit, contratos, typecheck, lint,
  verificadores Supabase e testes Go passarem.

Passar nos gates locais não comprova deploy, dados de produção nem capacidade de
5–6 mil usuários simultâneos. Esses itens exigem validação separada no ambiente
alvo e teste de carga.

## Documentação

Comece por [ARCHITECTURE.md](ARCHITECTURE.md) e
[QUICK_REFERENCE.md](QUICK_REFERENCE.md). A API está detalhada em
[apps/api/README.md](apps/api/README.md), e o índice completo fica em
[INDEX.md](INDEX.md).

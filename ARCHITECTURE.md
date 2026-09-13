# Arquitetura do Vimob CRM

## Princípio

O sistema é separado por domínio e aplica segurança em camadas. Uma feature
deve manter UI, estado assíncrono, transporte e validação reconhecíveis sem
duplicar contratos ou acesso privilegiado.

```text
App Router
  -> components/features/{dominio}
     -> hooks/{dominio}
        -> lib/api/{dominio}.ts
           -> API Go /v1
              -> autorização + tenant
                 -> Postgres, Storage e provedores
```

Supabase Auth inicia a identidade. A API Go resolve usuário, organização,
papéis e permissões antes de executar regras de negócio. O browser usa o cliente
Supabase canônico apenas nas capacidades que pertencem ao cliente, como Auth e
Realtime; segredos e service role nunca chegam ao frontend.

## Frontend

- `app/` contém somente composição de rotas, layouts, boundaries e redirects.
- `components/features/` contém componentes específicos de domínio.
- `components/shared/` contém componentes realmente usados por dois ou mais
  domínios; `components/ui/` é a camada de primitivas shadcn/Radix.
- `hooks/` coordena React Query, estado e efeitos.
- `lib/api/` concentra transporte HTTP e normalização de erros.
- `lib/validation/` é a fonte de tipos de contrato derivados de Zod.
- `contexts/AuthContext.tsx` é a fonte de autenticação e tenant no browser.
- Não existe store Zustand ativo. Estado de UI permanece local ou no contexto
  proprietário; autenticação não possui um segundo store paralelo.

Componentes de cliente são usados somente quando precisam de hooks, eventos ou
APIs do browser. Layouts e páginas permanecem Server Components por padrão.

## Organização ativa

`lib/auth/active-organization.ts` define um contrato discriminado:

- `resolving`: autenticação, memberships ou troca de organização em andamento;
- `ready`: `organizationId` estável e autorizado;
- `missing`: usuário sem tenant utilizável ou falha de carregamento.

Queries, mutations, Realtime e cache keys só podem usar o ID no estado `ready`.
Durante login, impersonação ou troca de organização, o contrato não reaproveita
um ID antigo.

## API Go

- `apps/api/internal/app/app.go` constrói dependências e ciclo de vida.
- `apps/api/internal/app/routes.go` registra rotas e middleware.
- Cada pacote em `apps/api/internal/{dominio}` contém handlers, regras e
  repositório do domínio.
- `apps/api/internal/tenant` resolve e exige o contexto de organização.
- `apps/api/internal/httpserver` contém envelopes, erros e decoder HTTP canônico.
- `apps/api/internal/pgvalue` concentra conversões repetidas de valores pgx com
  políticas explícitas para vazio, branco e trim.
- `apps/api/internal/jsonvalue` concentra JSON de banco, preservando a política
  legada explícita para payload vazio onde ela é necessária.

O catálogo gerado em `docs/catalogo-contratos-backend.md` é a visão auditável
das rotas. O contrato público versionado fica em
`packages/contracts/openapi/v1.yaml`.

## Supabase

- `lib/supabase/client.ts`: singleton browser canônico, incluindo a proteção
  read-only local e o fluxo de recuperação de senha.
- `lib/supabase/server.ts`: cliente por request para Server Components/Actions.
- `integrations/supabase/types.ts`: única saída gerada pelo CLI.
- `lib/supabase/types.ts`: fachada estável usada pelo restante da aplicação.
- `supabase/migrations/`: cadeia append-only verificada contra o lock de origem.
- `supabase/functions/`: funções com estado `LIVE`, `TOMBSTONE` ou `RETIRED` no
  manifesto; o roteador self-hosted falha fechado para slug não declarado.

Uma migração que já foi aplicada não deve ser editada. Mudanças entram em um
novo arquivo e precisam passar por `scripts/supabase/verify-migrations.mjs`.

## Providers

`RootProvider` monta infraestrutura global. O grupo protegido adiciona Auth,
queries privadas, filtros e o chat flutuante; por isso rotas públicas não
instanciam listeners ou superfícies que dependem de tenant.

## Estado e cache

- Estado de servidor: React Query.
- Auth e organização ativa: `AuthContext`.
- Estado global visual: contexto proprietário somente quando realmente
  compartilhado; não há store genérico ativo.
- Estado local e efêmero: `useState`/`useReducer`.

Toda query multi-tenant inclui organização na chave e deve ficar desabilitada
fora de `activeOrganization.status === 'ready'`.

## Gates de release

Antes de construir e publicar imagens, a CI exige:

1. instalação determinística com `npm ci` e audit de dependências;
2. inventários gerados e contratos de validação;
3. typecheck, lint e testes frontend;
4. integridade das migrações e manifesto das Edge Functions;
5. testes da API Go e pacotes compartilhados.

Esses gates provam o estado do código. Deploy, migração remota, dados reais,
integrações externas e capacidade continuam sendo evidências separadas.

## Estado da reorganização

A separação de domínio está implantada, mas não é considerada “finalizada”. Os
arquivos monolíticos estão sendo recortados de forma incremental, com testes e
sem redesign. Barrels só devem exportar consumidores reais; código morto e
utilitários duplicados são removidos em lotes pequenos depois de confirmar o
grafo de imports e as diferenças de comportamento.

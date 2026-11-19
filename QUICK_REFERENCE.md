# Referência rápida

Mapa estrutural conferido em 18/11/2026 na base `05ff562c`. Para medições,
evidências históricas e metas, consultar [ARCHITECTURE.md](ARCHITECTURE.md).

## Organização atual

- Next.js e frontend ficam na raiz. A API é o monólito modular em `apps/api`.
- `go.work` reúne `apps/api`, `packages/auth` e `packages/db`. Os workers
  atuais são iniciados dentro da API; `apps/worker` é uma pasta reservada.
- Auth e organização ativa usam `contexts/AuthContext.tsx`; consultas e cache
  usam React Query. Estado local e contextos próprios atendem à UI.
- O gerenciador declarado é npm; usar `package-lock.json` e `npm ci`, como os
  workflows. Os arquivos pnpm existentes não definem outro fluxo ativo.
- Código de banco, histórico de migrations e funções Edge têm seus próprios
  contratos em `supabase/README.md`; não são pastas temporárias de build.

## Primeiro lote estrutural local

- [Contratos de validação](lib/validation/README.md): módulos donos dos schemas
  e fachada `auxiliary.ts` que preserva os imports existentes.
- [Domínio Leads](apps/api/internal/leads/README.md): leitura e scanners
  separados dentro do mesmo pacote Go, preservando assinaturas e SQL.
- [Runbook do lote de 18/11](docs/runbooks/architecture-refactor-2026-11-18.md):
  escopo, verificações e reversão. Os maiores arquivos legados continuam na
  fila de divisão; estes links não representam aprovação de teste ou deploy.
- [Preparo do release API/Web](docs/runbooks/architecture-release-2026-11-18.md):
  patch Next 16.4.6, imagens versionadas, bridge preservada e rollback.

## Onde colocar código

```text
Rota/layout/boundary?             app/
UI específica de domínio?         components/features/{dominio}/
UI usada por 2+ domínios?          components/shared/
Primitiva shadcn/Radix existente?  components/ui/ (não editar)
Hook/efeito/cache de domínio?       hooks/{dominio}/
Chamada à API Go?                  lib/api/{dominio}.ts
Contrato/validação?                lib/validation/{dominio}.ts
Estado compartilhado na árvore?    contexto proprietário do domínio
Regra/handler/repositório backend?  apps/api/internal/{dominio}/
```

Não crie uma segunda camada só para seguir o desenho: primeiro procure o schema,
cliente, hook e componente já existentes no domínio.

Os hooks ainda convivem entre a raiz e pastas de domínio. Ao reorganizar um
fluxo, preserve os imports e exports consumidos até migrar seus chamadores;
mover o arquivo sozinho não separa suas responsabilidades. Novas dependências
entre domínios usam a interface pública do domínio dono. A proteção de navegação
fica em `proxy.ts`; os BFFs e callbacks existentes continuam em `app/api`.

## Ao dividir um arquivo grande

1. Identificar consumidores, testes, contratos e efeitos do fluxo antes de mover.
2. Separar por responsabilidade dentro do domínio existente. Em Go, arquivos do
   mesmo pacote compartilham seus tipos e métodos; uma extração não exige criar
   outro pacote, serviço ou adaptador.
3. Preservar assinaturas, validação, filtros de tenant, SQL, transações e ordem
   dos efeitos. Mudança de comportamento exige justificativa e testes próprios.
4. Validar os consumidores e registrar comandos/resultados e reversão. Para uma
   extração estrutural, a reversão recompõe os arquivos sem alterar schema,
   contratos HTTP ou configurações de runtime.

Arquivo novo tem alvo de até 400 linhas e limite de 800. Medições de arquivos
legados são um ponto de partida; não substituir concentração de lógica por
pastas ou exports sem consumidores reais.

## Fluxo frontend

```tsx
import { useQuery } from '@tanstack/react-query'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { leadsAPI } from '@/lib/api/leads'

export function useLeads() {
  const activeOrganization = useActiveOrganization()
  const organizationId =
    activeOrganization.status === 'ready'
      ? activeOrganization.organizationId
      : null

  return useQuery({
    queryKey: ['leads', organizationId],
    queryFn: () => leadsAPI.getLeads(organizationId!),
    enabled: organizationId !== null,
  })
}
```

Use o contrato real do cliente do domínio; o exemplo mostra somente as regras
de tenant e cache. Nunca reaproveite um ID durante `resolving`.

## Autenticação e estado

- Auth, perfil, memberships, impersonação e organização ativa:
  `useAuth()` de `@/contexts/AuthContext`.
- Estado de servidor: React Query.
- Estado local: `useState` ou `useReducer`.
- Estado compartilhado de interface: contexto proprietário somente quando mais
  de um ramo realmente o consome.
- Ao sair, a revogação global deve ser confirmada antes de encerrar a sessão local. Se a
  sessão já estiver inválida, `/login?logout=unverified` avisa que não foi
  possível confirmar o encerramento das outras sessões; erro transitório
  mantém a sessão atual para permitir nova tentativa.

Não crie store paralelo para autenticação.

## Supabase

```tsx
// Browser: singleton canônico
import { supabase } from '@/lib/supabase/client'

// Server Component/Action: cliente por request
import { createClient } from '@/lib/supabase/server'

// Tipos públicos gerados, via fachada estável
import type { Database } from '@/lib/supabase/types'
```

Chamadas de negócio e acesso privilegiado pertencem à API Go. Não inicialize
`@supabase/supabase-js` em componentes nem use service role no browser.

## Handler Go

```go
func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}

	var request ListRequest
	if err := httpserver.DecodeJSON(w, r, &request, httpserver.DefaultJSONBodyLimit); err != nil {
		return
	}

	items, err := handler.repo.List(r.Context(), tenantContext, request)
	if err != nil {
		writeDomainError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Item]{Data: items})
}
```

Preserve limites de body específicos quando já existem. JSON opcional,
payload bruto e JSON vindo do banco não são automaticamente equivalentes ao
decoder HTTP estrito.

## Checklist de mudança

- O tenant está validado antes da leitura/escrita?
- Entrada e resposta usam o contrato Zod/Go canônico?
- A query key inclui organização e filtros relevantes?
- Loading, vazio, erro e permissão continuam cobertos?
- O utilitário “duplicado” tem realmente as mesmas políticas de vazio, trim,
  limite e erro?
- O arquivo removido não tem import direto, barrel, lazy/dynamic ou consumidor
  de rota?
- Foram executados testes focados e, antes do handoff, os gates completos?

## Comandos

```powershell
rg "símbolo" app components hooks lib apps/api
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

`docker-images.yml` já executa gates estáticos e cenários focados com
PostgreSQL, pgTAP e navegador antes de publicar API/Web. Isso não representa
execução automática de todo E2E ou de todo teste SQL existente. O workflow
manual `staging-images.yml` tem restrições e variáveis próprias de homologação.
Consultar o workflow e seus resultados antes de afirmar que uma verificação
passou; publicar uma imagem não atualiza a stack de produção.

Para executar tudo localmente, use `scripts/local/start-local.ps1`; ele impede
que o ambiente de desenvolvimento aponte silenciosamente para o Supabase remoto
esperado pelo deploy.

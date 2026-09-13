# Referência rápida

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

Para executar tudo localmente, use `scripts/local/start-local.ps1`; ele impede
que o ambiente de desenvolvimento aponte silenciosamente para o Supabase remoto
esperado pelo deploy.

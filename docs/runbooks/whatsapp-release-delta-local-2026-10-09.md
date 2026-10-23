# Recorte local do contrato WhatsApp para candidato de release

> Inventário de trabalho, não é um commit nem uma autorização de implantação.
> Base observada em 09/10/2026: `main` em
> `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. A árvore é compartilhada e
> continua mudando. Refaça o inventário e confira os hashes imediatamente antes
> de montar um checkout isolado.

## Fronteira do candidato

O menor candidato coerente tem **um pré-requisito versionado de
identidade/associação e sessão ativa**, seguido pela unidade WhatsApp. Quando
o código estiver fechado, criar um SHA local revisado para cada unidade; o
segundo deve ter o primeiro como base. Isto preserva as guardas atuais sem
puxar por acidente todo o checkout compartilhado.

1. **Pré-requisito de identidade, associação e sessão ativa — dono: frente de
   identidade/segurança.** A migration
   `20261009030225_membership_access_generation.sql` cria a geração usada
   pelos escopos de equipe. `20261009034132_scope_legacy_permission_helper_to_active_membership.sql`
   e `20261009034701_guard_whatsapp_realtime_inactive_custom_role.sql` fecham
   permissões antigas e Realtime. A migration WhatsApp
   `20261009061438_whatsapp_team_generation_read_scope.sql` depende da geração,
   do helper de permissão e das funções WhatsApp que ela substitui. A geração
   também afeta distribuição, equipes, propriedades e outros leitores. As novas
   migrations `20261009060500` a `20261009061000`, `20261009061902`,
   `20261009114207` e `20261009140731` dessa frente apareceram enquanto este
   inventário era escrito. O dono precisa fechar e revisar a sequência e os
   consumidores SQL/Go antes de versioná-la. A migration de RBAC
   `20261009030511` e os grants correlatos entram somente se a frente de
   segurança os aprovar no mesmo pré-requisito.
2. **Captura, vínculo, retenção e cutover WhatsApp.** Incluir integralmente,
   em ordem de timestamp, as migrations
   `20261008210143_whatsapp_unlinked_ephemeral_realtime.sql`,
   `20261009021248_whatsapp_observed_history_link_contract.sql`,
   `20261009022233_whatsapp_observed_retention_effects.sql`,
   `20261009024147_whatsapp_intake_split_contract.sql`,
   `20261009033238_whatsapp_partial_mixed_batch_retention.sql`,
   `20261009034701_guard_whatsapp_realtime_inactive_custom_role.sql`,
   `20261009053741_whatsapp_webhook_edge_execution_fence.sql` e
   `20261009061438_whatsapp_team_generation_read_scope.sql`. O índice
   `supabase/cutovers/20261008_whatsapp_unlinked_epoch_index.sql` e a ativação
   `supabase/cutovers/20261008_activate_whatsapp_unlinked_epoch.sql` são
   operações manuais separadas; a ativação pressupõe índice válido e todos os
   escritores/leitores compatíveis. Não colocá-las em `migrations/`.

`20261009034701` aparece nas duas descrições por ser a ponte entre papéis e
Realtime WhatsApp. É um único arquivo, aplicado uma única vez na sequência
cronológica do ledger.

As demais migrations novas de RBAC, navegação do site, auditoria, push e equipe
não são incluídas por proximidade de timestamp. Para uma cópia fiel do banco
alvo, comparar o ledger e decidir a sequência **antes** de executar SQL. Não
usar `db push` contra um ledger divergente.

## Arquivos de código a transportar

Copiar mudanças integrais somente após comparar `git diff` de cada arquivo com
esta fronteira:

- **Go WhatsApp:** os arquivos modificados e novos em
  `apps/api/internal/whatsapp/` que implementam ingest, processador nativo,
  cerca Edge, expiração, Storage GC, escopo de sessão, snapshot, preview,
  vínculo e envio; levar seus testes junto. `repository.go` inclui a guarda de
  visibilidade no mesmo SELECT de `ListMessages` que retorna o histórico, para
  fechar a janela entre autorização e leitura. Essa correção foi revisada
  estaticamente; a validação executável fica para a fase de testes. A revisão
  precisa separar qualquer
  edição concorrente posterior ao presente inventário.
- **Go lead e escopo:** `apps/api/internal/leads/repository.go`, `types.go`,
  `permission_contract_test.go`, `whatsapp_conversation_binding_contract_test.go`,
  `apps/api/internal/leadscope/scope.go` e respectivos testes. O filtro por
  `membership_generation` em `leadscope` depende da migration de identidade.
- **Edge roteável:** `supabase/functions/evolution-go-webhook/index.ts`,
  `edge-execution-fence.ts`, `label-color.ts` e seus testes locais. As mudanças
  em `evolution-proxy/index.ts` são de tipagem e envio legado; as de
  `evolution-webhook/index.ts` são de outro entrypoint. Avaliá-las em revisão
  própria, sem arrastá-las apenas pelo nome Evolution.
- **Web:** `components/features/chat/FloatingChat.tsx`,
  `components/features/whatsapp/ConversationLeadPanel.tsx`,
  `ConversationsScreen.tsx`, `ConfirmConversationLeadLinkDialog.tsx`,
  `EnterAttendanceDialog.tsx` e os pequenos componentes de conversa tocados;
  `components/features/leads/CreateLeadDialog.tsx` e `LeadUnifiedThread.tsx`;
  `hooks/use-whatsapp-conversations.ts`,
  `hooks/use-whatsapp-messages-paginated.ts`, `hooks/use-leads.ts`,
  `lib/api/whatsapp.ts`, `lib/api/leads.ts`, `lib/validation/whatsapp.ts`,
  `lib/validation/leads.ts`, `lib/whatsapp-query-cache.ts`,
  `lib/whatsapp-unlinked-expiration.ts` e os testes desses contratos.
- **Ensaios opt-in:** `tests/e2e/whatsapp-unlinked-realtime-local.spec.ts`,
  `tests/e2e/whatsapp-visual-latency-local.spec.ts`,
  `scripts/tests/whatsapp-realtime-smoke.mjs` e os pgTAPs WhatsApp. O spec
  visual está preparado, mas a amostra integrada ainda não foi executada.

## Arquivos compartilhados: seleção por hunk e decisão explícita

| Arquivo | Hunk necessário | O que não entra automaticamente |
| --- | --- | --- |
| `apps/api/internal/config/config.go` | Campo `UnlinkedRetentionWorkerEnabled` em `WhatsAppConfig` e parse de `WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED` | Reformatação ou configurações de outras frentes |
| `apps/api/internal/app/app.go` | Estatística do worker, passagem da flag e `StartUnlinkedRetentionWorker`; `activeSessionChecker` pertence ao pré-requisito de sessão ativa | `WithDatabaseReadOnly` pertence a outro trabalho |
| `.env.example` | Bloco `WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED=false` | Flags de preview somente local e banco somente leitura |
| `apps/api/internal/app/routes.go` | `GET .../link-preview`, permissão `lead_operate` em `POST .../link-lead` e `GET /v1/leads/{id}/history-raw`; wrappers de sessão ativa entram no pré-requisito | Revisar a mudança das demais rotas como parte do pré-requisito, sem copiá-las por coincidência |
| `apps/api/internal/tenant/repository.go` | Escopo de equipe e geração em `applyTeamLeadershipScope` e no contexto recarregado; checagem de papéis ativos | Hunk grande de atualização de todas as permissões: revisar com a unidade de identidade, não separar às cegas |
| `contexts/BackendRealtimeBus.tsx` | Evento `access.roles.changed` se a unidade de papéis for incluída | Não é alteração de wake-up de mensagem WhatsApp |
| `tests/e2e/support/e2e-env.ts` e `playwright.config.ts` | Guardas opt-in do worker e timeout do ensaio local, somente para testes | Essas mudanças não são necessárias ao runtime publicado |
| `supabase/migrations.source-lock.json` | Regenerar no checkout isolado **depois** de selecionar migrations | Não copiar o lock atual: ele inclui migrations de outras frentes |
| `supabase/functions/production-manifest.json` | Regenerar no checkout isolado **depois** de selecionar Edge | Não copiar o manifest atual: `_shared` e vários slugs Meta/admin mudaram |

Seletores estáveis para conferir os hunks, mesmo se as linhas mudarem:

- `app.go`: `unlinkedRetentionWorkerEnabled` na telemetria,
  `UnlinkedRetentionWorkerEnabled` no `WorkerConfig` e
  `StartUnlinkedRetentionWorker` na lista de workers. O hunk de
  `activeSessionChecker` entra no pré-requisito.
- `routes.go`: os endpoints `link-preview`, `link-lead` e `history-raw` entram
  no WhatsApp; as funções `withActiveAuth`, `withActiveAuthTenant` e
  `withActiveOrganization` entram na unidade de sessão ativa.
- `config.go`: declaração e parse de `UnlinkedRetentionWorkerEnabled`.
  `.env.example`: apenas a flag correspondente.
- `tenant/repository.go`: `refreshCachedContext`, `getPermissions`,
  `applyTeamLeadershipScope` e `getLegacyPermissions` devem ser revisados
  juntos pela unidade de identidade; selecionar somente as linhas com a
  palavra `membership_generation` deixaria o cache de permissões divergente.
- Os diffs de `hooks/use-whatsapp-access.ts`, `use-whatsapp-contacts.ts`,
  `use-whatsapp-groups.ts`, `use-whatsapp-labels.ts` e
  `use-whatsapp-sound.ts` observados aqui apenas removem variáveis `useAuth`
  não usadas; não são dependência da captura/vínculo/retensão.

O endpoint `history-raw` atualmente usa `withActiveOrganization`, definido pela
frente ampla de sessão ativa no mesmo `routes.go`. Portanto há uma decisão de
código **antes** do recorte: revisar e versionar a unidade de sessão ativa
inteira como pré-requisito. Não reduzir a guarda para estreitar o patch. Os
arquivos centrais são `apps/api/internal/app/auth_sessions.go`,
`apps/api/internal/httpserver/active_session.go`, os hunks correspondentes em
`apps/api/internal/app/app.go` e `routes.go`,
`apps/api/internal/httpserver/middleware.go`,
`apps/api/internal/realtime/handler.go`, `apps/api/internal/tenant/repository.go`
e seus testes. No Web, revisar `contexts/AuthContext.tsx`,
`lib/auth/active-organization.ts`, `lib/auth/global-sign-out.ts`,
`components/shared/layout/AppLayout.tsx`, `proxy.ts` e os clientes `lib/api`
de auth/me/users/settings/admin afetados. `routes.go` altera diversas rotas
dessas áreas; sua revisão precisa ser global, não um hunk isolado de WhatsApp.
O inventário dessa frente ainda está em movimento, então a lista acima é a
fronteira inicial para o dono completar por dependência real de compilação e
contrato, não um allowlist fechado.

O campo `membership_generation` é uma dependência **transversal**. Não basta
transportar `leadscope/scope.go` e `whatsapp/session_access.go`: a mesma geração
aparece em código de distribuição, equipes, usuários, Meta, portais,
propriedades, agenda e em helpers SQL. A unidade de identidade deve ser
revisada/fechada antes de congelar o WhatsApp; não remover os filtros de geração
para reduzir o patch.

## Montagem reproduzível quando o código estiver fechado

1. Registrar `git rev-parse HEAD`, `git status --porcelain=v1 -uall` e os
   hashes dos arquivos escolhidos. Criar worktree local descartável a partir
   **desse** HEAD; não copiar o diretório inteiro nem usar `git add .`.
2. Transportar os arquivos integrais revisados; para a tabela acima, gerar
   `git diff -- <arquivo>` e aplicar hunk por hunk no worktree. Registrar um
   checklist de hunk aceito/rejeitado. Repetir `git diff` do worktree contra o
   HEAD para demonstrar que só o recorte aprovado entrou.
3. Gerar o source lock e o Edge manifest **nesse worktree**, de acordo com as
   fontes efetivamente escolhidas; seus hashes não são portáveis de uma árvore
   com alterações extras. Somente após fechar código, revisão e verificações,
   registrar o SHA do pré-requisito e depois o SHA do WhatsApp. O HEAD atual é
   apenas a base.
4. Ensaio de migrations em clone descartável fiel ao backup e ao ledger do alvo,
   com as duas unidades na ordem definida. Conservar a prova do ledger, índice
   concorrente, ativação manual, testes SQL, imagens Web/API do mesmo SHA e
   telemetria do canário para a futura publicação autorizada.

### Evidência estática desta auditoria

No início da auditoria, `git status --porcelain=v1 -uall` registrou 364
entradas (271 modificadas, 93 não rastreadas), e o verificador local de fonte
passou com 173 migrations; o manifest passou com 42 funções vivas. A árvore
mudou durante a leitura, inclusive com novas migrations de equipe, então esses
números **não** são um estado congelado. O `supabase/README.md` exige `db reset`
completo antes de produção e registra um ledger remoto histórico divergente;
o ensaio incremental em clone não substitui a resolução formal dessa regra.
Nenhum commit, staging, migração remota ou deploy foi feito nesta auditoria.

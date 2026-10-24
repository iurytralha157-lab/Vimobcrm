# Suplemento de permissões RPC da homologação

**Aplicado e verificado em 24/10/2026; liberação geral permanece em HOLD.**
O root executou o preview v3 com sucesso e ROLLBACK, depois aplicou o suplemento
`staging_restrict_reviewed_client_rpc_execution` no projeto
`lfkfuhvjvqgwyikzcfep`, organização `vimob teste`, run
`f7196a56-e7bb-4221-b61d-f3a95245338c`. A
[evidência de execução](../deploy/staging/cloud-rpc-hardening-verification.json)
foi observada em `2026-10-24T17:40:20.162Z`. O preparador continua offline,
com `ready=false`; a aplicação é comprovada por essa evidência separada.
Produção não foi acessada.

O catálogo inicial somente leitura fornecido pelo root em
`D:/Vimob/_safety/cloud-rpc-preflight-20261024.json` continha 75 funções públicas
SECURITY DEFINER com EXECUTE efetivo para anon/authenticated: 39 não retornam
`trigger`; 36 são funções de trigger. As 39 estão classificadas abaixo. A
presença de EXECUTE em uma função de trigger não demonstra chamada HTTP: o
PostgreSQL restringe sua execução ao contexto de trigger. Este suplemento não
altera essas 36 funções.

O suplemento restringiu 23 das 39 RPCs e também o overload de três argumentos
de `rebind`, antes permitido a service_role. O readback confirmou os contratos
das **24 assinaturas: 22 para service_role/postgres e duas aposentadas para
postgres**, além das ACLs inalteradas das outras 16. As 40 definições, owners,
SECDEF e proconfig permaneceram iguais. Nenhuma tabela, policy, trigger ou fonte
canônica foi alterada. O ledger original continua com 35 fases; o suplemento
tem nome próprio no histórico de migrations e evidência separada.

As funções SECDEF com EXECUTE para clientes passaram de 75 para **52: 36 de
trigger e 16 RPCs preservadas**. O preview comprovou transições sintéticas de
workers e manutenção do efeito do tenant irmão, depois reverteu os fixtures.
O [smoke SQL original](../scripts/staging/cloud-smoke.sql), SHA
`7d322dcc1e2ccbf0b6fb63799de358d15f4234d562dbb31c301eab07b5d6b6fc`,
foi repetido após a aplicação e também passou com ROLLBACK. O readback final
registrou zero usuários, organizações, leads e objetos, Vault vazio e Cron
ausente. Esses resultados não certificam Auth/PostgREST HTTP ou o CRM publicado.

## Prova dos consumidores e da fronteira

- As oito RPCs chamadas diretamente pelo runtime Edge são `cancel_disabled`,
  `complete`, `enter_delay_wait`, `fail`, `finish_external_effect`,
  `release_due_delays`, `reserve_external_effect` e `start_execution_from_event`.
  [adminClient](../supabase/functions/_shared/automation-runtime.ts#L63)
  usa `SUPABASE_SERVICE_ROLE_KEY`; a entrada
  [automation-runner](../supabase/functions/automation-runner/index.ts)
  valida `authorizeServiceRequest` antes de iniciar o trabalho. As referências
  exatas de cada chamada estão no contrato e no manifesto gerado.
- `resume_automation_delay` é dependência interna de
  `process_automation_inbound_message` e `release_due_automation_delays`
  ([baseline:61098 e 67611](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L61098)).
  As chamadas SECDEF continuam como postgres. O worker
  [sla-checker:78–96](../supabase/functions/sla-checker/index.ts#L78) usa
  autorização privada e cliente service_role para `get_sla_pending_leads`.
- `mark_overdue_financial_entries`, `notify_financial_entries`, `recover_stuck_executions`
  e os dois helpers de lock fazem operações globais sem caller guard. Não foi
  encontrado consumidor atual em Go/browser/Edge. A
  [migration histórica](../supabase/migrations/20260722000000_production_public_private_baseline.sql#L28136)
  já concedia somente service_role: linhas 28136–28137, 28173–28174,
  28243–28244, 28273–28274 e 28412–28413. `notify_financial_entries` chama
  `create_notification` internamente como postgres; essa dependência é preservada.
- O fluxo DRE é browser →
  [financialAPI:586](../lib/api/financial.ts#L586) → API Go →
  [repository_dre.go:148–152](../apps/api/internal/financial/repository_dre.go#L148)
  → SQL pool. Postgres e service_role permanecem permitidos. O papel efetivo
  da futura conexão da API ainda deve ser conferido no deployment; não foi
  lida configuração secreta. O teste preserva o guard de entrada existente,
  sem afirmar que a inicialização DRE funcional foi validada.
- Os dois `rebind` antigos movem históricos sem manter o ledger B1. O
  [cutover:730–738](../supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql#L730)
  os aposenta inclusive para service_role; conceder service_role aqui reabriria
  uma via explicitamente descontinuada. Nenhum consumidor Go/JS foi encontrado.
- `get_or_create_active_season` permite criar temporada em organização
  arbitrária; os cinco helpers de metadados listados abaixo aceitam IDs
  arbitrários. A leitura dos TOCs de todas as partes da baseline não encontrou
  dependências diretas de POLICY dessas 24 assinaturas. O preparador recusa
  essa dependência ou menção em uma das 20 forwards, para exigir revisão.
  `get_sla_start_at` é chamado pelo SECDEF de SLA, preservado como postgres.
  Não foram encontrados consumidores Go/browser/Edge dos outros quatro
  helpers nem de `get_or_create_active_season`.

A pesquisa de consumidores cobriu `apps/api`, `lib`, `hooks`, `app`,
`components` e `supabase/functions`, excluindo testes/tipos gerados. Ausência
nessa pesquisa não prova inexistência de consumidores externos. A ACL histórica
sozinha tampouco justifica revogar todas as 39: os helpers com autorização de
caller e as finalidades públicas recebem avaliação própria.

## Matriz finita das 39 RPCs

`service` nega PUBLIC/anon/authenticated e mantém service_role/postgres.
`aposentada` também nega service_role. `manter` preserva exatamente a ACL
anterior; o motivo descreve o guard estático, não aprovação funcional ou HTTP.
As assinaturas completas, MD5 do catálogo, evidência e linhas da baseline
constam de [rpc-hardening-contract.mjs](../scripts/staging/rpc-hardening-contract.mjs)
e do manifesto produzido.

| RPC (nome único, salvo overload indicado) | Decisão | Caller/finalidade comprovada |
|---|---|---|
| admin_dashboard_feed | manter | EXISTS de auth.uid com papel super_admin |
| admin_dashboard_pending_boards | manter | EXISTS de auth.uid com papel super_admin |
| admin_list_organizations | manter | EXISTS de auth.uid com papel super_admin |
| can_access_whatsapp_session(uuid,uuid) | service | Par sessão/usuário arbitrário, sem vínculo com caller |
| can_manage_session | manter | Organização atual e owner/admin do caller |
| cancel_disabled_automation_runtime | service | Runtime service_role; manutenção global |
| check_storage_org_access | manter | UUID válido e associação/super_admin de auth.uid |
| complete_automation_event | service | Runtime service_role; lease não é autorização |
| copy_default_dre_groups | service | API Go pelo SQL pool; fronteira histórica |
| count_unique_sessions | manter | Organização atual não nula ou super_admin |
| enter_automation_delay_wait | service | Runtime service_role |
| fail_automation_event | service | Runtime service_role |
| find_duplicate_lead_by_phone | manter | auth.uid obrigatório e filtro pela organização derivada |
| finish_automation_external_effect | service | Runtime service_role; effect_key não é autorização |
| generate_organization_api_key | manter | EXISTS admin da organização ou super_admin atual |
| get_my_org_id | manter | Retorna somente organização do auth.uid atual |
| get_or_create_active_season | service | Cria temporada para org arbitrária, sem caller guard |
| get_session_owner | service | Expõe owner de sessão arbitrária |
| get_sla_pending_leads | service | sla-checker privado com service_role; varredura global |
| get_sla_start_at | service | Lead arbitrário; consumidor nested SLA permanece postgres |
| get_user_organization_role | service | Permissões de usuário arbitrário; default auth.uid não limita argumento |
| has_whatsapp_session_ownership | service | Par sessão/usuário arbitrário |
| list_all_organizations_admin | manter | is_super_admin → private.is_super_admin com EXISTS de auth.uid ativo |
| list_all_users_admin | manter | Mesmo guard de super_admin ativo |
| mark_overdue_financial_entries | service | UPDATE global; fronteira histórica service_role |
| notify_financial_entries | service | Notificações globais; fronteira histórica service_role |
| notify_whatsapp_on_lead(uuid,uuid,text,text) | manter | No-op: somente RETURN; legado desativado |
| rebind_whatsapp_conversation_session(uuid,uuid) | aposentada | Retirada explícita pelo cutover B1 |
| recover_stuck_executions | service | UPDATE global; fronteira histórica service_role |
| release_due_automation_delays | service | Runtime service_role; varredura global |
| release_execution_step_lock | service | Mutação por ID/token; fronteira histórica service_role |
| reserve_automation_external_effect | service | Runtime service_role |
| resolve_site_domain | manter | Configuração de site público ativo; Edge possui consumidor |
| resume_automation_delay | service | Chamadas nested SECDEF de eventos/delays como postgres |
| start_automation_execution_from_event | service | Runtime service_role |
| try_acquire_execution_step_lock | service | Mutação por ID; fronteira histórica service_role |
| user_has_session_access | manter | Linha de acesso do auth.uid atual com can_view |
| verify_billing_payment_receipt | manter | Consumidor anon explícito com capability UUID de recibo |
| vimob_can_access_whatsapp_conversation | manter | Helper privado exige owner atual e membro da organização |

Fora dessas 39: `rebind_whatsapp_conversation_session(uuid,uuid,text)` recebe
a mesma aposentadoria do overload de dois argumentos. MD5 efetivo informado
pelo SELECT do root sob `search_path=pg_catalog`:
`5123f4c32d88eb68042c85578fb9d4b1`.

## Preparar, ensaiar e registrar

O roteiro abaixo registra a preparação executada; **não reaplicar no banco
atual**. O preparador exige o inventário inicial e recusa um catálogo já
restringido. Ele é offline e exige fontes canônicas validadas pelo contrato existente,
metadados `get_project` frescos e o preflight SQL somente leitura com no máximo
15 minutos. Recusa org/projeto diferente, banco com usuários/objetos/Vault/Cron,
owner/MD5/grants inesperados e alteração nos 35 hashes originais.

O contexto de deparser é fixo e registrado em `definitionHashContext`:
`searchPath=pg_catalog`, `deparser=pg_catalog.pg_get_functiondef`,
`digest=pg_catalog.md5`. O search_path de quem calcula `pg_get_functiondef`
pode mudar a qualificação do tipo de retorno; não se confunde com o proconfig
da função. O primeiro preview abortou antes das ACLs por essa diferença de
renderização. O snapshot confirmado sob contexto fixo atualiza somente três
MD5 de retornos compostos; os demais permanecem iguais. Desde v2, esse contexto
é exigido na entrada e no SQL. O preview v3 corrige exclusivamente a prova do
overload ambíguo descrita abaixo; os previews anteriores não devem ser utilizados.

```powershell
node scripts/staging/rpc-hardening-build.mjs `
  --target D:/Vimob/workspaces/vimob-crm/deploy/staging/supabase-target.json `
  --readback D:/Vimob/_safety/<fresh-project-readback>.json `
  --preflight D:/Vimob/_safety/<fresh-rpc-preflight>.json `
  --verification D:/Vimob/workspaces/vimob-crm/deploy/staging/cloud-verification.json `
  --output-dir D:/Vimob/_safety/<new-rpc-hardening-directory>
```

Saída fora de qualquer checkout Git, sem sobrescrever pasta: manifesto com
hashes e dois SQLs. `60-rpc-hardening-preview.sql` aplica as mesmas ACLs dentro
de uma transação, testa chamadas negadas de anon/authenticated com dois pares
sintéticos usuário/organização, exercícios locais de workers e isolamento do
efeito irmão; termina em ROLLBACK. Funções globais só são exercitadas depois
de comprovar ausência de dados operacionais. Todos os triggers continuam ativos.
Os claims SQL modelam contexto; não são JWTs HTTP nem sessão Auth validada.

`rebind(uuid,uuid)` não admite uma chamada SQL direta inequívoca: o overload
de três argumentos possui `p_remote_jid text DEFAULT NULL`. O preview v2
abortou com 42725 nessa chamada, após passar os guards/ACLs e controles vazios
service_role; a transação foi revertida, sem ACL durável. No preview v3, cada
papel confere a negação efetiva do overload exato por
`has_function_privilege(current_user, to_regprocedure('public.rebind_whatsapp_conversation_session(uuid,uuid)')::oid, 'EXECUTE')`.
Essa assinatura não é invocada diretamente. As outras 23 continuam exigindo
42501 real, inclusive `rebind(uuid,uuid,text)` com terceiro argumento explícito.
42725 não é tratado como negação de permissão e erros genéricos não são capturados.
O resultado aprovado do smoke registra essa limitação. O SQL de aplicação v3 é idêntico
ao v2: SHA256 `e7de34357dc7555dc505f67e61c095e322d75637ef59a027b6b8859362d7193b`.

Após revisão independente e ensaio v3 remoto bem-sucedido, o root aplicou os
bytes de `61-rpc-hardening-apply.sql` com o nome de suplemento registrado acima.
Esse arquivo contém somente guardas, snapshots temporários e alteração de ACL,
sem fixtures e sem INSERT em `phase_history`. O postflight exige manutenção dos
corpos/owners/proconfig de todas as 40 assinaturas, ACLs efetivas esperadas nas
24 e ACLs integralmente iguais nas 16 preservadas. O SELECT posterior confirmou
esses contratos; o resultado durável está na evidência separada do manifesto
offline `ready=false`.

Validação local: `node --test scripts/staging/rpc-hardening.test.mjs` passou
9/9 testes sem pulos. Eles validam derivação, limites, rejeições e transações;
**não executam PostgreSQL**. O preview SQL v3, a aplicação e o smoke SQL original
foram aprovados remotamente pelo root. Auth/PostgREST HTTP, cenário funcional da
API, Storage por usuário e WebSocket privado continuam pendentes.

O HOLD geral permanece: é preciso verificar Advisors/GraphQL, chamadas públicas
permitidas, sessão revogada e tenant via HTTP, além da futura API/Web. Os guards
retidos não foram promovidos a prova de revogação de sessão. Uma reversão desta
ACL deve usar o catálogo anterior conferido pelo root; não existe rollback
automático que reabra permissões amplas. A reversão do ensaio é o ROLLBACK.

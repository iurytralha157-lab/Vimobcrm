# Revisão independente do bootstrap Cloud de homologação

**Estado da revisão: pacote corrigido aplicado na homologação, com 15 fases de
baseline e 20 forwards registradas; smoke SQL V1 aprovado com rollback na segunda
tentativa. A liberação estática anterior continua SUPERADA e o pacote antigo não
deve ser utilizado. A aceitação da aplicação e a liberação para testes gerais
continuam pendentes.**
Foi identificada omissão real dos blocos TOC `ACL SCHEMA public/private`, cujo
campo Schema é `-`: o classificador anterior os preservava como plataforma em
vez de exportá-los. As comparações anteriores de preservação valiam somente
para o conjunto selecionado, não demonstravam completude dessa seleção. A versão
corrigida inclui os dois blocos com allowlist exata e validação de seus owners.

Revisão local em 2026-10-23. Alvo autorizado: `lfkfuhvjvqgwyikzcfep`.
Nenhum acesso à produção, leitura de dados de clientes ou comando remoto foi
executado por este revisor. As conclusões vêm do código, dos artefatos canônicos
e dos registros salvos pelo executor da homologação. O catálogo inicial
`deploy/staging/cloud-catalog.json` retrata o projeto antes da instalação;
não representa seu estado final.

## Estado registrado após a instalação

O registro [cloud-baseline-verification.json](../deploy/staging/cloud-baseline-verification.json)
de 2026-10-23 às 19:45:41 UTC confirma a baseline corrigida, seu hash de dados
de referência e os privilégios efetivos de schema observados. O registro
[cloud-verification.json](../deploy/staging/cloud-verification.json) de
20:04:50 UTC registra as 35 fases, com ordinais e hashes dos payloads revisados,
e o resultado do smoke SQL. Nenhum desses registros afirma execução literal
das 238 migrations históricas: foi aplicada a baseline derivada equivalente.

- O readback da baseline registra USAGE em public/private para anon,
  authenticated e service_role, sem CREATE para esses papéis; postgres mantém
  CREATE nos schemas do domínio. O readback final preserva os owners nativos
  de Auth, Storage e Realtime.
- As nove tabelas canônicas integram a publicação; o hash dos cinco conjuntos
  de referência coincide com o canônico. A única linha estrutural adicional
  registrada após os forwards é o cursor singleton de configuração da fila.
- Os registros finais mostram zero usuários Auth, objetos/buckets Storage,
  entradas Vault e mensagens sintéticas do smoke; cron não está instalado.
  Nenhuma tabela public aparece sem RLS.
- O smoke aprovado cobre assertions selecionadas em SQL. A comparação completa
  das definições/ACLs e a triagem dos avisos herdados de GraphQL e EXECUTE de
  funções SECURITY DEFINER continuam pendentes. O resultado não certifica
  integralmente os grants herdados nem autoriza acesso geral.
- `readyForGeneralTesting=false` permanece no registro final. Auth HTTP,
  onboarding, CRUD no CRM publicado, upload/download Storage e autorização
  de canais WebSocket privados não foram certificados.

O planner `scripts/staging/cloud-baseline-plan.mjs` continua sendo inventário
offline: não chama o exporter/promotores disponíveis, não acessa banco e não
avalia o estado remoto. Por contrato, `ready=false` e
`remoteReadinessEvaluated=false` permanecem mesmo após uma instalação externa
aprovada. Seus requisitos de revisão não constituem readback do projeto.

## Conclusões para o instalador

- As 20 migrations posteriores à baseline alteram somente `public`/`private`.
  As referências a `auth.uid()` em predicates não alteram o schema Auth.
  Não instalam extensões, agendam cron, importam clientes ou fazem HTTP.
- Seus preflights, corpos de funções, owners e ACLs devem permanecer canônicos.
  Existem hashes de predecessores e verificações de ACL que precisam continuar
  falhando quando o estado não corresponder ao esperado.
- A adaptação necessária fica no restore de domínio, nos defaults/ACLs de criação,
  nos overlays da plataforma e na identidade/transação de cada fase.
- Nenhum `OPERATOR`, `OPERATOR CLASS` ou `OPERATOR FAMILY` aparece no TOC dos
  dois artefatos de schema. A restrição nova do PostgreSQL 17.11 a estimadores
  de operadores customizados não possui um objeto correspondente neste dump.
- O `support_email` embutido no snapshot do emissor do recibo é contato
  operacional. Esse campo, isoladamente, não demonstra destinatário ou envio.
  Nenhum endereço é reproduzido aqui.

## Omissão de ACLs de schema e auditoria de completude

A seleção anterior perdeu dois blocos com `Type: ACL; Schema: -`:

- `baseline-20261016.sql:113806`, `SCHEMA private`, owner `postgres`:
  concede USAGE a `anon`, `authenticated` e `service_role`.
- `baseline-20261016.sql:113815`, `SCHEMA public`, owner `pg_database_owner`:
  concede USAGE a `postgres`, `anon`, `authenticated` e `service_role`.

Sem USAGE em `private`, EXECUTE nas funções isoladamente não basta para os
chamadores resolverem e utilizarem os helpers do domínio. Preservar milhares
de instruções do conjunto selecionado não demonstrava equivalência funcional.
A correção permite somente esses dois blocos, com nome/tipo/schema/owner
esperados, sem restaurar ACLs de schemas gerenciados nem trocar seus owners.

Todos os 43 blocos TOC cujo schema é `-` foram inventariados separadamente:

| Classe | Quantidade | Decisão semântica |
| --- | ---: | --- |
| Declaração de `private` | 1 | Aplicação; já selecionada. |
| ACLs de `private` e `public` | 2 | Aplicação; omissão corrigida na seleção e confirmada no pacote aplicado. |
| EXTENSION | 8 | Pré-requisitos explicitamente revisados, sem versão pinada. |
| Declaração `supabase_realtime` | 1 | Overlay; conferir publicação nativa, sem recriar. |
| Schemas nativos | 10 | Preservar plataforma. |
| COMMENT de EXTENSION | 8 | Metadados nativos; não necessários ao domínio. |
| ACLs de schemas nativos | 7 | Preservar plataforma; conferir os privilégios mínimos efetivos usados pelo CRM. |
| EVENT TRIGGER da plataforma | 6 | Preservar plataforma; não recriar. |

Uma segunda auditoria independente examinou os 736 blocos excluídos pela seleção
anterior, com 1.143 instruções top-level. As únicas instruções de aplicação
omitidas eram os sete GRANT USAGE desses dois blocos. As outras 12 referências
qualificadas a public eram os três DEFAULT ACLs de supabase_admin deliberadamente
gerenciados. Também foram examinadas 90 instruções dos três artefatos
extension-binding: nenhum alvo qualificado public/private foi encontrado.

Não há TYPE, SEQUENCE, SEQUENCE OWNED BY, DEFAULT ou DEFAULT ACL com schema `-`.
Os objetos dessas classes no domínio já selecionado são quatro TYPE em public,
uma SEQUENCE em private e três em public, três SEQUENCE OWNED BY em public,
três DEFAULT em public e três DEFAULT ACL de postgres em public. Outras três
DEFAULT ACL de supabase_admin/public pertencem ao criador da plataforma e não
devem ser aplicadas como defaults de objetos criados por postgres.

Após a seleção corrigida, conferir por catálogo e privilégios efetivos:

1. `private` continua de postgres; o owner nativo de `public` é preservado.
2. USAGE em `private` para anon/authenticated/service_role e em `public` para
   esses papéis e postgres, além de EXECUTE nos helpers chamados pelas policies.
3. Papéis de cliente não recebem CREATE em public/private nem ownership de
   schemas/objetos por efeito da correção. Conferir herança/PUBLIC, não só ACL textual.
4. USAGE mínimo nos schemas nativos dependentes (auth, extensions, realtime,
   storage e, nos fluxos server-only pertinentes, vault/net), sem sobrescrever
   permissões/owners da plataforma com o dump local.
5. O pacote regenerado contém as duas ACLs e seu manifesto/hash é recomposto.
   Reutilizar o pacote anterior não aplica a correção.

Na revisão offline da factory corrigida foram geradas 15 fases com 6.348 blocos
de domínio, dois a mais que a versão anterior. As sete instruções de ACL de
schema foram comparadas integralmente: três para private, quatro para public.
Nenhum ALTER SCHEMA public OWNER TO postgres foi emitido. O promotor CLI
reconstrói o manifesto esperado a partir da fonte atual e recusa o manifesto
antigo. A evidência offline valida a correção do pacote; o readback dos
privilégios efetivos está registrado separadamente no snapshot da baseline.

## As 20 migrations posteriores

"Aplicável" significa compatível em análise estática com `postgres` dono dos
objetos de domínio, após restaurar a baseline canônica. A aplicação das 20 unidades
foi registrada no ledger final; os testes específicos da matriz continuam sendo
critérios de aceitação e não foram todos cobertos pelo smoke SQL. Os nomes abaixo
ficam em `supabase/migrations/`.

| Migration | Aplicação/adaptação | Verificação específica |
| --- | --- | --- |
| `20261016121216_pipeline_stage_assignee_clock_consistency.sql` | Aplicável; preserva owner e ACL da função de stage. | Troca efetiva reinicia `assigned_at`/`first_touch_at`; regra inválida ou mesmo dono não reinicia relógio. |
| `20261016164738_fence_stage_inactivity_fact_capture.sql` | Aplicável; exige políticas de inatividade e ciclos da baseline. | Regra movida/revisada não amplia captura por policy obsoleta; pausa continua coletando o fato previsto. |
| `20261016171117_wake_managed_queue_configuration_and_guard_delete.sql` | Aplicável; preservar hash do predecessor do batch. Insere somente um cursor estrutural singleton. | Mudança de configuração cria recheck; deleção com distribuição pendente falha; cursor único existe e recheck é limitado. |
| `20261016171251_contact_import_managed_queue_outcomes.sql` | Aplicável; troca CHECK conhecido por vocabulário ampliado `NOT VALID`. | Novas linhas aceitam os outcomes geridos e continuam exigindo recibo concluído consistente. |
| `20261016171254_queue_runtime_history_transitions.sql` | Aplicável; cria triggers/funções de histórico de domínio. | Transição repetida não duplica evento; vínculo de assignment usa UUID real, organização e transação corretos. |
| `20261016171624_protect_managed_queue_human_activities.sql` | Aplicável; rename do helper exige ordem canônica. | Ação humana do dono protege fila; bot/inbound não; browser não escreve antes de claim do pool. |
| `20261016171628_integrate_managed_queue_stage_assignments.sql` | Aplicável; exige constraint/trigger anteriores e helpers de fila. | Mudança de stage/dono/runtime é atômica; pool exige claim; invariantes diferidas falham no COMMIT quando há drift. |
| `20261016173733_authorize_queue_notification_at_attempt_start.sql` | Aplicável; replacement exige âncora exata do relógio do predecessor. | Após espera no lock, lease, janela, destinatário e snapshot antigo não autorizam tentativa; teste sem enviar ao provedor. |
| `20261016175607_validate_contact_import_managed_queue_outcomes.sql` | Aplicável depois da ampliação do CHECK. | `convalidated=true`; constraints não são removidas para contornar falha. |
| `20261016180244_stamp_managed_queue_outreach_default_clock.sql` | Aplicável; trigger roda na ordem alfabética prevista. | Default `now()` é estampado após o lock; timestamp explícito é preservado; ator/tenant divergente é rejeitado. |
| `20261016180410_use_post_lock_cycle_end_clocks.sql` | Aplicável; exige MD5/proconfig/owner exatos de `capture_lead_cycles`. | Sob contenção, fechamento permanece maior ou igual ao início do ciclo; nenhum backfill histórico. |
| `20261016201006_protect_queue_pool_lead_task_mutations.sql` | Aplicável; policies/função/trigger pertencem ao domínio. | INSERT/UPDATE/DELETE de tarefa do pool por browser falham antes de claim; lock ocupado retorna `55P03`. |
| `20261016234227_prevent_activity_parent_lock_deadlocks.sql` | Aplicável; manter nome/ordem do trigger de lock. | UPDATE/DELETE de activity contra cascade do lead retorna retry tipado, sem ciclo de deadlock. |
| `20261017053625_add_lead_feedback_command_receipts.sql` | Aplicável; arquivo não possui BEGIN/COMMIT: executor deve fornecer atomicidade. | Retry do mesmo comando retorna ACK original sem recriar activity removida; organização/ator/command compõem a chave. |
| `20261018210058_restrict_activity_reads_to_visible_leads_and_active_session.sql` | Aplicável; exige policy canônica, grants e gate de sessão já restaurados. | Activity invisível fora do escopo do lead; JWT de sessão revogada perde acesso mesmo antes de expirar. |
| `20261018222847_restrict_activity_sensitive_columns_to_canonical_api.sql` | Aplicável; exige grants efetivos de `service_role` e a policy anterior. | Browser lê só seis identificadores; `SELECT *`, content/metadata falham; backend mantém projeção completa. |
| `20261019214356_add_lead_contact_outcome_command_receipts.sql` | Aplicável; arquivo não possui BEGIN/COMMIT: executor deve fornecer atomicidade. | Outcomes call/email são idempotentes por organização/ator/comando; recibo sobrevive à remoção da activity. |
| `20261019222441_restrict_activity_browser_writes_to_canonical_api.sql` | Aplicável; pre/postflight preserva exatamente projeção e acesso interno. | INSERT/UPDATE/DELETE Data API falham por ACL; privilégios do backend e SELECT seguro não mudam. |
| `20261019224603_guard_lead_financial_values_and_generated_amounts.sql` | Aplicável; exige corpo, trigger, tipos, owner e ACL canônicos do produtor financeiro. | Rejeitar negativo/NaN/Infinity/percentual acima de 100/overflow gerado; edição comum de legado permanece possível. |
| `20261019230804_restrict_agenda_activity_browser_reads_to_canonical_api.sql` | Aplicável depois das policies e da projeção de activity. | Browser não vê existência/ator de eventos Agenda por tipo ou presença de metadata; API mantém projeção autorizada. |

Dezoito arquivos contêm BEGIN/COMMIT. Não concatená-los dentro de uma transação
externa prometendo rollback da fase: COMMIT interno encerraria a transação antes
do postflight. Uma transformação derivada deve retirar somente controles de
transação de nível superior verificados, conservar o hash canônico separado e
preservar integralmente corpos de função. Alternativamente, executar uma unidade
canônica por transação, com guarda e postflight dentro da mesma unidade.

## Overlays de plataforma

Os overlays foram aplicados com o papel `postgres` não-superuser, preservando
owners e DDL nativos. A matriz mantém os testes funcionais específicos: a
instalação das policies não equivale à aprovação de cada fluxo da plataforma.

| Overlay canônico | Tratamento e teste |
| --- | --- |
| Auth `on_auth_user_created` (`baseline-20261016.sql:96453`) | Criar somente o trigger; não restaurar `auth.users` nem mudar owner. O catálogo registra TRIGGER/REFERENCES em `auth.users`; ensaiar criação Auth sintética e confirmar perfil com role `user`, organização nula e tratamento de convite provisório. |
| Realtime `whatsapp_authorized_private_broadcast` (`:113568`) | Criar a policy de SELECT somente em `realtime.messages`, preservando a plataforma; usuário de uma organização não recebe tópico da outra. |
| Realtime `whatsapp_broadcast_requires_active_session` (`:113575`) | Preservar policy restritiva e helper de sessão; testar sessão viva e revogada, incluindo canal já aberto separadamente. |
| Storage `Users manage own avatar` (`:113582`) | Ensaiar CREATE POLICY com postgres delegado. Testar own-path e outro usuário; a policy não contém gate explícito de sessão ativa. |
| Storage `automation admins manage media` (`:113589`) | Testar administrador/permissão da organização e negar outro tenant/usuário sem permissão. Não ativar integração externa. |
| Storage `contract_docs_delete` (`:113614`) | Testar tenant/path de exclusão. A expressão consulta `public.users.organization_id`, sem check explícito de associação atual ou sessão viva. |
| Storage `contract_docs_insert` (`:113623`) | Testar upload na pasta de outro tenant e usuário removido. Mesma limitação de associação/sessão da policy anterior. |
| Storage `contract_docs_select` (`:113632`) | Testar leitura/listagem entre tenants e JWT revogado. Mesma limitação; não declarar essa proteção aprovada sem o canário. |
| Storage `org admins manage logo assets` (`:113665`) | Testar path `organizations/<org>` com settings_manage/role; negar outro tenant. |
| Storage `org admins manage site images` (`:113672`) | Testar papel/permissão e tenant do path; não assumir que bucket público permite listar/escrever via Data API. |
| Storage `whatsapp media backend-only boundary` (`:113697`) | Preservar policy restritiva; anon/authenticated não acessam `whatsapp-media`, incluindo caminho direto. Backend/signed URL exigem teste próprio. |
| Publicação `supabase_realtime` (`:113701` em diante) | Existia vazia no catálogo inicial, owner postgres. O overlay adicionou somente nove tabelas canônicas, confirmadas no readback da baseline; não recriou a publicação nem usou FOR ALL TABLES. |

O helper `private.has_active_lead_read_session()` (`baseline-20261016.sql:21475`)
é SECURITY DEFINER de postgres e consulta `auth.sessions`; exige usuário e
`session_id` correspondentes, rejeita AMR de recovery e falha fechado em erro.
O catálogo registra SELECT de postgres em `auth.sessions` e BYPASSRLS nesse papel.
O controle positivo de sessão viva é necessário: uma falta de grant também
retornaria false pelo handler de exceção e poderia parecer revogação correta.

## Seeds: efeitos comprovados no código

O artefato de referência contém somente 1.271 INSERT, sem COPY, UPDATE, DELETE,
TRUNCATE, ON CONFLICT ou chamada top-level a executores. Textos dos artigos
podem mencionar comandos; continuam valores literais, não SQL executado.

| Tabela | INSERTs | Triggers que podem executar durante essa carga |
| --- | ---: | --- |
| `private.queue_timezone_catalog` | 1196 | Nenhum trigger no alvo. |
| `public.admin_subscription_plans` | 3 | `update_admin_subscription_plans_updated_at` é UPDATE-only; não dispara. |
| `public.available_permissions` | 38 | `queue_runtime_permission_catalog_gate` é DELETE/UPDATE OF key; não dispara. |
| `public.help_articles` | 30 | `refresh_help_article_search_vector` dispara em INSERT e calcula vetor com `pg_catalog.to_tsvector/translate`; sem rede, Vault, fila ou cron. `update_help_articles_updated_at` é UPDATE-only. |
| `public.home_publications` | 4 | `update_home_publications_updated_at` é UPDATE-only; não dispara. |

Os overlays Auth/Storage/Realtime não têm essas tabelas como alvo e não mudam
essa análise, sejam instalados antes ou depois da carga. Carregar após os triggers
de domínio permite conferir o vetor de busca e o hash final reais. Não é necessário
desativar triggers globalmente nem usar `session_replication_role`.

## Defaults, permissões e efeitos externos

- Comparar `pg_default_acl` de postgres antes de criar objetos. Defaults Cloud
  podem acrescentar grants na criação que um dump relativo aos defaults nativos
  não revogaria automaticamente. O derivado deve zerar apenas defaults revisados
  do domínio ou limpar ACLs explícitas antes de reaplicar as canônicas. Comparar
  privilégios efetivos, owners, grantors e grants de coluna após baseline e forwards.
- `private.invoke_google_calendar_worker` (`baseline-20261016.sql:23685`) só chama
  `net.http_post` depois de exigir os segredos Vault de cron e base URL. Não criar
  esses segredos nem invocar a função no ensaio inicial.
- `private.reconcile_google_calendar_cron_jobs` (`:30798`) possui três schedules
  condicionados à base URL do Vault; armazenar sua definição não agenda jobs.
  Nenhum caller automático/trigger dessa função foi encontrado no dump.
- Vault/cron jobs/filas de dispatch/tokens/usuários/arquivos não integram os seeds.
  Novos eventos internos de domínio durante testes não equivalem a despacho externo.
- Os únicos chamadores de Realtime encontrados no domínio são os broadcasters de
  audit e WhatsApp. Ensaiar INSERT sintético com broadcast; existir assinatura no
  catálogo não comprova defaults de argumentos nem comportamento da plataforma.

## Revisão do exporter e do promotor

A factory offline final produziu 15 fases, dividindo domínio somente entre
blocos TOC completos. Uma segunda revisão independente comparou as instruções
normalizadas com as fontes canônicas: 805 funções e seus OWNERs, 1.141 ACLs,
três DEFAULT ACLs, 705 policies, 304 configurações de RLS e 458 triggers foram
preservados integralmente. Os 1.271 INSERTs também permaneceram intactos e usam
valores literais. Não houve instrução canônica faltando ou controle psql emitido.
As únicas remoções são dois SETs de storage permitidos, fora de corpo de função.
O limite de cerca de 480 KB é do payload; guardas acrescentam alguns bytes.

O promotor verifica manifesto/SQL contra a factory atual no caminho CLI,
substitui somente a guarda local exata e conserva o payload. Exige readback
público recente do projeto autorizado, organização de testes, estado saudável
e UUID da sentinela. Cada SQL resultante verifica a sentinela persistente,
baseline/hash, quantidade e hashes/ordinais das fases anteriores. Payload e
registro de phase_history ficam na mesma transação, com COMMIT somente ao final.

A revisão inicial não encontrou alteração de conteúdo no conjunto selecionado,
mas essa conclusão foi superada pela omissão semântica das ACLs de schema
descrita no início. A seleção corrigida passou pela auditoria de completude e
comparação offline acima; os grants efetivos dos schemas foram observados no
readback da baseline. As 20 forwards usam pacote separado e agora constam no
ledger final. O estado de execução vem desse registro, não do inventário offline.
O promotor não implementa conexão ou aplicação remota por conta própria.

Os validadores estruturais de DDL/INSERT não são um parser SQL completo. Existem
formas adversariais fora do contrato que exigiriam endurecimento para fontes
futuras, mas elas não aparecem neste pacote: os artefatos atuais são verificados
por hash e foram comparados com o SQL canônico. Não se deve promover um pacote
manualmente editado ou tratar o parser como autorização genérica de SQL.

## Contrato do ensaio Cloud transacional

1. Conferir por API de gerenciamento a referência autorizada, estado e metadados
   do projeto. Fixar explicitamente esse ID em cada chamada; nenhuma seleção por
   variável de produção ou último projeto conectado.
2. Conferir `current_user=postgres`, `rolsuper=false`, PostgreSQL 17 e estado
   vazio esperado. Não usar o executor local de superuser/full-dump.
3. Registrar e validar sentinela persistente contendo somente identidade pública
   de staging e hashes de fonte/pacote. Uma GUC configurada em outra conexão não
   demonstra identidade na conexão de `apply_migration` seguinte.
4. Dentro da transação de cada fase, verificar a sentinela, os predecessores e
   os hashes/contratos pertinentes; aplicar o derivado; executar postflight;
   registrar somente a fase realmente executada e confirmar ao final.
5. Em falha, reverter a transação dessa fase e confirmar seu estado. Fases
   anteriores aprovadas permanecem instaladas; não prometer rollback global de
   várias chamadas já confirmadas nem apagar objetos gerenciados da plataforma.
6. Conferir seeds, ACLs/RLS, memberships da publicação, ausência de cron/provider
   secrets e tabelas de efeitos externos antes de criar dados sintéticos de CRM.
7. Registro de baseline equivalente não declara execução literal das 238
   migrations históricas. Cada forward executado recebe evidência própria.

Esse contrato orientou a aplicação na homologação nova; não transforma observações
de catálogo ou execução de DDL em aceitação funcional da aplicação.

## Smoke SQL e limite da evidência

O arquivo `scripts/staging/cloud-smoke.sql` preserva o SQL V1 revisado, SHA-256
`7d322dcc1e2ccbf0b6fb63799de358d15f4234d562dbb31c301eab07b5d6b6fc`.
A primeira execução falhou em `cloud_smoke_live_inbox_broadcast_select_failed`:
o serviço Realtime ainda não havia criado partições nativas de broadcast.
O executor confirmou rollback completo das fixtures e preservação das 35 fases.

Segundo o registro final, uma conexão do cliente oficial a um canal WebSocket
público retornou SUBSCRIBED e inicializou as partições pelo serviço gerenciado.
Não houve DDL manual em tabelas/partições nativas nem relaxamento da asserção.
Os mesmos bytes de SQL foram executados novamente, passaram e sofreram rollback.
Esse comportamento de inicialização é documentado pelo Supabase em
[WARN ao enviar broadcast](https://supabase.com/kb/troubleshooting/realtime-warn-sending-broadcast-message).

O smoke cobre criação sintética pelo trigger Auth, grants com papéis reais,
controle positivo de sessão ativa e negativo de sessão revogada, isolamento
entre dois tenants, limites de leitura/escrita de activities e policies/send
Realtime em SQL. A conexão pública comprova apenas o join de inicialização;
não certifica autorização de canal privado, entrega de broadcasts à aplicação,
Auth HTTP ou upload Storage. Storage com sessão revogada permanece não testado.

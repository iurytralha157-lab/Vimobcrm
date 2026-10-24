# Completude dos cutovers na homologação

Revisão local em 2026-10-24, candidata
`c61c80f8c0c3b441fe2046e0e6aaae6d6a64c2ef`, branch `homologacao`.
Escopo: os 20 SQLs de `supabase/cutovers`, baseline
`local-20261016-238-v1`, seus 20 forwards e consumidores atuais da API.
Nenhum comando remoto, segredo, dado de cliente ou produção foi acessado.

`loadCloudSource` validou os hashes das 238 migrations representadas, dos
artefatos e dos 20 forwards. A presença/ausência abaixo é da fonte candidata,
não uma nova consulta ao catálogo Cloud. O ledger de 35 fases comprova a
instalação desse pacote; não declara a execução dos cutovers externos a ele.

## Adendo: índice aplicado na homologação em 24/10

A análise abaixo preserva o estado da fonte candidata `c61c80f8`; a lacuna do
índice nessa fonte foi suprida separadamente no Cloud pelo suplemento
`staging_prepare_simple_stage_inactivity_index`. A
[evidência de aplicação e readback](../deploy/staging/cloud-inactivity-index-verification.json),
observada em `2026-10-24T17:20:54.458Z`, confirma o índice válido e pronto,
`runtimeReady=true`, zero leads e o ledger original preservado com 35 fases.
O ensaio passou com ROLLBACK antes da aplicação. Workers permanecem desligados;
esse resultado não comprova salvar regra pela API nem qualquer teste HTTP.

## Resultado para CRM básico com workers desligados

Há uma lacuna funcional pequena e concreta: falta o índice
`public.idx_leads_simple_stage_inactivity_scan`. A API verifica esse índice
antes de salvar uma regra de inatividade, inclusive uma regra desativada.
Adicionar apenas o índice, com guarda do alvo de staging, não ativa workers,
policies de negócio, envio nem integrações.

A identidade por fila e os contratos estritos do WhatsApp ainda estão na
janela de compatibilidade anterior a A2/B1/B2. Isso não impede todo CRUD de
leads, mas impede tratar os testes de identidade entre filas e de histórico
WhatsApp como equivalentes à capacidade final planejada. O worker desligado
também não torna uma RPC concedida a clientes inacessível; a revisão/fix de
ACLs ocorre separadamente e não é substituída por este inventário.

| Domínio/capacidade | Estado da fonte | Consequência com workers off |
| --- | --- | --- |
| Leads, Pipeline e tarefas em geral | Contratos aditivos e os 20 forwards presentes. Não foi identificado outro gate geral de cutover nesses caminhos. | Aceitação HTTP continua necessária; a ausência dos cutovers não prova falha de todo CRUD. |
| Configuração de inatividade simples | Tabelas/funções presentes; índice obrigatório ausente. | Leitura pode informar runtime indisponível. Salvar uma regra, mesmo desativada, falha no gate do índice. |
| Mesmo telefone em filas diferentes | Índice global ainda presente; índice por escopo ausente. | API usa deliberadamente o fallback global. Não certificar criação de cards distintos por fila. |
| Upload de imóveis | Tabelas, índices, triggers e grants do reparo já presentes. | Não reaplicar o reparo emergencial. Bucket/configuração e upload real são verificações distintas. |
| Auxiliares de imóveis | Gateway de cinco tabelas já representado nas policies e ACLs. | Não há necessidade de repetir o cutover para obter essa fronteira. |
| Convites | API suporta armazenamento legado e hash-only; coluna `token` ainda existe. | O cutover hash-only é hardening separado, não pré-requisito funcional da API compatível. |
| WhatsApp e epochs de conversas | Ativação estrita incompleta, índices finais ausentes. | Manter integrações off; não declarar esses fluxos prontos a partir do smoke SQL geral. |

### Criação, importação CSV e gestão: A2 não é gate geral

O caminho corrente da UI usa
[POST /v1/leads](../lib/api/leads.ts#L302). A importação CSV também chama
[leadsAPI.createLead por linha](../hooks/use-leads.ts#L385), com `importMode`
e chave de recibo; não usa o importador histórico de migração C2S.

- [Create](../apps/api/internal/leads/repository.go#L340) consulta a existência
  de `leads_org_phone_unique`. Enquanto ele existe, procura o telefone no
  tenant inteiro. A ausência de A2 não aciona uma tentativa de inferir um
  arbiter scoped inexistente.
- [createNewLead](../apps/api/internal/leads/repository.go#L1431) repete a
  decisão sob advisory lock e row lock. O INSERT em public.leads
  [:1465](../apps/api/internal/leads/repository.go#L1465) é simples, sem
  `ON CONFLICT` por telefone. Grava `intake_scope_key` e `origin_round_robin_id`
  coerentes; o trigger A1 valida a identidade, sem exigir o índice A2.
- Telefone já existente entra no caminho conservador de reentrada, sujeito à
  autorização. Mesmo telefone em outra fila não ganha um segundo card nesse
  estado; regras de acesso/reentrada podem rejeitar a operação. Isso é uma
  diferença funcional explícita, não erro de índice faltante em todo Create.
- A [importação idempotente](../apps/api/internal/leads/lead_import_request.go#L50)
  usa `ON CONFLICT(organization_id,actor_id,request_key)` somente no recibo.
  Sua PK existe na baseline. Depois chama o mesmo Create; não depende do freeze.
- Update usa UPDATE parametrizado por tenant e id
  [:653](../apps/api/internal/leads/repository.go#L653). Conflito real de telefone
  é convertido em `ErrLeadPhoneConflict` para os nomes dos dois índices. Não
  exige que ambos existam. Contatos são projeções de leads pela API.
- Create/Update de filas gravam round_robins/regras/membros em transação e não
  exigem A2/freeze. A configuração com operating_schedule verifica
  [process_queue_runtime_batch](../apps/api/internal/roundrobin/repository_queue_validation.go#L145),
  cujo contrato está na baseline e nos forwards. Worker desligado impede seu
  processamento, não a gravação da configuração pela API.
- Anexos usam lead/tenant, receipt próprio e INSERT simples. A PK do receipt
  também existe. Upload manual exige o bucket privado
  [whatsapp-media](../apps/api/internal/leads/attachments_upload.go#L14), mesmo
  com integração WhatsApp off; isso já está no manifesto de buckets core.

Existe uma exceção real e separada: o importador histórico C2S
`scripts/c2s/apply-import.mjs` chama `import_historical_lead_batch` e seu
preflight. Na baseline
[:22359](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L22359),
esse RPC rejeita o índice global presente e exige o índice scoped válido.
O preflight retorna `scoped_phone_identity_ready=false` e
`legacy_global_phone_identity_absent=false` nesse estado. Portanto, não
certificar importação histórica C2S; a conclusão de compatibilidade vale para
Create/Update/CSV correntes, não para esse roteiro de migração externa.

O mínimo derivado para esses fluxos básicos não inclui A2/B1/B2: manter o índice
global e a compatibilidade atual, completar o índice de inatividade e a
configuração core/ACLs já listadas, depois executar canários autenticados.
Não remover a unicidade global para simplificar os testes.

### Índice de inatividade: evidência e complemento proposto

O [gate](../apps/api/internal/stageconfig/inactivity_readiness.go#L13) exige
btree válido e pronto, sem expressão, com as três chaves na ordem exata e o
predicado abaixo. [SaveInactivityAutomation](../apps/api/internal/stageconfig/inactivity_api_save.go#L39)
chama esse gate incondicionalmente. Já
[InactivityRuntimeAvailable](../apps/api/internal/stageconfig/inactivity_api_read.go#L17)
retorna false com o runtime desligado; a leitura de configuração pode continuar.
Não confundir essa lacuna com indisponibilidade geral de Pipeline.

Fragmento de DDL proposto para um complemento derivado de staging:

```sql
CREATE INDEX idx_leads_simple_stage_inactivity_scan
ON public.leads (organization_id, stage_id, id)
WHERE deal_status = 'open' AND operational_effects_suppressed = false;
```

Esse fragmento não é um instalador. O executor deve reutilizar a identidade e
sentinela exatas da homologação, conferir ausência do índice e tabela vazia,
limitar lock/statement, criar e verificar o contrato no mesmo commit. Se a
tabela já tiver dados, reavaliar a estratégia online. O SQL canônico separado
usa `CONCURRENTLY`, que não cabe numa transação de `apply_migration`.
`IF NOT EXISTS` sozinho não valida um índice existente.

Não alterar a função de readiness nem ativar o worker para contornar a falha.
Após o complemento: conferir o gate, salvar regra desativada e confirmar que
`inactivityRuntimeAvailable` continua false quando o worker está off. Reversão
do complemento remove somente o índice novo, sem alterar dados de negócio.

## Identidade por fila e B1: objetos finais ausentes ou antigos

As verificações foram feitas pelo TOC e pelas definições, não apenas buscando
menções em corpos de funções. Nenhum dos 20 forwards instala os objetos abaixo.

| Fronteira | Diferença concreta na baseline | Necessidade |
| --- | --- | --- |
| A2 | Ausentes `leads_org_scope_phone_unique` e `outbox_messages_active_lead_idx`. | Pré-requisitos de B1/B2 e da identidade final por escopo. |
| Freeze online | Helper/tabela existem, mas o trigger `guard_whatsapp_webhook_legacy_routing_freeze` não está instalado na inbox. | Necessário para alegar o caminho online protegido; tabela/helper isolados não provam freeze. |
| B1: proveniência da inbox | Ausente `whatsapp_webhook_active_routing_snapshot_v1_check`. | Cerca final de snapshots v1 ou identidade exata congelada. |
| B1: consistência de binding | Função presente em versão fraca; o trigger de conversa é UPDATE-only. Ausente trigger diferido na tabela de bindings. | B1 exige INSERT/UPDATE na conversa e INSERT/UPDATE/DELETE nos bindings, com zero ou exatamente um binding ativo exato e não stale. |
| B1: contexto de mensagem | `set_whatsapp_message_context` ainda deriva o lead atual da conversa; existe `set_whatsapp_message_context_before_write`, sem o trigger final `zz_enforce_whatsapp_message_context_before_write`. | Não equivale ao ledger imutável de evento/binding da versão estrita. |
| B1: outbox | Ausentes função `private.enforce_canonical_whatsapp_outbox_lead_binding()` e trigger correspondente. | Falta a cerca de contexto/reativação da outbox canônica. |
| B1: rebind legado | Fonte concede execução ao helper de dois argumentos; a sobrecarga de três é concedida a service_role. | B1 revoga ambas de PUBLIC/anon/authenticated/service_role. Corrigir ACL não materializa os demais objetos de B1. |
| B2 | `leads_org_phone_unique` ainda existe. Os dados estáticos não incluem o marcador operacional de conclusão. | Aposentar a unicidade global é a ativação da identidade por fila. Não certificar B2 apenas pela presença de colunas A1. |

Referências da baseline: função de consistência
[:14913](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L14913),
contexto de mensagem
[:70032](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L70032),
índice global
[:94490](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L94490)
e trigger UPDATE-only
[:96912](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L96912).
A API consulta explicitamente a presença do índice global em
[legacyLeadPhoneUniquenessActive](../apps/api/internal/leads/repository.go#L5254).

### Por que não executar A2/B1/B2 cegamente no banco vazio

- A2 exige a estrutura A1, índice global antigo válido e ausência de duplicatas;
  exige intake realmente quiescido ou prova do freeze online. Cria índices
  `CONCURRENTLY`, usa lock de sessão e exige conexão dedicada/autocommit.
- Freeze exige SHA compatível implantado e smoke atestado; rejeita ingressos
  legados em processing e corridas de claim. Insere o ledger de identidades
  congeladas e instala o trigger, sem reprocessar ou editar a inbox de origem.
- B1 exige SHA implantado, smoke e workers+intake quiescidos, ou freeze online
  provado. Mesmo vazio, faltam hoje os dois índices A2. Verifica grants de
  backend, ausência de policies de escrita browser, contratos de proveniência,
  ausência de trabalho em voo e consistência de ledger/recibos.
- B1 toma locks finais com timeout de cinco segundos, materializa bindings
  ausentes, preenche históricos incompletos e terminaliza entregas antigas
  ainda não enviadas. Substitui funções/triggers e revoga helpers legados.
  Não é uma simples operação de ACL, nem um seed para importar integralmente.
- B2 só aceita a versão estrita com comments/readbacks, os índices A2,
  constraints e privilégios finais. Registra marcador prepared, executa
  `DROP INDEX CONCURRENTLY` e registra completed. Não oferece rollback global
  de todas essas etapas autocommit; em falha exige inspeção do marcador.
- Banco vazio elimina alguns conflitos de dados, não prova deploy, smokes,
  quiescência nem compatibilidade dos writers. Não preencher atestações com
  valores artificiais para vencer os guards.

Fonte operacional:
[A2](../supabase/cutovers/20260919_prepare_queue_scoped_lead_online_indexes.sql),
[B1](../supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql),
[B2](../supabase/cutovers/20260919_retire_legacy_global_lead_phone_index.sql) e
[runbook](../supabase/cutovers/20260919_queue_scoped_lead_identity_runbook.md).

Para homologação futura, preparar um pacote final derivado, com estados e
guards de staging, preservando as funções modernas; não executar a sequência
histórica de produção para fingir que o ambiente nasceu em rollout online.
Sem esse pacote, manter a capacidade por fila/WhatsApp como não certificada.

## Epochs de conversas: não restaurar o corpo histórico

A baseline ainda tem a constraint global
`whatsapp_conversations_session_id_remote_jid_key`
[:89041](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L89041),
e não possui o índice parcial
`whatsapp_conversations_active_session_remote_jid_uidx`.
O resolver de automação ainda usa `ON CONFLICT(session_id, remote_jid)` completo.
A captura v2 atual não marca `unlinked_capture_policy=v1`.
Assim, a retenção/aposentadoria de epochs está preparada, mas não ativada como
na fase B. Os consumidores posteriores verificam esse marcador antes de agir.

O [cutover de ativação](../supabase/cutovers/20261008_activate_whatsapp_unlinked_epoch.sql)
exige o índice parcial pré-construído com chave/predicado exatos, remove a
constraint completa e substitui o resolver e a captura v2. Não possui um gate
de SHA/smoke equivalente ao B1; a compatibilidade dos writers depende do runbook.
Aplicá-lo diretamente agora também regrediria a captura moderna:

- [Baseline atual, linha 7932](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L7932):
  usa `whatsapp_contact_pn_reference` para obter PN explícito.
- [Linha 7966](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L7966)
  e [linha 8230](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L8230):
  rejeitam conflito de PNs, incluindo evidências da conversa armazenada.
- O corpo histórico no cutover volta a usar somente
  `normalize_phone(p_contact_phone)` e não contém essas barreiras.

Uma ativação futura precisa compor epochs com as barreiras PN/LID atuais e
testar writers, histórico, contexto herdado, intake e automação. Criar apenas
o índice parcial não ativa a feature; remover apenas a constraint global
quebra o resolver antigo que depende dela. Isso não é necessário para o CRUD
básico com integrações desligadas.

## Inventário dos 20 SQLs de cutover

Os nomes abaixo são relativos a `supabase/cutovers/`. “Representado” significa
estrutura/ACL observada na fonte atual; não certifica execução histórica ou
catálogo remoto. Preparo antigo pode ter sido substituído por contrato mais novo.

| Arquivo | Estado/relevância para a candidata | Guard/efeito que impede execução direta |
| --- | --- | --- |
| `20260713000500_whatsapp_backend_cutover_security.sql` | Fronteira backend-only de tabelas já refletida nas ACLs; helpers/policies atuais evoluíram. | Substitui helpers e remove policies/grants browser. Reaplicar corpos antigos pode remover autorização posterior; não é instalador atual. |
| `20260719015030_complete_whatsapp_webhook_token_cutover.sql` | Duas constraints finais anti-credenciais não constam na baseline. Relevante antes de habilitar ingressos de teste, não ao CRUD básico. | Preflight fixa URL da API de produção; rotaciona tokens de todas as sessões Evolution e remove campos dos payloads históricos. Não usar em staging; derivar só o contrato pertinente sem rotação/import. |
| `20260909_prepare_whatsapp_media_queue.sql` | Campos/índices de hardening presentes; índice global serial foi superado pela escala por slots. | Normaliza linhas/status/dedupe e cria o semáforo global antigo; pode restringir indevidamente a fila atual. Exige worker legado drenado e autocommit. |
| `20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql` | Índice processing presente; due-head antigo foi substituído por v2. | Recria índice antigo redundante; exige forma/validade exatas e execução CONCURRENTLY. |
| `20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql` | Colunas lane/provider e os dois índices finais presentes. A API verifica sua validade. | Alteração de colunas e índices CONCURRENTLY; IF NOT EXISTS não basta para forma/validade. Não repetir preparo representado. |
| `20260912_prepare_whatsapp_outbox_finalization_index.sql` | Índice due-head v2 presente e antigo ausente, estado final esperado. | Cria v2, valida sua forma e remove o antigo online; não é etapa faltante. |
| `20260912_prepare_whatsapp_outbox_lane_indexes.sql` | Índices fast/media presentes. Índices de contrato temporários não devem integrar a baseline. | Usa CONCURRENTLY e valida predicados contra tabela/índices temporários. Não confundir objetos temporários ausentes com lacuna. |
| `20260912_prepare_whatsapp_storage_boundary.sql` | Policy restritiva `whatsapp media backend-only boundary` presente no overlay Cloud. | Exige bucket privado whatsapp-media e lock NOWAIT em storage.objects; lock e policy dependem dos privilégios da plataforma. O overlay atual já cobre a policy, sem necessidade de repetir o preparo histórico. |
| `20260912_scale_whatsapp_media_queue.sql` | Sete índices de escala e claim legado no-op já presentes. Estado operacional de drenagem não é seed. | Exige índice global serial antigo, hoje ausente; instala fence e aguarda drenagem antes da migration ativadora. Não reativar fase de preparo. |
| `20260912_validate_whatsapp_media_scale.sql` | CHECK `media_jobs_processing_slot_check` continua NOT VALID na fonte. Validação final é complemento pendente para certificar escala, sem bloquear o CRM com worker off. | Exige todos os índices/overloads, ausência do semáforo global, dados consistentes e FORCE RLS das cercas; faz scan e VALIDATE, sem enviar ao provedor. |
| `20260919_prepare_queue_scoped_lead_online_indexes.sql` | A2 ausente: dois índices finais. | Estrutura A1 + índice global legado válido + intake quiescido ou freeze provado; CONCURRENTLY/autocommit. |
| `20260919_enable_strict_whatsapp_message_binding.sql` | B1 incompleto, conforme lista de objetos acima. | Deploy/smoke/quiescência ou freeze; índices A2 e contratos; locks/backfills/terminalização e substituição de funções. |
| `20260919_retire_legacy_global_lead_phone_index.sql` | B2 não representado: índice global ainda existe. | Exige B1 completo e readbacks; marcador durável e DROP INDEX CONCURRENTLY, com recuperação por estado. |
| `20260920_freeze_legacy_whatsapp_ingress_online.sql` | Trigger de freeze ausente; helper/tabela aditivos presentes. | Exige release/smoke, nenhuma linha legada processing e cobertura exata de identidades; não é simples flag de ambiente. |
| `20260924_restore_property_media_upload_intents.sql` | Tabelas, índices, triggers e grants presentes; reparo desnecessário. | Aborta se qualquer objeto do reparo já existe, se ledger de migrations existe, ou se bucket/ACL/Storage diferem; não é idempotente. |
| `20261008_whatsapp_unlinked_epoch_index.sql` | Índice parcial ativo ausente. Pré-requisito para epochs, não ativação isolada. | CONCURRENTLY fora de transação; verificar indisvalid/indisready e chave/predicado, não só existência. |
| `20261008_activate_whatsapp_unlinked_epoch.sql` | Fase B ausente; aplicação histórica direta regrediria barreiras PN atuais. | Exige índice parcial exato, remove constraint global e substitui dois corpos. Necessita derivado moderno e compatibilidade de todos os writers. |
| `20261009_retire_invitation_plaintext_token.sql` | Coluna/trigger legados existem; API compatível trabalha nos dois estados. | Exige SHA compatível, réplicas antigas drenadas, backup atestado, pares token/hash válidos e índice hash único; DROP COLUMN irreversível após commit. |
| `20261012_property_auxiliary_gateway.sql` | As cinco tabelas já têm policies/grants finais na baseline/post-GraphQL. | Exige helper e RLS; revoga grants de tabela/coluna e substitui policies. Não é lacuna a reparar novamente. |
| `20261013_prepare_simple_stage_inactivity_index.sql` | Índice ausente; necessário para salvar regras de inatividade, inclusive desativadas. | SQL canônico é um CREATE INDEX CONCURRENTLY isolado. Propor complemento guardado de staging, sem chamar outros cutovers. |

## Limites e próxima verificação

Prioridade para o CRM básico: hardening RPC acompanhado separadamente, índice
de inatividade derivado, configuração dos buckets apropriados e canários reais
de leitura/escrita autorizados. Não habilitar integrações para validar esses itens.
Para testes de cards entre filas ou WhatsApp, primeiro especificar e verificar
os objetos finais A2/B1/B2/epochs; não anunciar essas capacidades como prontas
com base na baseline ou no smoke de Auth/RLS.

Esta revisão não aplicou DDL, não rodou pgTAP/SQL contra banco e não executou
testes HTTP. A validação offline comprova as fontes e as diferenças enumeradas;
não comprova o runtime remoto nem substitui o catálogo efetivo do executor.

# Cutovers manuais do banco de dados

Os arquivos deste diretório representam alterações operacionais executadas uma
única vez e cujas condições dependem do estado da implantação em produção. Eles
ficam deliberadamente fora de `supabase/migrations` e da execução normal de
`db push`.

## Processo obrigatório

1. Siga o roteiro de implantação correspondente e valide todas as pré-condições.
2. Crie um backup do banco e registre o responsável e o horário da execução.
3. Execute o cutover manualmente, na ordem documentada.
4. Rode o teste SQL correspondente em `supabase/cutovers/tests/`.
5. Registre o resultado no histórico da implantação.

## Situação do WhatsApp em 2026-07-22

Nenhum dos dois cutovers do WhatsApp está pronto para execução. A auditoria
encontrou 55 sessões ativas do Evolution Go que ainda não haviam convergido para
o endpoint de backend sem token na URL e 7.985 payloads históricos da inbox com
campos de autenticação. As constraints finais também estavam ausentes.

Repita as verificações do roteiro antes de qualquer execução. Esses números são
apenas um retrato datado do banco.

## Fila de mídia do WhatsApp

`20260909_prepare_whatsapp_media_queue.sql` é pré-requisito obrigatório para
aplicar `20260904225214_harden_whatsapp_media_queue.sql` em um banco com dados.
Desative primeiro o media-worker legado e confirme que não há job em
`processing`; o script falha fechado se encontrar trabalho ambíguo. Ele preserva
jobs `pending` e `failed`, valida os dados e cria os índices com
`CREATE INDEX CONCURRENTLY`. Execute-o com cliente em autocommit, faça o readback
dos blocos de verificação e só então avance com a migration transacional.

## Identidade de lead por fila e vínculo canônico do WhatsApp

O rollout iniciado por
`20260919181318_queue_scoped_lead_identity_and_whatsapp_binding.sql` é
deliberadamente dividido. A1 e a migration aditiva de fences da automação
pertencem à cadeia normal. Os três passos seguintes são cutovers manuais e não podem ser movidos
para `supabase/migrations`, porque o runner poderia atravessar o deploy de
compatibilidade e retirar a unicidade global cedo demais.

Siga exatamente o roteiro em
`20260919_queue_scoped_lead_identity_runbook.md`. A ordem original com pausa
integral continua suportada. Para produção ativa, a ordem online é:

1. migrations aditivas A1 e de fences já aplicadas;
2. migration aditiva
   `20260920012629_preserve_deleted_round_robin_identity.sql`;
3. migration aditiva
   `20260920022237_harden_canonical_distribution_availability.sql`;
4. migration aditiva
   `20260920080434_freeze_legacy_whatsapp_ingress_for_online_cutover.sql`;
5. deploy API e Web compatíveis no mesmo SHA imutável, cujo worker só reivindica
   inbox com routing snapshot v1 e, no Edge self-hosted, publicação somente de
   `evolution-go-webhook` com readback do allowlist real;
6. `20260920_freeze_legacy_whatsapp_ingress_online.sql`, que registra o legado
   sem alterar, reenviar ou apagar nenhuma linha da inbox;
7. `20260919_prepare_queue_scoped_lead_online_indexes.sql` em autocommit com
   `online_legacy_freeze=true`;
8. `20260919_enable_strict_whatsapp_message_binding.sql`, informando o SHA, os
   smokes e `online_legacy_freeze=true`;
9. `20260919_retire_legacy_global_lead_phone_index.sql` em autocommit, com os
   mesmos gates.

No caminho online o intake nunca é desligado. Os scripts usam locks com timeout
de cinco segundos: se não conseguirem a fronteira final, abortam sem mudança e
devem ser repetidos quando a atividade em voo terminar naturalmente.

O passo 9 é o ponto em que duas filas passam a poder manter cards distintos
para o mesmo telefone. Não o execute se qualquer readback, smoke ou pgTAP não
estiver verde.

## Recibos técnicos retidos de conexões excluídas

O cutover de 17 de novembro de 2026 permite encerrar os recibos técnicos da
época zero de conexões Evolution Go excluídas e inativas cuja época ativa é um.
O guard exige uma autorização do proprietário na mesma transação e mantém
o envelope, a chave original de deduplicação e as tentativas. A API, os workers
e os clientes conservam as permissões e os contratos existentes.

1. Confirme a aprovação do escopo e a CI e auditoria do commit. Identifique o
   primário, confirme a recuperação do backup e preserve as definições e os
   grants vigentes. Confira a ingestão, a outbox e os workers de notificações.
2. Execute `20261117_install_whatsapp_retained_receipt_guard.sql` como
   proprietário do banco. O instalador exige os corpos revisados dos guards,
   classificadores e digest. Confira o catálogo e o teste SQL antes da drenagem.
3. Carregue `20261117_apply_whatsapp_retained_receipt_batch.sql` em uma
   transação explícita por conexão excluída. Compare os hashes de catálogo e
   forneça o manifesto exato. Ensaie com rollback antes do commit. O operador
   guarda os originais indefinidamente e recusa IDs associados a mensagem,
   envio, confirmação de notificação ou outra dependência conhecida.
4. Confira o pós-estado e as métricas de entrada, envio e notificações a cada
   rodada. Após finalizar os lotes, desative a exceção com
   `20261117_disable_whatsapp_retained_receipt_guard.sql`. Confirme o corpo
   original do guard e a retenção dos originais e auditorias. Use a mesma
   desativação para reverter a alteração de schema operacional.

O teste `tests/20261117_whatsapp_retained_receipt_guard_readback.sql`
verifica a proteção do catálogo e os originais. A auditoria do banco registra o
pré-estado necessário para uma eventual reversão de um lote, que exige uma
operação própria e comparação com o pós-estado gravado.

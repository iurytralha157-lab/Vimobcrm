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
`20260919_queue_scoped_lead_identity_runbook.md`. A ordem é:

1. quiesce comprovado de todo intake que cria/reentra leads;
2. migration aditiva A1;
3. migration aditiva
   `20260919232152_harden_automation_whatsapp_binding_fences.sql`;
4. migration aditiva
   `20260920012629_preserve_deleted_round_robin_identity.sql`, que deve estar
   aplicada antes de qualquer réplica da API que consulte `round_robins.deleted_at`;
5. migration aditiva
   `20260920022237_harden_canonical_distribution_availability.sql`;
6. `20260919_prepare_queue_scoped_lead_online_indexes.sql` em autocommit;
7. deploy API e Web compatíveis no mesmo SHA imutável e, no Edge
   self-hosted, publicação somente de `evolution-go-webhook`, com readback do
   allowlist real e sem reativar rotas Edge ausentes/legadas;
8. `20260919_enable_strict_whatsapp_message_binding.sql`, informando o SHA e a
   confirmação explícita dos smokes;
9. `20260919_retire_legacy_global_lead_phone_index.sql` em autocommit, com os
   mesmos gates.

O intake só volta depois dos canários posteriores ao último passo; caso
contrário uma entrada em outra fila durante a convivência com o índice global
seria registrada como reentrada no card antigo.

O passo 9 é o ponto em que duas filas passam a poder manter cards distintos
para o mesmo telefone. Não o execute se qualquer readback, smoke ou pgTAP não
estiver verde.

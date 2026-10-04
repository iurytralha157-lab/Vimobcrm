# Canário local de sucessoras recentes após CTWA vencido

Este roteiro descreve a ordem de verificação para uma futura publicação. Não é uma autorização para alterar produção, ativar sessões ou recuperar a fila antiga.

## Contrato e ordem

1. Publicar a migração aditiva `supabase/migrations/20261003234500_whatsapp_ctwa_recent_successor_cohort.sql` **antes** do binário Go que consulta suas tabelas e funções. A migração, sozinha, deixa o rollout desligado por sessão.
2. Publicar as duas réplicas da API no mesmo SHA compatível. Confirmar `/readyz` em **cada tarefa atual** e a conexão do processo com o banco que recebeu a migração. Dois `worker_id` nos últimos 90 segundos podem ser a mesma réplica após reinício e não provam duas tarefas vivas.
3. Em ambas as tarefas, ler a configuração efetiva: `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native`, `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS` com **um único UUID** de canário, `WHATSAPP_INBOUND_RECORDING_SESSION_IDS` contendo o mesmo UUID, e workers webhook, mídia e retenção ligados. A allowlist mantém as outras sessões no caminho Edge. Verificar que o callback Evolution Go desse número aponta para a API Go. Não assumir isso a partir do arquivo de stack.
4. Fazer o preflight somente com SELECT no banco efetivo. Confirmar `current_user` e permissão de EXECUTE dos helpers usados pela API; conferir zero jobs de mídia antigos pendentes da sessão canário, zero deleções de Storage pendentes de outras sessões/organizações, nenhuma lease processing antes de ativar, nenhuma rota candidata acima do limite de 256 eventos, e estado das duas réplicas. Registrar contagens e horários. A deleção de Storage ainda usa outbox global; se houver itens externos, **não ativar** até existir claim restrito. Medir também o tamanho de `whatsapp_webhook_routing_snapshots` e o plano de acesso do predicado FIFO na base de teste com volume representativo: o índice de cadeia existente só cobre `binding_eligible=true`, enquanto as sucessoras orgânicas rebaseadas usam `false`. Se a leitura varrer grande parte da tabela, preparar índice próprio em etapa separada e segura antes da ativação; não criar índice bloqueante às cegas na publicação.
5. Só depois de testes locais, readback e autorização específica de publicação, ativar **uma** sessão pelo procedimento privado `private.activate_whatsapp_ctwa_recent_successor_session`. Não ativar a política geral de retenção nem reenfileirar eventos antigos. Ler novamente os estados e medir: CTWA antiga sem efeitos, sucessora recente processada uma vez, conversa sem lead com 168 horas desde a primeira ACK recente, mídia enfileirada/visível, sem dois cards ou mensagens duplicadas.
6. Uma API anterior não entende a coorte e é barrada pelo gatilho após ativação. O SHA anterior só serve para voltar antes de ativar. Depois, manter binário compatível, pausar apenas a sessão canário se necessário e corrigir adiante; não apagar a linha de rollout como improviso.

## Consultas de inspeção

Substituir `:session_id` pelo UUID da sessão canário e executar no mesmo papel do `DATABASE_URL` da API, em conexão de leitura. Não executar comandos de escrita do roteiro durante o preflight.

```sql
select current_user,
       has_function_privilege(current_user,
         'private.whatsapp_ctwa_recent_successor_claimable(uuid,uuid,text)', 'EXECUTE') as claimable_ok,
       has_function_privilege(current_user,
         'private.whatsapp_ctwa_recent_successor_claimable(uuid,uuid,text,text)', 'EXECUTE') as fifo_claimable_ok,
       has_function_privilege(current_user,
         'private.whatsapp_nonlead_retention_candidate_active(uuid,uuid,uuid)', 'EXECUTE') as candidate_ok,
       has_function_privilege(current_user,
         'private.stage_whatsapp_repair_source_media_delete(uuid,uuid[],text[],text)', 'EXECUTE') as media_repair_gc_stage_ok,
       has_function_privilege(current_user,
         'private.claim_whatsapp_nonlead_media_delete(text)', 'EXECUTE') as media_delete_claim_ok,
       has_function_privilege(current_user,
         'private.heartbeat_whatsapp_ctwa_cohort_worker(text)', 'EXECUTE') as heartbeat_ok;

select status, count(*), min(created_at)
from public.media_jobs
where session_id = :session_id::uuid
group by status order by status;

select status, count(*), min(created_at)
from private.whatsapp_nonlead_media_delete_outbox
group by status order by status;

select status, count(*), min(created_at)
from public.whatsapp_webhook_inbox
where session_id = :session_id::uuid
group by status order by status;

select routing_key, count(*) as events
from public.whatsapp_webhook_routing_snapshots
where session_id = :session_id::uuid
group by routing_key
having count(*) > 256
order by events desc;

select pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(
         'public.whatsapp_webhook_routing_snapshots'::regclass)) as snapshot_bytes,
       reltuples::bigint as estimated_snapshot_rows
from pg_catalog.pg_class
where oid = 'public.whatsapp_webhook_routing_snapshots'::regclass;
```

Em ambiente de teste com volume semelhante, executar `EXPLAIN (ANALYZE, BUFFERS)` para o predicado de predecessores por organização, sessão, rota e faixa de `ingress_sequence` usado em `private.whatsapp_ctwa_recent_successor_claimable(uuid,uuid,text,text)`. Não usar `ANALYZE` em produção para esta checagem; registrar o plano e duração antes do canário.

O preflight deve também revisar os erros `whatsapp_ctwa_cohort_*` e o atraso `oldestCohortOverdueSeconds` nos logs do worker. `busy` e `retry` preservam os dados e exigem investigação; não são autorização para apagar ou reprocesar manualmente.

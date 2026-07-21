# Automações: contrato operacional

O runtime é backend-owned. O navegador nunca escreve diretamente nas tabelas internas: publicação e administração passam pela API Go; execução passa por RPCs `security definer` concedidas somente a `service_role` e pelas Edge Functions versionadas neste repositório.

## Criação e publicação atômicas

`POST /v1/automations` aceita um rascunho sem grafo ou cria a automação já com `flow_definition` validado. Quando o grafo é enviado, automação, nós visuais, conexões e a primeira `automation_flow_versions` são gravados na mesma transação. Não existe mais a janela POST + PUT que deixava rascunho órfão. `is_active=true` só é aceito junto de um grafo publicável.

`PUT /v1/automations/{id}/flow` publica uma nova versão imutável e aceita:

- `flowDefinition` obrigatório;
- `name`, `description` e `isActive` opcionais.

`PATCH /v1/automations/{id}` aceita somente metadados/status. Trigger e grafo mudam exclusivamente pelos contratos versionados acima.

O grafo tem exatamente um trigger, é acíclico e totalmente alcançável. Condições usam branches `true`/`false`; delays com resposta usam `replied`/`no_reply`.

Templates podem usar `{{lead.*}}`, `{{organization.name}}`, `{{date}}`, `{{now}}` e dados em `{{execution.*}}`. `date` é `DD/MM/AAAA` no `settings.timezone` do fluxo (ou timezone do trigger agendado; fallback `America/Sao_Paulo`); `now` é ISO 8601 UTC.

As ações `deal_status`, `assign_user` e `property_interest` continuam deliberadamente bloqueadas na validação. `move_lead` usa o comando transacional canônico instalado pela migration `20260721000613_automation_conversational_handoff.sql`, com validação de tenant/pipeline/etapa, auditoria e atividade.

Esperas com `stop_on_reply` podem configurar handoff por mídia, resposta inesperada ou rajada de mensagens. Uma mensagem humana enviada na conversa cancela as execuções ativas do lead no banco, e `POST /v1/leads/{id}/automation-executions/cancel` oferece a mesma parada manual para a interface.

## Mídia e WhatsApp

O grafo persiste somente referência privada:

```json
{
  "media_bucket": "automation-media",
  "media_path": "<organization-uuid>/images/<arquivo>"
}
```

As pastas válidas são `images`, `audios` e `videos`. Antes do envio, o runtime verifica tenant e tipo, copia a mídia para o caminho persistente `whatsapp-media/orgs/.../outgoing/...` e assina uma URL de 15 minutos apenas para o provider. O histórico nunca armazena URL expirada. A exclusão é bloqueada enquanto qualquer versão ativa ou execução `queued/running/waiting` referencia o objeto.

`GET /v1/automation-media` é paginado por `limit`/`offset` (máximo 100 por página). A interface oferece carregamento incremental, sem truncar silenciosamente a galeria.

Se um lead ainda não tiver conversa, a sessão configurada é validada como ativa, conectada, `evolution_go` e da mesma organização; telefone/JID são normalizados e a conversa individual é criada/reutilizada de modo idempotente. Depois do provider, uma única RPC grava mensagem, preview da conversa, atividade do lead, identidade canônica e timeline.

## Eventos, atrasos e execução

Produtores transacionais geram `lead_created`, `lead_stage_changed`, `tag_added` e `message_received`. Eles são fail-open: falha no outbox gera warning sem impedir a escrita principal do CRM. `scheduled` é one-shot. O scan de `inactivity` tem índice próprio e worker separado a cada 60 segundos, para nunca atrasar mensagens, delays ou execuções acordados a cada 5 segundos.

Cada execução aponta para um snapshot em `automation_flow_versions`; cada nó registra `automation_execution_steps`. Entrada em espera, fechamento do step e retomada são transações com fencing. Uma resposta durável cujo `occurred_at` esteja entre o início e o deadline vence a corrida com timeout; timeout avança para `no_reply`. Não existe update intermediário de `resume_branch`.

Estados: `queued -> running -> waiting -> queued -> running -> completed`; terminais alternativos são `failed` e `cancelled`. Lease/CAS é conferido antes de efeitos e transições. O runner processa no máximo cinco execuções em paralelo e faz checkpoint depois de 50 nós.

Histórico detalhado:

`GET /v1/automation-executions/{id}/steps?limit=50&offset=0`

Métricas de cards não são inferidas da página de 50 execuções: `GET /v1/automation-executions/summary` agrega todos os registros por automação. Os counts são exatos; a amostra `activeExecutionIds` traz até 100 IDs e sinaliza `activeIdsTruncated`. `POST /v1/automations/{id}/executions/cancel` cancela todas as execuções ativas no servidor e fecha seus steps na mesma transação.

## Idempotência, webhooks e operação

`automation_effect_dispatches.effect_key` reserva cada efeito uma vez. Timeout ou resultado de rede ambíguo vira `unknown` e nunca é reenviado automaticamente.

Webhooks exigem `AUTOMATION_WEBHOOK_ALLOWED_HOSTS`; allowlist vazia desabilita o efeito. Redirects são bloqueados, DNS privado/reservado (inclusive IPv4-mapped IPv6) é recusado, request tem timeout e a resposta é lida em streaming até 64 KiB. Se `AUTOMATION_WEBHOOK_HMAC_SECRET` estiver definido, o runtime envia `X-Vimob-Signature: sha256=...`, além de `Idempotency-Key`.

Profundidade causal é limitada a 10 e o circuit breaker abre após dez execuções da mesma automação/lead por hora. Decisões de circuito e deduplicação ficam registradas no evento.

Diagnóstico tenant-safe:

- `GET /v1/automation-runtime/issues?limit=50&offset=0` retorna contadores e lista de dead letters, falhas, circuitos, duplicações e efeitos ambíguos;
- `POST /v1/automation-runtime/issues/{kind}/{id}/retry` recoloca somente eventos comprovadamente seguros. Efeitos `unknown/sending` nunca têm retry automático.

## Integração Go

O bootstrap chama uma vez:

```go
automationsRepository.StartRuntimeWorker(ctx, logger)
```

Esse método inicia o runner crítico e o worker desacoplado de inatividade. Rotas a registrar no app:

- `Handler.ListExecutionSteps`;
- `Handler.ListExecutionSummaries` e `Handler.CancelAutomationExecutions`;
- `Handler.ListRuntimeIssues`;
- `Handler.RetryRuntimeIssue`.

`ProcessRuntimeOnce(ctx)` e `ProcessInactivityOnce(ctx)` permitem probes locais determinísticos.

As Edge Functions `automation-runner`, `automation-trigger`, `automation-delay-processor`, `automation-executor` e `automation-inactivity` exigem Bearer igual ao `SUPABASE_SERVICE_ROLE_KEY`. `automation-executor` aceita somente `execution_id`; não existe override de nó.

## Validação local

Nenhum comando abaixo publica função nem aplica migration remota:

```text
go test ./apps/api/internal/automations
go test ./apps/api/...
npx -y deno@2.1.14 check supabase/functions/_shared/automation-runtime.ts supabase/functions/automation-*/index.ts
npx -y deno@2.1.14 test --allow-env supabase/functions/_shared/automation-runtime.test.ts
```

`supabase/tests/automation_runtime_hardening.test.sql` cobre 29 contratos de banco, incluindo crash/race de delay, compatibilidade de espera simples, precedência reply-vs-timeout, lead sem conversa e persistência atômica do histórico/ledger. A migration também pode ser executada localmente dentro de uma transação forçada a rollback para validar DDL/RPC sem persistir estado.

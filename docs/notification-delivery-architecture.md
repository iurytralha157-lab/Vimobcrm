# Notificações Vimob CRM: arquitetura, garantias e operação

## Objetivo

O registro em `public.notifications` é a fonte durável do evento e da caixa de entrada. Cada entrega externa é materializada separadamente em `private.notification_deliveries`, uma linha por notificação, canal e destinatário lógico. O envio para WhatsApp, e-mail ou push acontece somente no worker do backend Go.

Essa separação elimina a corrida anterior em que a requisição HTTP enviava imediatamente e, ao mesmo tempo, deixava a mesma notificação disponível para o worker. Também elimina o fallback para um segundo remetente quando o primeiro pedido ao WhatsApp pode ter sido gravado pelo provedor, mas sua resposta não chegou ao CRM.

## Fluxo canônico

1. O produtor valida o evento, destinatário e organização.
2. A transação de negócio grava uma única linha em `public.notifications`, com `dedupe_key` e os canais requeridos em `metadata.dispatch`.
3. Um trigger materializa uma entrega por canal. Push gera uma entrega por token ativo.
4. O worker reserva entregas vencidas com `FOR UPDATE SKIP LOCKED` e um lease curto.
5. Antes de qualquer chamada externa, o worker faz o preflight de configuração, destinatário e conexão.
6. Imediatamente antes do HTTP, a tentativa passa para `sending` e ganha uma entrada no ledger.
7. O resultado vira `accepted`, `delivered`, `retry_wait`, `blocked_dependency`, `permanent_failed` ou `dead_letter`.
8. Webhooks/recibos promovem `accepted` para `delivered` ou devolvem uma falha transitória para a fila.

O endpoint público `POST /v1/notifications/dispatch` confirma apenas `queued: true`. Ele não afirma que o provedor entregou a mensagem.

## Estados

| Estado | Significado | Próxima ação |
| --- | --- | --- |
| `queued` | Pronta para ser reservada | Worker |
| `leased` | Reservada por um worker, ainda sem tentativa externa | Preflight |
| `sending` | Tentativa externa iniciada e auditada | Provedor/timeout |
| `accepted` | Provedor aceitou ou o resultado ficou incerto após o request | Aguardar recibo; não reenviar às cegas |
| `delivered` | Recibo ou canal confirmou a entrega | Terminal |
| `retry_wait` | Falha transitória com nova data de tentativa | Worker após backoff |
| `blocked_dependency` | Sessão, token ou configuração indisponível | Desbloqueio automático ou operacional |
| `permanent_failed` | Destino/requisição inválida sem retry seguro | Corrigir e reprocessar manualmente |
| `dead_letter` | TTL ou orçamento de tentativas encerrado | Análise e replay auditado |
| `cancelled` | Entrega retirada de circulação | Replay somente por decisão operacional |

## Garantias

- Persistência antes do envio: eventos transacionais são enfileirados dentro da mesma transação do negócio quando aplicável.
- Confirmação do produtor: verificadores de SLA e sessão só avançam o estado de origem depois de receber `queued: true`; uma falha preserva o episódio para nova tentativa.
- Idempotência: uma chave estável existe por organização, evento lógico, canal e destinatário.
- Fontes equivalentes compartilham a mesma chave: distribuição SQL, formulário do site e dispatcher de lead convergem em `new_lead_received:<lead>:<user>`.
- Concorrência: uma entrega tem apenas um lease válido; workers concorrentes não reservam a mesma linha.
- Retentativa: falhas transitórias usam backoff exponencial com jitter, respeitam `Retry-After`, TTL e orçamento máximo.
- Falha de dependência não consome tentativa: WhatsApp desconectado, credencial ausente ou configuração inválida fica bloqueado.
- Resultado incerto não gera duplicata: se o request pode ter chegado ao provedor, a entrega fica `accepted` aguardando reconciliação.
- Auditoria: toda tentativa, sweep, recibo e replay fica em `private.notification_delivery_attempts`.
- Privacidade: a fila usa identificadores lógicos (`user:<uuid>` e `push_token:<uuid>`), não telefone/e-mail como chave de destinatário.
- Retenção fail-closed: a limpeza automática não apaga notificações que possuam qualquer marcador de entrega.

Nenhum sistema distribuído consegue prometer “exactly once” apenas com HTTP. A garantia prática aqui é at-least-once controlado, idempotência estável no provedor quando suportada e ausência de retry cego depois de um resultado incerto.

## Inventário de eventos e canais

O backend reconhece atualmente estes grupos principais:

- Leads e funil: `new_lead_received`, `lead_reentry`, `lead_duplicate_existing`, `lead_transferred`, `lead_stage_changed`, `deal_won`, `lead_redistribution_warning`, `lead_redistributed_received`, `lead_redistributed_away`, `lead_auto_redistributed`, `lead_auto_redistribution_failed`.
- Agenda e SLA: `schedule_reminder`, `appointment_reminder`, `sla_warning`, `sla_overdue`, `sla_overdue_manager`.
- WhatsApp: `whatsapp_disconnected` e `whatsapp_disconnected_admin`.
- Assinatura e onboarding: `billing_*`, `onboarding_welcome`, `onboarding_email_confirmation`, `internal_user_invitation`.
- Produto: `update_phone_reminder`, `gamification_update`, `announcement`, `announcement_published`, `interest_property_reserved` e `test_push`.

Nem todo evento usa todos os canais. O produtor grava exatamente os canais resolvidos pelo template ou pela política do backend. O canal `system` permanece como a linha visível na caixa de entrada; WhatsApp, push e e-mail ganham entregas externas independentes.

## Pontos de produção

- Backend Go: produtor canônico, worker e reconciliação.
- `notification-dispatcher` Edge: compatibilidade para produtores legados, agora somente enfileira.
- Schedulers e produtores Edge: `notification-scheduler`, `lead-notification-dispatcher`, `public-site-contact`, `sla-checker` e `session-health-check`.
- Recibos: webhooks de Evolution Go/WhatsApp e Resend atualizam a entrega correspondente.
- Interface: caixa de entrada lê `public.notifications`; painel técnico lê métricas e entregas problemáticas.
- Limpeza: `cleanup-notifications` só remove registros antigos comprovadamente internos e sem qualquer estado de entrega.

As funções legadas de envio não devem ser removidas apenas por busca no repositório: a retirada exige confirmar invocações e configuração no ambiente publicado.

## Operação

O painel técnico do superadmin expõe:

- volume por canal e estado;
- itens vencidos e idade da fila;
- entregas bloqueadas, aguardando recibo e em dead-letter;
- erro, dependência, provedor e orçamento de tentativas;
- replay manual com motivo e usuário solicitante gravados no ledger.

Alertas recomendados:

- qualquer `dead_letter` ou `permanent_failed` novo;
- `blocked_dependency` por mais de 5 minutos para eventos críticos;
- entrega pronta há mais de 2 minutos com worker habilitado;
- `accepted` sem recibo por mais de 1 hora;
- lease expirado, aumento abrupto de retries ou taxa de erro por provedor;
- ausência de ciclo do worker por mais de duas vezes o intervalo configurado.

## Runbook de indisponibilidade do WhatsApp

1. Confirmar a sessão e a configuração no painel, sem disparar replay em massa.
2. Verificar se as entregas novas estão em `blocked_dependency` e se nenhuma tentativa foi consumida.
3. Restabelecer a sessão. O evento de reconexão libera somente as entregas daquela organização/dependência.
4. Observar fila ativa, idade e recibos.
5. Reprocessar manualmente apenas itens em estado terminal ou bloqueado que não foram liberados automaticamente.
6. Nunca reprocessar uma entrega `accepted` sem antes consultar o provedor pelo identificador persistido.

## Rollout seguro

1. Aplicar a migração com o worker desligado. O histórico pendente entra bloqueado por `legacy_backfill_cutover` e não é enviado automaticamente.
2. Publicar os produtores enqueue-only e interromper o fanout direto legado.
3. Publicar o backend enqueue-only ainda com o worker desligado.
4. Validar métricas, materialização por canal, permissões e reconciliação em staging.
5. Habilitar um único worker canário e liberar apenas eventos novos. Não reprocessar o backlog histórico em lote.
6. Executar testes de queda/reconexão, timeout depois do write, `429 Retry-After`, credencial ausente, token push inválido e worker morto durante o lease.
7. Manter o canário sob observação antes de aumentar concorrência.
8. Só retirar funções legadas após confirmar zero invocações no ambiente publicado e conservar um caminho de rollback.

## Limites desta atualização

A implementação e a validação deste pacote são locais. Migração remota, ativação do worker, replay de backlog e publicação de Edge Functions são ações separadas e exigem confirmação operacional no momento da mudança.

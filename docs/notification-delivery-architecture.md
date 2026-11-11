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

O worker Go consulta `private.notification_lead_whatsapp_fast_claim_v1()` no
catálogo ao iniciar. Com a função instalada, cada réplica reserva um executor
dos três executores existentes para os avisos de lead novo, prazo, recebimento
após redistribuição e saída da responsabilidade pelo WhatsApp. Ele consulta a
fila a cada dois segundos quando está livre e usa o mesmo lease, autorização e política de
retentativa do worker geral. A função deve existir em cada nova reserva dessa
fila. Uma réplica que inicia sem ela usa a rotina geral.

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
- WhatsApp: `whatsapp_disconnected`, `whatsapp_disconnected_admin` e
  `whatsapp_inbound_attendant`. O último é produzido somente pelo backend,
  para mensagem inbound nova capturada e responsável atual com atendimento
  elegível; reações, histórico e mensagens sem atendimento não geram esse push.
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

### Subfila SQL de push WhatsApp sem dispositivo

`private.whatsapp_inbound_push_waiting` preserva avisos sem nenhum token ativo
na origem. A chave é a notificação, com organização e validade originais;
não substitui uma entrega externa nem registra tentativa de HTTP.
`private.whatsapp_inbound_push_waiting_seed` é um cursor finito para avisos
anteriores à migration, ainda válidos e sem entrega: examina até 100 registros
por transação, sem replay de mensagens históricas.

Essas tabelas são privadas, com RLS e sem acesso direto de `anon`,
`authenticated` ou `service_role`. O `NotificationDispatchWorker` existente
processa a subfila dentro de `claim_notification_deliveries`; não há novo
worker Go ou cron. Ele revalida o responsável e as permissões, materializa
tokens ativados ou redireciona um aviso que nunca iniciou envio. A mensagem
possui um advisory lock compartilhado por todos os dispositivos; a transação
curta e o lease da entrega coordenam as réplicas. Ausência de dispositivo recebe
nova consulta em um minuto, limitada pela validade original. Expiração é
removida em lotes de até 100, em autocommit separado antes dos locks de acesso,
inclusive quando o alvo da mensagem foi apagado.

Configuração ou token ausentes preservam a tentativa zero. O marcador durável
de envio só é gravado depois do preflight e confirmado antes da chamada de
rede. Transferência depois desse marcador pode deixar concluir a chamada já
iniciada; não cria um push repetido ao novo responsável. O caminho legado
também valida configuração e tokens antes desse marcador.

A claim exige a capacidade interna `|wa_push_v2` para todo push de
`whatsapp_inbound_attendant`, inclusive com token ativo. Réplicas anteriores
continuam processando eventos genéricos, mas não reservam esses avisos nem
avançam o seed/waiting. Essa proteção permite aplicar o SQL antes de trocar
réplicas que faziam preflight do token antes de revalidar atendimento.

O [ensaio local de push e retenção](runbooks/whatsapp-push-retention-hardening-2026-10-12.md)
registra migrações, regressões, limites e sequência de publicação. A flag
`NOTIFICATION_DISPATCH_WORKER_ENABLED` continua opt-in; o inventário não
confirma sua ativação em produção.

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

### Descartar avisos pendentes antes de conectar o WhatsApp

Em `/admin/system-settings`, o superadmin pode abrir a prévia do reset da fila
de WhatsApp para a organização atual ou escolher explicitamente todas as
organizações. A prévia mostra quantos envios podem ser cancelados e quantos
já começaram ou foram aceitos pelo provedor. Informe um motivo e digite
`RESETAR` para confirmar; depois do resultado, conecte o remetente desejado.

O corte usa o horário da prévia retornado pelo banco e vale por 15 minutos.
Somente entregas `whatsapp` criadas até esse horário nos estados `queued`,
`retry_wait`, `blocked_dependency` ou `leased` passam a `cancelled`. A transação
invalida o lease e registra o motivo, autor, escopo e corte no ledger existente.
O início de envio confere estado e lease: se o reset vencer a corrida, o worker
não chama o provedor; se o envio já começou, ele permanece fora do reset.

As notificações na caixa de entrada, os envios por e-mail e push e as conversas
e mensagens da outbox de atendimento permanecem preservados. `sending` e
`accepted` não podem ser recolhidos; o resultado informa sua quantidade.
Avisos criados depois da prévia continuam seguindo o fluxo normal. Portanto,
este reset é um descarte pontual, não uma pausa permanente do disparador.
O reset só alcança registros já confirmados no banco; um produtor que ainda
esteja em transação poderá confirmar outro aviso depois da operação. Faça a
consulta novamente antes de conectar se precisar conferir o volume restante.

Contratos, ambos com autenticação ativa e autorização de superadmin:

- `GET /v1/admin/notification-deliveries/whatsapp-reset-preview` recebe
  `scope=organization&organizationId=<uuid>` ou `scope=all`; retorna `scope`,
  `organizationId` quando aplicável, `cutoffAt`, `pendingCount` e `inFlightCount`.
- `POST /v1/admin/notification-deliveries/whatsapp-reset` recebe o mesmo escopo,
  `cutoffAt`, `reason` e `confirmation: "RESETAR"`; retorna `cancelledCount`
  e `inFlightCount`. Corte futuro ou expirado exige nova prévia.

Não há nova migration nem alteração de worker ou configuração de conexão.
O cancelamento usa as tabelas e o estado terminal existentes e não apaga o
histórico. A reconexão automática não libera itens cancelados. Para recuperar
um aviso descartado por engano, analise a entrega individual no painel técnico
e use o replay auditado com motivo; isso pode gerar um envio real. Reverter o
código remove o controle, mas não desfaz cancelamentos já confirmados.

Verificações reproduzíveis da interface e dos contratos:

```text
node --test scripts/tests/notification-reset-ui-runtime.test.mjs
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/validation/notifications.test.ts
go test ./apps/api/internal/admin ./apps/api/internal/app ./apps/api/internal/leads
```

O teste de interface usa componentes e hook reais, com autenticação e respostas
sintéticas e toda a rede bloqueada. Não comprova publicação nem entrega real.
O runner `scripts/tests/notification-whatsapp-reset-postgres.mjs` recebe uma
raiz absoluta **nova**, terminada em `vimob-whatsapp-ci`, e o diretório absoluto
dos binários PostgreSQL 17. Ele cria dados sintéticos, admite somente o cluster
local identificado na porta 57924, executa os três testes de integração Go sem
aceitar skips e encerra o cluster ao terminar. Não carrega `.env` do CRM.

Em 15/10/2026, os seis testes de interface e os três testes com PostgreSQL 17.11
passaram. O ensaio de banco usa as tabelas e funções canônicas da fila, com
tabelas pai mínimas sintéticas; não executa a cadeia completa de migrations
Supabase nem chama o provedor WhatsApp.

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

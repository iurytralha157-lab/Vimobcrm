# Motor canônico de gamificação

O motor possui uma única fonte de verdade: `gamification_events`. O CRM nunca
calcula pontos. Produtores transacionais inserem um job em
`gamification_outbox`; o worker Go concede o evento, atualiza estatísticas e
missões na mesma transação.

## Contrato de produção

| Evento | Registro produtor | Beneficiário seguro | Referência idempotente |
| --- | --- | --- | --- |
| Lead criado/manual | `leads` INSERT | responsável ou criador, conforme a origem | lead |
| Venda/recuperação | mudança de `leads.deal_status` | responsável atual | lead |
| Mensagem humana | `whatsapp_messages` ao chegar em `sent/delivered/read` | `sender_user_id` | ID do provedor/cliente |
| Visita/reunião | criação/conclusão de `schedule_events` | usuário/completador | evento da agenda |
| Ligação/contato | `activities.task_completed` | autor da atividade | tarefa |
| Imóvel criado | `properties` INSERT | criador ou responsável | imóvel |
| Prospecção | tabela legada de relatório, quando existir | usuário explícito do relatório | relatório |

Os triggers apenas verificam módulo, associação e temporada e fazem um INSERT
com `ON CONFLICT`; não consultam regras nem ranking. Eles são `fail-open`: uma
falha estrutural em gamificação gera `WARNING`, mas não aborta a operação do CRM
(essencial após um envio de WhatsApp). No caminho normal, o outbox participa da
mesma transação do domínio. Não existe advisory lock global no hot path;
enqueues usam lock `SHARE` compatível no registro do módulo e o reset usa
`UPDATE`, definindo a fronteira de temporada sem serializar mensagens entre si.

`RecordAction` é mantido como no-op validado para os chamadores antigos já
cobertos pelos triggers. Um produtor novo deve chamar
`EnqueueActionTx(ctx, tx, tenantContext, action, quantity, reference)` dentro da
própria transação. Nunca deve chamar `RecordAction` depois do commit.

## Consumo e idempotência

`StartWorker(ctx, logger)` inicia o consumidor. Cada réplica pode executar o
worker: o claim usa `FOR UPDATE SKIP LOCKED`, lease de cinco minutos, no máximo
cinco tentativas, backoff e estado `dead`. A chave
`v1|organization_id|action_type|reference_id` é única por organização tanto no
outbox quanto no ledger. Um retry ou dois produtores para o mesmo fato não
concedem duas vezes.

O outbox também captura `occurred_at`. O horário de processamento fica em
`created_at`, mas temporada, período de missão, histórico e métricas usam o
horário da ação. Dias ativos são materializados em
`private.gamification_activity_days`, permitindo recompor o streak mesmo quando
um retry antigo chega fora de ordem. O lote máximo cabe integralmente no lease.

Quando o worker recebe um lote cheio, ele continua drenando a fila após um yield
curto; a espera normal só acontece em lote parcial ou vazio. Isso evita limitar
artificialmente a vazão a um lote por ciclo.

O worker revalida no momento do consumo:

- módulo `gamification` habilitado;
- usuário ativo na organização correta;
- participação não desabilitada;
- temporada capturada no enqueue ainda existente;
- ação no catálogo e regra ativa.

Regra explicitamente desativada vale zero; ela nunca recai no default. Ausência
de regra usa o default canônico. Pontos, XP, totais e progresso usam `bigint`.

## Temporadas, missões e lançamentos manuais

O `season_id` é capturado no outbox. Portanto, um job criado antes de um reset
continua pertencendo à temporada anterior mesmo se for processado depois. Reset
encerra a temporada ativa e cria outra; não apaga histórico nem zera linhas.

Progresso de missão é por `(organização, missão, temporada, usuário, período)`.
Períodos diário, semanal, mensal e temporada são isolados. O bônus cria um evento
`mission_bonus` idempotente e é concedido uma vez.

Lançamento manual nasce `pending`. A decisão é irreversível; rejeição exige
motivo. Aprovação apenas enfileira o mesmo motor e recebe `awarded_at` depois do
commit do worker, sem segundo mecanismo de pontuação. A API expõe
`awardStatus` (`pending`, `processing`, `completed`, `skipped` ou `dead`) e
`awardedAt`; aprovação não é tratada como concessão concluída.

A fila administrativa mantém visíveis concessões `pending`, `processing`,
`skipped` e `dead`. Mudanças de regras, missões, participantes, temporadas,
eventos e estatísticas são publicadas no Realtime com RLS; polling moderado
cobre indisponibilidade ou atraso do canal.

## Consultas de Arena e histórico

Ranking filtrado é sempre agregado no servidor:

```text
GET /v1/gamification/ranking?from=<RFC3339>&to=<RFC3339>&actionType=call_made&actionType=contact_made
```

`from` e `to` são opcionais e formam `[from, to)`. `actionType` pode ser
repetido; sem ele entram todas as ações da temporada ativa. A resposta é
`{"data": RankingEntry[]}`. O histórico limitado do overview nunca é usado para
calcular ranking.

Histórico completo usa cursor opaco e estável no par `(occurred_at, id)`:

```text
GET /v1/gamification/events?limit=30&from=<RFC3339>&to=<RFC3339>&userId=<uuid>&cursor=<opaque>
```

O limite padrão é 30 e o máximo 100. A resposta é
`{"data":{"events":[],"total":0,"nextCursor":null}}`. Usuário sem
`gamification_manage` é forçado ao próprio `userId`; gerente pode omitir o
filtro para ver a organização ou informar um membro ativo.

## Segurança e execução local

A migration `20260712200000_gamification_canonical_engine.sql` remove produtores
legados, reconcilia o ledger, corrige chaves multi-organização, fecha o catálogo,
revoga escrita de `anon`, `authenticated` e `service_role` e mantém somente
SELECT com RLS de membro + módulo habilitado. O outbox não é exposto na Data API.

Integração necessária no bootstrap da API (fora deste pacote):

```go
gamificationRepository.StartWorker(ctx, logger)
```

Validação local, sem aplicar migration nem fazer deploy:

```powershell
cd apps/api
go test ./internal/gamification
go test ./...
```

Antes de produção, a migration deve ser testada em um banco descartável com
testes de RLS, rollback, concorrência de reset/worker e carga. Não aplique esse
arquivo diretamente no banco definitivo sem esse ensaio.

# Dashboard: resultado de compromisso remarcado

Diagnóstico `SCHED-DIAG-01`, base `7f80251f`, Vetter co., 15/11/2026.
Delta local ainda não publicado; o caso visual de produção requer reteste.

## Problema e correção

O original remarcado aparecia como **Cancelada** no detalhe de visitas da
Dashboard e como **Remarcado** no lead. A remarcação canônica grava
`status=cancelled` e `outcome=rescheduled` no original e cria outro evento.
O SELECT/DTO de `/v1/dashboard/visits` descartava outcome; o diálogo também
considerava somente status. O Zod com passthrough não causava essa perda.

A correção projeta `se.outcome` como campo nullable no DTO, documenta o campo
aditivo no OpenAPI e o aceita como opcional/nullable no Zod, limitado a 80
caracteres. O diálogo usa o helper existente `getScheduleOutcomeLabel` para
rescheduled, preservando o fallback anterior para outros resultados/status.
Não expõe notas de resultado ou outros dados pessoais.

API antiga + Web nova aceita ausência/null e mantém o rótulo anterior quando
não há informação para distinguir remarcação. API nova + Web antiga aceita
o campo aditivo por passthrough. Com ambos atualizados, o original mostra
Remarcado e o cancelamento real continua Cancelada. A precedência de atraso
continua baseada no `is_overdue` retornado pelo servidor.

WHERE, autorização, período, ordenação, limites e totais ficaram intactos.
**Marcadas conserva o histórico**: os dois eventos não viram um único registro.
Não há migration, backfill, mudança de status ou alteração de dados persistidos.

## Verificação executada

| Verificação | Resultado local |
|---|---|
| Diálogo real + Zod, 390/1280px | RED 2/2 de remarcação; fallback antigo passou |
| DTO Go | RED 3 subcasos por perda de outcome |
| SQL real com CTEs | RED 5 positivos por projeção perdida; 9 negativas preservadas; GREEN 14/14 |
| Diálogo, contrato Zod e helper | 34/34, sem pulos |
| Go | Pacotes internal/leads e internal/schedule passaram |
| Typecheck / lint | exit 0 / exit 0, 0 erros e 8 avisos legados |
| OpenAPI / inventários | 65/65 / audit 4/4 |

O diálogo usa componentes reais com auth/dados sintéticos e nenhuma rede de
produção. O SQL executou no PostgreSQL 17.11 descartável, loopback verificado,
banco postgres e ForceReadOnly, sem criar schema/tabela. As CTEs cobrem duas
organizações, privacidade, papéis e gerações de membership; preservam total 4,
próximas 2 e atrasadas 0, incluindo resultados finais e legado null.

O harness antigo falhava 3F000 em postgres vazio por ausência de
`private.queue_pool_read_access`. Apenas na fixture, uma ocorrência exata da
chamada recebe NULL, o resultado esperado para leads sem pool. Todos os leads
CTE estão atribuídos; o predicado completo de visibilidade e os 14 cenários foram
mantidos. O produto continua chamando a função real. **Não é prova do pool real,
de schema integral de produção ou de HTTP/auth ponta a ponta.** Outros testes
SQL opt-in não foram ativados pelo go test comum.

Dois steps nos jobs existentes tornam permanentes as regressões:34 casos de
UI/contrato após instalar Chromium em whatsapp-contracts;14 cenários SQL com
LOCAL_READ_TEST no PostgreSQL 17 de membership-access-integration. YAML, alvo,
ordem e dependências do build foram conferidos, sem novo job/dependência.
Peer independente aprovou produto, testes e os dois steps. A CI remota deste
delta ainda não foi executada; CI 366 verde refere-se à base 7f.

## Impacto e reversão

O resultado de uma atividade autorizada passa a acompanhar sua representação
no detalhe da Dashboard. Não há alteração de permissões, notificações,
sincronização Google ou regra da contagem histórica. Retestar em produção o
mesmo par de eventos: original remarcado e substituto cancelado, mantendo os
totais do recorte. CI e testes locais não substituem essa observação.

Reverter o commit deste delta e publicar pela rotina normal restaura o
comportamento anterior; nenhum dado exige restauração. Durante troca parcial
das réplicas, o rótulo antigo pode permanecer até API e Web atualizarem.
Logs/imagens sintéticas ficam nos artefatos operacionais `schedule-outcome-*`;
segredos, DSNs, QR e dados de destinatários não fazem parte deste documento.

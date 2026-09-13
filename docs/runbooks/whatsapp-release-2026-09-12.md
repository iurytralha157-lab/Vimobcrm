# Release blindado do WhatsApp

Status em 12/09/2026: **pronto apenas no escopo local**. Este roteiro não
autoriza aplicação de SQL, deploy, alteração da Evolution Go nem conversão de
sessões. O aceite de produção depende dos gates e do soak descritos abaixo.

## Objetivos do corte

- Mensagem de texto atual não espera o histórico antigo nem o download de mídia.
- Áudio, imagem, vídeo e documento usam uma pista limitada e não bloqueiam texto.
- Todo ingresso e envio continua durável, idempotente e recuperável após reinício.
- Administrador vê a organização; líder vê apenas suas equipes; membro vê a si.
- A lista de status nunca retorna conversas, mensagens, JIDs ou credenciais.
- Somente owner/administrador pode escolher o número de notificações.
- Queda de sessão não dispara reconexões em massa nem conversão de provedor.
- Mídia privada é entregue somente pelo backend, com URL curta e renovável.

## Evidência que deve ser registrada antes do primeiro passo

1. SHA imutável do Web e da API, que devem ser exatamente iguais.
2. Tags atuais do Web e da API para rollback coordenado.
3. Digest real da imagem Evolution Go no formato `sha256:<64 hex>`.
4. Contagem e idade máxima de inbox, outbox e fila de mídia por estado.
5. Sessões por estado e por provedor, sem imprimir tokens ou URLs completas.
6. Uso e limite do pool do Supabase e conexões abertas pela Evolution Go.
7. Snapshot/backup e responsável nominal por abortar o corte.

Não use `latest`. Não preencha `EVOLUTION_GO_IMAGE_DIGEST` com um valor
inventado. Se a identidade de qualquer imagem não puder ser provada, o release
fica em **HOLD**.

## Ordem obrigatória dos SQLs

O projeto remoto não possui um ledger de migrations confiável o bastante para
um `supabase db push` cego. Compare os efeitos instalados, faça preflight de
locks e volume e aplique somente os arquivos revisados abaixo.

1. Em autocommit, preparar os índices online da inbox:
   `supabase/cutovers/20260909_prepare_whatsapp_webhook_fair_claim_indexes.sql`.
2. Registrar/aplicar o efeito de
   `supabase/migrations/20260909152547_optimize_whatsapp_webhook_fair_claim.sql`.
3. Em autocommit, preparar os índices online da outbox:
   `supabase/cutovers/20260909_prepare_whatsapp_outbox_fast_lane_indexes.sql`.
4. Registrar/aplicar o efeito de
   `supabase/migrations/20260909164702_optimize_whatsapp_outbox_fast_lane.sql`.
5. Em autocommit, preparar o índice de finalização local da outbox:
   `supabase/cutovers/20260912_prepare_whatsapp_outbox_finalization_index.sql`.
6. Registrar/aplicar o efeito de
   `supabase/migrations/20260912160000_optimize_whatsapp_outbox_finalization_claim.sql`.
7. Em autocommit, preparar os índices literais das pistas de texto e mídia:
   `supabase/cutovers/20260912_prepare_whatsapp_outbox_lane_indexes.sql`.
8. Registrar/aplicar o efeito de
   `supabase/migrations/20260912183453_isolate_whatsapp_outbox_lane_claims.sql`.
9. Parar toda réplica/Edge worker de mídia legado e confirmar zero linhas
   `processing`.
10. Em autocommit, preparar a fundação da fila de mídia:
   `supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql`.
11. Registrar/aplicar o efeito de
   `supabase/migrations/20260904225214_harden_whatsapp_media_queue.sql`.
12. Executar, em invocação dedicada e autocommit, o corte de escala
    `supabase/cutovers/20260912_scale_whatsapp_media_queue.sql`. O primeiro
    commit desabilita de forma durável a assinatura de claim do worker antigo.
    Se o arquivo parar no gate de drain, isso é **HOLD seguro**, não motivo para
    religar o consumidor legado ou alterar status manualmente.
13. A partir de `private.whatsapp_media_scale_cutover_state.legacy_claim_disabled_at`,
    aguardar pelo menos 10 minutos com workers antigos desligados; provar
    novamente zero `processing` e `private.whatsapp_media_worker_state.breaker_open=false`.
14. Registrar/aplicar o efeito de
    `supabase/migrations/20260912152432_scale_whatsapp_media_queue_safely.sql`.
    A migration falha fechada se o fence, cooldown, drain, breaker ou qualquer
    índice preparado não estiver exato.
15. Executar
    `supabase/cutovers/20260912_validate_whatsapp_media_scale.sql` e exigir
    constraint validada, slots íntegros, assinaturas e quarentena privada.
16. Registrar/aplicar o estado privado e os leases do supervisor:
    `supabase/migrations/20260912173704_harden_whatsapp_session_supervisor_state.sql`.
17. Confirmar o efeito de
   `supabase/migrations/20260908081513_fix_whatsapp_realtime_without_lead.sql`.

Até esse ponto, mantenha o ingresso durável, mas não deixe worker antigo e novo
processarem mídia ao mesmo tempo. As colunas e os índices de pista são
pré-requisitos: a API nova recusa o ingresso com `503` e não inicia os workers
se eles estiverem incompletos.

A migration de boundary abaixo é deliberadamente posterior ao corte completo
dos consumidores. Aplique-a somente depois de provar que Web, Edge Functions e
workers não acessam mais diretamente as tabelas ou o bucket do WhatsApp:

18. Executar o pre-cutover curto do bucket:
    `supabase/cutovers/20260912_prepare_whatsapp_storage_boundary.sql`.
19. Aplicar
   `supabase/migrations/20260912132937_harden_whatsapp_backend_only_boundary.sql`.
20. Executar
    `supabase/cutovers/tests/whatsapp_backend_only_boundary.test.sql` e exigir
    `21/21` asserts.

Se algum consumidor legítimo falhar após o passo 19, pare. Não reabra acesso
amplo para `authenticated`; corrija o consumidor para atravessar a API ou usar
`service_role` no backend apropriado.

## Corte da aplicação

1. Publicar uma única réplica canário da API, no SHA registrado.
2. Manter `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback` e colocar apenas um
   UUID aprovado em `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS`.
3. Deixar `WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS` vazio no primeiro
   smoke. A sincronização de status permanece ativa; mutações de recuperação,
   não.
4. Provar `/readyz`, identidade do release e digest da Evolution Go.
5. Validar uma sessão sem alterar seu `id`, `instance_id`, `instance_name`,
   token ou `webhook_token` e sem pedir novo QR Code.
6. Ampliar o processador nativo em estágios: 1, 5, 20 e depois todas as sessões,
   sempre respeitando os gates abaixo.
7. Publicar o Web com o mesmo SHA da API.
8. Somente então executar o corte backend-only dos passos 18 a 20 da seção SQL.

Nunca faça `UPDATE provider = 'evolution_go'` em massa. Sessões `evolution`
legadas permanecem visíveis e somente leitura; sessões `evolution_go`
existentes preservam integralmente sua identidade.

## Retirada controlada das rotas Edge antigas

Não confunda código legado versionado com produtor autorizado a continuar
rodando. Durante o canário, `evolution-go-webhook` ainda é necessário como
fallback e não pode ser desligado. Após a promoção integral:

1. Provar zero chamadas e zero trabalho pendente dos fluxos antigos.
2. Publicar os tombstones já preparados em `deploy/edge-retirement/` para
   `evolution-go-proxy`, `whatsapp-notifier`, `whatsapp-history-access` e,
   somente no fim, o webhook legado correspondente.
3. Confirmar `410 Gone`, ausência de acesso a banco/provider/segredos e
   `verify_jwt` conforme `deploy/edge-retirement/README.md`.
4. Só então marcar cada entrada como retirada no manifesto real de produção.

`message-sender`, `session-health-check`, `global-whatsapp-status`,
`sync-whatsapp-contacts`, `evolution-proxy` e `evolution-webhook` precisam de
uma decisão por consumidor: ou há evidência de uso legítimo e dono definido,
ou recebem um tombstone separado. Não os apague nem os mantenha indefinidamente
por suposição. O release fica em HOLD se duas rotas puderem enviar a mesma
mensagem, recuperar a mesma sessão ou autorizar o mesmo histórico.

## Configuração inicial segura

Use estes valores como ponto de partida, não como prova de capacidade:

```dotenv
DATABASE_MAX_CONNS=8
WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback
WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=<um-uuid-canario>
WHATSAPP_WEBHOOK_WORKER_INTERVAL=1s
WHATSAPP_WEBHOOK_WORKER_BATCH=10
WHATSAPP_WEBHOOK_WORKER_CONCURRENCY=4
WHATSAPP_OUTBOX_WORKER_INTERVAL=1s
WHATSAPP_OUTBOX_WORKER_BATCH=10
WHATSAPP_OUTBOX_WORKER_CONCURRENCY=4
WHATSAPP_MEDIA_WORKER_ENABLED=false
WHATSAPP_MEDIA_WORKER_INTERVAL=2s
WHATSAPP_MEDIA_WORKER_LEASE=5m
WHATSAPP_MEDIA_WORKER_CONCURRENCY=4
WHATSAPP_SESSION_SUPERVISOR_INTERVAL=1m
WHATSAPP_SESSION_SUPERVISOR_BATCH=10
WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS=
EVOLUTION_GO_IMAGE_DIGEST=sha256:<digest-real-de-64-hex>
```

No Evolution Go, mantenha `WEBHOOK_FILES=false`. Só habilite o worker de mídia
depois do corte da fila e sem réplica antiga. A partir da migration de escala, o
worker respeita a allowlist do canário; portanto imagem, áudio, vídeo e documento
devem ser validados no UUID canário antes de usar `*`. Comece com concorrência 4,
observe conexões/CPU/memória do provider e aumente somente por evidência. O batch 10 do supervisor é o valor
do canário; o default interno é 50 e o máximo aceito é 100 por ciclo. As cerca
de 200 sessões são cobertas ao longo de ciclos sucessivos, sempre com medição.

## Matriz de smoke obrigatória

Execute a matriz em duas organizações e tente também o cruzamento indevido:

| Papel | Lista de status | Conversas na lista | Gerir sessão alheia | Definir notificações |
| --- | --- | --- | --- | --- |
| Owner/admin | Organização | Nunca | Não | Sim |
| Líder | Própria + equipes lideradas | Nunca | Não | Não |
| Membro | Própria | Nunca | Não | Não |
| Sem módulo/permissão | Negado | Nunca | Não | Não |

Para cada estágio do canário, provar:

- envio e recebimento de texto atual;
- confirmação de envio sem retransmitir quando o resultado do provider for
  incerto;
- imagem, áudio, vídeo e documento, inclusive erro e nova tentativa;
- texto novo chegando enquanto um vídeo grande está parado;
- histórico antigo sendo drenado sem atrasar mensagens atuais;
- URL de mídia expirar, ser renovada pela API e falhar em outra organização;
- queda e retorno de uma sessão canário, sem afetar as demais;
- restart da API durante inbox, outbox e mídia sem perder nem duplicar trabalho;
- tela de integrações por papel e flag de notificações apenas para admin/owner;
- callback sem token, API key ou webhook token em query string.

## Gates para avançar 1 -> 5 -> 20 -> todas

- p95 de texto atual abaixo do SLO definido e sem cauda de horas;
- idade máxima da pista `live` não cresce por duas janelas consecutivas;
- nenhum `outcome_unknown` em repetição automática de mutação;
- nenhuma duplicidade por `dedupe_key` ou mensagem externa;
- inbox/outbox sem linhas `processing` além do lease;
- fila de mídia sem bloquear texto e com breaker fechado após recuperação;
- pool do Supabase com folga e sem `EMAXCONNSESSION`;
- conexões PostgreSQL da Evolution Go estáveis após ciclos de reconnect;
- nenhum panic/restart e nenhuma sessão fora do escopo do canário alterada;
- Web/API no mesmo SHA e Evolution Go no digest registrado.

O alvo de aproximadamente 200 conexões não pode ser certificado por teste
unitário. Exija soak de pelo menos 24 horas na carga esperada, incluindo
reconnect controlado, mídia pesada e reinício de réplica. Não use `*` em
`WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS` enquanto o digest implantado
não tiver demonstrado que não sofre crescimento de pool, cliente morto após
erro de stream ou panic de reconnect. Para reduzir o raio de explosão, prefira
grupos/shards de sessões em vez de uma recuperação global.

## Abort e rollback

Ao violar qualquer gate:

1. Remover os UUIDs de recuperação do supervisor.
2. Voltar o processador para `edge`, mantendo a imagem que entende inbox,
   outbox e a nova estrutura do banco.
3. Esvaziar a allowlist nativa e preservar o ingresso durável.
4. Drenar as filas; não apagar linhas e não reenviar resultados incertos.
5. Retirar o Web novo antes de trocar a API, se houver incompatibilidade.
6. Restaurar somente o par Web/API previamente registrado e compatível com o
   schema novo. Não reverta migrations destrutivamente.

O rollback nunca deve restaurar callback com credencial na URL, executar dois
workers de mídia simultaneamente, apagar backlog ou recriar todas as sessões.

## Condição de aceite

O release pode ser chamado de pronto para produção somente quando houver:

- `node scripts/supabase/verify-migrations.mjs` verde depois da revisão dos
  novos SQLs, sem usar `--write` para aceitar arquivos não revisados;
- `node scripts/supabase/verify-edge-functions.mjs` verde e o manifesto
  correspondente exatamente ao conjunto que será publicado;
- pgTAP `21/21` após a migration real;
- E2E autenticado da matriz de papéis;
- smoke completo de texto e quatro tipos de mídia;
- evidência de não bloqueio de texto por mídia/histórico;
- identidade imutável das três imagens e métricas operacionais preservadas;
- soak de 24 horas sem vazamento entre organizações, duplicidade, perda,
  reconnect em massa, crescimento de conexões ou cauda de horas.

Até lá, testes locais aprovados significam **candidato de release**, não 100%
de produção.

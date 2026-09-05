# Cutover da fila de midia do WhatsApp

Este runbook cobre o corte forward-only da fila de midia para a API Go e do
Evolution Go endurecido. Ele evita uma janela de perda no deploy `stop-first`
da API parando a fonte Evolution antes de cada mudanca de configuracao. Nao ha
promessa de capacidade por numero de sessoes: a promocao depende do canario,
das metricas e de soak real.

## Baseline e regras que nao podem mudar

O inventario read-only de 2026-09-04 encontrou 125 sessoes Evolution ativas,
6 conectadas, 125 callbacks na API e 125 assinaturas
`lead-message-events-v2`. Recalcule estes numeros imediatamente antes do corte.
Registre os UUIDs das sessoes conectadas: apenas elas podem ser recuperadas
automaticamente nesta janela. Nao reconecte sessoes que ja estavam offline.

- So avance com o workflow verde e com as tres referencias do artefato
  `whatsapp-media-release-<commit>` no formato `image@sha256:...`.
- Use o mesmo digest da API em todas as fases. So a configuracao muda.
- Nao altere plano Hetzner, n8n, Postgres, Redis, Traefik, CRM ou Landing Page
  neste corte.
- Parar o Evolution significa escalar o servico para zero. Nao faca logout,
  nao apague a sessao e nao remova o volume persistente.
- `WEBHOOK_FILES=false` e global. Depois dele, nao volte ao writer Edge.
- `CONNECT_ON_STARTUP=false` e limite final de 4 GiB no Evolution custom.
- O download global permanece em uma midia por vez. O canario usa uma allowlist
  explicita; nunca comece com `*`.
- `cleanup_whatsapp_retention()` permanece sem cron/chamador durante o canario.
  Quando liberada depois do soak, cada chamada deve ser uma statement autocommit:
  ela usa try-locks transacionais e limpa no maximo 500 linhas por relacao.
- Toda mudanca de ambiente da API repete a barreira de fonte: Evolution em zero,
  requisicoes em voo encerradas e filas drenadas. Isso torna inofensiva a
  janela `stop-first` da API.

## 0. Gate da release e snapshot

1. Confirme no GitHub Actions que testes Go/Node, type-check, lint, build Web e
   as tres construcoes Docker passaram antes da publicacao.
2. Baixe o manifest da release e registre os digests de API, Web e Evolution.
   Registre tambem os digests atuais, exporte os dois stacks afetados e confirme
   backup recente do Postgres. Nao copie tokens para ticket ou log.
3. Confirme que o teste de integracao
   `TestWhatsAppMediaQueueIntegrationDeduplicatesNineteenSessions` passou contra
   um banco descartavel com as duas migrations. Ele deve provar 19 sessoes,
   uma busca no provedor e um unico objeto de Storage.
4. Recalcule o baseline:

   ```sql
   select
     count(*) filter (where is_active) as evolution_active,
     count(*) filter (where is_active and status = 'connected') as connected,
     count(*) filter (
       where is_active
         and nullif(advanced_settings->>'webhook_url', '') is not null
     ) as callback_recorded,
     count(*) filter (
       where is_active
         and advanced_settings->>'webhook_subscription_version' = 'lead-message-events-v2'
     ) as subscription_current,
     count(*) filter (
       where is_active
         and nullif(advanced_settings->>'webhook_url', '') is null
     ) as callback_not_recorded
   from public.whatsapp_sessions
   where provider = 'evolution_go';

   select id, status,
          advanced_settings->>'webhook_url' as webhook_url,
          advanced_settings->>'webhook_subscription_version' as subscription_version
   from public.whatsapp_sessions
   where provider = 'evolution_go' and is_active
   order by status, id;
   ```

   Pare se houver callback fora da API, assinatura antiga ou segredo na query
   string da URL.

## 1. Congelar a fonte e drenar o legado

1. No Portainer, escale apenas `evolution_go_evolution_go` para zero. Espere a
   task encerrar. Nao altere ainda imagem, ambiente ou volume.
2. Confirme no Evolution que nao ha download destacado ainda rodando. Espere a
   API atual e eventuais Edge Functions terminarem tudo que ja aceitaram.
3. Consulte as filas:

   ```sql
   select status, count(*)
   from public.whatsapp_webhook_inbox
   group by status order by status;

   select status, count(*)
   from public.whatsapp_outbox
   group by status order by status;

   select count(*) as inbox_open
   from public.whatsapp_webhook_inbox
   where status in ('pending', 'retry', 'processing');

   select count(*) as outbox_open
   from public.whatsapp_outbox
   where status in ('pending', 'retry', 'processing');

   select count(*) as media_processing
   from public.media_jobs
   where status = 'processing';
   ```

   Exija `inbox_open=0`, `outbox_open=0` e `media_processing=0`. Pare se o
   Evolution ainda estiver emitindo callbacks, se houver invocacao Edge em voo
   ou se qualquer contador voltar a subir.
4. Iniba novas execucoes do antigo Edge `media-worker` (o tombstone desta
   release responde 410) e confirme que nenhum agendamento ou chamador legado
   consegue inicia-lo. Depois de tombstonar, consulte novamente e exija
   `media_processing=0`; o primeiro resultado sozinho nao prova a barreira.

## 2. Instalar a API com todos os consumidores fechados

Com o Evolution ainda em zero, atualize a API para o digest aprovado. A janela
`stop-first` e segura porque a fonte esta parada. Use:

```dotenv
WHATSAPP_WEBHOOK_PROCESSOR_MODE=native
WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=*
WHATSAPP_WEBHOOK_WORKER_ENABLED=false
WHATSAPP_MEDIA_WORKER_ENABLED=false
WHATSAPP_MEDIA_WORKER_SESSION_IDS=
WHATSAPP_SESSION_SUPERVISOR_ENABLED=false
WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS=
```

Exija task saudavel e `/readyz` OK. O Evolution continua em zero. Se a API nao
subir, volte ao digest anterior ainda com a fonte parada e nao aplique migration.

## 3. Aplicar as migrations sob a barreira

1. Aplique `20260904225214_harden_whatsapp_media_queue.sql`. O arquivo abre uma
   unica transacao, usa `lock_timeout` e instala a ordem de locks
   `global-claim -> mutation`. Uma falha deve fazer rollback integral.
2. Nao consulte `supabase_migrations.schema_migrations`: ele nao existe neste
   ambiente. Valide o catalogo diretamente:

   ```sql
   select
     to_regclass('public.media_jobs') as jobs,
     to_regclass('private.whatsapp_media_worker_state') as worker_state,
     to_regprocedure('private.claim_whatsapp_media_job(text,interval,uuid[])') as claim_function,
     to_regprocedure('private.renew_whatsapp_media_job(uuid,text,uuid)') as renew_function;

   select conname, convalidated
   from pg_constraint
   where conrelid = 'public.media_jobs'::regclass
     and conname in (
       'media_jobs_dedupe_key_check',
       'media_jobs_asset_key_check',
       'media_jobs_status_hardened_check',
       'media_jobs_lock_hardened_check',
       'media_jobs_declared_size_check'
     )
   order by conname;

   select indexrelid::regclass as index_name, indisvalid
   from pg_index
   where indexrelid in (
     'public.media_jobs_session_id_idx'::regclass,
     'public.media_jobs_conversation_id_idx'::regclass
   )
   order by indexrelid::regclass::text;

   select
     has_table_privilege('service_role', 'public.media_jobs', 'insert') as edge_can_insert,
     has_function_privilege(
       'service_role',
       'private.claim_whatsapp_media_job(text,interval,uuid[])',
       'execute'
     ) as edge_can_claim;
   ```

   Os dois indices devem estar validos e os dois privilegios Edge devem ser
   `false`. A migration primaria nao abre mais uma janela temporaria de escrita.

3. Antes da migration final, exija zero inconsistencia de tenant:

   ```sql
   select count(*) as cross_tenant_jobs
   from public.media_jobs as job
   left join public.whatsapp_sessions as session on session.id = job.session_id
   left join public.whatsapp_conversations as conversation on conversation.id = job.conversation_id
   left join public.whatsapp_messages as message on message.id = job.message_id
   where job.error_code is distinct from 'media_legacy_job_retired'
     and (
       session.id is null
       or conversation.id is null
       or message.id is null
       or session.organization_id is distinct from job.organization_id
       or conversation.organization_id is distinct from job.organization_id
       or conversation.session_id is distinct from job.session_id
       or message.organization_id is distinct from job.organization_id
       or message.session_id is distinct from job.session_id
       or message.conversation_id is distinct from job.conversation_id
     );
   ```

4. Ainda com Evolution em zero e todos os workers desligados, aplique
   `20260905003206_harden_whatsapp_media_queue_retention.sql`. Ela aposenta jobs
   legacy incompletos sem reproduzir downloads, repete o preflight relacional
   com semantica NULL-safe, instala a chave minima, protege registros com job
   ativo, preserva o breaker e mantem o writer Edge revogado.
5. Confirme o estado final:

   ```sql
   select conname, convalidated
   from pg_constraint
   where conrelid = 'public.media_jobs'::regclass
     and conname = 'media_jobs_message_key_minimal_check';

   select
     has_table_privilege('service_role', 'public.media_jobs', 'insert') as can_insert,
     has_table_privilege('service_role', 'public.media_jobs', 'select') as can_select,
     has_table_privilege('service_role', 'public.media_jobs', 'update') as can_update,
     has_table_privilege(
       'service_role', 'private.whatsapp_media_worker_state', 'select'
     ) as can_read_breaker,
     has_function_privilege(
       'service_role',
       'private.claim_whatsapp_media_job(text,interval,uuid[])',
       'execute'
     ) as can_claim,
     has_function_privilege(
       'service_role',
       'private.renew_whatsapp_media_job(uuid,text,uuid)',
       'execute'
     ) as can_renew;

   select status, count(*) as jobs, min(created_at) as oldest
   from public.media_jobs
   group by status order by status;
   ```

   Todos os privilegios devem ser `false`. Confirme tambem que nao existe cron
   nem chamador para `cleanup_whatsapp_retention()` durante o canario. Depois
   deste ponto, rollback de banco ou retorno ao writer Edge nao e permitido;
   corrija para frente.

## 4. Ligar apenas a ingestao nativa

Com o Evolution ainda em zero, reaplique o mesmo digest da API com:

```dotenv
WHATSAPP_WEBHOOK_PROCESSOR_MODE=native
WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=*
WHATSAPP_WEBHOOK_WORKER_ENABLED=true
WHATSAPP_MEDIA_WORKER_ENABLED=false
WHATSAPP_MEDIA_WORKER_SESSION_IDS=
WHATSAPP_SESSION_SUPERVISOR_ENABLED=false
WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS=
```

Exija task saudavel, `/readyz` OK, nenhuma chamada ao Edge e inbox/outbox sem
`pending/retry/processing`. O Evolution permanece em zero durante todo este
deploy e sua verificacao.

## 5. Trocar o Evolution sem reconectar sessoes

1. Ainda com escala zero, altere apenas o stack Evolution:

   ```dotenv
   WEBHOOK_FILES=false
   CONNECT_ON_STARTUP=false
   ```

   Use o digest endurecido aprovado e corrija o limite salvo do servico para
   4 GiB. Nao mude volume, Postgres, Redis ou rede.
2. Escale o Evolution para uma replica. Ele deve subir saudavel, mas sem
   reconectar sessao. Se qualquer sessao conectar automaticamente, escale de
   volta para zero e pare o corte.
3. Exija no boot a mensagem
   `CONNECT_ON_STARTUP=false: automatic and lazy instance starts are blocked`.
   A ausencia desse log torna o gate inconclusivo. Nao pode aparecer
   `Connecting all instances on startup`, `Starting client for user` nem
   `Starting websocket connection to Whatsapp for user` antes do canario.
4. Valide o runtime em duas etapas sem registrar respostas brutas ou tokens:

   - chame `GET /instance/all` com a chave global somente em memoria, confirme
     HTTP 200, `message=success`, inventario igual ao snapshot e zero itens com
     `connected=true`;
   - para cada token retornado, mantido somente em memoria, chame
     `GET /instance/status` e exija `Connected=false`, `LoggedIn=false` e
     `Name=""`.

   Registre apenas o resumo sanitizado `total`, `aggregate_connected`,
   `transport_connected` e `logged_in`. Qualquer HTTP nao-200, ID faltante,
   contagem divergente ou valor diferente de zero e STOP. `/server/ok` sozinho
   nao prova ausencia de sessoes.

## 6. Canario de uma sessao

Escolha um UUID que estava conectado no snapshot. Com todas as sessoes ainda
desconectadas, reaplique o mesmo digest da API com:

```dotenv
WHATSAPP_WEBHOOK_PROCESSOR_MODE=native
WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=*
WHATSAPP_WEBHOOK_WORKER_ENABLED=true
WHATSAPP_MEDIA_WORKER_ENABLED=true
WHATSAPP_MEDIA_WORKER_INTERVAL=2s
WHATSAPP_MEDIA_WORKER_LEASE=5m
WHATSAPP_MEDIA_WORKER_SESSION_IDS=<uuid-canario>
WHATSAPP_SESSION_SUPERVISOR_ENABLED=true
WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS=<uuid-canario>
```

Este e o ultimo deploy da API antes do canario. Nao reinicie a API apenas para
desligar o supervisor enquanto a fonte estiver conectada. A allowlist exata,
backoff e limite de tres falhas mantem a recuperacao controlada.

Com `WHATSAPP_MEDIA_WORKER_ENABLED=true`, `app.New` executa antes de qualquer
worker um preflight pela propria `DATABASE_URL`. Ele exige do `current_user`:
USAGE no schema `private`; SELECT/INSERT/UPDATE em `public.media_jobs` e
`private.whatsapp_media_worker_state`; EXECUTE em claim/renew; RLS habilitado na
tabela e `row_security_active(public.media_jobs)=false` para esse principal.
Exija task saudavel e `/readyz` OK; qualquer erro de preflight torna este deploy
NO-GO e o Evolution deve continuar sem sessoes conectadas. O codigo nunca cria
GRANT nem policy automaticamente.

Valide no canario:

- texto sem regressao;
- audio ate 25 MiB automatico;
- imagem ate 10 MiB automatica;
- figurinha ate 5 MiB automatica;
- video e documento sem download automatico e com botao no CRM;
- tamanho ausente/zero sem download automatico;
- video/documento manual acima de 25 MiB recusado amigavelmente;
- no maximo um job `processing` global;
- um unico objeto para conteudo repetido e nenhuma repeticao quando o resultado
  do provedor ou Storage for desconhecido.

Observe `whatsapp media queue metrics`: `queue_depth`,
`oldest_pending_age_seconds`, `processing_jobs`, `completed_last_5m`,
`failed_last_5m` e `breaker_open`. Pare se `processing_jobs > 1`, a idade crescer
continuamente, nao houver vazao ou o breaker abrir.

## 7. Promover em lotes sem criar janela de webhook

Cada mudanca de allowlist da API repete a mesma barreira:

1. Escale Evolution para zero, sem logout nem remocao de volume.
2. Espere requisicoes em voo terminarem e exija inbox/outbox/media processing
   em zero.
3. Amplie `WHATSAPP_MEDIA_WORKER_SESSION_IDS` e
   `WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS` apenas com o proximo lote
   dos UUIDs originalmente conectados.
4. Reaplique o mesmo digest da API enquanto Evolution esta em zero.
5. Suba uma replica do Evolution; `CONNECT_ON_STARTUP=false` deve mante-la
   parada ate o supervisor recuperar somente a allowlist.
6. Revalide o lote e faca soak antes do proximo.

Nao use `*` no supervisor. Nao inclua as sessoes que ja estavam desconectadas
antes do corte. O teste de 19 concorrentes prova deduplicacao e ausencia
funcional de deadlock, nao capacidade para 100 ou 200 sessoes; a decisao de
servidor depende das metricas do soak.

## Rollback operacional

1. Pare a fonte primeiro: Evolution em zero, sem logout ou delete.
2. Desligue webhook worker, media worker e supervisor na API. Aplique a mudanca
   apenas com a fonte parada.
3. Nao apague jobs, mensagens ou objetos do Storage. Nao transforme job
   `processing` em `pending` se `provider_started_at` estiver preenchido; o
   resultado externo pode ser desconhecido.
4. Depois de `WEBHOOK_FILES=false` e da migration final, nao volte ao Edge. Uma
   API anterior so pode ser usada se aceitar o schema final, permanecer em
   `native/*` e nao reativar writer Edge.
5. Nao restaure snapshot geral do banco como rollback de aplicacao. Corrija
   para frente e recupere novamente apenas o canario.

## Breaker: reset somente por operador

Nunca resete enquanto houver download/upload destacado ou job em processamento:

```sql
select singleton, breaker_open, breaker_opened_at, breaker_reason,
       breaker_job_id, updated_at
from private.whatsapp_media_worker_state;

select id, session_id, status, provider_started_at, locked_by,
       lease_expires_at, error_code, storage_path, updated_at
from public.media_jobs
where status = 'processing'
   or id = (select breaker_job_id
            from private.whatsapp_media_worker_state
            where singleton = true)
order by updated_at desc;

begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(
  hashtextextended('vimob:whatsapp-media:global-claim', 0)
);
select pg_advisory_xact_lock(
  hashtextextended('vimob:whatsapp-media:mutation', 0)
);

do $operator_reset$
begin
  if exists (select 1 from public.media_jobs where status = 'processing') then
    raise exception 'media breaker reset refused: a job is still processing';
  end if;
end;
$operator_reset$;

update private.whatsapp_media_worker_state
set breaker_open = false,
    breaker_opened_at = null,
    breaker_reason = null,
    breaker_job_id = null,
    updated_at = now()
where singleton = true and breaker_open = true;
commit;
```

Depois do reset, reative apenas o canario. Se o breaker abrir novamente,
desligue o worker e investigue; nao repita resets em loop.

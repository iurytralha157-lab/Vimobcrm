# Equipes, Agenda e aviso PWA na auditoria Vetter

Candidato local de 15/11/2026, baseado no commit `279d4053`.
Os resultados de produção pertencem à auditoria visual. Esta implementação
foi verificada com dados sintéticos e transporte de produto bloqueado.

## Equipes após criação ou renomeação

As mutações já invalidavam o prefixo `['teams', organization_id]`, abrangendo
lista de gestão e catálogo dos filtros. O cliente global define
`refetchOnMount: false`. Uma tela desmontada conservava os dados invalidados
e voltava a mostrá-los quando o usuário abria a Distribuição.

`useTeams` agora permite a consulta ao montar quando o cache está stale ou
invalidado. As chaves de organização, usuário e sessão e a projeção mínima do
catálogo continuam sendo usadas. Um dado fresco conserva o cache normal.

O teste com QueryClient e QueryObserver reais reproduziu a lista antiga antes
da alteração e passou após ela, tanto para gestão quanto para catálogo. A
invalidação de uma organização preserva o cache da segunda organização.
O harness de mutações também recebeu o import simulado da camada de confiança
já consumida pelo hook. Esse import ausente causava cinco falhas anteriores
ao ajuste do produto. As asserções de intenção, isolamento e snapshot foram
mantidas.

## Área útil com aviso de instalação

O aviso PWA é fixo na janela. A Agenda usa conteúdo de altura integral com
rolagem própria. O espaço inferior do shell agora acompanha a altura real do
aviso e seu afastamento inferior, incluindo a safe area calculada pelo CSS.
A reserva reage a redimensionamento e desaparece quando o aviso sai da tela.
O mesmo componente é usado pelo aviso de notificações.

O ajuste atua em `PwaActionPrompt`, no `main` de `AppLayout` e no CSS da área
útil. Fluxos de instalação, permissão, aceite e preferência do usuário seguem
os respectivos controles existentes. A contagem de atividades usa singular
quando o total é um.

O harness executa o corpo real de `AppLayoutContent` e `PwaActionPrompt`, com
auth, cabeçalho e serviços simulados. Confere a última ação alcançável acima
do banner em 1762×957 e 390×844, com rolagem do `main` e rolagem interna da
Agenda. Confere mudança de altura, troca entre mobile e desktop, desmontagem
do aviso e preservação do valor de preferência. A suíte da Agenda executa os
componentes reais com dados sintéticos, inclusive singular e plural.

## Google Agenda e o erro histórico 404

Na auditoria visual, uma conexão existente mostrava o erro persistido
`Google Calendar sync error 404`. A tela conservou o aviso após operações da
Agenda. Não houve nova tentativa OAuth nem evidência da resposta HTTP que
originou esse erro.

No checkout, essa mensagem literal é produzida em
`syncConnectionFromGoogle`, ao ler
`/calendar/v3/calendars/{calendarId}/events` no provedor. O candidato atual
interrompe esse caminho com `INBOUND_SYNC_DISABLED` e ignora jobs legados de
pull, full sync e renovação de watch. A mensagem persistida é compatível com
uma execução anterior desse caminho. A leitura de produção abaixo confirmou
jobs recentes aguardando execução e pré-requisitos ausentes no alvo.

A tela agora descreve um erro registrado na sincronização, conserva os
detalhes e oferece **Atualizar status**, que repete somente a leitura. Esse
comando permite observar a conexão após recuperação. A correção do texto
não comprova recuperação do serviço ou entrega de compromissos.

### Produção conferida em 15/11/2026

O agente responsável pela auditoria conferiu o alvo self-hosted por consultas
somente leitura. A conexão Vetter apresentava `sync_enabled=true`,
`sync_status=error`, calendário classificado como `primary`,
`last_synced_at=null` e `updated_at` de 14/08/2026 às 18:12 UTC. A verificação
booleana do erro registrado confirmou a mensagem de sync 404.

Havia 24 jobs históricos `pull_incremental` em `dead`, com tentativas
esgotadas, erro de sync 404 e última atualização em 14/08. Além deles, havia
cinco jobs do QA de 15/11, criados entre 13:51 e 13:53 UTC. Quatro eram
`push_upsert` e um `push_delete`. Às 16:20 UTC, os cinco continuavam
`queued`, todos com `next_run_at <= now()`, zero tentativas e sem locks.
A chegada desses compromissos ao calendário externo permanece pendente.

O catálogo confirmou `pg_cron`, `pg_net`, `cron.job` e
`cron.job_run_details`. A busca por nomes contendo Google/calendar retornou
zero registros. A conferência dos comandos de todos os jobs retornou somente
booleanos e encontrou zero referências a `google-calendar-sync` ou a
`invoke_google_calendar_worker`. Nenhum comando, URL ou segredo foi exibido.

| Pré-requisito no alvo | Resultado da leitura |
| --- | --- |
| `private.invoke_google_calendar_worker(text,integer)` | Presente |
| `public.google_calendar_verify_cron_secret(text)` | Presente |
| Coluna `google_calendar_tokens.token_secret_ref` | Presente |
| Coluna `google_calendar_tokens.disconnecting_at` | Ausente |
| `public.google_calendar_claim_outbound_sync_jobs_v2(integer,text)` | Ausente |
| `public.google_calendar_job_heartbeat(uuid,text)` | Ausente |
| `public.google_calendar_finish_outbound_job(uuid,text,text,text,integer,boolean,boolean)` | Ausente |

O scheduler esperado está ausente e o schema ainda não oferece o protocolo
exigido pelo worker candidato. Habilitar o Cron depende da reconciliação
prévia do schema e das Functions efetivamente montadas. O erro antigo da
conexão continua relevante para revisão do recurso Google quando a execução
for retomada. Os jobs atuais de saída têm um bloqueio de processamento
comprovado pelo inventário acima.

A captura saneada dessa conferência está em
[production-google-runtime-preflight.png](D:/Vimob/outputs/vetter-remediation-20261115/production-google-runtime-preflight.png).

### Dono da execução e gates

O Go grava a outbox junto à alteração da Agenda. Depois do commit,
`schedule/google_sync.go` pode chamar o invoker privado quando
`GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED` está ativo. O padrão versionado
é `false`. O fallback previsto é um scheduler periódico que chama o invoker,
usa `pg_net` e alcança a Function `google-calendar-sync`. Essa Function
autentica o serviço/Cron e chama `runDueJobs`, que usa claim v2, lease,
heartbeat e finish. A API Go não inicia um consumidor Google independente.

`GOOGLE_CALENDAR_CONNECT_MODE` controla novas autorizações. A leitura de
status e o processamento das conexões existentes têm seus próprios gates.
O invoker instalado precisa ter destino e autenticação compatíveis com o
runtime self-hosted. O roteiro anterior registra variantes de URL literal
e de resolução via Vault. Conferir a definição instalada é necessário para
determinar o consumidor atual, com saída restrita a metadados e booleanos.

O claim candidato exige ação de saída, tentativa disponível, prazo vencido,
mesma organização e conexão, owner correspondente, credencial referenciada
e ausência de desconexão em andamento. Ele também serializa trabalhos do
mesmo evento e revalida o lease. `sync_status=error` não exclui sozinho um
job do claim. A validade da credencial e o acesso ao recurso Google precisam
de verificação própria após o preparo da execução.

### Reconciliação e ensaio antes de retomar

O preflight F00 também constatou ausência do registro de migrations no
self-hosted conferido. O identificador de projeto e o ledger cloud citados
em `supabase/README.md` são referências históricas de outro alvo. A operação
deve inventariar o schema e a procedência do self-hosted, registrar os objetos
já equivalentes e reconciliar esse alvo explicitamente. Copiar o ledger cloud
não estabelece equivalência entre os ambientes.

As fontes canônicas relevantes já existem no repositório.

1. `20260726235820_google_calendar_bidirectional_sync.sql` é a origem da
   fundação Google/Vault, das tabelas de links, canais, jobs e OAuth states,
   além de campos de conexão. Esse arquivo também migra dados e agenda
   tarefas históricas. Use-o como mapa de pré-requisitos do catálogo real,
   preservando dados e credenciais existentes durante a reconciliação.
2. `20261006150000_claim_google_calendar_outbound_jobs.sql` define a
   assinatura anterior
   `public.google_calendar_claim_outbound_sync_jobs(integer,text)`. Essa
   assinatura precisa estar reconciliada porque o hardening posterior
   revoga seu acesso explicitamente. Confira também `schedule_events`,
   chaves/índices e a FK dos links com comportamento compatível de exclusão.
3. `20261012212128_harden_google_calendar_outbound_protocol.sql` acrescenta
   `disconnecting_at`, `terminal_reason`, índice de jobs em andamento,
   claim v2, heartbeat, finish, guards de backend e protocolo de desconexão.
   Seus pré-requisitos são as cinco tabelas Google, `schedule_events`, Vault,
   roles e a assinatura de claim anterior. O arquivo fecha grants de browser
   e concede os RPCs necessários ao `service_role`.
4. `20261013000127_harden_google_calendar_activation_status_and_export.sql`
   é forward posterior ao hardening. Acrescenta `credential_revision`, CAS
   de ativação/refresh, status agregado e export autorizado, preservando as
   assinaturas de claim/finish. O candidato atual de OAuth/sync depende
   desse protocolo. Confira colunas e funções equivalentes antes de aplicar
   cada arquivo uma única vez no alvo reconciliado.

O ensaio precisa usar uma base descartável e dados sintéticos. A fixture
`supabase/tests/google_calendar_outbound_protocol.fixture.sql`, o hardening
de 12/10 e `supabase/tests/google_calendar_outbound_protocol.test.sql`
cobrem claim/lease, papéis, duas organizações e fechamento atômico. A forward
de 13/10 requer também os testes de lifecycle e o runner
`scripts/supabase/test-google-calendar-lifecycle-sql.mjs`, cujo destino é
`memory://`, conforme o roteiro de release. Esses ensaios ficam separados
da conferência de concorrência no Postgres nativo e do runtime efetivo.

Antes do corte, reconciliar backup, ledger e ACLs do alvo, drenar workers,
callbacks e refreshes antigos e ensaiar a compatibilidade entre SQL e
Functions. Depois, conferir o catálogo esperado, grants service-only,
mount/router/hashes de OAuth/sync e dependências compartilhadas, ainda com
novas conexões e disparo imediato nos estados controlados pelo roteiro.
O plano completo consta em
`deploy/supabase-self-hosted/google-calendar-release-readiness.md` e no
adendo da segunda auditoria desse documento.

O sweep histórico `20260907230953_google_calendar_reliability_sweep.sql`
também agenda pulls e watches. Sua rotina de reconciliação de Cron não deve
ser usada para reparar somente esta fila de saída. A configuração do
scheduler fica para a operação específica após o schema e as Functions
compatíveis estarem conferidos. Os cinco comandos pendentes podem produzir
escritas no calendário ao retomar o consumidor. Revisar o estado canônico
dos eventos, owners e vínculos antes do canário e comprovar a versão final
no Google, a fila e o recibo CRM. Esta entrega documental não ativou Cron,
não chamou o worker e não reprocessou ou removeu jobs.

### Consultas de acompanhamento

Use o contexto de organização conferido e uma sessão de leitura. As consultas
abaixo aceitam `$1` como UUID parametrizado da organização no driver SQL.
Execute em transação `READ ONLY`, com timeout curto. Se alguma tabela ou coluna
faltar, registre o schema ausente e reconcilie o alvo antes de continuar.

```sql
select to_regclass('public.google_calendar_tokens') as connections,
       to_regclass('public.google_calendar_sync_jobs') as jobs,
       to_regclass('public.google_calendar_event_links') as links;
```

```sql
select id as connection_id, user_id, sync_enabled, sync_status,
       connected_at, disconnected_at, last_synced_at, updated_at,
       case when nullif(btrim(calendar_id), '') is null then 'missing'
            when calendar_id = 'primary' then 'primary'
            else 'custom' end as calendar_kind,
       coalesce(last_error like '%Google Calendar sync error 404%', false)
         as has_recorded_sync_404,
       nullif(last_error, '') is not null as has_recorded_error
from public.google_calendar_tokens
where organization_id = $1::uuid
order by updated_at desc;
```

```sql
select connection_id, action, status, count(*) as jobs,
       min(created_at) as oldest_created_at,
       max(updated_at) as latest_updated_at,
       max(attempts) as highest_attempt,
       count(*) filter (where attempts >= max_attempts) as attempts_exhausted,
       count(*) filter (where locked_at is not null) as with_lock,
       count(*) filter (where last_error like '%Google Calendar sync error 404%')
         as recorded_sync_404,
       min(next_run_at) as earliest_next_run
from public.google_calendar_sync_jobs
where organization_id = $1::uuid
group by connection_id, action, status
order by connection_id, action, status;
```

```sql
select link.connection_id, count(*) as links,
       count(*) filter (where link.deleted_at is null) as live_links,
       count(*) filter (where connection.id is null) as missing_connection,
       count(*) filter (where connection.id is not null
         and link.google_calendar_id is distinct from connection.calendar_id)
         as calendar_reference_mismatch,
       count(*) filter (where nullif(link.last_error, '') is not null)
         as links_with_error,
       max(link.last_synced_at) as latest_link_sync
from public.google_calendar_event_links link
left join public.google_calendar_tokens connection
  on connection.id = link.connection_id
 and connection.organization_id = link.organization_id
where link.organization_id = $1::uuid
group by link.connection_id;
```

As saídas excluem tokens, Vault refs, payloads, e-mails, calendário e IDs de
eventos Google. A comparação de referências aponta divergência, mas sua
ausência também não prova que o recurso remoto esteja acessível.

Correlacione a data de `last_error`/atualização com ação e idade dos jobs.
Erros em pulls antigos e ausência de novos push jobs pedem investigação do
producer/outbox atual. Push jobs em erro pedem correlação do status HTTP,
versão/lease e resposta saneada do provedor. Jobs concluídos precisam de
vínculo e confirmação do compromisso na conta controlada para demonstrar
recebimento externo.

Confirme a identidade de release e os recursos implantados seguindo
`deploy/supabase-self-hosted/google-calendar-release-readiness.md`. Recurso
Google ausente ou inacessível requer conferência do calendário e da conta
autorizada no provedor. Reautorizar, alterar conexão, reaproveitar jobs ou
ativar processamento exige executar a operação específica no alvo correto.
O diagnóstico preparado aqui não executa essas ações.

## Verificação local e reversão

- `node --test hooks/use-teams.test.mjs hooks/team-catalog.runtime.test.mjs`
- `node --test hooks/shared-team-catalog.runtime.test.mjs`
- `node --test components/features/pwa/pwa-layout.runtime.test.mjs`
- `node --test components/features/schedule/schedule-ui-runtime.test.mjs`

Os gates gerais de TypeScript e lint pertencem à verificação consolidada do
worktree. Os resultados de catálogo/filas de produção acima foram fornecidos
pela leitura do agente responsável pela auditoria. As consultas e a operação
remota continuavam pendentes ao fechar a etapa diagnóstica. Após autorização
posterior, o ensaio nativo das migrations passou em banco descartável; a
preparação operacional atual, sem ampliar OAuth ou inbound, está em
[`google-calendar-outbound-recovery-2026-11-15.md`](./google-calendar-outbound-recovery-2026-11-15.md).
Esse roteiro distingue os testes locais da execução remota a cargo do operador.

A reversão é somente de código. Remova o override de montagem de `useTeams`,
a medição/reserva de espaço PWA e os ajustes de texto/contagem nas respectivas
linhas. A reserva CSS é efêmera e removida ao desmontar o aviso. Nenhum dado
durável ou preferência é gravado por esses ajustes.

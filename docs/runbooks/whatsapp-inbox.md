# WhatsApp: contrato da inbox e da outbox duráveis

> Complemento atual de 12/10: [correções da revisão total e evidências finais](whatsapp-audit-closure-2026-10-12.md),
> incluindo mídia imutável, interface, autorização de alvo, push e retenção.
> Os resultados anteriores não encerram a rodada adicional da última auditoria:
> [estado atual e validação de banco pendente](whatsapp-deep-fixes-local-2026-10-12.md#rodada-adicional-da-última-auditoria-1210).
> Publicação e piloto continuam separados.

> Preparação atual de 11/10 no checkout principal: veja o
> [fechamento local e publicação conjunta](whatsapp-local-release-2026-10-11.md),
> com contrato confirmado, provas locais e passos ainda necessários no piloto.

> A seção inicial é uma revisão histórica de 2026-10-08 do commit
> `ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b`. Os ensaios e correções
> locais de 2026-10-09 estão datados nas seções posteriores. Não houve leitura
> de Portainer, banco ou filas de produção nesta revisão.

**Estado local em 09/10:** recebimento, corte de época, visibilidade,
vínculo, expiração, outbox, permissões e Storage GC passaram nos ensaios
sintéticos abaixo. Produção permaneceu intacta. Para preparar a publicação,
congelar um SHA revisado, reconciliar o ledger em cópia fiel do banco alvo,
resolver a regra de `db reset` histórico, ligar o alerta de GC e executar
canário autorizado com provedor, Realtime e UI observados.

Este documento registra a regra de processamento encontrada no repositório.
Para preparar um corte, consulte o [runbook de deploy](../deploy-portainer.md)
e o [roteiro histórico de release](whatsapp-release-2026-09-12.md); a leitura
desses arquivos não confirma quais passos foram executados no ambiente atual.

## Inbox de webhooks

- O claim separa `live` e `backlog`, considera itens `pending` ou `retry` da
  época ativa da sessão e exige o snapshot de roteamento versão 1.
- Na mesma época, lane e rota (`routing_key`), itens mais antigos por
  `(created_at, id)` impedem o claim dos posteriores. A chave `__session__`
  impõe uma barreira para a sessão inteira. Rotas independentes podem avançar
  enquanto outra está bloqueada; não há FIFO global entre conversas ou lanes.
- Em `live`, um retry ainda não vencido bloqueia itens posteriores **da mesma
  rota**, mas não itens prontos de outras rotas. Em `backlog`, uma cabeça em
  retry pode pausar o claim daquela sessão nessa lane.
- Um item `live` pronto pode ultrapassar o histórico em `backlog`. A exceção é
  a raiz exata do backlog de que o item `live` depende: ela pode ser
  reivindicada para resolver essa dependência.
- As lanes têm slots separados. A configuração padrão de concorrência 4
  distribui 2 slots para `live` e 2 para `backlog`. Cada slot reivindica um
  item que pode iniciar imediatamente. Falhas recebem retry com atraso limitado;
  ao esgotar tentativas, o item vai para `dead`.

Fontes: [claim e dependências](../../apps/api/internal/whatsapp/webhook_worker.go)
(linhas 59–305), [slots e execução](../../apps/api/internal/whatsapp/webhook_worker.go)
(linhas 552–675), [falha e retry](../../apps/api/internal/whatsapp/webhook_worker.go)
(linhas 1445–1519).

## Outbox de envios

A outbox é independente da inbox. Texto e mídia usam lanes que podem reivindicar
e enviar itens prontos em paralelo; não há garantia de ordem global de entrega.
Fontes: [worker da outbox](../../apps/api/internal/whatsapp/outbox_worker.go)
(linhas 265–302) e [runbook de deploy](../deploy-portainer.md)
(seção de preparo das filas, linhas 210–212).

## Configuração e limite da evidência

O [runbook de deploy](../deploy-portainer.md) registra, para uma atualização
específica, `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native` e
`WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=*` como valores então em uso em produção
(linha 258). Já o [código de configuração](../../apps/api/internal/config/config.go)
usa `edge` e lista vazia como defaults (linhas 331–332). Nenhuma dessas fontes
confirma as flags montadas hoje, os cutovers aplicados ou o comportamento ao
vivo. Mudança de modo ou allowlist exige conferir o ambiente, os pré-requisitos
de banco, a identidade das imagens e um canário específico antes do corte.

Os procedimentos de migração, operação e rollback permanecem no
[runbook de deploy](../deploy-portainer.md); não se deve reaplicar um corte
histórico apenas porque ele aparece na documentação.

## Ensaio local da época 1 em uma sessão (2026-10-09)

O teste opt-in em
[local_epoch1_dual_processor_integration_test.go](../../apps/api/internal/whatsapp/local_epoch1_dual_processor_integration_test.go)
usou uma organização, um usuário, um contato e uma sessão **sintéticos** em um
projeto Supabase descartável (`127.0.0.1:57721` API/Edge;
`127.0.0.1:57722` Postgres). A fonte era um clone local anterior copiado para
um volume Docker novo; não houve conexão com provedor, banco remoto ou produção.
A função Edge copiada tinha o mesmo SHA256 do checkout
(`08D6B7C320F5B62F9D42A5E7C98AEB1A5107C32920813DD4C02BC23D116C1334`).

Esse clone herdou um trigger e `cutoff_at NOT NULL` de uma migração antiga,
ausente do `main`. Antes da fixture, uma transação guardada confirmou o
fingerprint do trigger, zero cutovers, zero inbox `processing` e o guard atual;
somente no projeto descartável removeu o trigger antigo e relaxou `cutoff_at`.
`routing_epoch` e as demais estruturas antigas permaneceram. Portanto, o teste
prova o comportamento funcional no destino **híbrido**, não a instalação limpa
da migração Phase B. A ativação chamou o RPC atual de dois argumentos
`private.activate_whatsapp_webhook_session_cutover(uuid,uuid)`.

Para reproduzir no mesmo projeto local, obtenha `DB_URL`, `API_URL` e
`SERVICE_ROLE_KEY` de `supabase status -o json --workdir` do **projeto
descartável**, atribua-os respectivamente a
`WHATSAPP_EPOCH1_TEST_DATABASE_URL`, `WHATSAPP_EPOCH1_TEST_SUPABASE_URL` e
`WHATSAPP_EPOCH1_TEST_SERVICE_ROLE_KEY`, e execute no diretório `apps/api`:

```text
go test ./internal/whatsapp -run '^TestLocalEpochOneNativeWithEdgeConfigured$' -count=1 -v -timeout 240s
```

O teste recusa URL fora dos ports locais acima. `WHATSAPP_EPOCH1_TEST_SLUG`
permite nomear a fixture; `WHATSAPP_EPOCH1_TEST_PAUSE_BEFORE_CLEANUP=1` abre
uma pausa opcional de 45 s para leitura independente. Sem as variáveis opt-in,
ele é ignorado. A fixture é limpa ao final, exceto se o resultado do Edge ficar
incerto ou uma falha após a retenção exigir diagnóstico.

O registro abaixo da fixture `wa-epoch1-dual-20261009-7` pertence ao ensaio
histórico Go → Edge → Go, anterior ao fechamento do contrato native-only para
`epoch=1`. Ele não autoriza Edge no cutover. Naquela execução, a mesma sessão e
o mesmo JID passaram por Go inbound → Edge outbound externo (`from_me`) → Go
primeiro evento de lead sem atendimento. Inbox, payload e snapshots dos três
eventos tinham `processing_epoch=1`; os snapshots tinham
`unlinked_capture_policy=v1`. A mensagem inbound e a outbound externa ficaram
na mesma conversa sem lead com as direções corretas; lista/chat/contador foram
verificados. O envio CRM sem lead retornou 404; sem atendimento, 409; a outbox
permaneceu vazia. O primeiro evento do lead ficou em `observed_unattended` e
visível no histórico correto. Replay exato antes e após a retenção não duplicou
mensagens. A conversa sem lead expirou sete dias após `created_at`, ainda com
`last_message_at` recente; histórico do lead foi preservado. Após o scrub, o
mesmo ID de provedor com texto alterado gerou colisão 23505 sem nova inbox ou
mensagem, e um teste transacional confirmou que tombstone sem snapshot v1 não
é aceito como replay.

O ensaio também forçou a corrida entre replay e retenção: uma transação reteve
o lock da sessão, o replay autenticado passou pela consulta antecipada e ficou
bloqueado em `FOR KEY SHARE`; as duas rotinas de scrub rodaram na transação que
segurava o lock. O `COMMIT` publicou os tombstones e liberou o replay, que
retornou HTTP 202 `Duplicate` com o mesmo ID, sem novos registros. O negativo
de texto alterado confirmou `SQLSTATE 23505` e a mensagem
`managed_whatsapp_provider_message_collision`, além das cardinalidades
estáveis. Esta é uma corrida local controlada; não mede throughput ou todos os
interleavings possíveis.

O replay após o scrub havia revelado uma falha no ingress Go: o lookup
gerenciado comparava o texto original ao conteúdo já redigido (`NULL`) antes
de chegar à deduplicação. O ingress agora reconhece antecipadamente **apenas**
o hash exato do callback autenticado de um tombstone terminal com snapshot
imutável v1; a mesma prova é reutilizada no branch de conflito da inbox. Se o
scrub comitar entre a consulta antecipada e a seleção da rota, o ingress
desfaz a transação após essa colisão específica e repete a prova estrita em
nova leitura; colisões sem tombstone exato continuam falhando. A
leitura SQL independente, antes da limpeza, viu 1 cutover época 1, 3 inbox
processadas, 3 snapshots v1, 2 conversas, 1 lead, 1 conversa sem lead
redigida, 1 mensagem do lead preservada e 2 tombstones. Depois da limpeza, as
contagens de organização/sessão/inbox/snapshots/mensagens da fixture eram
`0|0|0|0|0`. `go test ./internal/whatsapp -count=1 -timeout 180s` passou.

Tentativas diagnósticas: `-4` passou antes do teste de corrida; `-5` revelou
que rodar scrub em outra conexão enquanto se segurava `FOR UPDATE` na sessão
bloqueava a própria rotina; a transação foi encerrada, e a fixture foi limpa
por script SQL guardado. `-6` expôs um panic no fallback porque o erro da
captura substituía `parts` por slice vazio; o tipo do evento passou a ser
guardado antes dessa chamada, e a fixture foi limpa por script guardado.
`-7` passou com a corrida e teve limpeza automática. Leituras posteriores
confirmaram zero linhas da fixture e zero sessões aguardando lock.

**Limite do ensaio histórico:** uma tentativa anterior excedeu o timeout HTTP
de 25 s e a função Edge escreveu após o cliente encerrar. Os logs não
identificaram a causa do intervalo de cerca de 62 s antes da primeira chamada
ao PostgREST. A cerca de execução e o novo ensaio de timeout/cutover abaixo
tratam essa corrida; o ensaio histórico sozinho não a comprovava. A instalação
da cadeia em uma cópia fiel do banco de destino, o navegador autenticado com
Realtime e a carga representativa continuam como verificações separadas. Os
tempos de uma única execução local não são média de produção.

Na interface local, o chat direto sem lead aberto agora encerra a seleção no
limite `created_at + 7 dias` ou após resposta 404/410 da API. O cache de
mensagens desse par conversa/escopo sem lead é removido; consultas de lead e
de outras organizações permanecem intactas. O teste focado
`lib/whatsapp-unlinked-expiration.test.ts` atravessa o prazo com temporizador,
confere o limite exato e a remoção seletiva do cache. Em 09/10, o ensaio
autenticado `whatsapp-unlinked-realtime-local.spec.ts` também atravessou o prazo
com o chat **flutuante** aberto: em T−1 ms permaneceu visível; em T+1 ms fechou,
reconsultou lista e contador, e a API devolveu 404/410 para o histórico. A
tela de Conversas usa o mesmo helper, mas não foi a superfície desse Playwright.

## Cerca de execução Edge para o corte de época (local, 2026-10-09)

A migration `20261009053741_whatsapp_webhook_edge_execution_fence.sql` adiciona
um token à inbox existente. Go reserva o token antes da chamada HTTP; Edge
confirma o início antes de qualquer efeito e o libera somente depois de
aguardar os efeitos. Se o HTTP expirar antes do início, Go pode cancelar a
reserva: um Edge atrasado não consegue começar. Se Edge já começou, um timeout
não cancela a execução; o token bloqueia o cutover e novo claim até a conclusão
ou reparo após prova de que o runtime e as requisições PostgREST antigas
pararam. Reserva abandonada por crash do Go pode ser cancelada por CAS na
recuperação, mas execução ativa não expira apenas pelo relógio.

O RPC de ativação conserva sua assinatura e agora exige zero inbox época 0
`pending`, `retry` ou `processing`, além de zero token reservado/ativo em
qualquer status. Assim não deixa eventos antigos sem worker após o corte. Itens
`dead` sem token exigem auditoria e decisão operacional antes do canário; o
cutover não os reproduz automaticamente. Para a primeira implantação da cerca,
é necessário drenar ou encerrar as invocações Edge da versão anterior, pois
elas não conhecem o token.

Na stack descartável `vimob-wa-epoch1-local-20261009` (Postgres `57722`), o
SQL aplicou sem erro; `whatsapp_webhook_edge_execution_fence.test.sql` passou
30/30 e `whatsapp_webhook_session_cutover_epoch.test.sql` passou 35/35, ambos
com `ROLLBACK`. `verify-migrations.mjs` passou com 171 arquivos. O comando
`--write` do source-lock incluiu também hashes de migrations de outros
trabalhos no checkout compartilhado; isso exige revisão
separada no SHA congelado. Esses testes não comprovam instalação limpa da
cadeia. O E2E separado `TestLocalEdgeExecutionFenceAndCutover` passou no clone:
Go→Edge normal, cancelamento de reserva com requisição tardia recusada,
timeout após início que bloqueia cutover e recuperação, dreno da epoch 0 e
processamento nativo da epoch 1. A fixture terminou com zero marcadores e zero
linhas sintéticas; esse teste também não representa carga de produção.

Depois do corte, `epoch=1` permanece no processador Go mesmo que a configuração
geral esteja em `edge`. O teste integrado no mesmo clone confirmou que os
callbacks `labels.update` e `groups.update` são processados sem envio ao
provedor: etiqueta com cor numérica mantém `integer`/`NULL` no banco, e
metadados de grupo só alteram uma conversa de grupo que já existe. O caso
`messages.update` com ID e estado de entrega válidos tem teste Go de recibo;
ele não classifica conteúdo de cliente como recibo. Esses testes cobrem os
formatos exercitados, sem presumir que todo formato possível do provedor foi
observado.

No projeto descartável com Auth, API, Realtime e navegador, o Playwright
`whatsapp-unlinked-realtime-local.spec.ts` passou com a infraestrutura
Realtime já inicializada: após uma inserção sintética, capturou o frame privado
`whatsapp.inbox.changed` **antes** da resposta GET que trouxe a conversa. A
lista, o contador, o conteúdo e o bloqueio de envio ficaram corretos sem
recarregar a página. O primeiro ensaio, durante a inicialização do Realtime,
perdeu o aviso antes de a publicação/slot estarem prontos; a inscrição WebSocket
sozinha não comprova a transmissão. Isso deve ser observado no canário de
inicialização/reconexão. A fixture foi removida.

Auditoria local da reconexão: o barramento da aplicação e as telas usam o
mesmo canal privado. Em cada `SUBSCRIBED`, inclusive após rejoin, a inbox
invalida lista, contador e mensagens imediatamente e após 1 s; o tópico do
lead reconcilia o histórico selecionado. Os testes do registro do canal
(8/8) cobrem a sequência `SUBSCRIBED` → falha/timeout → `SUBSCRIBED`, e o
coordenador de reconsultas passou 3/3. Isso prova o caminho de reconciliação,
mas o join não certifica que a replicação do banco já esteja pronta: um aviso
durante a inicialização do slot ainda pode ser perdido. O fallback visível é
30 s no chat, 90 s para lista com uma página e contador, e 5 min para lista
paginada; em segundo plano ele pausa. O contador agora continua tentando após
um erro transitório de GET. Portanto o alvo visual de 15/60 s para cold start
e reconexão segue como gate de teste em ambiente representativo, com
publicação/slot prontos antes da amostra e ensaio separado durante a partida.

### Retenção sem lead e Storage GC

No clone descartável independente `127.0.0.1:57323`, com `ROLLBACK`, o pgTAP
`whatsapp_unlinked_epoch_retention.test.sql` passou **31/31**. Além do scrub
após sete dias de `created_at`, ele comprovou que um objeto compartilhado com
uma mensagem viva de lead não é reivindicado pelo GC, que um vínculo novo ao
caminho é bloqueado durante a exclusão, e que a 12ª falha de Storage deixa o
job terminal `failed` com código fixo. O contrato de vínculo e preservação de
histórico passou **37/37** no mesmo clone. Os testes Go com servidor HTTP local
confirmaram DELETE autenticado, 404 como exclusão idempotente, 503 como retry e
um único evento estruturado `whatsapp unlinked media GC terminal` depois do
`COMMIT` que marcou `failed`. O evento contém apenas `reason`; não registra
contato, conteúdo, corpo HTTP ou caminho do objeto. O clone 57323 é somente
Postgres: não houve exclusão de objeto em um Storage real nesse ensaio.

Em seguida, o ensaio opt-in `TestLocalUnlinkedStorageGC` passou na stack
descartável `127.0.0.1:57721/57722`, usando a API Storage real e bytes
sintéticos. Duas mídias foram gravadas; o scrub da conversa sem lead venceu
ambas. O worker reivindicou e removeu a mídia exclusiva; manteve a mídia
compartilhada com uma mensagem viva de lead, e só a removeu depois que a
referência viva foi retirada. As duas linhas GC terminaram `completed` e a
consulta de Storage confirmou ausência dos objetos. A repetição do DELETE
revelou que essa versão local retorna HTTP 400 com corpo
`{"statusCode":"404","error":"not_found","message":"Object not found"}`
para objeto já ausente; o cliente Go passou a aceitar apenas esse formato
exato como idempotente. Outro 400 e 503 continuam sendo falhas. Após o teste,
organização, mensagens, jobs GC e objetos da fixture somaram zero.

O worker de retenção tem default **desligado**. No canário, habilitar
`WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED=true` nas réplicas designadas,
confirmar o valor efetivo e acompanhar o primeiro ciclo. A regra de alerta
operacional deve disparar no evento estruturado acima e em qualquer resultado
positivo da consulta abaixo, executada pelo monitor com acesso restrito ao
banco, pelo menos a cada minuto. A consulta agrega por organização sem expor
telefone, conteúdo ou caminho de mídia:

```sql
select gc.organization_id,
       count(*) filter (where gc.status = 'failed') as terminal,
       count(*) filter (
         where gc.status in ('pending', 'retry', 'processing')
           and (gc.created_at <= clock_timestamp() - interval '48 hours'
                or conversation.created_at <= clock_timestamp() - interval '9 days')
       ) as overdue
from private.whatsapp_unlinked_media_gc as gc
left join public.whatsapp_conversations as conversation
  on conversation.id = gc.source_conversation_id
 and conversation.organization_id = gc.organization_id
where gc.status <> 'completed'
group by gc.organization_id
having count(*) filter (where gc.status = 'failed') > 0
    or count(*) filter (
         where gc.status in ('pending', 'retry', 'processing')
           and (gc.created_at <= clock_timestamp() - interval '48 hours'
                or conversation.created_at <= clock_timestamp() - interval '9 days')
       ) > 0;
```

Qualquer linha é incidente de retenção. Confirmar o job e o código de erro em
acesso restrito, verificar se o Storage voltou a responder e se há outra
referência viva ao caminho; não remover o objeto manualmente nem forçar o
`COMMIT` do GC. Para `storage_http_503`, a causa precisa ser resolvida antes de
um retry administrativo exato e auditado. `invalid_path` exige correção do
dado/caminho, não repetição cega. O worker faz nova checagem de referências em
transação antes de cada DELETE. A ligação desse log e da consulta ao canal real
de alerta da operação é gate do canário. A exclusão local foi comprovada; os
testes acima não provam que um alerta já está configurado.

### Primeira implantação da cerca

Esta sequência é um gate de implantação, não um registro de que alguma réplica
já recebeu a configuração. Edge antigo ignora o token; portanto a migration
sozinha não protege uma invocação antiga que continue executando.

1. Registrar SHA das imagens e inventário de **todas** as réplicas Go/Edge.
   Configurar `WHATSAPP_WEBHOOK_WORKER_ENABLED=false` em cada réplica Go que
   ainda possa despachar para Edge, e ler a configuração efetiva em cada uma.
   Manter o ingress HTTP recebendo webhooks: conferir `202` e persistência na
   inbox com um evento sintético. Nunca responder `202` se o evento não foi
   persistido.
2. Confirmar zero jobs antigos `processing` e ausência de invocações da Edge
   antiga em todas as réplicas. Timeout HTTP ou ausência de logs recentes não
   são prova de término. Se houver execução incerta, parar os runtimes Edge
   antigos, aguardar requisições PostgREST antigas terminarem e registrar a
   evidência de quiescência. Não avançar se não for possível provar isso.
3. Aplicar a migration da cerca, conferir colunas, grants, RPCs e veto do
   cutover. Publicar a Edge nova e confirmar seu hash/manifesto efetivo, a
   exigência dos headers `x-vimob-inbox-id` e
   `x-vimob-edge-execution-id` no fluxo `internal_worker_lease`, e as chamadas
   `start`/`finish` à RPC. Implantar Go novo ainda com worker desligado;
   verificar compatibilidade e que o ingress continua retornando `202` após
   persistir na inbox.
4. Configurar o modo nativo e a allowlist do canário em todas as réplicas,
   conferir valores efetivos e só então reativar o worker. Acompanhar
   `pending`, `retry`, `processing`, tokens reservados/ativos e `dead`.
   Ativar epoch 1 apenas após zero `pending`/`retry`/`processing` de epoch 0,
   zero tokens da sessão e auditoria operacional dos `dead`; não há replay
   automático dos `dead` no corte.

Antes do primeiro cutover de epoch 1, uma reversão do aplicativo exige desligar
o worker em todas as réplicas, drenar invocações da Edge nova e conferir a inbox.
A migration aditiva permanece aplicada; não fazer downgrade de schema. Depois
do primeiro cutover, não voltar para um binário Go anterior à regra que força
epoch 1 ao processador nativo: ele poderia reenviar esses eventos à Edge. Se
houver falha nesse ponto, manter o worker pausado em todas as réplicas e
publicar correção compatível com o contrato de epoch já gravado no banco.

### Compatibilidade do processador nativo durante a atualização

Configure `WHATSAPP_LEGACY_NATIVE_COMPAT_ENABLED=true` na API e na bridge
novas enquanto o banco usar a captura por atendimento e o caminho anterior de
reações. O padrão é `false` para instalações com o contrato novo completo.
O modo de compatibilidade conserva os estados `captured` e `suppressed` e
recusa snapshots de retenção v1. Mantenha
`WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED=false` durante essa etapa. O
limite de sete dias se aplica somente às conversas inscritas em retenção v1.

Uma conversa legada própria, sem vínculo anterior e com apenas registros
suprimidos sem conteúdo, pode ser vinculada para receber mensagens futuras.
A prévia indica `futureOnly: true` e a confirmação repete esse valor. A API
revalida o proprietário da sessão, o telefone, o acesso ao lead e a ausência
de histórico sob o bloqueio da conversa. Se ela passar a ter um vínculo ou
retenção v1 antes da confirmação, é preciso revisar a prévia. O vínculo
prospectivo não anexa as mensagens anteriores. A confirmação registra o
atendimento se o ator é o responsável atual pelo lead e o dono da conexão
ativa. A opção de iniciar atendimento na conversa atual usa
`startAttendance: true`, a conexão própria e o vínculo exato com o lead.
Nas duas opções, a captura usa os limites de horário e sequência do registro
de atendimento. Trocar de conexão não carrega o histórico de outra sessão.

Antes de desligar a compatibilidade, confira o schema e as políticas de
visibilidade da captura nova, a RPC de reações e o dreno das réplicas anteriores.
A reconciliação de recibos usa o contrato de sessão da RPC nova nos dois modos.

### Recuperação manual de token `active` órfão

Um token `active` pode sobreviver a crash ou perda do ACK HTTP. Não o liberar
por timeout de 30 s, idade de `locked_at` ou status `dead`/`processed`: uma
Edge atrasada ainda pode executar. O cutover, inclusive chamada idempotente
após um corte anterior, veta qualquer token remanescente na sessão.

1. Descobrir **somente metadados**, sem conteúdo ou telefone, e anotar
   organização, sessão, inbox e token exatos em um incidente com acesso
   restrito:

   ```sql
   select organization_id, session_id, id as inbox_id, edge_execution_id,
          edge_execution_state, status, attempts, max_attempts,
          processing_epoch, edge_execution_started_at, locked_at
   from public.whatsapp_webhook_inbox
   where edge_execution_state = 'active'
   order by edge_execution_started_at;
   ```

2. Desligar o webhook worker em **todas** as réplicas e conferir o valor
   efetivo; impedir novos despachos Edge da sessão. Registrar SHA, inventário,
   status da linha, horários e evidências. Em uma janela controlada, parar
   **todas** as instâncias do runtime Edge antigo e do PostgREST que poderiam
   atender aquela execução. Confirmar os processos/containers parados e que
   não restou backend PostgREST no banco. Identificar antes o usuário de banco
   real do PostgREST e conferir, por conexão administrativa direta:

   ```sql
   select count(*) as postgrest_backends_restantes
   from pg_catalog.pg_stat_activity
   where usename = :'postgrest_db_role'
     and pid <> pg_catalog.pg_backend_pid();
   ```

   O resultado precisa ser `0`. Se não for possível identificar o usuário,
   parar todas as instâncias ou provar zero conexões, **não reparar**. Durante
   essa janela, não acusar `202` para webhooks que não puderem ser persistidos;
   usar buffer durável de entrada ou uma janela operacional que exponha falha
   ao provedor para permitir sua repetição.

3. Após confirmar que não há mais execução antiga, revisar no incidente os
   efeitos já gravados e a chave idempotente do evento. Somente então executar
   a transação abaixo em `psql` direto no banco correto, com
   `ON_ERROR_STOP=1` e as quatro variáveis UUID preenchidas a partir da linha
   descoberta (`organization_id`, `session_id`, `inbox_id`, `execution_id`).
   O lock da sessão serializa com o cutover; a condição exata e o rowcount
   impedem limpar outro token. Qualquer falha aborta a transação.

   ```sql
   begin;
   set local lock_timeout = '5s';
   select set_config('vimob.edge_repair_org', :'organization_id', true);
   select set_config('vimob.edge_repair_session', :'session_id', true);
   select set_config('vimob.edge_repair_inbox', :'inbox_id', true);
   select set_config('vimob.edge_repair_token', :'execution_id', true);

   do $$
   declare
     v_org uuid := current_setting('vimob.edge_repair_org')::uuid;
     v_session uuid := current_setting('vimob.edge_repair_session')::uuid;
     v_inbox uuid := current_setting('vimob.edge_repair_inbox')::uuid;
     v_token uuid := current_setting('vimob.edge_repair_token')::uuid;
     v_status text;
     v_epoch integer;
     v_rows integer;
   begin
     perform 1
       from public.whatsapp_sessions s
      where s.id = v_session and s.organization_id = v_org
      for update;
     if not found then
       raise exception 'Sessão/organização não encontrada';
     end if;

     select i.status, i.processing_epoch
       into v_status, v_epoch
       from public.whatsapp_webhook_inbox i
      where i.organization_id = v_org and i.session_id = v_session
        and i.id = v_inbox and i.edge_execution_id = v_token
        and i.edge_execution_state = 'active'
      for update;
     if not found or v_epoch <> 0 or v_status not in
        ('processing', 'retry', 'dead', 'processed') then
       raise exception 'Token/epoch/status mudou; nenhum reparo aplicado';
     end if;

     update public.whatsapp_webhook_inbox i
        set edge_execution_id = null,
            edge_execution_state = null,
            edge_execution_reserved_at = null,
            edge_execution_started_at = null,
            status = case when v_status = 'processing' then 'retry'
                          else v_status end,
            next_attempt_at = case when v_status = 'processing' then now()
                                   else i.next_attempt_at end,
            locked_at = case when v_status = 'processing' then null
                             else i.locked_at end,
            locked_by = case when v_status = 'processing' then null
                             else i.locked_by end,
            updated_at = now()
      where i.organization_id = v_org and i.session_id = v_session
        and i.id = v_inbox and i.edge_execution_id = v_token
        and i.edge_execution_state = 'active' and i.processing_epoch = 0;
     get diagnostics v_rows = row_count;
     if v_rows <> 1 then
       raise exception 'CAS afetou % linhas; nenhum reparo aplicado', v_rows;
     end if;
     raise notice 'Token limpo após quiescência; status anterior: %', v_status;
   end $$;

   select id, organization_id, session_id, status, processing_epoch,
          edge_execution_id, edge_execution_state, locked_at, locked_by
   from public.whatsapp_webhook_inbox
   where organization_id = :'organization_id'::uuid
     and session_id = :'session_id'::uuid
     and id = :'inbox_id'::uuid;
   commit;
   ```

4. Guardar o antes/depois e o rowcount no incidente; `processing` vira
   `retry` para ser reprocessado pelo fluxo normal, enquanto `dead` e
   `processed` preservam seu estado. Religar PostgREST e a **Edge nova**,
   confirmar saúde, reativar Go somente no modo nativo comprovado e acompanhar
   retry/DLQ. Auditar efeitos de `dead` sem replay automático. Antes do
   cutover, consultar novamente a sessão: zero tokens de qualquer estado e
   zero inbox epoch 0 `pending`, `retry` ou `processing`. Se algum contador não
   zerar, continuar o dreno e não executar a ativação.


## Consulta de leads ativos na tela Conversas e no balão

A tela Conversas e o balão enviam `includeSupervisoryLeads=true` à lista.
A tela Conversas também envia ao catálogo de filtros. Em **Todos os números**, a API pode
mostrar também conversas diretas de leads em aberto que o usuário já pode ler
no CRM. O escopo é da organização atual e segue as permissões de lead: acesso
da organização, das equipes que o usuário lidera ou dos leads atribuídos ao
usuário. A API exige vínculo ativo com a organização para esse modo.

As linhas adicionais são identificadas por `supervisory_lead_view` e abertas
no histórico vinculado ao lead, somente para consulta. A lista não conta essas
linhas como mensagens não lidas do usuário. O modo não se aplica a conversas
sem lead, grupos, arquivadas, seleção de um número específico ou filtro de
resposta pendente. Envio e outras ações da caixa continuam sujeitos à posse
ou ao compartilhamento operacional do número. Clientes antigos que não
enviam o parâmetro continuam com a caixa operacional.

## Correções locais de cache e interação — 21/10/2026

Este complemento descreve os seis ajustes locais WA-C01, WA-D02, WA-F02,
WA-F03, WA-F01 e WA-C02. Não altera flags, allowlists, schema ou cutover.

- Respostas 401/403 da inbox esvaziam cards, catálogo de filtros e contador
  somente da organização, usuário e escopo de acesso correspondentes. Leituras
  antigas são aposentadas e não repõem o snapshot. O cache vazio fica stale,
  sem disparar outro GET na própria negação; uma nova leitura pode revalidar
  o acesso. Falhas 5xx/offline preservam o último snapshot.
- Recovery conserva `ErrProviderOutcomeUnknown` antes da heurística de
  cliente desconectado, inclusive no forceReconnect usado para obter QR.
  Timeout/HTTP ambíguo não autoriza fallback adicional. O tratamento existente
  da rejeição definitiva HTTP 400 permanece coberto por teste.
- O HEAD customizado possui controller compartilhado por QueryClient e Query.
  Fechar um consumidor preserva a leitura dos demais; sair o último, aposentar
  o acesso ou iniciar HEAD canônica aborta o transporte anterior. As cercas de
  identidade e geração continuam descartando respostas tardias.
- No balão desktop, Escape respeita a superfície com foco e as camadas abertas;
  voltar da conversa devolve foco à superfície. Fechar permanece acessível
  durante a preparação e o indicador `+N` das tags é um botão com nome
  acessível e tooltip alcançável por teclado, preservando as classes visuais.
  Fechar a interface não desfaz um POST que o servidor já recebeu.

Regressões locais: `hooks/whatsapp-inbox-denial.runtime.test.mjs`,
`hooks/whatsapp-head-cancellation.runtime.test.mjs`,
`hooks/whatsapp/use-whatsapp-visible-canonical-previews.runtime.test.mjs`,
`components/features/whatsapp/conversations/floating-mobile-modal.runtime.test.mjs`
e `apps/api/internal/whatsapp/evolution_recovery_outcome_test.go`. Executar em
ambiente sem credenciais reais, sem carregar `.env` e com temporários externos.
As provas usam transportes e dados sintéticos; testes opt-in de banco ausentes
são skips. Não comprovam provedor, entrega real, carga ou estado em produção.
Rollback: reverter seletivamente apenas os hunks destes ajustes, preservando
o dirty anterior e as alterações concorrentes; não restaurar arquivos inteiros.


## Complemento local das pendências — 21/10/2026

- O histórico também aposenta o escopo quando recebe 401 terminal do transporte,
  após a tentativa de renovar a sessão. A renovação bem-sucedida e os caches de
  outros acessos permanecem intactos; 503/offline preservam o histórico autorizado.
- Um lead novo sem conversa persistida conserva a preparação normal pelo número
  próprio. Conversas existentes compartilhadas mantêm o compositor autorizado e
  a opção de iniciar pelo número próprio; múltiplos números exigem escolha.
- O indicador `+N` das tags do balão alterna por toque, clique e teclado. Escape,
  clique fora e mudanças de conversa/escopo/rota/mobile aposentam a camada, sem
  mudar as classes aprovadas dos badges ou as primitivas compartilhadas.
- A seleção explícita da CI inclui as regressões de inbox negada, cancelamento
  do último consumidor, preview canônico, autenticação terminal e toque nas tags.
  O teste de limite do webhook fixa somente seu relógio injetável; o limitador
  de produção e suas asserções de rejeição antes de ler o corpo não mudaram.

Executar o gate WhatsApp completo no candidato estabilizado. A fixture CI usa
PostgreSQL descartável identificado por caminho/porta/nonce e dados sintéticos;
seu bootstrap não é um reset Supabase completo nem ensaio do ledger publicado.
Testes locais não comprovam Evolution real, telefones físicos ou produção.
Rollback seletivo continua obrigatório para preservar as alterações anteriores.

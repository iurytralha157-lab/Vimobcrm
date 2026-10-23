# Distribuição e bolsão por fila — implementação local

Este documento preserva as rodadas anteriores de homologação. O status desta
etapa está no [fechamento local de 16/10/2026](#fechamento-local-de-16102026-baseline-formal-e-forward-239):
baseline formal de 238 migrations representadas e execução real da forward 239.
Os resultados anteriores de 236 fontes e de navegador continuam identificados
como evidência histórica; não substituem a validação da rodada atual.

## Escopo e ativação

Implementação no checkout principal `D:\Vimob\workspaces\vimob-crm`.
Aplicações de migrations e serviços de homologação ficaram restritos a ambientes
locais descartáveis, com dados sintéticos. Nenhum deploy, push ou alteração de
produção foi feito. O código de distribuição depende das catorze migrations abaixo.
Não iniciar uma API com este código contra um banco sem esses contratos.

Fila sem `settings.operating_schedule` continua explicitamente legada.
Não há backfill de horários nem ativação automática de filas reais. O editor
solicita fuso e semana explícitos para filas novas e permite revisar uma fila
legada antes de ativar o calendário. Todos os dias fechados representam uma
fila de bolsão/manual; isso não desliga a entrada de leads.

As seis migrations iniciais foram preservadas; as correções posteriores são
oito migrations forward, aplicadas depois delas:

| Migration | Contrato |
| --- | --- |
| `20261015022236_queue_operating_schedule_contract.sql` | Calendário e validação |
| `20261015022536_queue_runtime_state_and_audience.sql` | Estado, audiência e metadados |
| `20261015022817_queue_runtime_transition_engine.sql` | Transições e atendimento |
| `20261015023126_queue_runtime_claim_and_guards.sql` | Claim e barreiras de escrita/leitura |
| `20261015023712_queue_runtime_canonical_and_batch.sql` | Distribuição canônica e lotes |
| `20261015024500_queue_notification_delivery_authorization.sql` | Autorização da entrega |
| `20261015033816_queue_runtime_concurrency_barriers.sql` | Serialização de capacidades e atendimento |
| `20261015034140_queue_ticket_bootstrap_catalog_recheck.sql` | Criação concorrente da primeira sequência |
| `20261015035224_queue_claim_permissions_match_server_defaults.sql` | Defaults e negativas de permissão no claim |
| `20261015042551_queue_claim_tenant_not_found.sql` | Fila ausente/estrangeira retorna 404; lock real mantém 409 |
| `20261015042757_queue_timezone_catalog_hot_path.sql` | Catálogo privado de fusos e janela calculada uma vez por chamada |
| `20261016031913_reconcile_legacy_rotation_with_queue_runtime.sql` | Ledger legado do hotfix sem consumir visitas managed em duplicidade |
| `20261016031917_reconcile_canonical_rotation_and_worker_boundaries.sql` | Canônico legado reconciliado, owner real e relógios técnicos de retry |
| `20261016035549_resume_proven_initial_jobs_and_fair_queue_batches.sql` | Handoff seletivo de pendentes e paginação justa com cursor durável |

O recorte da rodada anterior continha 236 migrations: as 233 fontes anteriores
e as três reconciliações de 16/10. Seu manifesto conserva os hashes e a versão
exata do harness usados naquela rodada. A migration de automações então criada
por trabalho simultâneo ficou fora daquele recorte. O tratamento atual dessa
divergência e da instalação local está no
[fechamento desta etapa](#fechamento-local-de-16102026-baseline-formal-e-forward-239).
Integridade de fonte não comprova execução literal do histórico nem autoriza
implantação.

## Regras implementadas

- A fila habilitada continua recebendo leads fora de sua escala. `is_active`
  não é usado como interruptor diário e a resolução da origem é preservada.
- Intervalos incluem o início e excluem o fim, com fuso explícito, dia inteiro
  e virada da meia-noite. Usuário direto depende da fila e de vínculo ativo;
  usuário de equipe também depende da escala daquela participação específica.
- Distribuição inicial mantém pesos. Redistribuição managed registra episódio,
  rodada e visitas por usuário, passa pelos elegíveis antes de repetir e não
  ordena pelo total histórico de entradas do corretor.
- Prazo, próxima verificação, rodada, visitas e orçamento são campos distintos.
  Esperar sem alternativa não gera uma atribuição fictícia nem renova o prazo.
  Zero no limite mantém a semântica existente de tentativas ilimitadas.
- Fechar a fila ou encerrar o turno recolhe/repassa somente leads automáticos
  abertos, sem atendimento humano confirmado. Atendimentos e proteções manuais
  permanecem com seu responsável. Fronteiras persistidas permitem reconciliar
  um fechamento que ocorreu durante uma indisponibilidade do worker.
- Bolsão significa responsável real nulo. Não há responsável apenas visual.
  A coleta física é eventual, por lotes; a validação de horário impede novas
  atribuições automáticas fora da janela mesmo com o worker atrasado.
- Apenas membros ativos da fila, líderes autorizados e administradores/dono
  veem o bolsão. A permissão genérica de ver todos os leads não o contorna.
  A mesma restrição alcança recursos dependentes com RLS e os reads da API.
- `Assumir lead` usa ator autenticado, episódio, revisão e chave idempotente,
  inclusive fora do horário. A reivindicação manual fica protegida na reabertura.
  Transferência genérica não substitui esse comando; limpar manualmente o dono
  de um lead managed é rejeitado para não criar um lead protegido sem dono.
- O claim e seu `canClaim` usam a mesma projeção de permissões: corretor ativo
  sem papel customizado mantém os defaults `lead_operate` e `lead_view_own`.
  Papéis somam concessões; negativa explícita é respeitada, com a precedência
  de wildcard do resolver Go. Operação e algum escopo de leitura são exigidos.
  Isso não amplia a audiência privada nem concede claim a todo usuário ativo.
- A reabertura retoma apenas os leads ainda no bolsão, com o histórico do mesmo
  episódio. Uma janela realmente nova pode atribuir ao antigo corretor quando
  ele é a única alternativa, sem simular uma nova janela a cada polling.
- Timeout de 1 a 5 minutos é permitido, com aviso prévio zero. Acima de 5,
  o aviso positivo precisa ser menor que o prazo. UI, API, jobs e entrega
  verificam a regra; aviso enfileirado pode ser cancelado por estado atual.
- Alertas do bolsão são opcionais, desligados por padrão, usam a outbox existente,
  payload mínimo, deduplicação e controle de frequência. A entrega revalida
  vínculo e contexto. Um alerta antigo não ganha validade só porque o lead
  voltou ao mesmo corretor em outra atribuição.
- Eventos de leads e notificações transportam invalidação sem dados privados
  tanto em tempo real quanto no replay. O cliente refaz leituras autorizadas e
  descarta capacidades pendentes após mudanças de vínculo, fila ou sessão.

## Principais contratos

`settings.operating_schedule`:

```json
{
  "version": 1,
  "timezone": "America/Sao_Paulo",
  "days": [
    {
      "day_of_week": 0,
      "is_active": false,
      "is_all_day": false,
      "start_time": null,
      "end_time": null
    }
  ]
}
```

O exemplo abreviado mostra um dia; o payload real exige os sete dias únicos,
de domingo (0) a sábado (6). Nenhum fuso ou horário é escolhido pelo sistema.

`POST /v1/leads/{id}/claim-queue-pool`, com `X-Organization-Id`,
`Idempotency-Key` e corpo `{roundRobinId, episodeId, expectedRevision}`.
Conflito retorna 409; falta de acesso não revela o conteúdo do bolsão.
`Lead.queuePool` é metadado autorizado, não um campo de escrita do cliente.
Fila inexistente na organização autenticada, inclusive um ID de fila de outro
tenant, retorna o mesmo 404 opaco. Fila existente cujo lock está ocupado mantém
409. A existência é conferida antes do lock, sem conceder capacidade; permissões
e audiência continuam revalidadas somente depois de obter queue SHARE.

## Persistência, processamento e operação

`private.queue_lead_runtime`, `queue_round_visits`, `queue_runtime_events`,
recibos de claim e comandos transacionais preservam estado e evidência.
O comando de escrita é privado ao banco; um GUC enviado pelo cliente não libera
mudanças de responsável. O worker managed confirma lotes separadamente do
worker legado, publica invalidações depois do commit e isola falhas por item.
Retentativas de erro têm limite e quarentena; problemas não apagam o orçamento
de negócio nem a causa legítima de entrada no bolsão.

A inspeção operacional deve observar filas vencidas, idade da espera, erros,
quarentenas, motivos de exclusão, revisões de configuração e eventos do episódio.
Quantidade de corretores igual a dois não prova erro: o histórico precisa dizer
quais outros usuários estavam inelegíveis e por quê naquele instante.

As barreiras forward serializam mudanças de vínculo, participação, escala,
perfil, papéis, overrides e catálogo de permissões com a decisão de atribuição
ou claim. Escritas concorrentes que inverteriam a ordem de locks falham
atomicamente com `55P03`; o chamador precisa tratar a operação como não salva
e repetir de forma limitada. Revisões históricas de membros já existentes
continuam participando do contrato, sem serem substituídas por um mock.

Fatos de atendimento confirmados disputam o mesmo lock do lead. O cache
derivado `lead_assignment_cycles` não é usado sozinho como prova de atendimento
nem recebe um gatilho que inverta a ordem lead → ciclo. Replay do claim
revalida a capacidade atual antes de devolver um recibo antigo.

A inicialização fria da sequência de tickets usa advisory lock por fila e
reconsulta explícita do catálogo depois da espera, antes de criar/retornar a
sequência. O caminho quente mantém a ausência de DDL/alteração de ACL; não
adiciona lock de fila/lead ao helper nem muda os pesos. O `XX000` observado
com um helper obsoleto da primeira fixture foi descartado após carregar o
pré-requisito correto; o `42P07` de criação concorrente permaneceu reproduzível
e motivou a migration `34140`.

`private.queue_timezone_catalog` guarda somente os nomes exatos publicados em
`pg_timezone_names`, com chave primária, RLS e sem grants para os papéis da
Data API. Não guarda offset, data, usuário, agenda ou elegibilidade. Após uma
troca da base tzdata/arquivos de fusos do PostgreSQL, o responsável pelo ambiente
deve renovar o catálogo no alvo conferido, em sessão postgres sem `SET ROLE`
para um papel da aplicação:

```sql
select private.refresh_queue_timezone_catalog();
```

O refresh é restrito a postgres, serializado e atômico. Whitelist, aliases e
distinção de maiúsculas/minúsculas continuam sendo os do catálogo PostgreSQL
instalado. `AT TIME ZONE` resolve offsets e DST ao usar o horário real recebido.
Em `queue_runtime_members`, o CTE `queue_window_context AS MATERIALIZED`
calcula a janela uma vez por chamada e reutiliza seu `windowKey`; vínculos,
escalas individuais, expansão e ordenação não ficam em cache entre chamadas.
Agenda inválida marca disponibilidade falsa sem remover o participante da
audiência autorizada de claim. Calendário válido fechado mantém o contrato
de disponibilidade individual e depende do gate da fila para atribuição automática.

## Validação local reproduzível

O runner SQL recebe apenas um caminho absoluto para PGlite instalado à parte;
não recebe URL de banco, não carrega `.env` e cria `memory://` em cada execução:

```powershell
node scripts/supabase/test-queue-runtime-sql.mjs C:/caminho/isolado/node_modules/@electric-sql/pglite/dist/index.js
```

Essa fixture aplica as seis migrations iniciais e os pré-requisitos que seu
runner enumera. Os dados são sintéticos. É uma verificação em sessão única,
sem envio de mensagens; não substitui a suíte das cinco correções forward.

O runner PostgreSQL real é separado e altera somente um banco descartável já
provisionado. Exige caminhos absolutos para configuração e relatório, host
literal `127.0.0.1`/`::1`, porta isolada entre 20000 e 65535, nome começando
com `vimob_queue_`, usuário/senha locais e sentinel exclusivo. Não lê `.env`
nem variáveis de URL da aplicação. Exemplo de configuração, com valores que
devem ser substituídos pelos do provisionamento descartável:

```json
{
  "host": "127.0.0.1",
  "port": 57433,
  "database": "vimob_queue_homologacao_exemplo",
  "user": "postgres",
  "password": "senha-exclusiva-do-banco-descartavel",
  "sentinel": "marcador-unico-do-provisionamento-local",
  "mode": "bootstrap-fixture",
  "forwardMigrations": [
    "20261015033816_queue_runtime_concurrency_barriers.sql",
    "20261015034140_queue_ticket_bootstrap_catalog_recheck.sql",
    "20261015035224_queue_claim_permissions_match_server_defaults.sql",
    "20261015042551_queue_claim_tenant_not_found.sql",
    "20261015042757_queue_timezone_catalog_hot_path.sql"
  ]
}
```

O provisionamento precisa ter criado `public.queue_homologation_sentinel`,
com uma única linha que corresponda ao `marker` configurado. O runner confere
sentinel e `current_database()` em cada conexão antes das escritas. Não criar
esse marcador em um banco existente para contornar a proteção. O modo
`bootstrap-fixture` também exige ausência de outras tabelas em
`public`/`private`/`auth`; `existing-fixture` é destinado somente à fixture
descartável preparada para esse runner, não a um schema de aplicação arbitrário. Omitir
`caseFilter` para executar todos os casos; filtros ficam explícitos no relatório.

```powershell
node scripts/supabase/test-queue-runtime-postgres.mjs C:/caminho/isolado/queue-postgres-config.json C:/caminho/isolado/queue-postgres-results.json
```

Resultado inicial conferido em 15/10/2026: **44 aprovados, zero falhas e zero casos
filtrados**, PostgreSQL **17.11**, `READ COMMITTED`, **oito backends distintos**
mais observador, nove conexões com sentinel e **14 observações reais de espera
por lock** via `pg_stat_activity`. Foram cobertos claim concorrente/replay,
rollback, primeira sequência, pesos 3:1:1 em 30 entradas, rodadas de cinco
usuários, duas organizações, mudanças de vínculo/permissões e atendimento.

Com as duas novas migrations, a rodada ampliada concluiu **51 aprovados,
zero falhas e zero filtros**, em PostgreSQL **17.11**, de `04:43:06Z` a
`04:43:18Z` em 15/10/2026. Foram oito backends independentes mais observador,
nove conexões atestadas e 14 observações de espera. Entraram negativas de fila
ausente/estrangeira/bloqueada, catálogo/ACL, JSON e fusos inválidos, refresh e
equivalência de UTC, aliases, DST e virada de dia com os predecessores.

A primeira rodada ampliada registrou **49 aprovados e duas falhas** de
assunção de teste: `US/Eastern` não existia naquela imagem, sendo rejeitado
tanto pelo predecessor quanto pela versão nova. A comparação foi corrigida
para nomes presentes no catálogo, sem ampliar a whitelist ou alterar a
migration. O relatório anterior continua preservado; o resultado final não
apaga essa primeira execução.

Essas aprovações são do **substrato sintético reduzido**, com pré-requisitos
canônicos carregados pelo runner. O próprio relatório mantém fora do escopo
a cadeia histórica completa, API/navegador e entrega de provedor. As evidências
em `work/queue-concurrency-homologation`, no diretório da tarefa, são
`concurrency-results-final.json` (44),
`concurrency-results-timezone-first-alias-assumption.json` (49/2) e
`concurrency-results-timezone.json` (51). Não representam validação de produção.

Para testes Go sem download/toolchain automático, em `apps/api`:

```powershell
$env:GOWORK='off'
$env:GOTOOLCHAIN='local'
$env:GOPROXY='off'
$env:GOSUMDB='off'
$env:REDISTRIBUTION_TEST_DATABASE_URL=''
go test -buildvcs=false ./internal/leads ./internal/roundrobin ./internal/distribution -run 'Test(QueuePool|OperatingSchedule|Redistribution|InitialDistributionNever|SelectRoundRobin)' -count=1
```

Suites de integração externas exigem seus ambientes isolados explícitos;
nunca aproveitar URLs ou flags ambientes de uma operação anterior. O runner
SQL não inicia API nem dispatcher. A homologação HTTP usa launchers próprios
com alvo atestado, separados do runner reduzido.

## Bootstrap histórico e preview de API/navegador

A reprodução da cadeia histórica original em banco vazio permanece
**BLOCKED**. O bootstrap funcional de QA usa adaptações explícitas fora das
migrations canônicas, sem importar dados de produção:

1. Pré-condição de gatilhos aposentados: três gatilhos foram temporariamente
   removidos para o readback histórico e suas definições originais restauradas
   antes da migration posterior que exige a instalação. Esse ajuste de
   pré-condição não comprova que a cadeia original executa sem adaptação.
2. Adaptador de `20260921132800_guard_historical_stage_clock.sql`: omite somente
   o bloco `historical_stage_clock_reconcile`, dependente de quatro registros
   e hashes de payload C2S exclusivos de produção; mantém schema e readback.
3. Adaptadores de `20261012144339_whatsapp_selected_route_explicit_pn_barrier.sql`
   e `20261012223733_whatsapp_stored_lid_contact_identity_barrier.sql`: ampliam
   somente os guards MD5 para os predecessores canônicos reconstruídos e
   conferidos byte a byte. Substituições e contagens permanecem; o cutover
   remoto não foi aplicado.

Os três arquivos de migrations adaptados são cópias de QA: um bloco C2S
omitido e dois guards de hash ajustados. O ajuste/restauração dos gatilhos é
uma pré-condição adicional, registrada à parte. Evidências locais:
`empty-bootstrap-adapter.json`, `selected-route-source-drift.json` e
`migration-source-hashes.json`, em `work/queue-homologation`. As fontes
canônicas não foram reescritas. Bootstrap adaptado funcional não é aprovação
da cadeia histórica original.

O preview Next usa snapshot hermético de **2.073 entradas**, sem `.env`,
acrescido do JSON compartilhado `apps/api/internal/admin/legal_documents.json`
copiado da origem com hash. Next **16.3.8** foi copiado byte a byte em
**8.539 arquivos** para evitar identidades conflitantes entre discos; os
outros pacotes usam 453 junctions individuais. Geist/Geist Mono latin são
bytes locais do pacote Next, fornecidos ao hook de aquisição de fontes do
compilador. Não há substituição das respostas da API Go ou do Supabase.

Os arquivos `tsconfig.json`/`next-env.d.ts` gerados e os caches falhos foram
preservados antes da recuperação. A conferência posterior identificou apenas
esses dois arquivos regenerados, sem alteração das fontes da aplicação.
Posteriormente houve uma alteração intencional de texto na seção de
redistribuição, para descrever a ordem da fila. Somente esse arquivo foi
copiado novamente e teve seu registro de hash/tamanho atualizado; os outros
2.072 registros permaneceram intactos. Manifesto anterior, backup da fonte e
hashes raw/origem/cópia estão em `frontend-redistribution-copy-update.json` e
nos backups referenciados por ele; o manifesto inicial foi preservado.
`/login` respondeu 200; claim/calendário e uma nova tentativa de prazo real foram observados
no navegador. Homologação funcional local aprovada com ressalvas; produção não aprovada.
Conferência de 05:29:23Z: 2.073 fontes do preview preservadas e dois arquivos Next gerados;
seis arquivos WhatsApp mudaram no checkout por outra tarefa, sem recópia. O preview é um snapshot congelado, não o main inteiro atual.

Os alvos do preview são loopback: Next `3005`, API `58081`, Supabase `57421`
e PostgreSQL `57422`. O manifesto é atestado por identidade do container/rede
e sentinel com `runId`/`projectId`; cron local ativo impede o seed. Segredos
ficam no manifesto local, sem impressão e sem passagem de service role ao
browser. Workers de provedores, dispatchers e automações externas permanecem
**OFF**. O runtime automático local roda em processo separado da API: seus
efeitos são conferidos por refresh/leitura; não se comprovou SSE entre esses
processos. Eventos de mutações da API e o runtime automático são verificações
distintas. Nenhuma entrega real WhatsApp foi autorizada ou testada aqui.

Para reduzir a pressão de RAM durante a investigação, o preview Next e os
serviços opcionais de QA Storage, Supabase Realtime e Mailpit foram parados.
O recorte ativo dos testes de fila usa PostgreSQL, Auth, REST/PostgREST, Kong
e Go, incluindo a execução pontual do runtime real. O servidor Storage e o
servidor Supabase Realtime não foram exercitados nesse recorte. Essa limitação
é adicional à ausência de SSE entre o runtime separado e a API; refresh de
dados da API não comprova entrega por esses servidores desligados.

## Resultado HTTP e equipes no schema completo de QA

Em 15/10/2026, a API Go real concluiu **9/9 casos**, com nove sessões Auth
reais e 233 migrations aplicadas no schema com adapters declarados acima.
Esses nove casos antecedem as duas correções do editor. Depois da última correção,
quatro regressões de contrato foram aprovadas; não se alega rerun dos nove no binário final.
`full-schema-api-report.json`, attempt `0280adec-931a-4378-ab29-a7bcc7e2823d`,
e `full-schema-team-report.json`, attempt `927c7db1-8e95-46fb-93c9-339189ee989f`,
estão aprovados em `work/queue-homologation`; a revisão negativa não encontrou P0/P1 nos casos executados.
O GET do editor retornava `rules:null`; `repository_sources.go` passou a preservar `[]`.
Regressão Go/Zod: GET e LIST 38 (três sem regras) aprovados em `editor-real-response-after-empty-rules-fix.json`.
O navegador também expôs `jsonb_strip_nulls` apagando relógios nulos: GET/LIST/stateForUpdate preservam settings; 4/4 em `editor-settings-null-roundtrip-report.json`, sem mudar o schema estrito.

- Ingresso: 16 concorrentes, todas 201 sem retry; pesos 8/2/2/2/2. Fila nova sem ledger,
  sequência já existente por inicialização eager. Fallback de sequência ausente foi provado
  no fixture, não por esse caso HTTP do schema completo.
- Claim: cinco concorrentes, um vencedor; replay manteve um recibo, um audit e uma outbox.
  Invalidação SSE de 1→2: **P2** de evento adicional, sem duplicar transferência/notificação.
- Runtime real: duas rodadas 5+5, sem repetição dentro da rodada nem reset do
  orçamento. Fechamento/reabertura conservaram episódio, atendimento humano
  e proteção manual. Os prazos sintéticos foram avançados; isso não prova t0.
- Três disputas reais: revogação, retirada da fila e atendimento humano. Cleanup confirmou
  duas amostras consecutivas sem sessões/consultas remanescentes na janela máxima de dois segundos.
- REST legado retornou `[]` para corretor/líder e `[id]` para admin; as três
  leituras autorizadas do app via Go retornaram 200. Nenhum grant SQL foi ampliado.

Equipes: cinco elegíveis, líder sem escala excluído, redistribuição no fim do turno e bolsão sem alternativas.
Participação direta ignora horários da equipe; usuário duplicado é elegível uma vez. A API exige dia ativo:
criação com sete dias abertos; setup legado removeu 42 linhas dos seis membros da equipe sintética nova.
Alterações seguintes usaram API, com um dia futuro ativo para fechar o instante atual.
Não se provou semana toda inativa nessa API; o calendário da fila é um contrato separado.

Medição `EXPLAIN Execution Time`, mesma fila/parâmetros: membros 352,1→5,548 ms;
controle bruto `pg_timezone_names`, 54,852→57,672 ms. Planos `performance-{before,after}-timezone-catalog.json`; medição local, não um SLA.

No navegador, corretor viu dois cards e assumiu um: observer/screenshot confirmam posse manual, um claim e zero visitas.
Editor exibiu sete dias fechados; quinta/dia inteiro, prazo 6/aviso 3 habilitado→5/zero desabilitado, revisão e Salvar foram executados.
`browser-observation-reopened-effective.json` (05:27:51.933Z): backlog automático com uma visita e due +5min; claim continuou protegido.
Fechar/salvar devolveu backlog ao bolsão e manteve a visita; `browser-observation-closed-effective.json` (05:29:07.437Z) preserva claim manual.
Primeiro loop falhou em 10.283ms (`first-failed-runtime.log`), sob compilação concorrente observada; causa não comprovada, antes do cenário t0.
Uma `-once` real drenou 86 due→0 em 4.211ms (wall 4.838), nove owners/revisões mudaram e atividade final zero (`worker-once-recovery-observation.json`).
O segundo runtime registrou ciclos 1–8 aprovados; ciclo 9 falhou em 12.074ms às 05:31:35Z, antes do due. Log/PID preservados em `interrupted-t0-runtime.*`.
Primeira tentativa t0 **INTERROMPIDA**: lead `0ea2df18-3daf-48c8-b155-5a992055deda`, t0 05:30:47.026867Z, due +60s.
`timer-initial` observou +26,645s; o arquivo `timer-before-due` está malrotulado: server 05:31:50.476Z = +63,449s, após due, owner/count ainda inalterados.
Na interrupção 05:33:32.947Z, owner/count0 ainda estavam inalterados. Helper saiu1 após
salvar: assertion global de quiescência conflitava com loop legítimo. A qualificação
INTERROMPIDA permanece no registro; o lead antigo voltou a girar naturalmente no worker real.

## Prazo real com o worker de produção reutilizado localmente

A tentativa separada `worker-v2` criou o lead `4961e1b5-257d-4d49-9915-d449e976df18`.
O driver chamou `StartRedistributionWorker` real, com os limites e tratamento de erros
existentes. Não houve edição de relógio, `due_at`, prazo ou lote para obter o resultado.

- t0: **05:46:11.646030Z**; due: **05:47:11.646030Z**, sessenta segundos depois.
- Aos **56,314970s**, responsável ainda corretor2 e `assignment_count=0`.
- `assigned_at=05:47:29.113785Z`: decisão aos **77,467755s**, ou **17,467755s após due**.
- O SQL observou o estado durável aos **91,147970s**: corretor3, uma redistribuição,
  duas visitas, zero claims e mesmo episódio. `assigned_at` não prova o instante do commit.
- Navegador/imagens confirmam corretor2→corretor3. O lead manual protegido permaneceu
  inteiramente idêntico nos três snapshots. Não se promete SLA inferior a noventa segundos.

Provas: `browser-timeout-attempt-worker-v2.json`, `browser-observation-worker-v2-*.json`
e imagens `worker-real-antes-do-prazo.jpg`/`worker-real-redistribuido.jpg` em `outputs`.
Revisão independente de artefatos e pixels: aprovada com ressalvas, sem novo P0/P1.
O log do worker real não contém erros; isso **não prova retry após falha injetada**.
Os dois timeouts anteriores permanecem registrados e exigem avaliação de latência/carga.

A inspeção OS inicial do launcher excedeu sete segundos. Recuperou-se o recibo por
leitura com outro inspetor PowerShell disponível, sem novo spawn, banco ou criação de lead.
PID **97508**, executável e nascimento **05:43:08.1922800Z** coincidiram durante o cenário.
Os guards passaram a exigir nascimento exato e obrigação de cleanup mesmo se faltar recibo;
tentativas novas exigem novo intent, sem segunda POST silenciosa após persistência.

Stop verificou PID/executável/nascimento antes de encerrar somente esse worker.
`worker-owned-stop.json` confirma ausência; `browser-cleanup-obligations.json` passou
às **05:49:11.237Z**, após duas amostras globais vazias às **05:49:11.125Z/.231Z**.
O cleanup terminal foi retomado após parar o loop; o erro inicial era do harness de QA,
não prova de falha ao criar o lead. O teste HTTP estrito de nove casos não foi afrouxado.

Reprodução exige novo ambiente atestado, worker próprio e intent inédito. Exemplos de CLI:

```powershell
node scripts/supabase/queue-browser-scenarios.mjs create-timeout-attempt <manifesto-local-atestado> <id-inedito>
node scripts/supabase/queue-browser-scenarios.mjs snapshot-timeout-attempt <manifesto-local-atestado> <id-inedito>
node scripts/supabase/queue-browser-scenarios.mjs global-cleanup <manifesto-local-atestado>
```

O último comando só encerra a obrigação depois da parada verificada do worker próprio
e de duas amostras globais quiescentes; não reutilizar o cenário concluído como nova tentativa.

## Limites da validação e sequência para homologação

PGlite não comprova concorrência entre conexões reais. Os 51 casos PostgreSQL cobrem o substrato reduzido;
HTTP cobre o schema completo de QA adaptado e a API autenticada. A cadeia histórica original permanece
bloqueada; esse resultado não aprova sua reprodução sem adaptações.

O alocador inicial preserva os tickets: `nextval` pode deixar lacunas após rollback. Pesos foram testados
com atribuições confirmadas e participantes estáveis; não se demonstrou equidade estrita sob falhas concorrentes.
Após a reconciliação de 16/10, o legado também mantém estado persistente por lead/fila
em `private.round_robin_rotation_state`. O managed conserva seu próprio ledger;
seus logs não consomem novamente a rotação legada. Ativar o calendário continua
sendo uma transição explícita, sem backfill de histórico ou reset de contadores.

Na rodada de 15/10 ficaram abertos: retry após falha, latência/carga e prazos sob pressão,
restante dos fluxos de navegador, desligamento durante trabalho e entrega WhatsApp sem envio duplicado.
Os novos resultados locais de 16/10 qualificam esses pontos no escopo dos cenários
registrados; não representam certificação de capacidade ou de provedor externo.
Storage/Realtime e SSE automático entre processos continuam fora da prova.
Não há garantia de disponibilidade ou entrega externa absoluta.
As seis mudanças WhatsApp concorrentes não foram incorporadas ao preview congelado.
Na rodada de 15/10, o source-lock de 233 entradas passou; o HEAD permaneceu `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
A cadeia original limpa, restore, revisão final de grants e piloto autorizado continuam sendo gates de produção.

Antes de publicar: revisar as catorze migrations/grants da distribuição, resolver histórico conforme o runbook, testar restore
e validar cadeia completa em ambiente descartável. Ativar piloto por configuração explícita;
`supabase db push` permanece proibido. Rollback não pode apagar calendário de episódios ativos:
preservar/reconciliar dados e proteções antes de trocar o motor.

## Requalificação local de 16/10/2026 e compatibilidade com o hotfix

Esta seção registra a rodada anterior, com recorte de 236 fontes. As limitações
e os estados de gates abaixo pertencem àquela amostra; a atualização vigente
está no fechamento formal ao fim deste documento.

As correções de produto foram feitas no principal, mantendo `main` e o HEAD
acima. Havia 2.034 entradas sujas antes do trabalho; não houve reset, merge,
pull, commit, push ou deploy. Os espelhos de frontend e harness são artefatos
de QA fora do Git, com fontes e hashes registrados; não são outro checkout
de desenvolvimento. Os serviços usam apenas loopback e dados sintéticos.

O hotfix foi lido do worktree local em `7e490c7559b37d058395804b857173fc326e76d6`.
A reconciliação testa tanto managed antes do hotfix quanto os quatro contratos
do hotfix antes do managed, incluindo a variante canônica original. Não houve
consulta a produção para afirmar qual versão está implantada hoje.

Correções complementares:

- O worker legado descobre e confirma o lote antes de processar cada job em
  sua própria transação. Mantém ordem de locks, releitura, CAS, retries limitados
  a `40001`/`40P01` e clocks técnicos independentes. Erro de um job não desfaz
  outro nem muda o prazo ou o orçamento de atribuições. Rollback usa contexto
  independente do cancelamento e limite de cinco segundos.
- Ao ativar o calendário, pendentes sem dono só são adotados com prova durável
  da entrada WhatsApp ou Meta, evento canônico `no_available_members`, mesma
  organização/lead/fila e ausência de atendimento/proteção manual. Não se
  classificam genericamente todos os leads sem responsável como automáticos.
- Handoff de uma atribuição/reentrada automática comprovada preserva a âncora
  atual, `due_at` e aviso já entregue. Polling de distribuição inicial não vira
  orçamento de redistribuições bem-sucedidas.
- Duas lanes privadas de cursor durável limitam a varredura e avançam sobre
  locks/contextos inválidos. Conseguem ultrapassar os primeiros 50 ocupados e
  continuar no próximo tick após atingir o orçamento de scan. Essa passagem
  não consome visita, tentativa de negócio ou prazo do lead bloqueado.
- Claim retorna internamente se houve mudança. O handler publica invalidação
  apenas no primeiro sucesso; replay conserva dono, recibo, ledger e outbox.
  O ensaio espera visibilidade durável por até dez segundos, exige exatamente
  um evento e continua exigindo `1 → 1` depois do replay. A primeira leitura
  imediata viu zero após ACK expirado, mas o banco confirmou um único INSERT;
  diagnóstico e execução inicialmente falha foram preservados.
- `queue_pool_available` continua sendo um evento exclusivo do backend. A
  seleção de remetente foi separada dessa proteção: usa sessão autorizada da
  organização e o fallback global já existente antes do envio. Depois de
  iniciar HTTP ou obter resultado incerto, não troca de remetente.

Evidências em `outputs/main-queue-homologation-20261016`, no workspace da tarefa:

| Ensaio | Resultado e limite |
| --- | --- |
| Reconciliação inicial com hotfix | 42 casos PostgreSQL, em substratos reduzidos; não é replay da cadeia inteira |
| Handoff e paginação final | 18 grupos aprovados, incluindo 16 negativos estritos e seis Meta; sem somar esses subcasos novamente |
| Worker após a terceira forward | 20 cenários / 26 com subcenários; zero falhas ou skips; PostgreSQL 17.6 real |
| API Go + Auth + Data API/RLS | 9/9 na execução final `d5a23631-db47-44cb-99ed-fc19685b988a`, com 236 migrations no schema adaptado |
| Equipes | Escala específica, troca no fim do turno, bolsão sem alternativa e membro direto sem herdar escala da equipe; aprovado |
| Dispatcher + PostgreSQL + HTTP local | 14 resultados, zero skips; dois workers/um envio, resultado incerto, oito negativas, produtor do bolsão, dedupe/throttle e claim cancelado |
| Frontend | 33 testes focados; typecheck/lint; os relatórios distinguem os warnings e o estado do principal no momento de cada execução |

Os três pacotes Go (`leads`, `roundrobin`, `authorization`) também passaram:
1.153 resultados incluindo subcasos, com 110 skips de integrações opt-in.
Esses skips não são aprovação dos testes externos; os ensaios PostgreSQL
obrigatórios da fila acima foram executados separadamente, sem skips.

No Chrome real, calendário/fuso foram lidos e salvos; prazo seis/aviso três
ficou habilitado e prazo cinco zerou/bloqueou o aviso. Administrador e corretor
assumiram cards autorizados. A fila reaberta retomou o backlog e preservou
integralmente o claim manual nos snapshots antes/depois.

O prazo real reutilizou `StartRedistributionWorker`, sem alterar relógios/due:
atribuição inicial `04:29:47.136464Z`, vencimento `04:30:47.136464Z`.
Aos 54,725s o responsável permanecia corretor1. A decisão SQL ocorreu aos
78,121s, 18,121s depois do vencimento, atribuindo ao corretor2 com uma única
redistribuição e mesmo episódio. `assigned_at` não mede o commit. A imagem do
Pipeline foi conferida após atualização autorizada; isso não prova SSE entre
processos nem oferece SLA de latência. O worker próprio foi parado com
PID/executável/nascimento exatos antes do drain global e dos testes finais.

Houve uma última checagem do card após alteração simultânea de apresentação
e `can_operate`: o espelho recebeu somente `LeadCard.tsx` e o helper real
`display-name.ts`, sem alterar o principal. O claim pelo teclado concluiu com
um responsável manual, um recibo, uma atribuição e uma invalidação durável.
Typecheck e lint integrais desse espelho revisão2 passaram, sem diagnósticos.
O manifesto registra as 40 diferenças paralelas de outras superfícies que não
foram sincronizadas; essa prova não certifica todas as telas atuais do principal.

O clone de notificações preservou código, owners e ACLs dos contratos usados.
Excluiu somente pg_cron/cron; um wrapper GraphQL gerado por extensão foi
reconstituído com definição/owner/ACL exatos. Não houve tabela cron falsa.
O receptor HTTP era local e o transporte recusava outra origem. Tentativas
iniciais falhas tocaram apenas fixtures sintéticas; o relato não afirma que
a outbox sintética original permaneceu intocada. A execução final ocorreu em
DB próprio, terminou sem fixtures/entregas ativas e restaurou configuração.

Esta tarefa preservou as 233 entradas anteriores do source-lock e acrescentou
somente as três migrations revisadas. O gate do snapshot de distribuição
passou com 236 fontes. O gate global do principal continua separado: na amostra
final de `04:50:40Z`, a migration de outra tarefa
`20261016041918_automation_canonical_stage_command_guard.sql` já havia recebido
um pin por aquele trabalho, mas sua fonte voltou a divergir dele. Ela não foi
aplicada ao QA de distribuição. O gate Edge falhou numa amostra intermediária
e passou na amostra final; este trabalho não alterou nem repinou esse manifesto.
Os relatórios preservam ambos os resultados, sem silenciar o gate global.

A API/binário testados foram compilados de 573 fontes Go estáveis no principal
às `04:17:34Z`. A comparação de `04:45:41Z` confirmou os arquivos específicos
de fila/redistribuição/remetente inalterados e registrou 19 diferenças Go
paralelas fora desse conjunto. Portanto a conclusão qualifica o candidato
congelado de distribuição e sua compatibilidade com o hotfix, não uma árvore
limpa nem a integração global de todo o trabalho simultâneo do principal.

O encerramento confirmou PostgreSQL 17.6, 236 migrations, apenas dois tenants
sintéticos, zero backends ativos de fila e zero advisory locks. As abas, API,
Next e worker próprios foram encerrados; somente os dois relays locais que
esta tarefa havia ligado voltaram ao estado inicial parado. O DB descartável
e os artefatos de evidência foram preservados.

A cadeia histórica original sem adapters, restore, providers reais, capacidade
para milhares de usuários e coordenação dos trabalhos simultâneos continuam
sendo gates antes de qualquer publicação. Há comprovação local dos cenários
acima, sem promessa de infalibilidade ou autorização de produção.

## Fechamento local de 16/10/2026: baseline formal e forward 239

Esta etapa continuou no checkout principal, preservando os trabalhos paralelos.
O caminho de instalação local nova e a divergência das fontes de automações
foram tratados e validados localmente. Não houve deploy, acesso ou alteração
de produção, commit ou envio ao GitHub. As provas anteriores permanecem acima.

### Instalação reproduzível e ledger próprio

O caminho comprovado em banco descartável é a baseline formal
`local-20261016-238-v1`, que representa 238 migrations canônicas com seus hashes,
seguida da execução real de
`20261016121216_pipeline_stage_assignee_clock_consistency.sql`. A comparação
posterior confrontou schema, owners, ACLs efetivas e referência estática com o
schema de referência atual. O fingerprint final é:

`f121682af5508b4f0f7e7f45aaff2023ce89bbf9186a151b401c7c653f91c01e`.

O catálogo comparado contém 13 schemas, 377 relações, 1.136 funções e 715
policies. O manifesto fixa seis artefatos: schema anterior ao binding GraphQL,
binding GraphQL exato, restante do schema, definições exatas de plataforma,
ACLs de plataforma e dados de referência permitidos. As 78 sequências
operacionais de tickets presentes no dump de QA foram removidas dos artefatos;
não são dados iniciais de uma instalação nova. Sua exclusão do fingerprint é
restrita ao padrão canônico, com validação de tipo, owner, limites, cache,
dependências e ACL antes/depois da coleta. Objetos desconhecidos ou permissões
diferentes continuam bloqueantes.

O ledger `vimob_local_bootstrap.history` distingue `baseline-equivalent` de
`forward-executed`. Há 238 entradas da primeira classe e uma execução da segunda;
`historical_execution=false`. Não foram inseridas versões históricas fictícias
em `supabase_migrations.schema_migrations`. A execução literal da cadeia antiga
em banco vazio continua sem aprovação: os contratos de gatilhos aposentados,
os quatro payloads C2S de produção e a variante dependente de cutover permanecem
documentados. A baseline formal resolve a instalação local sem fingir que
esses reparos de dados ou cutovers foram executados.

Owners e grants reais não foram descartados da comparação. ACLs usam
`aclexplode`, incluindo defaults, grantor, grantee e grant option; normaliza-se
somente a ordem do array. Colunas preservam nomes, tipos e ordem visível, sem
exigir os slots físicos de colunas já removidas. GraphQL e `net.http_get/post`
receberam bindings/definições exatos da origem local, com owner e ACL conferidos.
O clone local não instala o scheduler `pg_cron` de outro banco; essa exceção de
plataforma é declarada, sem tabela cron falsa ou worker remoto.

### Barreiras e comandos locais

O [roteiro da baseline](../../supabase/reconciliation/local-bootstrap/README.md)
contém manifesto, procedência, escopo dos dados estáticos, alvo atestado,
recuperação de falhas e reversão por outro banco descartável. O contrato exige
banco local com nome e sentinela próprios, contêiner/rede conferidos e ausência
de schema de aplicação antes do restore. Reaplicar sobre banco preenchido é
recusado. O restore usa PostgreSQL 17+, transação limitada a 180 segundos e
processo filho limitado a 190 segundos. A senha sintética fica no ambiente do
filho e não aparece nos argumentos ou relatórios.

Execute a partir da raiz do principal:

```powershell
node scripts/supabase/verify-migrations.mjs
node scripts/supabase/verify-edge-functions.mjs
node scripts/supabase/verify-local-schema-baseline.mjs
node --test scripts/supabase/local-schema-baseline.test.mjs scripts/supabase/local-schema-baseline-artifacts.test.mjs
```

O terceiro comando verifica todo o prefixo, os seis artefatos e os forwards
revisados sem abrir banco, carregar `.env` ou consultar Docker. Os comandos
`preflight/apply/forward/verify` e o arquivo privado do alvo estão descritos no
roteiro; não substituí-los por `--linked` ou por uma URL de produção. SQL e
registro de cada forward ficam na mesma transação, com verificação do catálogo
e referência. Commit sem reconhecimento não recebe repetição cega.

### Resultados desta rodada

Evidências em `outputs/migrations-closure-20261016` no workspace da tarefa:

| Prova atual | Resultado e escopo |
| --- | --- |
| Restore formal | 238 contratos representados; catálogo/owners/ACL/RLS/referência estática equivalentes |
| Forward 239 | SQL realmente executado; um registro durável; fingerprint final igual ao schema de referência |
| Negativas no clone integral | 11/11: alvo adulterado, reapply, schema/ACL/trigger/referência/ledger, rollback e replay de forward |
| Preflight de banco vazio | 8/8: vazio aceito; relação, função, enum, domain, collation, schema e default ACL preexistentes recusados |
| Semântica do catálogo | 8/8: ACL ordenada/defaults/grant option, grants reais, colunas visíveis, runtime canônico e rejeição de desvios |
| API autenticada e Data API | 9/9 no schema funcional atual de QA; ingresso concorrente, claim exclusivo, replay, audiência e rotação completa |
| Worker PostgreSQL real | 20 cenários / 26 com subcasos; zero falhas e zero skips |
| Notificações PostgreSQL + HTTP local | 14 resultados aprovados; nenhum provider externo usado |
| Equipes | Cenário atual aprovado: escala da participação, fim do turno, bolsão e membro direto |
| Go API completo | 6.554 resultados aprovados incluindo subcasos; zero falhas e 462 skips opt-in explicitamente registrados |
| Contratos baseline e guard SQL | 77/77 testes unitários; zero falhas e zero skips; revisão independente com 13 probes aprovada e lint sem erros ou warnings |
| Navegador Chrome atual | Tentativa limpa v2 aprovada: bolsão/claim, reabertura, aviso 6→5 minutos e redistribuição real após o prazo |

Não somar suítes sobrepostas nem contar os skips como validação externa. As
integrações obrigatórias da fila acima foram executadas separadamente. As
provas de API/equipes usam a referência funcional atual; o restore formal e a
forward tiveram comparação estrutural independente com essa referência.

Os 11 grupos no clone confirmaram o fingerprint e as cinco referências do alvo
positivo inalterados antes/depois. Todos os bancos criados por essa subauditoria
foram removidos; o alvo positivo e as tentativas anteriores do responsável pela
homologação permanecem para reprodução. Ver `baseline-apply.json`,
`baseline-forward239.json`, `baseline-postgres-negatives.json`,
`baseline-empty-postgres-negatives.json` e
`baseline-catalog-semantic-postgres.json`.

### Navegador atual e limite de publicação

O Chrome atual foi aprovado com fixtures sintéticas na tentativa limpa
`closure-current-20261016-v2`. O timer real redistribuiu corretor 2→3 aos
83,476 segundos, com prazo configurado de 60 segundos e polling do worker de
30 segundos. O estado foi observado antes do vencimento e após a troca;
episódio e etapa permaneceram iguais, com uma redistribuição, duas visitas e
nenhum claim. Esse resultado não certifica execução no segundo exato do prazo.

O navegador confirmou claim exclusivo no bolsão e preservou quem assumiu
manualmente na reabertura; o lead que continuava aguardando voltou à atribuição.
O aviso prévio ficou habilitado com seis minutos e foi bloqueado e zerado ao
alterar para cinco. A prova está em `BROWSER-FINAL.json`,
`browser-timer-clean-before.png`, `browser-timer-clean-after.png`,
`browser-pool-claimed.png`, `browser-pool-reopened.png` e
`browser-warning-five.png`.

A primeira tentativa ficou excluída da prova limpa porque o usuário confirmou
edição manual paralela de etapa e movimentação de leads. Seus artefatos foram
preservados; o resultado acima usa novo intento e novo timer.

A baseline local não repara nem autoriza o ledger de produção. O bloqueio de
`supabase db push` descrito em `supabase/README.md` permanece; a aprovação local
não certifica execução literal do histórico antigo. Não há autorização de
publicação ou comprovação de providers reais, capacidade de milhares de
usuários, Safari/PWA ou SSE entre processos. Uma nova divergência de fonte ou
mudança paralela exige revalidação do conjunto correspondente, preservando as
evidências anteriores.

### Correções da auditoria de distribuição — fechamento de 16/10/2026

Esta rodada corrigiu F01–F08 (P1/P2) no principal: atribuição por regra de
etapa integrada ao runtime; importação/replay dos outcomes gerenciados;
rechecagem durável de configuração, membros e escala; proteção atômica de
ligação/e-mail; fila gerenciada com zero/um elegível; exclusão barrada com
pendências; histórico detalhado por ocorrência real; e atividades da Data API
impedidas no bolsão sem claim. O guard C01 revalida política e payload da
notificação depois das esperas de locks, antes do início durável do HTTP.

Foram acrescentadas nove migrations, preservando as 240 fontes anteriores:

1. `20261016171117_wake_managed_queue_configuration_and_guard_delete.sql`
2. `20261016171251_contact_import_managed_queue_outcomes.sql`
3. `20261016171254_queue_runtime_history_transitions.sql`
4. `20261016171624_protect_managed_queue_human_activities.sql`
5. `20261016171628_integrate_managed_queue_stage_assignments.sql`
6. `20261016173733_authorize_queue_notification_at_attempt_start.sql`
7. `20261016175607_validate_contact_import_managed_queue_outcomes.sql`
8. `20261016180244_stamp_managed_queue_outreach_default_clock.sql`
9. `20261016180410_use_post_lock_cycle_end_clocks.sql`

O alvo formal foi criado vazio, recebeu os seis artefatos da baseline
(238 contratos equivalentes) e executou 11 forwards de fato: os dois
predecessores mais os nove desta rodada. Catálogo/ACL e cinco referências
estáticas conferem; zero forwards pendentes. Isso é equivalência de schema,
com `originalReplayPassed=false`, e não replay literal das 249 migrations.
A referência histórica local contém adaptações de bootstrap/guarda
explicitamente classificadas. Nenhum ledger histórico foi reparado.

Provas atuais: 25 cenários API/GoTrue/Data API/PostgreSQL; cinco grupos de
regressões SQL; reprodução/correção da corrida de relógio de atendimento;
28 testes folha de notificação com PostgreSQL e HTTP loopback; e cenário de
equipes após dreno comprovado. Testes Go de `internal/leads` e
`internal/roundrobin`: 1.195 registros PASS, 127 SKIP opt-in, zero FAIL; não
representam todo o backend. Os opt-ins obrigatórios do recorte foram testados
separadamente. Não somar suítes sobrepostas.

O Chrome confirmou criação/edição com um corretor, aviso seis → cinco,
claim do bolsão, preservação de quem assumiu na reabertura e retomada do
backlog. Tentativa limpa `distribution-fixes-final-v3`: corretor 3 antes do
prazo, corretor 4 depois; SQL confirmou primeira troca aos 78,407495 s,
nenhuma antes dos 60 s. O worker real usa polling de 30 s. Não foi avançado
o relógio. Histórico da retomada mostra uma criação real e rodadas completas,
sem interpretar o marcador interno `queue_runtime` como nova criação.

Relatórios, comandos, hashes, screenshots e recibos estão em
`C:/Users/andre/Documents/Codex/2026-10-14/c/outputs/distribution-fixes-20261016/`,
especialmente `HOMOLOGACAO-DISTRIBUICAO.md`, `BANCO-E-RISCOS.md`,
`browser-db-closure.json`, `formal-final-equivalence.json` e os manifestos
finais. Frontend de teste é espelho verificado do principal em loopback,
com API Go atual local; não usa API publicada. Serviços próprios de teste
foram encerrados e o dreno global comprovou duas observações sem sessão
pendente; os bancos/artefatos sintéticos permanecem para reprodução.

Permanecem os limites de capacidade e rollout: duas tentativas de equipes
atingiram o orçamento global de dez segundos sob backlog. Commits e avanço
real foram comprovados antes do rerun aprovado, sem aumentar timeout nem
alterar o algoritmo. Não houve teste de carga para milhares de usuários.
DDL com índices comuns pode bloquear writes; API nova depende do schema;
sender antigo não ganha C01 durante mistura de versões. O rollout futuro
exige reconciliar o catálogo/ledger reais, aplicar forwards revisados por
transação e verificar cada COMMIT. Mantém-se o bloqueio de `supabase db push`.
Não houve deploy, alteração/acesso a produção, commit ou push nesta rodada.


### Fechamento das barreiras do bolsão — 16/10/2026

Cadence-state agora usa audiência privada consistente; comandos verificam
o bolsão em nova consulta depois do lead lock. Inclui PATCH/DELETE, tarefas,
primeira resposta, anexos, Attention, reservas e nova vinculação de agenda.
Tarefas API usam lead → tarefa e conclusão/atividade atômicas.

Forward adicional: `20261016201006_protect_queue_pool_lead_task_mutations.sql`
(policies restritivas I/U/D + gate NOWAIT antes de fatos humanos).
Pins249 anteriores preservados; cadeia250, baseline238 +12 forwards revisados.
Backend confiável é preservado: banco sozinho não corrige réplicas API antigas.
Nenhuma publicação/produção/GitHub nesta rodada.

Provas locais: Go cinco pacotes sem falhas (1294 PASS records/156 opt-ins
pulados e testados separadamente quando necessários); oito cenários PG
dirigidos sem pulos; SQL de três estados/três perfis; corrida real de tarefa
com negativa em84ms; suíte25/25 e40 ciclos Go; progresso sob51 leads bloqueados
+4livres. Navegador confirmou bloqueio antes de claim, feedback após claim,
preservação na reabertura, backlog e timer real60s (primeira troca68,425684s,
nenhuma antecipada). Não somar suítes sobrepostas nem tratar counts como carga.

Coleta no fechamento continua eventual. Atendimento registrado após horário,
mas antes da coleta física, pode proteger o responsável: prova temporal real
registrada no relatório. Corte estrito no instante do fechamento exigiria nova
precedência transversal; não foi introduzido silenciosamente.

Relatório completo e hashes:
`C:/Users/andre/Documents/Codex/2026-10-14/c/outputs/distribution-pool-fixes-20261016/HOMOLOGACAO-BOLSAO.md`.
Worker/API próprios encerrados; frontend e portas conferidos ausentes; clone
descartável removido preservando referência/template. Docker ficou indisponível
na última limpeza pós-browser: último global-drain e restauração dos relays
ficaram sem confirmação. Cleanup estrito e global-drain anteriores passaram;
conferir pendência quando Docker retornar, sem reiniciar stacks por suposição.

### Reentrada manual/importada no bolsão — 16/10/2026

O P2 da reentrada foi corrigido no principal sem nova migration. A autorização
consulta `private.queue_pool_read_access` antes de alterar o contato e novamente
em statement próprio depois do lock do lead. A audiência do bolsão recebe
`queue_pool_changed` (409) até assumir; fora da audiência, a resposta continua
opaca (404). Administrador e permissão de importar não dispensam o claim.

Quando há conversa de WhatsApp para vincular, a mesma barreira é conferida
depois do lock de autorização do vínculo e antes dos RPCs de histórico. A ordem
conversa → lead foi preservada. Reentrada comum fora do bolsão, entrada confiável
de integração e replay idempotente mantêm seus contratos. Após claim real, a
reentrada é permitida e conserva o responsável e a proteção manual.

A importação classifica apenas `queue_pool_changed` como falha confirmada sem
COMMIT, oferecendo revisão e confirmação explícita para nova tentativa. Timeout,
resultado desconhecido e conflito de payload não foram liberados para reenvio
automático. A revisão preserva a chave idempotente da linha.

Homologação deste delta: cinco grupos com PostgreSQL local real (incluindo
espera comprovada por locks, vínculo WhatsApp, três estados do bolsão, isolamento
entre organizações e entrada confiável); seis testes puros dirigidos; 22/22
testes de importação; typecheck aprovado; lint sem erros e com sete warnings fora
do delta. A suíte Go de leads/authorization/distribution passou com 1.101 registros
PASS e 141 opt-ins pulados, sem contá-los como prova de integração. Os testes de
PostgreSQL dirigidos passaram sem skips. Não somar suítes sobrepostas.

O navegador usou frontend espelhado e API Go atuais em loopback: importação
recusada antes do claim, claim real e nova importação do mesmo CSV com uma
reentrada, zero falhas e responsável preservado. Replay da mesma chave foi
validado no PostgreSQL e no teste do callback; o clique de nova tentativa com
a mesma chave não foi concluído no navegador, pois o reload de desenvolvimento
fechou o modal. Duas linhas visuais no histórico correspondem a uma activity e
um evento da mesma reentrada (contador e recibo únicos): P3 visual separado.

A pendência anterior do Docker foi conferida com ele disponível, sem reiniciar
stacks. Nesta rodada, clone e fixtures próprios foram removidos, processos API/
frontend próprios encerrados, relays restaurados ao estado anterior (parados)
e duas amostras sem transação/lock pendente confirmadas. Referência e template
foram preservados. As provas de equivalência da baseline não são replay literal
do histórico nem autorização de `supabase db push`.

Relatório e recibos desta correção:
`C:/Users/andre/Documents/Codex/2026-10-14/c/outputs/distribution-reentry-fix-20261016/HOMOLOGACAO-REENTRADA.md`.
Não houve deploy, acesso/alteração de produção, commit ou push. A aprovação deste
delta não certifica os demais trabalhos paralelos do checkout nem carga de
milhares de usuários ou providers externos.

### Projeção única da reentrada no histórico — 16/10/2026

A atividade detalhada e o evento de entrada permanecem como registros distintos
de auditoria, mas a interface consolida as representações da mesma ocorrência.
A API Go grava `entry_event_id` na metadata da atividade manual/importada, com o
UUID da entrada inserida na mesma transação. O helper de histórico usa esse ID
exato, prefere a atividade detalhada e preserva ator, origem, conteúdo e notas.
Não altera distribuição, responsável, contador, notificações ou os dados brutos.

Registros antigos desse produtor, sem o ID, só são consolidados com histórico
completo e correspondência recíproca única de timestamp PostgreSQL integral,
origem, escopo, destino, imóvel e estado comercial. Não há janela de tolerância
nem comparação pelo texto. Em página incompleta, informação insuficiente ou
ambiguidade, as representações antigas são preservadas; podem parecer duplicadas
até o histórico completo estabelecer a identidade. IDs malformados não ativam
o fallback. Duas atividades distintas com o mesmo ID também não são descartadas
arbitrariamente. Duas reentradas reais continuam sendo duas ocorrências.

Provas dirigidas: 60/60 testes frontend; os mesmos testes no builder anterior
reproduziram 11 falhas; 11 grupos Go dirigidos, sendo cinco com PostgreSQL real,
sem skips/falhas; pacote leads com 1.022 registros PASS e 139 opt-ins pulados,
sem contá-los como integração aprovada. Typecheck e lint passaram, com sete
warnings fora deste delta. Uma fixture com duas reentradas reais separadas por
279,506 ms confirmou IDs distintos, um claim e responsável preservado. Payloads
reais ilimitado, página100 e seis páginas de tamanho2 preservam duas reentradas,
uma criação, um bolsão, um claim e duas notas após carregar o histórico completo.

Não há migration, reparo de ledger nem backfill de dados reais para este P3:
o identificador utiliza a metadata existente. API anterior continua compatível
com a projeção conservadora, e UI anterior apenas ignora o campo adicional.
A correção não autoriza publicação dos demais trabalhos locais. Reversão deve
ser seletiva: helper/import do builder, tipos opcionais e a linha de metadata,
preservando os outros hunks compartilhados e as barreiras do bolsão.

Relatório, navegador, hashes e recibos de encerramento desta rodada:
`C:/Users/andre/Documents/Codex/2026-10-14/c/outputs/distribution-history-fix-20261016/HOMOLOGACAO-HISTORICO.md`.


### Distribuição: fechamento de atividades e identidade do histórico — 16/10/2026

Escopo final restrito pelo usuário a distribuição, redistribuição, bolsão e
histórico. WhatsApp e seus trabalhos paralelos ficam fora desta conclusão;
as alterações anteriores desse domínio foram preservadas, sem certificação.

A migration nova `20261016234227_prevent_activity_parent_lock_deadlocks.sql`
introduz um gate NOWAIT anterior aos guards de atividades. Ele trava os pais
OLD/NEW em ordem e evita aguardar o lead mantendo a atividade bloqueada.
O conflito aborta a transação com `55P03/queue_activity_lead_busy_retry`;
escritores diretos devem repetir a transação inteira. Grants, RLS e guards
existentes permanecem ativos. Não elimina deadlocks de lotes arbitrários.

O histórico conserva `distribution_event_id` do log para usar a correlação
exata existente. Runtime e log da mesma atribuição produzem uma linha mesmo
sem timeline; IDs distintos continuam sendo ocorrências distintas. Não há
backfill ou deduplicação por proximidade para registros antigos ambíguos.

Provas locais: quatro deadlocks `40P01` reproduzidos antes da migration;
três grupos de concorrência PostgreSQL aprovados depois, cinco regressões
SQL aprovadas e 76 testes frontend de histórico/capacidade/bolsão aprovados.
Pacotes Go leads/distribution/authorization aprovados; opt-ins pulados na
suíte geral não contam como integração. Chrome mostrou exatamente duas
atribuições para dois IDs reais, com dois logs e nenhuma timeline dessas
atribuições. Typecheck e lint passaram no snapshot frontend examinado.

Aplicada somente no Supabase local de QA, após ensaio em clone descartável.
Os 250 pins anteriores e os dados preexistentes de leads/atividades/runtime
foram preservados; a referência local tem 251 migrations. A baseline formal
continua sendo equivalência de schema, sem ledger histórico fabricado ou
replay literal. Isso não autoriza `supabase db push` contra produção.

Fixtures ativas próprias removidas; tombstone e quatro eventos de auditoria
preservados por contrato. Clone removido sem FORCE, processos próprios
encerrados, relays restaurados ao estado parado e duas amostras finais sem
transações/locks pendentes. Sem produção, deploy, commit ou push.

Relatório final e recibos:
`C:/Users/andre/Documents/Codex/2026-10-14/c/outputs/distribution-four-fixes-20261016/HOMOLOGACAO-DISTRIBUICAO.md`.

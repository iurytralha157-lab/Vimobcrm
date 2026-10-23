# WhatsApp sem lead: validação local antes da publicação

Este roteiro cobre a correção transferida para o checkout principal `D:\Vimob\workspaces\vimob-crm`.
É um contrato para teste e revisão; nenhuma etapa aqui autoriza executar um
cutover, replay, limpeza ou deploy em produção.
As seções de evidência datadas de 8/10 e do início de 9/10 são registros
históricos. A seção final de 9/10 contém o estado local mais recente.

## Regras que devem permanecer verdadeiras

| Situação | Visibilidade | Envio | Retenção |
| --- | --- | --- | --- |
| Conversa direta sem lead | Dono da sessão WhatsApp, na inbox normal e em tempo real | Bloqueado | Sai da inbox sete dias depois de `whatsapp_conversations.created_at`, mesmo se receber outras mensagens |
| Conversa com lead | Admin: todos os leads da organização; líder: leads a que tem acesso; usuário: leads atribuídos | Permissões atuais de envio e da sessão | Histórico do lead preservado |
| Grupo, evento de automação ou rota sem identidade segura | Contrato atual | Contrato atual | Fora da nova captura temporária |

O sinal de Realtime informa que a inbox mudou; a API consulta novamente e
aplica o escopo de usuário/organização. Nenhum conteúdo de mensagem deve ser
enviado no evento de aviso. A recepção do provedor, os modos do processador e a
outbox de envio continuam com seus contratos atuais.

## Componentes do ajuste

1. A migração `20261008210143_whatsapp_unlinked_ephemeral_realtime.sql` adiciona
   estados de captura, marcação de retenção, proteção de histórico de lead,
   autorização de leitura, scrub limitado e fila privada de coleta de mídia.
   Ela não ativa a captura prospectiva nem a limpeza por si só.
2. O script `supabase/cutovers/20261008_whatsapp_unlinked_epoch_index.sql`
   prepara o índice único somente das conversas ativas. Depois que todos os
   escritores Edge e Go, a automação e os leitores estiverem compatíveis, o
   script **manual** `supabase/cutovers/20261008_activate_whatsapp_unlinked_epoch.sql`
   exige o índice preexistente e válido, desativa a unicidade antiga e ativa o
   marcador `unlinked_capture_policy=v1` apenas em novos snapshots. Snapshot
   antigo e replay mantêm sua decisão original. A ativação fica fora de
   `supabase/migrations` para não entrar em uma aplicação em lote.
3. Os processadores Edge e Go usam o mesmo marcador e a mesma identidade da
   conversa. Uma nova mensagem após o prazo aposenta a época antiga por
   comparação de ID, sessão e JID antes de criar outra conversa física.
4. A API Go filtra lista, contagem, detalhe, mensagens e mídia pelo prazo e
   pelo escopo do lead. A interface assina o aviso privado da inbox enquanto
   o chat flutuante está aberto e reconsulta a API.
5. `WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED=false` é o padrão da API Go.
   Quando habilitado depois da validação, o worker processa pequenos lotes;
   a remoção dos objetos usa a API do Storage e só ocorre após nova checagem
   de referências. A exclusão de objetos não deve ser feita por SQL.

## Evidência local em 8/10/2026

| Verificação | Resultado | Alcance |
| --- | --- | --- |
| pgTAP: `whatsapp_unlinked_ephemeral_realtime.test.sql` | 20/20 | Passou nos dois clones locais descartáveis |
| pgTAP: `whatsapp_unlinked_epoch_retention.test.sql` | 27/27 | Passou nos dois clones, após ativação manual |
| pgTAP: `whatsapp_realtime_authorization.test.sql` | 18/18 | Passou nos dois clones; autorização de Realtime |
| pgTAP: `whatsapp_realtime_unlinked_contract.test.sql` | 26/26 | Contrato legado atualizado; passou nos dois clones |
| Go: pacotes `internal/whatsapp`, `internal/config`, `internal/app` | Passou | Testes locais; a integração da lista com fixture de vínculo canônico passou nos dois clones |
| Webhook Edge: `hardening-source.node.test.mjs` | 19/19 | Contrato de código; não é entrega real do provedor |
| Interface e cache: testes focados | 56/56 | Contratos locais, incluindo chat flutuante |
| `npm run typecheck`; `npm run lint` | Passaram | Lint: 0 erros e 533 avisos no repositório |
| Verificadores de migrations e manifesto Edge | Passaram | Source lock: 160 migrations não vazias; conferência de arquivos, sem aplicação em produção |

Os pgTAP e a integração Go acima rodaram em **dois clones isolados de um volume
PostgreSQL E2E local parado**, sem alterar o volume original. Ambos receberam
a migration da fase A, o índice parcial e o contrato de ativação. O clone de
base exercitou o script manual final; o mais estrito executou a versão anterior
equivalente da fase B antes da separação em `cutovers/`. Esse clone mais estrito
recebeu **somente a função de contexto de mensagens da versão de 19/9**, não o
cutover histórico inteiro. A integração Go passou nos dois clones após corrigir
a fixture para usar o vínculo canônico.

No clone de base, a ativação manual foi tentada antes de preparar o índice e
abortou com `whatsapp_unlinked_active_unique_index_not_ready`, sem concluir o
corte. Depois de construir o índice concorrentemente com o script de prebuild,
a mesma ativação passou. Isso confirma o bloqueio de segurança nesse clone;
não substitui ensaio de implantação em produção. Os resultados **não equivalem**
a um `supabase db reset` limpo nem a um teste de ponta a ponta da UI. O reset
limpo do projeto descartável parou em migrações anteriores a este ajuste:
`20260921115616` (leitura de triggers ausentes), `20260921132800` (exige leads
históricos) e `20260922173000` (diferença no patch de função). As tentativas de
contorno ficaram somente na cópia descartável; o terceiro bloqueio encerrou o
reset. Os arquivos canônicos não foram alterados por isso.

A suíte Go completa com `WHATSAPP_TEST_ISOLATED=1` não ficou verde nesses
clones: outros testes exigem o banco dedicado `vimob_whatsapp_test` e fixtures
próprias; a rodada exploratória também apontou falhas em cenários de webhook
e concorrência que não foram isoladas neste ensaio. A prova de integração
declarada na tabela é o teste focado da lista, executado separadamente.

Para inspeção local, os clones PostgreSQL ficaram disponíveis somente em
`127.0.0.1:57324` (contrato base) e `127.0.0.1:57323` (contexto estrito).
São bancos de teste, não uma aplicação completa com Auth, Realtime, Storage e
provedor WhatsApp; não confunda uma consulta neles com o teste visual abaixo.

## Como repetir e avaliar localmente

Trabalhe no checkout principal `D:\Vimob\workspaces\vimob-crm`.
Antes de iniciar a aplicação, confira que **API, Edge, Realtime e Storage**
apontam para o mesmo projeto Supabase **descartável**, com `project_id` próprio.
Nunca use `--linked`, `db push`, credenciais ou sessões de produção neste ensaio.
O banco deve conter a migration da fase A e o índice parcial válido antes de
testar a captura `v1`. A fase B é um cutover manual e **não** acompanha
`supabase db reset`, `db push` ou outra aplicação em lote. Em um banco
descartável, a ordem é: aplicar a fase A; executar
`supabase/cutovers/20261008_whatsapp_unlinked_epoch_index.sql` em autocommit;
confirmar que o índice está pronto e válido; preparar os escritores Edge/Go,
automação e leitores compatíveis; executar isoladamente
`supabase/cutovers/20261008_activate_whatsapp_unlinked_epoch.sql`.
Esse último script aborta se o índice não estiver pronto, sem tentar construí-lo
sob lock da transação.

1. Confirme o estado do checkout e repita `node scripts/supabase/verify-migrations.mjs`
   e `node scripts/supabase/verify-edge-functions.mjs` na raiz do projeto.
2. No banco descartável preparado pela sequência acima, rode os quatro pgTAP da
   tabela acima. `whatsapp_unlinked_epoch_retention.test.sql` requer a ativação manual da
   fase B; um reset que aplica só migrations não basta. Registre separadamente
   o resultado de um futuro reset limpo; `supabase test db` em um projeto
   criado do zero ainda não foi validado devido às migrações históricas citadas.
3. Em `apps/api`, rode
   `go test ./internal/whatsapp ./internal/config ./internal/app -count=1`.
   Para repetir **só** a integração SQL da lista, use
   `WHATSAPP_TEST_ISOLATED=1` e `WHATSAPP_TEST_DATABASE_URL` apontando a uma
   URL PostgreSQL de loopback do banco descartável; execute
   `go test ./internal/whatsapp -run '^TestConversationListFiltersSourceAndPeriodIntegration$' -count=1`.
4. Na raiz, rode `node --test supabase/functions/evolution-go-webhook/hardening-source.node.test.mjs`,
   `node --test components/features/chat/floating-chat-contract.test.mts` e
   `node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/whatsapp-query-cache.test.ts lib/access/whatsapp-realtime.test.ts`.
   Essas três suítes da interface/cache somam 56 testes. Rode também
   `npm run typecheck` e `npm run lint`.
5. Com **duas organizações, contas por papel, sessões e contatos de teste**,
   faça a conferência manual abaixo na UI e na API locais. Use somente números
   controlados pela equipe. Anote horário, ID da conversa, papel do usuário,
   status da API e resultado visual; não copie conteúdo pessoal para o relatório.
6. Habilite o worker de retenção apenas nesse ambiente descartável. Exercite
   scrub e coleta de mídia sintética; desligue-o ao concluir. Não ative o worker
   como substituto da verificação da UI e da API.

### Roteiro manual de avaliação

1. Abra o chat flutuante como dono da sessão A. Envie **para essa sessão de
   teste** uma mensagem nova de contato sintético sem lead, pelo fluxo atual
   de entrada. Confirme que lista, contador e conversa atualizam sem recarregar;
   feche e reabra o balão e atualize a página para confirmar persistência. A
   resposta deve permanecer bloqueada na UI e na API.
2. Entre como usuário sem acesso à sessão A e como usuário da organização B.
   Confirme que não recebem aviso com conteúdo nem conseguem ler a conversa ou
   sua mídia. Como admin da organização A, líder e usuário comum, confira a
   visibilidade dos chats **com lead** conforme o acesso ao lead; confira que
   o envio continua sujeito à permissão da sessão WhatsApp.
3. Use fixtures sintéticas para uma conversa sem lead criada há 6 dias com
   mensagem nova hoje e outra criada há mais de 7 dias. Verifique lista,
   contador, detalhe, mensagens e mídia; o prazo é contado da criação, não da
   última mensagem. Receba nova mensagem no dia 8 e compare os IDs: deve haver
   nova conversa física, sem reaparecimento da época vencida.
4. Promova uma conversa de teste a lead antes de vencer. Confirme preservação
   do histórico e ausência de efeitos retroativos de lead. Reenvie o mesmo
   evento antigo de teste e confirme que o replay não muda de época nem
   ressuscita conteúdo. Faça ensaios separados para grupo, evento antigo sem
   marcador `v1` e conversa antiga com histórico protegido (lead, saída,
   atendimento, outbox ou vínculo). Não trate `lead_id IS NULL` como prova de
   que o histórico pode ser apagado.
5. Com o worker ativo no banco descartável, verifique fila, scrub, retry e
   exclusão de objeto somente quando o path não tiver outra referência. Confirme
   que uma corrida com job de mídia em processamento adia o scrub com segurança.

O ajuste é prospectivo. O backlog antes suprimido não é recuperado
automaticamente; não o reprocessar em massa durante a avaliação.

## Critérios para concluir a avaliação local

Registrar o resultado de cada passo manual acima, inclusive falha ou teste não
executado. Ainda faltam o teste de ponta a ponta da UI com entrada controlada,
o ensaio completo do worker/Storage e um reset limpo desde a primeira migration.
Antes de qualquer versão para produção, também é necessário demonstrar que
Edge e Go concordam sobre o mesmo snapshot e que recebimento e envio de leads
continuam iguais em um canário autorizado.

Antes de qualquer publicação futura, conferir novamente o alvo, o histórico
de migrations, a validade do índice parcial, compatibilidade de **todas** as
réplicas e escritores Edge/Go, automações e leitores, backup e plano de
retorno. Só então executar o corte manual da fase B, fora de `db push`.
Depois que surgirem duas épocas
com a mesma sessão/JID, recriar a constraint única antiga diretamente deixa
de ser um rollback válido. Nessa situação, desabilitar o worker, interromper
o corte e preparar uma correção específica sem descartar mensagens.

## Limites de evidência

### Parte 2 implementada no checkout local em 09/10/2026

A correção local acrescentou captura de entrada e saída externa sem lead,
observação do lead antes do atendimento sem efeitos comerciais retroativos,
separação da época antiga quando um intake comprovado cria ou encontra lead,
prévia e confirmação do vínculo com anexação automática do histórico elegível,
CAS contra mudança do card, leitura por escopo de lead e saneamento de épocas
vencidas. O recebimento do webhook e a outbox de envio continuam pelos
transportes atuais. A limpeza de payload integral depende da ativação manual
do cutover e do worker; nenhum deles foi ativado em produção.

| Verificação da Parte 2 | Resultado | Limite da prova |
| --- | --- | --- |
| pgTAP: vínculo, acesso e separação de época | 37/37 | Clone PostgreSQL descartável `127.0.0.1:57323` |
| pgTAP: lote bruto, 129 membros, 501 linhas e prova incompleta | 11/11 | O lote misto é preservado inteiro por segurança |
| pgTAP: retenção anterior e autorização Realtime | 27/27 e 18/18 | Banco local, sem canal Realtime do navegador |
| pgTAP: emissão Realtime sem lead | 18/20 | Dois asserts dependem de `realtime.send` materializar `realtime.messages` neste clone |
| Integração Go: prévia, vínculo e leitura de lead após desconexão/exclusão lógica da sessão | Passou | Banco local, dados sintéticos, sem provedor nem navegador |
| Go: `internal/whatsapp` e `internal/leads` | Passou | Testes de pacote, sem webhook HTTP ponta a ponta |
| Contrato de fonte do processador Edge | 20/20 | Não demonstra execução Edge real |
| Interface: contratos focados | 35/35 | Não demonstra atualização visual em sessão autenticada |
| TypeScript, lint focado e manifesto Edge | Passaram | Lint focado tem dois avisos preexistentes |
| Source lock das migrações WhatsApp | Passou antes de novos arquivos paralelos | O verificador global agora aponta migrações de RBAC fora deste ajuste ainda sem lock |

O teste integrado Go e os pgTAP acima usaram somente `57323`, com migrações
da Parte 2 aplicadas no clone. O clone `57324` e produção permaneceram
inalterados. A instalação completa local com Auth, Realtime, Storage, API Go,
Edge e interface apontando ao mesmo projeto **não foi executada** nesta rodada.
Exclusão física de linha de sessão não foi ensaiada; o fluxo normal da API
marca a sessão como excluída sem removê-la fisicamente.
Na última conferência do checkout compartilhado, `verify-migrations.mjs`
passou a apontar `20261009030225_membership_access_generation.sql` e
`20261009030511_harden_rbac_data_api_writes.sql`, migrações de RBAC criadas em
trabalho paralelo. Elas não foram alteradas nem adicionadas ao source lock por
esta correção de WhatsApp; o gate global precisa ser refeito após aquele
trabalho terminar.
Não há medição dos alvos de 15 e 60 segundos, teste de envio humano pelo CRM,
teste de concorrência exatamente no corte de sete dias ou prova de execução
contínua do worker/Storage GC. Essas verificações são gates da avaliação local.

No teste manual da Parte 2, acrescente ao roteiro acima: (a) saída externa pelo
WhatsApp conectado sem lead e com lead sem atendimento; (b) vínculo aos seis
dias e anexação automática de entrada, saída e mídia; (c) intake de lead com
histórico anterior separado e vínculo tardio somente como histórico; (d)
reassociação explícita A→B no desktop e no mobile, confirmando que mensagens
antigas continuam em A; (e) webhook aceito antes do vínculo e processado
depois, sem gerar efeitos de atendimento retroativos; (f) alerta de eventos
`pending`/`retry` terminalizados pela retenção. Não use conversas reais para
simular vencimento ou replay.

### Gate anterior: payload bruto com lote misto

O texto abaixo registra o limite antes da migração parcial de 9/10. A seção
final descreve o que passou e quais formatos ainda falham fechados.

Um callback Evolution pode ficar em uma única linha de
`whatsapp_webhook_inbox` com mais de 128 mensagens ou com um formato que não
permite divisão na entrada. A linha pode misturar uma mensagem sem lead já
vencida com uma mensagem de lead que ainda precisa ser processada. A limpeza
local da Parte 2 só apaga o payload inteiro quando **todos** os membros têm
snapshot imutável que comprova a mesma época sem lead vencida. O pgTAP cobre
129 membros da mesma época, lote misto, prova incompleta e mais de 500 linhas.
No lote misto, a linha fica intacta para não perder a mensagem do lead.

**Gate para a meta de saneamento em até 24 horas:** ainda não demonstramos
uma redação parcial segura. Retirar apenas o membro vencido exigiria associar
cada item bruto ao respectivo snapshot, preservar a ordem e as referências de
predecessor, atualizar em conjunto a lista de snapshots embutida e manter o
processamento dos membros restantes em `pending`/`retry`. O replay do callback
original também precisaria reconhecer a linha parcialmente redigida sem
reinserir ou reprocessar o membro apagado; hoje a comparação de ingress aceita
somente o payload original ou o tombstone integral terminal. Campos do envelope
fora da lista podem conter identidade do membro vencido. Não há prova local de
que removê-los preservaria os dados do lead em todos os formatos aceitos.

Até existir essa prova, manter a regra fail-closed, alertar quando um lote
misto vencido continuar com payload bruto após 24 horas, e não declarar a
retenção raw completa nem liberar produção com essa meta como cumprida. Para
fechar o gate, testar processamento e replay em Go/Edge para lotes mistos
`pending`, `retry`, `dead` e `processed`, inclusive predecessor ainda sem
resultado, e demonstrar que nenhum dado de lead é perdido ou exposto a outro
tenant. Estes ensaios devem ocorrer em projeto descartável e com números
sintéticos.

Testes de código e pgTAP locais provam apenas o ambiente em que rodaram.
`/readyz`, resposta HTTP `202` do webhook e avisos de Realtime isolados não
provam persistência e visibilidade ponta a ponta. Para produção, a prova ainda
depende de um canário autorizado e leitura das filas, da API e da UI no mesmo
período.

## Atualização local em 09/10/2026

O checkout principal contém o ajuste da Parte 2. Nenhuma migração, cutover,
replay ou publicação foi aplicada à base ou à aplicação de produção. O projeto
Supabase completo deste ensaio é descartável (`57621` API/Edge e `57622` DB),
derivado do clone PostgreSQL local `57323`. Isso **não** substitui um reset
limpo desde a primeira migração.

| Ensaio | Resultado | Alcance exato |
| --- | --- | --- |
| pgTAP: histórico/vínculo, raw, época, autorização Realtime, contrato sem lead, lote misto | 37/37, 11/11, 27/27, 18/18, 26/26, 31/31 | Banco descartável; snapshots e regras de acesso e retenção |
| Go HTTP → inbox → worker → API | Passou no clone `57325` | Entrada sem lead, saída externa, primeiro lead sem atendimento, bloqueio de envio, sete dias, replay e lote misto 129 |
| Edge HTTP → inbox → API | Passou no projeto `57621/57622` | Entrada sem lead, saída externa e primeiro lead sem atendimento; três linhas `processed`; sessão sintética em overlay sem cutover `epoch=1` |
| Realtime privado por WebSocket | Passou no projeto `57621` | Sinal da inbox sem conteúdo de mensagem, tópico de lead, recusa de inscrições indevidas |
| Auth e Storage locais | Passaram | Password grant sintético e upload/download/remoção de bytes sintéticos |
| Fonte Edge, source lock, typecheck e lint focado | Passaram | 22/22 no contrato de fonte; 168 migrações não vazias com hash correto |
| Verificador global do manifesto Edge | Falhou na última repetição | Mudanças paralelas em `_shared` e outras funções; a entrada `evolution-go-webhook` não apareceu entre as divergências |
| Navegador autenticado sem recarga | 1/1 passou | Com canal inscrito, mensagem sintética sem lead atualizou lista e contador; o chat exibiu conteúdo e manteve envio bloqueado |

O Edge retornava `500` para saída externa sem lead. A repetição no runtime
descartável confirmou SQLSTATE `23514`: `from_me=true` era inserido com a direção
padrão `inbound`, incompatível com a captura visível. O INSERT agora define
`direction` como `outbound` para `from_me`; o ensaio HTTP Edge passou após o
ajuste. O transporte de recebimento e a outbox de envio não foram trocados.

O teste de navegador encontrou outro defeito: a assinatura privada funcionava,
mas o frontend recusava o aviso emitido pelo Realtime porque ele contém um ID
técnico além de `scope`. A validação agora aceita somente `scope` ou
`{id, scope}` com UUID válido, mantendo rejeição de identificadores de conversa,
status e conteúdo. Depois dessa mudança, o Playwright confirmou a atualização
sem recarga. As tentativas anteriores falharam por compilação lenta do Next e
por um matcher incorreto do próprio teste; elas não foram contadas como prova
do comportamento do WhatsApp.

A retenção parcial remove o membro vencido de um lote bruto `data.messages`
somente quando a identidade e os snapshots permitem provar a correspondência
um a um. No ensaio Go de 129 membros, removeu o único membro sem lead vencido,
preservou 128 membros de lead e reconheceu o replay original com
`instanceToken` como duplicado. Formatos ambíguos e dependências de predecessor
continuam sem descarte automático; ver
`docs/runbooks/whatsapp-lote-misto-retencao-local-2026-10-09.md`.

Os tempos observados são amostras sintéticas individuais, não uma velocidade
média nem p95/p99: o lote Go de 129 teve ACK próximo de 1,15 s e worker próximo
de 7,10 s; no Edge, três ACKs foram 238/55/55 ms e os workers
1,16/0,61/1,76 s. Nenhuma dessas medições é latência do provedor real.

### Gates ainda abertos naquela medição

1. Ampliar a matriz visual autenticada para admin, líder e usuário com lead
   atribuído, sessão própria sem lead e usuário sem acesso. O teste básico sem
   recarga passou; a matriz completa e a corrida dos sete dias ainda não.
2. Ensaiar Edge e Go com a mesma sessão depois do cutover `epoch=1`. O clone
   `57325` precisou remover somente nele um trigger legado **não versionado**;
   o overlay Edge usou sessão sintética sem esse cutover. Comparar a definição
   desse trigger e o ledger de migrações do alvo antes de qualquer proposta de
   aplicação.
3. Validar a instalação completa de migrações desde uma base descartável vazia.
   O reset histórico ainda bloqueia antes desta Parte 2. Não transformar um
   resultado de clone físico em prova de migração reproduzível.
4. Exercitar a coleta de mídia e os formatos de lote que permanecem em modo
   fail-closed, além dos limites exatos de expiração no navegador.
5. Em uma publicação futura autorizada, executar canário controlado com o
   provedor real, conferir fila, API, Realtime, UI e envio atual antes de
   declarar o incidente encerrado.
6. Reconciliar o manifesto Edge global depois que as mudanças paralelas nas
   outras funções estiverem estáveis; a falha atual do gate não é evidência de
   problema na entrada `evolution-go-webhook`, mas impede liberar o conjunto.

## Conferência local posterior em 09/10/2026

No projeto descartável `57721/57722`, o teste integrado
`TestLocalEdgeExecutionFenceAndCutover` passou com HTTP Go→Edge real, token de
execução, timeout antes e depois do início da Edge, veto de cutover enquanto
ela estava ativa, dreno de `epoch=0` e processamento Go nativo de `epoch=1`
mesmo com Edge configurada. O ensaio também cobriu callbacks de etiqueta e
grupo depois do corte. Testes Go específicos cobrem `messages.update` como
recibo somente com ID e estado válidos. A suíte `go test ./internal/whatsapp`
passou depois dessas alterações. A migration da cerca passou nos pgTAP 30/30,
e o contrato de cutover, 35/35. Não houve conexão com o provedor real.

O Playwright autenticado, com Realtime local aquecido, confirmou o frame privado
`whatsapp.inbox.changed` antes da reconsulta que trouxe uma mensagem sintética
sem lead. Lista, contador, conteúdo e bloqueio de envio passaram. Um primeiro
ensaio de inicialização perdeu o aviso enquanto a publicação/slot do Realtime
ainda era criada; não se deve usar esse ensaio como prova de latência do caminho
aquecido. A fixture foi removida. `verify-migrations.mjs` passou com 173
migrations não vazias, `verify-edge-functions.mjs` passou com 42 funções vivas,
e `git diff --check` passou; os hashes devem ser conferidos novamente no SHA
congelado, pois o checkout principal contém outros trabalhos simultâneos. A
entrada `20261009061817` do source lock pertence a outra frente e precisa da
revisão de seu dono antes de congelar esse SHA.

A revisão de autorização encontrou e corrigiu dois caminhos concretos. Criar
lead com `conversationId` agora exige módulo WhatsApp, `whatsapp_operate` e
`lead_operate`, como o vínculo explícito. As leituras por equipe na API e nos
helpers SQL de RLS/Realtime agora exigem que os vínculos de líder e corretor
pertençam à geração vigente da associação à organização; remover e reconvidar
um membro não reativa a equipe antiga. No clone descartável, as migrations
predecessoras `20261009030225`, `20261009034132` e `20261009034701` e a nova
`20261009061438` foram aplicadas na ordem, com 29/29 pgTAP, integração Go de
escopo e cinco pacotes Go aprovados. Esse overlay local não prova o ledger do
destino de produção.

O segundo Playwright autenticado confirmou o vencimento no **chat flutuante**:
em `created_at + 7 dias - 1 ms`, chat e conteúdo seguiam visíveis; após avançar
1 ms, o widget fechou a conversa, reconsultou lista e contador no escopo atual,
e a API devolveu 404/410 para o histórico vencido. O teste sincronizou o
relógio virtual do navegador com o horário real do Postgres somente na fixture
sintética, removeu a fixture ao final e encerrou os servidores locais. A
`ConversationsScreen` usa o mesmo helper de expiração e invalidação escopada;
o teste focado de cache passou, mas este Playwright atravessou o limite apenas
no widget flutuante.

A matriz autenticada de três papéis passou em uma rodada Playwright no mesmo
projeto descartável. API e widget mostraram ambos os leads ao admin, apenas o
lead da equipe ao líder e o lead atribuído mais a conversa sem lead da própria
sessão ao usuário; cada papel deixou de ver os outros casos da fixture. Sessões
e conversas sintéticas foram removidas. O teste local de regressão de envio
`TestLocalWhatsAppSendRegression` também passou: sem lead e sem atendimento,
nenhuma linha de mensagem/outbox ou chamada ao provedor simulado; com
atendimento, pedido repetido e eco `from_me` mantiveram uma mensagem, uma
outbox e uma chamada. Esse teste não envia ao WhatsApp real.

O ensaio `TestLocalUnlinkedStorageGC` usou a API Storage real da stack
descartável: apagou a mídia exclusiva da época vencida, preservou o objeto
compartilhado com mensagem viva de lead e só o apagou após a referência ser
liberada. SQL da retenção passou 31/31 e vínculo, 37/37, no clone independente;
Go cobriu 404 idempotente, 503 com retry e log terminal sanitizado após
`COMMIT`. O [runbook da inbox](whatsapp-inbox.md) registra a consulta e a regra
de alerta; a ligação ao canal operacional ainda será conferida no canário.

O caminho finito até o canário é: (1) congelar o delta WhatsApp e reconciliar o
ledger de migrações do alvo em uma **cópia descartável de backup**; (2) ensaiar
nessa cópia a sequência de migration, Edge, Go com worker pausado e cutover
manual descrita no [runbook da inbox](whatsapp-inbox.md); (3) validar
inicialização/reconexão do Realtime e conectar o alerta operacional de GC;
(4) completar a medição de UI e Realtime contra os alvos de 15/60 s, além da
medição de API abaixo; (5) só na publicação futura autorizada, executar canário
real com telemetria de fila, API, Realtime, UI e outbox. Um clone com
ledger compatível permite provar a instalação incremental no destino; ele não
equivale a um `supabase db reset` desde a primeira migration.
O `supabase/README.md` ainda exige esse reset antes de produção. Como a cadeia
histórica bloqueia o reset vazio, a equipe precisa resolver essa divergência
formalmente no gate de release, com baseline/ledger reconciliados ou uma decisão
documentada sobre a prova incremental; este roteiro não dispensa a regra.

### Medição controlada de entrega HTTP → API em 09/10/2026

`TestLocalWhatsAppDeliveryLatencyContract` passou no projeto descartável
`57722`: 10 callbacks de texto para lead com conversa vinculada existente e 10
para contato sem lead, em sequência. Cada evento percorreu o webhook HTTP,
inbox durável, worker Go nativo assíncrono (`epoch=1`, intervalo de 1 s, quatro
slots) e GET autenticado da lista e do histórico da API. A tabela usa a segunda
execução integral, com fixture removida ao final; a primeira medição foi
descartada porque a limpeza da própria fixture falhou e foi corrigida.

| Categoria | Amostra | ACK HTTP média / p95 | ACK → `processed` observado média / p95 | ACK → lista e detalhe API observados média / p95 / máximo |
| --- | ---: | ---: | ---: | ---: |
| Lead | 10 | 148 / 396 ms | 616 ms / 2,107 s | 633 ms / 2,120 s / 2,120 s |
| Sem lead | 10 | 133 / 230 ms | 388 / 622 ms | 399 / 634 ms / 634 ms |

Todos os 20 eventos ficaram disponíveis na API em menos de 60 s; os p95 da API
ficaram abaixo de 15 s. A sondagem de `processed` ocorre a cada 25 ms e a
consulta da API começa depois dessa observação; esses tempos são limites
observados pelo teste, não timestamps exatos da mudança no banco. Com apenas 10
amostras por categoria, o p95 por posto mais próximo equivale ao máximo da
categoria. O ensaio não inclui o provedor real, concorrência representativa,
Realtime nem exibição na UI; portanto fecha somente o trecho webhook → API da
meta funcional, não a meta completa de aparição no navegador.

### Medição visual integrada HTTP → navegador — NÃO EXECUTADA

O teste opt-in
`tests/e2e/whatsapp-visual-latency-local.spec.ts` foi preparado para cinco
mensagens sintéticas de lead e cinco sem lead, em série. Ele usa o webhook HTTP,
worker nativo, frame privado do Realtime, reconsulta da lista e conteúdo no
chat flutuante sem refresh, e calcula média, p95 e máximo de POST → DOM e
ACK → DOM. Antes da amostra, exige `phx_join`, publicação de
`realtime.messages` e slot de replicação ativo. O opt-in do worker no harness
`tests/e2e/support/e2e-env.ts` só aceita workdir Supabase isolado, quatro
URLs em loopback nas portas 3100/8181/57721/57722 e inbox sem trabalho
pendente, retry ou processing.

Na única tentativa local de 09/10/2026, a API 8181 iniciou, mas o webServer
do Playwright expirou após **600000 ms** aguardando `/login` do Next 3100.
O log do Next ficou em `Compiling /login` após `Compiling proxy` e aviso de
filesystem lento. **Nenhum callback foi enviado, nenhuma amostra visual foi
colhida e o alvo de 15 s/60 s permanece não medido nesse caminho integrado.**
Os processos 3100/8181 foram encerrados; a consulta local encontrou zero
sessões e zero itens de inbox dessa fixture, e zero itens globais inacabados.
O Playwright anterior que mostrou um frame privado e atualizou o widget
permanece uma prova funcional separada, sem medição de latência.
`eslint` dos dois arquivos e `tsc` restrito ao spec/harness passaram. O
`tsc` global parou em `.next-e2e/dev/types/routes.d.ts:163` (TS1128), um
artefato gerado durante a inicialização incompleta do Next; esse resultado não
valida o typecheck global do checkout.

#### Pendências estáticas do gate visual antes da próxima execução

Auditoria do código em 09/10/2026, sem executar o teste nem enviar callback:

1. O spec atual mede somente canal aquecido. Criar cenários separados de início
   frio e reconexão; zerar a prontidão quando o socket fechar ou perder a
   inscrição, pois o booleano `subscribed` hoje permanece verdadeiro.
2. Incluir a atualização do contador de não lidas na verificação integrada,
   além de lista e conteúdo da conversa.
3. Tratar o frame `whatsapp.inbox.changed` como sinal organizacional sem
   identificador de mensagem. Correlacionar a amostra pelo conteúdo na API e no
   DOM e executar com clone exclusivo; não atribuir um frame específico à
   mensagem quando houver outra atividade no tópico.
4. Não permitir `E2E_SKIP_WEB_SERVER=true` com o opt-in do worker sem uma
   comprovação independente de que o servidor externo iniciou o worker.
5. Tornar a limpeza da fixture tolerante a falha de uma etapa, para que um erro
   em `page.close()` ou em um `DELETE` não deixe as demais linhas sintéticas.
6. Usar saída de build isolada e íntegra na próxima tentativa. O cache
   `.next-e2e` contém `routes.d.ts` gerado incompleto e o log anterior registra
   filesystem lento; isso ainda não isola a causa exata dos 600 s em `/login`.

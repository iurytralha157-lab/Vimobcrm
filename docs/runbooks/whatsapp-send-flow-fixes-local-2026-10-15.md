# WhatsApp: fechamento local dos seis pontos de envio e sincronização

Rodada autorizada no checkout principal `D:/Vimob/workspaces/vimob-crm`,
branch `main`, HEAD de partida `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
O checkout já continha alterações de outras tarefas. Os snapshots desta rodada
estão em `D:/Vimob/tmp/whatsapp-send-flow-fixes-20261015/`.

Sem deploy, push, migração remota, configuração do Evolution, replay de produção
ou envio real. A validação usa PostgreSQL descartável em loopback, provedor
`httptest` e interfaces com autenticação e transporte sintéticos.

## Mudanças

| Ponto | Comportamento corrigido | Implementação |
|---|---|---|
| 1. QR e conexão | Falha ou 404 ao consultar QR preserva a conexão conhecida. QR válido respeita conexão mais nova, logout, proprietário e tupla de evento. | `session_operations.go`, `session_observation.go` |
| 2. Consulta de status | CAS rejeitado devolve o estado atual autorizado. O navegador recarrega as capacidades autorizadas e reconcilia os caches de sessão; status conectado sozinho não concede envio. | `session_observation.go`, `use-whatsapp-sessions.ts`, `session-status-cache.ts` |
| 3. Controle adiado | Conexão e QR sem timestamp usam o horário de ingresso e a mesma ordenação dos eventos inline. Claim, tentativa, payload, organização, sessão e época são conferidos sob lock. | `webhook_session_control.go`, `webhook_native_processor.go` |
| 4. Escolha do número | Conversa compartilhada autorizada continua enviável e oferece iniciar pelo número próprio. A escolha cria/reutiliza outra conversa física. | `whatsapp-own-start.ts`, `ConversationsScreen.tsx`, `FloatingChat.tsx` |
| 5. Entrada desconectada | Pipeline/detalhe mantêm alvo e texto preparado enquanto exibem o link para conectar. O mobile libera Configurações sem apagar o contexto; reconexão retoma a abertura sem envio automático. | `FloatingChat.tsx`, `OwnWhatsAppStartNotice.tsx` |
| 6. Envios rápidos | Admissão em ordem por organização, ator, revisão de acesso, sessão e conversa substitui a rejeição local de um segundo. Espera fica visível; seleções sobrepostas do mesmo arquivo preservam a primeira intenção/legenda. Rotas independentes continuam avançando. | `use-whatsapp-conversations.ts`, `whatsapp-send-admission.ts` |

O envio continua preso à sessão física da conversa. Atendimento, vínculo atual,
permissões, idempotência e a outbox permanecem autoritativos no servidor.
Um resultado incerto continua sendo consultado pelo identificador original.

As classes aprovadas de cor, fonte e arredondamento foram preservadas. A ação
de início pelo próprio reaproveita a faixa existente de laranja a 50%, texto
de 11 px e o seletor de sessões existente. Primitivas e CSS global não fazem
parte desta correção.

## Evidência e limites

Interface: 10/10 casos de entrada/envio/resposta, 18/18 casos de escolha e
reconexão, 38/38 casos de regressão integrada e 31/31 casos leves aprovados.
Hooks: 33/33 casos novos, 71/71 casos anteriores e 10/10 casos puros aprovados
antes do último ajuste de estado reativo. A suíte nova passou a ter 34 casos,
incluindo StrictMode, e integra a rodada contínua final abaixo.
Três falhas foram reproduzidas nos snapshots anteriores;
o retorno 403 da organização original foi preservado após a regressão apontar
uma diferença no código de erro. O lint também reproduziu seis erros de leitura
de refs no render; o controle pendente passou a usar estado reativo, sem
desativar regras. Go: 128 testes principais, 247 incluindo subcasos, aprovados
em uma execução contínua no cluster limpo; os 52 casos registrados no gate
estão incluídos, sem falha, skip ou alteração dos fontes durante a execução.
A rodada contínua final dos 14 arquivos de runtime aprovou 338/338 casos,
incluindo os 34 casos novos de hooks após o ajuste reativo, sem skips,
cancelamentos ou mudança nos fontes. O conjunto Node aprovou 148/150 casos;
as duas falhas são os pins das migrações compartilhadas, mantidos intactos.
TypeScript global final aprovado, sem mudança nos fontes durante o check.
O lint global final não apontou problemas nos arquivos do WhatsApp. O comando
global terminou com um erro em `scripts/supabase/queue-editor-contract.mjs:19`
(`no-assign-module-variable`) e sete avisos em arquivos externos a esta rodada.
Esse trabalho de filas foi preservado, sem desativar regras ou editar sua fonte.

| Evidência final no diretório de artefatos | Resultado |
|---|---|
| `root/go-clean-proof.json` e `.jsonl` | 128 principais / 247 com subcasos, todos aprovados; inclui webhook core completo sem overlay |
| `root/registered-runtime-proof.json` e `.tap` | 338/338, 14 arquivos, sem skips ou cancelamentos |
| `root/typecheck-proof.json` | Aprovado no TypeScript final; posterior ajuste somente de fixture Go coberto pela rodada Go final |
| `root/node-proof.json` | 148 aprovados, 2 falhas dos pins compartilhados, zero skips/cancelamentos |
| `root/lint-proof.json` e `.log` | Somente 1 erro e 7 avisos externos ao WhatsApp |
| `root/final/proof.json` | União dos 28 caminhos, hashes, branch, HEAD, arquivos protegidos e encerramento do clone |

- `entry-send-receive.runtime.test.mjs`: botões e handlers extraídos do código
  real de Pipeline/detalhe, contexto e interfaces reais de balão/Conversas.
  Inclui envio explícito, alvo/sessão e resposta a partir do resultado da query,
  além do texto inicial preservado como rascunho. O layout completo da Pipeline
  e do detalhe não é montado por esta fixture.
- `send-entry-surfaces.runtime.test.mjs`: CSS e Radix reais, larguras 320,
  390 e 1440, escolha do número, cancelamento, reconexão e troca de contexto.
- `integrated-surfaces-mobile.runtime.test.mjs`: regressão visual e funcional
  das mídias, ações, pesquisa, carregamento e modal mobile.
- `whatsapp-send-admission.runtime.test.mjs`: hooks reais, React Query,
  anexos e armazenamento de intenções; transporte fechado e sintético.
- `session_observation_integration_test.go`: corridas com Evolution simulado,
  PostgreSQL real descartável e processamento nativo de recebimento.

Os artefatos distinguem RED do código anterior, falhas de preparação de fixture
e GREEN do candidato. Os primeiros diagnósticos de JSON da fixture e do mock
de `leadsAPI` foram corrigidos sem remover as asserções de comportamento.

Os testes de interface não comprovam entrega pela rede WhatsApp. A prova de
recebimento deve acompanhar ingresso, processamento e persistência canônica;
um HTTP 202 sozinho comprova apenas aceitação durável.
As larguras mobile são verificadas em Chromium automatizado. Safari físico,
teclado real, PWA instalada e rede móvel não foram verificados nesta rodada.

## Fronteira da publicação

Os arquivos das duas migrações compartilhadas de calendário/audiência e seus
pins na CI continuam fora das alterações desta rodada. O banco descartável
recebeu 77 migrações focais, recortes canônicos admitidos pelo bootstrap e uma
cópia imutável das duas definições compartilhadas para testar a autorização
atual. Também recebeu somente o CHECK canônico de papéis da migração
`20260804101153_secure_billing_payment_checkout_capabilities.sql`, preservando
o cenário de gerente no teste de compartilhamento. A admissão verificou
identidade, nonce e loopback; hashes dos originais permaneceram iguais.
A ausência inicial de `private.queue_pool_read_access` e do CHECK atualizado
fica registrada como preparação incompleta da fixture ampliada. Após corrigir
a ordem do cleanup legado, a bateria foi repetida em um cluster novo para
evitar resíduo das tentativas anteriores. Isso não é um reset completo do
Supabase nem uma execução do gate `all`.

O diagnóstico adicional de `TestNativeEvolutionWebhookCoreIntegration`
exigiu dois recortes canônicos de funções puras já referidas pela distribuição:
`private.management_distribution_source(text)` e
`private.management_campaign_match_values(jsonb,text)`. Somente essas
definições e grants foram instalados no clone, sem executar as migrações
completas, alterar produtores, regras ou configurações de distribuição.
O diagnóstico com overlay externo preservou as asserções e mostrou dois
leases da própria fixture ainda em `processing`: o processador interno havia
sido executado, mas os controles não tinham passado pela finalização do
worker. A fixture passou a chamar `markEvolutionWebhookProcessed` após cada
controle e a conferir estado processado e lease liberado. A barreira de ordem
do produto não foi relaxada. A rodada contínua final incluiu o teste completo
de webhook, sem overlay, e aprovou todos os 128 testes principais. Logs das
tentativas e do overlay foram retidos. O PostgreSQL descartável desta rodada
foi encerrado pelo helper canônico, com seus dados e artefatos preservados.

Os novos casos estão registrados nas listas do gate existente em
`scripts/tests/whatsapp-ci-contract.mjs`. Workflow e pins compartilhados
permanecem preservados; os gates continuam recusando casos pulados.

A publicação exige fechar o trabalho compartilhado e executar o gate completo
em um corte congelado. Permanecem duas verificações de hash recusadas:
`20261015022236_queue_operating_schedule_contract.sql` e
`20261015022536_queue_runtime_state_and_audience.sql`, cujos fontes e pins
nunca foram alterados nesta rodada. Também permanece o erro de lint externo
no script de contrato do editor de filas. Não foram transformados em skips.
A entrega real, os callbacks do Evolution, Realtime e
os quatro caminhos autenticados precisam de um canário autorizado no ambiente
publicado. Esta rodada não autoriza esse canário nem altera produção.

## Manutenção e reversão

Os arquivos legados grandes receberam mudanças localizadas para manter os
consumidores e o visual. A ordenação/admissão e a reconciliação de status foram
extraídas para helpers específicos; a divisão futura de composição, início e
conexão deve preservar as fixtures e ser uma tarefa própria.

O manifesto desta rodada reúne 28 caminhos: 13 fontes de produto, 13 arquivos
de teste, uma lista de registro da CI e este documento. Esse número descreve o
delta desta rodada, não todo o domínio WhatsApp nem todas as mudanças já
existentes no checkout. Snapshots e diffs por responsável preservam o ponto
anterior de cada arquivo; o manifesto final contém os hashes conferidos.

Uma reversão deve usar somente o inverso do delta desta rodada, conferindo os
hashes atuais contra os snapshots. Não restaurar arquivos inteiros pelo Git:
eles já continham trabalho anterior. Não há schema novo a reverter.

# WhatsApp: correções de interface e comportamento

> Complemento posterior: [correções finais da revisão de 12/10](whatsapp-audit-closure-2026-10-12.md).
> Preserve os resultados históricos abaixo; a validação atual está no complemento.

## Escopo

Continuação da [preparação local](whatsapp-local-release-2026-10-11.md), no
checkout principal `D:\Vimob\workspaces\vimob-crm`, base
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. O baseline deste complemento
continha 508 entradas de status, incluindo as correções da preparação anterior.
Snapshots anteriores a cada frente e logs ficam em
`D:\Vimob\tmp\whatsapp-ui-hardening-20261011`.

Este complemento inclui página de conversas, balões, chat flutuante, gravador,
mídia, falhas, QR, filtros, destino do push e os contratos de envio/leitura.
Não executa publicação, migration remota, envio real, replay de produção ou
alteração de flags. Os resultados antigos do outro roteiro não substituem a
validação das novas fontes.

## Matriz de correções

| Problema | Comportamento corrigido | Evidência de regressão |
| --- | --- | --- |
| Gravação de A reutilizada em B | Áudio, aquisição do microfone e tentativa têm contexto imutável e geração; trocar contexto encerra e limpa | `media-ui-runtime.test.mjs` |
| Timeout seguido de áudio duplicado | Mantém a intenção original; bloqueia reenvio e permite consultar seu estado canônico | `use-whatsapp-send-intent.runtime.test.mjs`, `whatsapp-send-intent.test.ts`, Go `GetSendStatus` |
| Permissão tardia/concurrente deixa microfone ativo | Uma aquisição por vez; tracks tardios ou de constructor inválido são encerrados, inclusive no unmount | `media-ui-runtime.test.mjs` |
| Gravador some ao digitar ou aguardar POST | Componente permanece montado; gravação e edição de texto têm controles coordenados | `whatsapp-ui-hardening.runtime.test.mjs` |
| Conversas mobile sem áudio | Mesmo gravador e contrato de envio no compositor mobile | `whatsapp-ui-hardening.runtime.test.mjs` |
| Respostas/prefill/feedback aplicados à conversa errada | Intents monotônicos, rascunhos por tenant/conversa/lead e guards após cada await; sem envio automático | `whatsapp-ui-hardening.runtime.test.mjs` |
| A→B→A revive operação antiga | Geração monotônica em seleção, overlays, preparação de envio, gravador e QR | Testes React de interface, mídia e envio |
| Mutation passa a usar outro tenant durante cancelamento do cache | Snapshot síncrono no gesto; revalidação antes do POST; completion usa só o cache original | `use-whatsapp-send-intent.runtime.test.mjs` |
| Marcação automática cancela a lista em ciclo | Funções mutate/mutateAsync estáveis; opções atuais capturadas no novo gesto e antigas preservadas no gesto pendente | RED do E2E com tempestade real; React com efeito de leitura; E2E com contador durável/POST bounded e estabilidade em idle |
| Token renovado troca o autor de uma ação antiga | API WhatsApp fixa ator antes de resolver autenticação; valida antes de cada HTTP e após 401; criar sessão também protegido | VM do cliente, API real com auth/fetch sintéticos e React |
| Reação captura outro atendimento depois de cancelQueries | Snapshot no gesto, guards antes/depois do cancelamento e cache somente no contexto original | Runtime do hook com troca, ABA e respostas tardias |
| Troca de contexto durante autenticação permite POST tardio | Abort antes de HTTP termina sem efeito; abort após HTTP preserva estado incerto e não libera reenvio | Runtime send/start/reaction e API |
| Ações de conexão/compartilhamento continuam após troca | Intenção capturada antes de onMutate; QR/status serializados por ator; callbacks não reaplicam em outro contexto | Runtime de mutações WhatsApp |
| Consumidor desmontado ainda inicia envio atrasado | Unmount invalida a geração antes do POST; consulta de intenção é abortada e não aplica resultado antigo | Runtime do hook de envio |
| Segunda organização libera atendimento indevido | Operações exigem organização original no Go e cliente; histórico autorizado permanece somente leitura | Go/PostgreSQL e React |
| Telefone corrigido reabre rota do número antigo | Lookup pelo telefone confere identidade física; troca exige consentimento e snapshots exatos | Go/PostgreSQL, Zod e React |
| Novo número já possui histórico sem lead | Dono da sessão vê prévia sem conteúdo e confirma as duas ações; aposentadoria e vínculo são atômicos | Go/PostgreSQL e React do fluxo composto |
| Abertura compartilhada exige indevidamente ser dono | Lead atribuído e grant efetivo permitem abrir a rota; contatos sem lead continuam privados | Go/PostgreSQL e React |
| GC apaga anexo capturado de rota aposentada | Claim e rechecagem reconhecem histórico protegido, inclusive sem ledger de importação | PostgreSQL com RED/GREEN, sem DELETE no Storage |
| Modais mantêm dados após tenant/permissão mudar | Ocultação imediata, reset e geração de requisições para criar/verificar/excluir | `whatsapp-ui-hardening.runtime.test.mjs` |
| PendingReply diverge do servidor/unread | Cliente usa filtro autoritativo; resposta exige outbound confirmado do mesmo lead e desempate canônico | Testes do modelo e Go/PostgreSQL |
| Legenda some em imagem/vídeo ou falha | Texto da legenda permanece fora do renderer de mídia | `media-ui-runtime.test.mjs`, testes puros de balão |
| Nome de documento perdido | Whitelist privada persiste basename; DTO explícito e renderer/download usam `media_filename` | Parser Go/Edge, DTO SQL, React |
| Leitor de histórico não consegue renovar mídia | GET autorizado independente de permissão de operar; renovação com TTL/Abort/geração e sem loop | `media-ui-runtime.test.mjs` |
| Retry repete URL vencida | URL renovada por GET; recuperação no provedor por POST permanece ação distinta | Testes de mídia e hook de URL |
| Download com erro vira falsa abertura | HTTP negado/erro não tem fallback; abort, prazo e tamanho limitados; cancelamento explícito | `message-download.test.mts`, React |
| Falha de áudio antiga marca player novo | Catch e estado usam identidade/generation da fonte atual | `media-ui-runtime.test.mjs` |
| Histórico salta ao fim durante leitura | Autoscroll condicionado à posição/primeira carga; chegada pode anunciar sem deslocar leitura | `media-ui-runtime.test.mjs` |
| Abertura pela notificação ou resize esconde a última mensagem | Posição aplicada ao DOM já montado, sem timer cancelável; resize inclusive no mesmo breakpoint restaura mensagem e offset de quem lê histórico | Seis regressões de scroll com Radix real, RED/GREEN e E2E sem rolagem manual |
| Painel do lead fica transparente enquanto carrega | Estado de carregamento usa a mesma superfície sólida dos estados carregado/erro | E2E segura o GET real, verifica superfície em 900px, captura e libera para conferir o painel carregado |
| Clique de push abre rota inexistente/lista genérica | Novo produtor aponta conversa+lead; app/native/SW resolvem também links legados seguros | SQL de push, Node/SW e E2E de navegação |
| QR antigo altera nova sessão ou recria instância | Poll serial, cancelamento/retry limitado e geração; erro genérico não recria instância | `whatsapp-ui-hardening.runtime.test.mjs` |
| Sessão excluída deixa envio pendente eterno | Cancelamento definitivo e bounded antes de claim; desconexão temporária permanece recuperável | Go/PostgreSQL |
| Storage falha eternamente sem consumir orçamento | Preparação tem orçamento próprio de seis; permanente termina antes do provedor | Go/PostgreSQL + HTTP fake |
| 2xx sem ACK inventa sucesso | ACK exige ID reconhecido ou confirmação booleana específica; ambíguo vira unknown terminal sem retry | Provedor fake; não comprova versão real |
| Texto ultrapassa mídia da mesma conversa | Início no provedor serializado entre lanes por conversa; conversas diferentes mantêm paralelismo | Go/PostgreSQL com concorrência real |
| Toast de queued diz enviado | Informa entrada na fila; ticks representam confirmação posterior | Modelo/UI |
| Falha não permite recuperação segura | Copiar/recuperar texto explicitamente, abrir lead para corrigir telefone, consultar unknown, descartar somente otimista local definitivamente falho | React/QueryClient e balões |
| Número sem WhatsApp | Motivo definitivo preservado no DTO/bolha; orientação para revisar telefone, sem retry cego | Provedor fake e React |
| Contatos/localização sem apresentação útil | Campos finitos e limitados; telefone de vCard só para exibição; mapa apenas em gesto do usuário | Go/Edge parser + DTO + React |
| Respostas citadas ausentes ou importam texto anterior | Guarda só referência provider; resolve target capturado/autorizado do mesmo lead; indisponível não contém corpo/nome | Go/PostgreSQL, Zod e React |
| Responder/reagir a envio ainda pendente | UI restringe; servidor e worker conferem alvo confirmado e revalidam dentro do marcador de início | Go/PostgreSQL e React |
| Tags com permissão errada | Ação depende de `lead_operate`; histórico pode continuar somente leitura | Modelo/UI |
| Mensagens/reactions difíceis de acessar | Log com anúncio de adições, nomes acessíveis, ações por teclado e alternativas em toque | React e inspeção visual |
| Balão áudio/lateral não cabem em tela estreita | Player e conteúdo podem encolher; painel não ocupa simultaneamente espaço fixo em viewport intermediário | React e E2E 1440/900/390 |

## Contratos novos

`GET /v1/whatsapp/conversations/{id}/send-status` recebe `expectedLeadId`
e `clientMessageId`. Revalida usuário, organização, sessão, conversa e lead;
retorna somente a tentativa exata persistida. `404 whatsapp_message_not_found`
significa ausência de observação, nunca autorização para reenviar. `outcome_unknown`
continua bloqueado. Estados queued/sending/confirmados significam intenção
persistida; falhas definitivas permitem recuperação explícita.

`expectedUserId`, `signal` e `onRequestStart` são opções privadas do transporte,
fora de body/query. Os 51 métodos da API WhatsApp fixam o ator no início da
chamada; mutações também capturam a intenção sincronamente no gesto, antes do
`onMutate` assíncrono. As funções de ação permanecem estáveis entre renders;
status pending/success e notificações do cache não repetem efeitos de leitura. O cliente verifica identidade antes de cada HTTP e depois
de renovar autenticação por 401. Sem esta opção, o comportamento genérico dos
outros domínios permanece igual. Cancelamento anterior ao HTTP produz conflito
local sem efeito; depois do HTTP, send/reaction permanecem incertos até a
reconciliação. Renovação de token do mesmo usuário continua permitida. O aviso de desconexão
também encaminha esta opção privada pelo NotificationService até dispatch; os
outros callers mantêm o comportamento anterior quando não a fornecem.

`quotedMessageId` é UUID canônico, não corpo ou chave fornecidos pelo browser.
Servidor resolve o alvo capturado e monta `quoted.messageId/participant` do
contrato oficial Evolution Go; o worker repete a conferência antes de iniciar.
Não transmite texto/nome da citação ao provedor. Recebimento guarda só a
referência; a leitura resolve o trecho dentro do mesmo lead imutável.

Metadados de apresentação são privados: `media_filename`, `message_contacts`,
`message_location`, `quoted_message_id`. Go e Edge escrevem a mesma whitelist;
DTO público não expõe raw/vCard/private metadata. Sem vínculo ou alvo elegível,
uma citação fica indisponível. Retenção expirada remove o metadata inteiro.

Não se promete ordem de entrega no telefone: a fila ordena o início das chamadas
por conversa. Preparação permanente termina sem tentativa de envio; um resultado
ambíguo nunca é reenviado automaticamente. Recibos/echo continuam sujeitos à
prova de identidade e reconciliação existentes.

O atendimento WhatsApp fica restrito à organização original do cadastro,
inclusive para usuários com vínculo ativo em uma segunda organização. Isso não
altera as regras gerais de acesso a leads do CRM nem amplia a leitura de histórico.

Corrigir `lead.phone` não altera o JID de uma conversa existente. O Start devolve
`409 whatsapp_phone_change_confirmation_required` com referências autorizadas.
Após consentimento, `confirmPhoneChange` exige o lead e sessão atuais e o UUID da
conversa anterior. A rota antiga recebe `retired_at`, perde somente o vínculo
operacional `conversation.lead_id` e fecha seu ledger; mensagens capturadas,
histórico e vínculos fechados preservam o lead imutável. O índice original e B1
permanecem intactos. Nenhum atendimento é iniciado automaticamente.
Push ainda pendente da rota de telefone aposentada é cancelado antes do início
do provedor; notificações já emitidas podem abrir seu histórico somente leitura.
Isso não altera o redirecionamento de aviso pendente na transferência de
responsável dentro do mesmo lead.

Se o número novo possui uma conversa sem lead, somente o dono da sessão pode
obter a referência e a prévia de quantidade/período/expiração. O gesto confirmado
inclui `confirmDestinationHistory` e `expectedDestinationConversationId` junto
do snapshot antigo. O servidor aposenta P1 e confirma o histórico de P2 no mesmo
TX. Destino rebinding/expirado/de outro lead aborta sem aposentadoria parcial.
Envio iniciado/aceito ou trabalho legado em andamento também bloqueia a troca.
As sete famílias de trabalho durável são travadas e ações antigas ainda não
iniciadas são canceladas; não há chamada ao provedor dentro da transação.

## Reproduzir localmente

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/whatsapp-send-intent.test.ts lib/notification-routing.test.ts lib/validation/whatsapp.test.ts scripts/tests/pwa-push-service-worker.test.mjs
node --experimental-strip-types --test supabase/functions/evolution-go-webhook/*.node.test.mjs
node --test lib/api/vimob-client.test.mjs lib/api/whatsapp-phone-conflict-boundary.test.mjs
node --test hooks/use-whatsapp-send-intent.runtime.test.mjs
node --test hooks/use-whatsapp-session-intent.runtime.test.mjs
node --test hooks/use-whatsapp-messages-paginated.race.test.mjs
node --test components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs
node --test components/features/whatsapp/media-ui-runtime.test.mjs
npm run typecheck
npm run lint
npm run audit:check
node scripts/supabase/verify-migrations.mjs
node scripts/supabase/verify-edge-functions.mjs
```

Os testes runtime usam os componentes/hooks reais em React/Chromium com APIs e
microfone sintéticos e rede bloqueada. Rodar os bundlers sequencialmente.
Os testes de scroll usam viewport real do Radix. Leitura antiga é posicionada
explicitamente para verificar a âncora; os asserts de abertura/follow não fazem
rolagem manual. O observador verifica contexto, viewport atual e conexão ao DOM
e desconecta na troca/desmontagem. Crescimento tardio apenas do conteúdo de
mídia/fontes, mantendo as dimensões da viewport, não foi verificado nesta rodada.
As integrações Go exigem opt-in de escrita, label exata do container, banco
`vimob_whatsapp_clone` e loopback `127.0.0.1:57922`; não usar DSN de produção.
SQL retorna ROLLBACK e fixtures Go limpam seus IDs. Não usar `db push`.

## Publicação e limites

Migrations adicionais:
`20261011222810_whatsapp_inbound_notification_conversation_target.sql`,
`20261011225605_whatsapp_binding_preserve_accepted_finalization.sql`,
`20261011232826_whatsapp_confirmed_phone_route_retirement.sql` e
`20261011235132_whatsapp_retired_captured_media_gc_fence.sql`.
A quinta atualiza apenas o produtor de links futuros, com hash do corpo esperado e
idempotência; não reescreve notificações antigas, grants ou entregas. O app/SW
mantêm compatibilidade com o destino antigo. A segunda preserva a reconciliação
de um ACK aceito antes de trocar o binding. A terceira cria helper privado,
executável somente pelo serviço, usado no mesmo TX da troca confirmada.
São a quinta, sexta, sétima e oitava migrations locais de 11/10 deste pacote. A
oitava preserva referências de mídia no claim e na rechecagem do GC quando o
histórico capturado continua protegido depois da aposentadoria. Usa hashes do
corpo normalizado esperado, aborta drift e mantém os grants originais. As quatro
anteriores e A2/B1/B2 continuam pré-requisitos. Uma experiência de índice feita
somente no clone vazio foi retirada; o índice original foi restaurado e seu hash
conferido. Nenhum arquivo SQL histórico foi reescrito por este complemento.

Antes de publicar: confirmar schema/ledger e permissões do alvo, verificar
compatibilidade/versionamento do Evolution Go, atualizar todos os workers Go
com estas fontes antes do Web, incluir o Edge e a migration nova no pacote,
validar reversão e selecionar as alterações preexistentes para a release.
Não testar coexistência de workers antigos como se respeitassem o novo FIFO.

O clone é schema local com fixtures sintéticas, não cópia fiel de produção nem
reset integral da cadeia. Push com PWA realmente fechada em Android/iOS,
microfone físico, reprodução/recebimento no telefone, versão real do provedor e
carga de 5–6 mil usuários continuam exigindo piloto. A autorização para obter
uma nova URL de mídia é revalidada; URLs assinadas já emitidas têm validade
configurada de 900 segundos no Storage. Limpar o cache não revoga arquivos
já recebidos pelo cliente. Não houve recuperação dos
17 predecessores/10 pendentes de produção nesta etapa local.

## Resultado da rodada final

Fechamento em 12/10/2026, no checkout principal, sem publicação ou alteração em
produção. O atendimento continua restrito à organização original do cadastro,
conforme a decisão confirmada pelo usuário.

| Gate | Resultado comprovado |
| --- | --- |
| Next.js/Webpack | PASS; compilação 5,2 min, tipos 40 s, 85 páginas geradas |
| Typecheck | PASS com a fonte final, incluindo o E2E corrigido |
| ESLint | Aplicação completa e teste final sem erros/avisos |
| Auditorias de inventário | 4/4 PASS; dívida visual existente permanece 147 achados em 48 arquivos |
| Interface React/Chromium | 40/40, zero skips e erros do browser; seis regressões de scroll com Radix real |
| Mídia React/Chromium | 22/22, zero skips/erros do browser |
| Intenção de envio/reação/leitura | 26/26; mutações de sessão/acesso 32/32; paginação 16/16 |
| Cliente/API/aviso de desconexão | 19/19, incluindo troca de ator antes do HTTP e após renovação |
| Go | Quatro pacotes PASS; 105 skips SQL opcionais na execução sem DSN. Integração local separada: 20 casos principais/49 eventos PASS, zero skips; regressão durável legada PASS |
| PostgreSQL | 14 arquivos, 481 assertions PASS, zero skips, todos ROLLBACK |
| Edge e contratos | 54/54 do parser, Deno check PASS, OpenAPI parse PASS; source lock 190; manifest Edge 42 ativos/25 tombstones/15 retirados |
| E2E final | 4/4 PASS em 49,1 s, zero skips; API Go/PostgreSQL/Auth/Realtime/Storage locais reais, callbacks sintéticos |
| Inspeção visual | 1440/900/390 px; última mensagem dentro da viewport sem scroll manual; loading opaco e painel carregado conferidos; fechar painel em 900 px preserva leitura e permite hit-test da mensagem |
| Integridade | 3.437 entradas de código/config/migrations e 1.910 fontes JS/TS UTF-8 verificadas; 207 verificações de hash dos manifestos independentes conferem |
| Limpeza | 40 tabelas de efeitos/fixtures com contagem zero; Go/Next e cinco serviços próprios encerrados; PostgreSQL tmpfs preservado saudável |

O build da aplicação não mudou após passar. As correções posteriores foram
somente no arquivo de E2E: bloquear o GET de `conversation-detail`, aguardar o
handler antes de remover a rota, conferir o fechamento do painel e observar a
inscrição atual por socket/topic/join reference com o decoder do SDK instalado.
Tipagem/lint foram repetidos para essa fonte e o E2E final executou contra o
mesmo build. `test-only-post-build-correction.json` registra a única diferença.
Os limites de 20 s para inscrição, 65 s para observar cada amostra, p95 local
de 15 s e máximo de 60 s para POST→DOM foram mantidos. Polling não conta como
prova de Realtime. A rodada final observou 44 frames de texto e zero binários;
não há prova de que formato binário causou o RED anterior.

Na amostra local de cinco mensagens por tipo, POST→DOM teve p95 de **1.373 ms
para lead** e **857 ms sem lead**. São medições sintéticas locais, sem envio ao
provedor, não um SLA de produção. Houve 14 POSTs de marcação de leitura na
rodada, com limite por amostra, contador durável zerado e estabilidade em idle.
Um envelope único produziu três mensagens/eventos processados, com ordem
preservada no histórico, na atualização e após reload.

Um teste interrompido deixou uma sessão/lead sintéticos. Foram identificados
pelo sufixo e IDs do log salvo, conferidos os 16 IDs de mensagens e removidos
apenas esses registros no clone antes da limpeza canônica. Uma tentativa de
limpeza canônica sofreu timeout e fez ROLLBACK; a repetição diagnóstica passou
sem ampliar o timeout ou os predicados. Nenhum dado de produção foi apagado.

O checkout permanece com alterações preexistentes: baseline deste complemento
508 entradas, fechamento 609, nenhum caminho do baseline removido e HEAD
inalterado. O fingerprint não constitui seleção de release nem validação
funcional de todos os outros domínios.

Evidências finais em `D:\Vimob\tmp\whatsapp-ui-hardening-20261011`:
`e2e-interface-final.json`, `e2e-inbox-lifecycle-final.log`,
`final-source-input-fingerprint.json`, `independent-source-hashes-final.json`,
`test-only-post-build-correction.json` e `baseline-preservation-final.json`.
Limpeza: `D:\Vimob\tmp\whatsapp-local-20261011\standalone-e2e\final-e2e-cleanup.json`.

Capturas inspecionadas: [desktop 1440](D:/Vimob/tmp/whatsapp-ui-hardening-20261011/visual-final/whatsapp-conversation-1440.png),
[painel 900](D:/Vimob/tmp/whatsapp-ui-hardening-20261011/visual-final/whatsapp-conversation-900.png),
[conversa 900 com painel fechado](D:/Vimob/tmp/whatsapp-ui-hardening-20261011/visual-final/whatsapp-conversation-900-panel-closed.png),
[mobile 390](D:/Vimob/tmp/whatsapp-ui-hardening-20261011/visual-final/whatsapp-conversation-390.png) e
[carregamento 900](D:/Vimob/tmp/whatsapp-ui-hardening-20261011/visual-final/whatsapp-lead-loading-900.png).

O pacote local está validado nestes limites. Publicação, piloto com o número
pessoal/compartilhado e o provedor real, push com PWA fechada, dispositivos
físicos e recuperação do backlog existente em produção continuam pendentes.

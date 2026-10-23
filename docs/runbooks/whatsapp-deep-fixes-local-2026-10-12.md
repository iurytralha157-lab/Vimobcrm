# WhatsApp: correções da nova revisão detalhada, somente local

Checkout principal: `D:\Vimob\workspaces\vimob-crm`, branch `main`, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Esta rodada sucede o
[fechamento anterior](whatsapp-audit-closure-2026-10-12.md). A revisão posterior
encontrou os problemas abaixo; o fechamento anterior não é prova deles.

Estado da rodada anterior em 12/10: correções dos problemas identificados, revisões independentes,
compilação e E2E local concluídos. Não ficou novo P1/P2 demonstrável aberto nos
caminhos revistos; os limites e gates externos abaixo permanecem. Todas as mudanças estão no checkout
principal, sobre as alterações locais preexistentes. Não houve publicação,
push, migração remota, replay, descarte do backlog ou envio ao provedor real.

## Rodada adicional da última auditoria (12/10)

Estado atual: ajustes implementados no checkout principal; **validação de banco
ainda pendente**. Não tratar os resultados históricos abaixo como aprovação dos
novos ajustes. HEAD permanece `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`;
as alterações preexistentes e a fila foram preservadas. Produção não foi acessada.

| Área da auditoria final | Ajuste preparado |
| --- | --- |
| P1: LID físico com PN persistido contraditório | A captura compara telefone e aliases persistidos na organização, sessão e conversa exatas. Go reverte somente a tentativa conflitante ao SAVEPOINT; Edge propaga conflito PN para evidência técnica com lease válido e continua o irmão válido. Guards finais preservam histórico e OLD em UPDATE/UPSERT. A migration `20261012223733` ainda não foi aplicada. |
| Locks, exclusão e recibo | Send/Grant e cercas compartilhadas começam pelos atores antes dos recursos. Exclusão exige propriedade ou concessão operacional e responsabilidade atual. Recibo externo conserva proprietário como ator, revalidado antes do início, com HTTP fora dos locks. As provas de transações concorrentes permanecem pendentes. |
| Anexo HTTP 200 já falho ou incerto | Página, chat flutuante e histórico do lead classificam a mensagem canônica do CID/conversa. Falha conclusiva informa arquivo não enviado; resultado desconhecido preserva citação e pede verificação. Somente aceite canônico informa fila. Input é limpo também quando a seleção apenas consultou o CID original. |
| Histórico unificado do lead | Usa resposta lateral do balão existente, citação no compositor, verificação pelo CID dedicado e recuperação/descarte somente onde permitidos. Leitura, capacidades atuais, organização original e geração cancelam gestos antigos; reação também revalida após entrada no atendimento. A troca de conversa física dentro do mesmo lead cancela efeitos tardios e preserva o rascunho/busy da nova conversa; a transição legítima de conversa ausente para a preparada continua permitida. Enter durante composição IME não envia. |
| Push por conta e SID | Dispositivo pertence ao usuário; organização do registro vira metadado nullable, com FK SET NULL e exclusão dessa tabela do purge organizacional. Membership atual da organização do aviso é revalidada antes do início. Protocolo `push_device_v3` preserva `wa_push_v2` e reserva entrega entre organizações apenas para worker compatível. Web opt-out e listagem seguem a conta. Intenções e transporte exigem o SID original, permitindo refresh do mesmo SID. Migration `20261012223833` ainda não aplicada. |
| Exclusividade do endpoint push | Registro e troca de proprietário usam uma transação, lock do endpoint físico, sessão confiável revalidada e índice único de endpoint ativo. Cleanup de um SID antigo não desativa o registro de outro SID. Duplicidades preexistentes fazem a migration `20261012232821` falhar com contagem, sem escolher silenciosamente um proprietário. Ainda não aplicada. |
| Recibos mistos no Edge | Todos os IDs conhecidos são processados antes do retry limitado dos desconhecidos. Atualização monotônica e reducer de recibos de notificação existente foram preservados. |
| Realtime e sessão revogada | Política restritiva WhatsApp adiciona a cerca de sessão ativa ao gate atual de leitura. Exige helper da migration `20261012201751`; `20261012221828` ainda não aplicada. Protege join/reautorização, sem prometer expulsar instantaneamente socket já autorizado. |
| Prévia de áudio | Contexto, elemento e geração cercam a rejeição tardia de play. Cleanup em layout depende também do contexto e pausa a prévia anterior, inclusive quando o play já resolveu e a URL anterior ainda está no estado. |

Evidências desta rodada: `D:\Vimob\tmp\whatsapp-final-adjustments-20261012`.
Baselines próprios foram guardados antes das alterações, e falhas de fixture ou
infraestrutura não contam como RED de produto. Resultados confirmados até aqui:

- Interface React/Chromium: **80/80 PASS**, zero skips/page errors. Seis casos
  de anexo e resposta do histórico reproduziram **7 falhas reais + 1 controle
  positivo** no baseline. Os handlers reais do histórico passaram em **20/20**
  casos em RAM: reação teve **4 RED + 1 controle positivo** e troca de rota
  física teve **5 RED + 3 controles positivos**. IME no histórico teve um RED
  real seguido de GREEN em Chromium; Enter normal permanece como controle.
- Feedback real dos handlers de arquivo: **16/16 PASS**, após **11 RED + 5
  controles positivos**; helpers de CID/arquivo: **16/16 PASS**, zero skips.
- Push Native/Web: **20/20 PASS**; sessão/transporte: **14/14**, controles do
  cliente: **12/12**; mídia React/Chromium: **33/33** e layout/play reais em RAM
  **5/5**. O último caso teve RED de asserção em RAM e GREEN em Chromium;
  timeout do baseline Chromium foi registrado como infraestrutura, não RED.
- Edge: **33/33 PASS** em RAM, zero skips; módulo de identidade passou no
  typecheck estrito. Esses resultados não são prova de efeitos em PostgreSQL.
- Go nas quatro áreas alteradas (WhatsApp, leads, settings e admin): **2.127
  resultados PASS**, zero falhas e **249 integrações opcionais SKIP**, sem DSN.
  Compilação desses pacotes passou; SKIP não aprova os novos casos de banco.
- TypeScript focado das três superfícies e dependências: **PASS**, após corrigir
  17 erros transitivos em dois arquivos de pipeline. O comportamento conjunto
  passou em **24/24** casos React/QueryClient e **38/38** de cache/status/query.
  Lint das superfícies de conversa/histórico, helper de intenção e seus testes
  conferidos pelo ROOT passou sem avisos. A última repetição de lint da mídia
  ficou incompleta no bootstrap; o PASS anterior não inclui a última linha.
  O typecheck global iniciado
  nesta rodada não terminou e foi cancelado; o build histórico abaixo não
  aprova automaticamente as fontes atuais. A repetição focada após a última
  dependência de cleanup de áudio também travou no bootstrap e foi cancelada;
  ela é incompleta e não substitui o PASS focado anterior.
  A conferência final também identificou alterações concorrentes posteriores
  em `hooks/use-deal-status-change.ts` e no seu teste runtime de pipeline;
  foram preservadas. Os resultados de compilação e pipeline acima pertencem
  ao snapshot anterior, e precisam ser repetidos sobre a seleção final.
- Inventários de fontes: source lock **210 migrations** e manifest Edge
  **41 live / 26 tombstones / 15 retired PASS**. Foram atualizadas somente
  entradas de fonte das migrations próprias e `evolution-go-webhook`;
  hashes `_shared`, outros domínios e metadados de deployment foram preservados.

Manifesto consolidado: `verification/final-local-evidence.json`, na pasta de
evidências desta rodada. Foram conferidos 64 arquivos do pacote e os 3.842
arquivos do baseline continuam presentes; o HEAD não mudou. Isso prova
presença e hashes em um instante, não autoria de alterações concorrentes nem
que o checkout completo esteja pronto para publicação.

O clone verificado é somente local: container `vimob-wa-test-ready-20261011`,
label `vimob.test=whatsapp-20261011`, sem mounts, tmpfs e porta
`127.0.0.1:57922`, banco `vimob_whatsapp_clone`. Nesta rodada ele não completou
conexão/exec, sem executar SQL nem criar fixtures. WSL também falhou com
`WSAETIMEDOUT`; a parada restrita ao clone terminou com erro porque o daemon
não recebeu evento de saída. Consultas de inventário retornaram 502. Reinício geral do Docker
local depende de autorização por interromper outros containers locais. Depois
da recuperação, executar RED P1 com baseline, aplicar as quatro migrations apenas
no clone, GREEN/ACL/RLS, concorrência de Send/Grant/UsersDelete e push, e exclusão
organizacional pelo caminho Go. Reconstrução usa dumps locais de esquema, sem
dados reais, e lista explícita de migrations/cutovers; não aplicar tudo cegamente.

As quatro migrations preparadas são `20261012221828`, `20261012223733`,
`20261012223833` e `20261012232821`. A primeira depende do helper de sessão ativa
em `20261012201751`; a terceira precede a quarta. Nenhuma foi aplicada nesta
rodada. O índice único de endpoint exige interromper e drenar escritores
antigos antes da migration. Entre duas sessões ainda válidas, a API preserva o
último commit autorizado; não há prova de ordenação pelo gesto mais recente do
sistema operacional. Detalhes: [runbook do dispositivo por conta](push-device-account-scope-2026-10-12.md).

Continuam separados: typecheck global/build final, geração de tipos
pelo clone, pacote de release revisado, ensaio fiel ao banco de destino e piloto
com provedor/push real. Operação e clique WhatsApp exigem a organização original;
troca automática de organização no clique e mudança do fluxo Native de
reativação não foram implementadas nesta rodada. Permissão do OS, microfone real,
entrega com PWA fechada e carga de produção não foram comprovados pelos mocks.

## P1 — corrigidos primeiro

| Problema | Comportamento corrigido e prova |
| --- | --- |
| Revogação de operação entre enqueue e primeiro envio | O worker consulta a autorização efetiva atual e trava ator, vínculo, papéis e recursos antes de marcar o início. Revogação de `whatsapp_operate`/`whatsapp_manage` efetiva impede o primeiro HTTP. Trabalho já aceito ou com resultado incerto conserva sua proteção contra reenvio. Testes reais de transações incluem proprietário e WhatsApp compartilhado. |
| Perda de leitura durante a assinatura de mídia | Mensagem capturada, lead imutável, caminho e autorização são consultados novamente após o I/O. GET, retry, enqueue, hidratação em lote e respostas idempotentes não emitem nova URL com autorização perdida nesse intervalo. I/O fica fora dos locks; hidratação tem no máximo seis assinaturas simultâneas e quatro consultas de autorização por lote. Leitura autorizada em organização secundária permanece. |
| Identidade PN contraditória | Contradição entre referências explícitas de telefone do contato é colocada em quarentena antes de congelar uma rota. Um LID opaco não autoriza escolher um PN físico diferente. Número internacional explícito não é reinterpretado como um telefone brasileiro semelhante. Captura SQL compara todos os aliases de entrada com a rota escolhida. Callbacks válidos do mesmo lote continuam; entrada bruta durável e idempotência permanecem. |
| Falha de projeção depois da admissão | Perder membership durante a assinatura podia devolver 403 depois do commit e do ACK aceito, induzindo a interface a liberar outro CID. Nos ramos normal e idempotente, erro de projeção depois de commit agora retorna `200 confirming` com CID/conversa, sem mensagem, URL ou conteúdo. Rejeição antes da admissão continua sendo erro real. RED reproduziu ambos; GREEN preservou uma mensagem, um outbox e o ACK, com finalização sem novo HTTP. Reação e GET canônico não foram alterados. |

A quarentena por rota selecionada também foi exercitada em Go nativo e Edge.
Metadados privados fornecidos pelo provedor são removidos; os IDs confiáveis são
construídos pelo servidor e confirmados no ledger. Edge só lê esses IDs por RPC
`service_role`, com organização, sessão e lease ativo exatos. Anônimo e usuário
autenticado recebem 42501; organização errada e lease antigo não obtêm IDs.

## P2 e P3 — demais correções

| Problema | Comportamento resultante |
| --- | --- |
| Marcar lida/arquivar após transferência ou revogação | A mutação revalida acesso, organização original, responsável, concessão de leitura e binding dentro da transação. Administrador com leitura de histórico, mas sem acesso operacional ao número, continua somente leitura. |
| Reply/reação dependiam de editar metadados do lead | As capacidades usam `whatsapp_operate` e autorização da mensagem capturada; `lead_operate` deixa de bloquear uma resposta/reação válida. Edição do lead conserva sua autorização própria. |
| Arquivo com resposta ambígua gerava nova intenção | No mesmo runtime da página, o arquivo original é identificado por seus bytes e metadados, junto de conversa, lead e sessão. A intenção incerta conserva seu CID. Selecionar novamente consulta o CID original; não envia os bytes outra vez. Só resolução canônica exata aceita ou falha definitiva libera uma nova escolha deliberada. Ausência de mensagem ou falha sem código conclusivo permanece pendente. |
| Cache recriado esquecia CID incerto | O registro de intenções não pertence mais ao `QueryClient`, que muda quando permissões são renovadas. O acesso ao registro exige contexto atual e se isola por ator/organização. Revisão de permissão não perde o CID; a consulta usa autorização atual do servidor. |
| Balão local em confirmação sem código de erro | `confirming`/`unconfirmed`, mesmo sem `delivery_error_code`, mostra verificação e cópia. Não oferece recuperação, descarte ou reenvio como se fosse falha conclusiva. |
| Responder embaixo do balão | Conforme o ajuste solicitado durante a rodada, a resposta citada agora usa ícone circular na lateral, junto da reação, com o mesmo estilo discreto. Incoming fica à direita e outgoing à esquerda. Rótulo acessível, tooltip e teclado permanecem; os estados e callbacks que autorizam citação continuam os mesmos. |
| Seleção de arquivo iniciada na conversa anterior | Inputs ocultos têm chave de contexto nas três superfícies. A seleção antiga não é entregue ao input da conversa nova. Guards após compressão e leitura dos bytes cancelam efeitos A→B, A→B→A e desmontagem. |
| Áudio terminava no contexto anterior | Página, chat flutuante e histórico do lead verificam a geração após atendimento, envio e falha. Um retorno antigo não limpa rascunho/citação, não libera o busy novo e não mostra aviso de fila no contexto atual. |
| HTTP 200 de áudio já continha falha do worker | As três superfícies classificam a mensagem canônica. `outcome_unknown` conserva CID e prévia para verificar; `recipient_not_registered`/`send_failed` conserva a gravação como falha definitiva. Só aceite normal limpa a citação e informa fila. |
| Cancelamento de GET de mídia perdia uma vaga | O semáforo transfere a vaga sem perder o próximo solicitante quando quem recebeu a vaga é cancelado. Limite de concorrência preservado. |
| Prévia Opus com parâmetros MIME | MIME válido, incluindo parâmetros de codec, e Data URI local limitada são reconhecidos. O balão usa o player da prévia antes da URL canônica. |
| Transação nativa/recovery sem limite | Processamento por job usa contexto de 45 s, transação com lock de 2 s e statement de 20 s. Recovery usa contexto de 20 s e statement de 15 s. Rollback tem cleanup independente limitado; se necessário, cancelamento mira somente a conexão pgx fechada correspondente. Nenhum timeout global ou novo worker. |
| Receipt misto revertia status válido | IDs conhecidos são confirmados mesmo quando o lote contém IDs futuros/desconhecidos. O restante mantém reconciliação e retry limitados; falha terminal do desconhecido não desfaz o status conhecido. Não há nova fila nem alteração do payload assinado. |
| Push/device continuava depois de troca de identidade | Registro, desativação e callbacks prendem usuário, organização, geração e sinal à intenção. A callback Native de ação também compara o contexto atualizado em layout, cobrindo o intervalo anterior ao cleanup do listener. |
| Logout/cache tardio interferia no login novo | Logout explícito e automático, sessão expirada, suspensão e recuperação usam guards de sessão/geração. Consulta fresca ao SDK precede limpeza local. Cache, unsubscribe e redirect posteriores cancelam quando o contexto muda. Refresh do mesmo SID e a transição legítima original→null são controles positivos. |
| Gravador parava espontaneamente | Parada/erro encerra stream e intervalo e invalida bytes tardios. A próxima gravação inicia com estado consistente. |

Outra falha encontrada durante os testes era um deadlock entre o início do
worker e a exclusão canônica de usuário. Foi reproduzido com 40P01 no código
anterior. A ordem de locks agora começa pelo ator/vínculo, compatível com a
exclusão; o cenário corrigido impede o envio sem consumir tentativa ou chamar
o provedor. Não houve alteração de concorrência, FIFO ou replay da fila.

## Contratos preservados

- Apenas administrador compartilha o próprio WhatsApp; concessões não ampliam
  o conjunto de leads do destinatário.
- Contato sem lead continua visível de forma durável e temporária, com retenção
  limitada. Responder exige criar/vincular lead e entrar no atendimento.
- Histórico capturado acompanha o lead na transferência; leitura depende do
  acesso atual, sem copiar mensagens privadas anteriores ao atendimento.
- Push de entrada tem somente o responsável atual como destinatário. Aviso
  intocado acompanha a transferência; entrega iniciada/aceita não é repetida.
- Operação de WhatsApp fica na organização original do cadastro. Permissão de
  leitura de histórico em outra organização não autoriza enviar ou retry.
- Inbox, outbox, FIFO, dependências e idempotência existentes permanecem.

## Validação local e evidências

Pasta desta rodada: `D:\Vimob\tmp\whatsapp-deep-fixes-20261012`.
Logs e baselines anteriores foram preservados. RED identifica falha do código
anterior; GREEN identifica a correção, sem tratar fixture inválida como bug.

| Gate | Resultado |
| --- | --- |
| Access, banco PostgreSQL real descartável | Novos 15 testes + 21 subcasos PASS; matriz anterior 25 + 63 PASS. Zero SKIP. |
| Pós-admissão, PostgreSQL e handler reais | 4 testes + 11 subcasos PASS, zero SKIP, incluindo dois ramos de projeção e rejeição antes do commit. Fonte e evidências v2 preservadas separadamente. |
| Ingress/identidade/prazos/receipts, banco real | 9 testes + 4 subcasos PASS, zero SKIP. Duas migrações aplicadas duas vezes, ledger exato e negativos de ACL reais. |
| Regressões SQL da fila e contratos | 15 arquivos, 504 asserts PASS, zero SKIP; todos terminam em ROLLBACK. |
| Go completo no recorte | Cinco pacotes PASS; 1.730 eventos de teste PASS. Os 191 testes SQL opcionais pulados por ausência de DSN não contam como prova. Cenários necessários de banco foram executados nas matrizes reais acima. |
| Interface e intenção, Chromium | Página/chat flutuante 64 casos e hooks de envio 32 casos PASS; arquivo, citação, reconciliação, permissões, navegação, classificação canônica de áudio e resposta parcial pós-admissão. Zero SKIP. |
| Responder na lateral, Bubble real | 19 PASS, zero SKIP; clique/Enter/Espaço, lados corretos, reação interna, permissões e estados impedidos. Baseline apresentou cinco falhas nos contratos de posição. |
| Histórico do lead, handlers reais | 7 PASS, zero SKIP, incluindo preparo ABA e áudio canônico incerto/sem WhatsApp. |
| Intenção/arquivo/atendimento, helpers reais | 19 PASS, zero SKIP. |
| Mídia/gravador, React real | 28 PASS; semáforo 2 PASS; MIME/preview 16 PASS. Hardware não simulado como prova física. |
| Device push e Auth/cache | 47 regressões + 11 controles legados + 12 Native/Web em Chromium PASS, zero SKIP. Revisão independente inclui recovery com SID diferente e callback Native antigo. |
| Edge | 11 testes do código de ingresso e 8 contratos estáticos PASS. Runner Node executa os helpers/handler reais extraídos da AST; Deno não está instalado neste ambiente. |
| OpenAPI | 33 contratos PASS. |
| Supabase source gates | 195 migrações não vazias/imutáveis; manifesto Edge: 41 live, 26 tombstones, 15 retiradas. Só hash de `evolution-go-webhook` atualizado. |
| Auditoria de superfícies | `audit:check` PASS; dívida visual externa permanece no inventário, sem redesenho nesta rodada. |
| TypeScript global e build Next | `npm run typecheck` PASS; build Next final PASS, incluindo nova etapa TypeScript depois da alteração lateral. Lint dos arquivos alterados PASS, sem erros/avisos. Dois includes gerados pelo Next foram removidos restaurando os bytes exatos do tsconfig anterior; outros campos foram comparados antes da restauração. |
| E2E oficial Auth/REST/Storage/Realtime + Go/Next | 4/4 PASS em 1,7 min, sem SKIP; dados duráveis sem lead, expiração, inbox próprio/compartilhado, atribuição/leitura, reconexão, ordem de mensagens consecutivas e envelope nativo. Geometria lateral real PASS em 1440/900/390 px, sem overflow; resposta citada selecionada/cancelada pelo controle real no mobile. |
| Suíte geral do checkout | 705/708 PASS, zero SKIP; três falhas em asserts de fonte de gestão/equipes/filas, fora das correções WhatsApp. Não foram ocultadas nem usadas como justificativa para editar esses outros fluxos. |

As matrizes reais utilizaram exclusivamente o clone `vimob_whatsapp_clone` no
container rotulado `vimob-wa-test-ready-20261011`, loopback 127.0.0.1:57922,
PostgreSQL 17.6.1.075, sem volume de dados do host. Os serviços oficiais de
teste têm rótulo próprio, gateway somente 127.0.0.1:58021 e chaves sintéticas.
Os compiladores não carregam `.env` do projeto. No E2E somente o worker nativo
da inbox é habilitado; outbox/provedor, mídia, push e demais workers externos
continuam desligados. Prova de fornecedor usa fakes, nunca envio real.

No último E2E, POST→DOM p95 foi 2.398 ms para lead e 972 ms para contato sem
lead, cinco amostras por grupo. São medições do ambiente local, com serviços
sintéticos e computador compartilhado com a validação; não estimam latência
nem carga de produção. A ordem foi conferida antes e depois de reload e em
mensagens consecutivas, com seis mensagens capturadas preservadas.

Os serviços de teste foram encerrados ao final. API/Next foram parados somente
após conferir os PIDs/executáveis próprios. Cleanup verificou 40 tabelas de
negócio zeradas, waiting zerado e seed concluído preservado. Postgres descartável
permanece saudável. Manifestos finais conferiram 62 referências de arquivos,
sem divergências; nenhum dos 3.479 arquivos do baseline foi removido. O HEAD
permanece o mesmo. Oito arquivos de alterações paralelas foram inventariados e
mantidos como encontrados. Fingerprint final: 3.509 entradas de código/config/
migrações, com 1.941 arquivos JS/TS decodificados em UTF-8 estrito.

As três falhas externas são: `gestao abre a criacao e a edicao de equipes e filas
em paginas dedicadas`, `editor de fila bloqueia salvamento inseguro e atualiza
historico auditado` e `editor de equipe prioriza KPIs, selecao de escala e
historico auditado`, em `lib/access/api-boundary.test.ts`. Elas impedem tratar o
checkout completo como uma release com suíte geral verde.

## Migrações e pacote de publicação futura

Novas migrações desta rodada, nesta ordem, depois do cutover canônico B1:

1. `20261012133549_whatsapp_contradictory_pn_ingress_barrier.sql` — SHA256 bruto
   `1F0BBFE0D09E9FFC5D6289CF265DA072C061E124AD446D4DDABC8D9F3F4E75E1`.
2. `20261012144339_whatsapp_selected_route_explicit_pn_barrier.sql` — SHA256 bruto
   `C164B921063B463827ECB310A16FAA4C9D560C44669421C4DDC05A2264C91825`.

São patches novos, com identificação estrita da fonte anterior e repetição
segura. Nenhuma migração já aplicada foi editada. MD5 da função de captura no
clone final: `3a2da8da0a39e6d55bb0a66c659719c2`. Reexecutar B1 por cima removeria
os patches; a sequência deve respeitar ambos. Drift em outra fonte de função
falha fechado e exige análise, sem substituir a função remotamente por palpite.

As mudanças envolvem banco, Go, Edge, interface e Auth/push necessários para
estas correções. O checkout tem muitas alterações de outros domínios; os
fingerprints locais não são um commit limpo nem seleção automática de release.
Uma publicação precisa selecionar o pacote e suas dependências e repetir os
gates que divergirem. Nenhuma publicação está autorizada nesta rodada.

## Limites materiais e piloto pendente

URLs assinadas já emitidas conservam o TTL existente de 15 minutos. O fence
impede emissão nova após a perda de acesso detectada na consulta final; não
revoga retroativamente uma URL já entregue nem transforma o instante do commit
de início em uma transação atômica com o provedor externo.

No SDK Supabase instalado, `signOut(local)` público pode aguardar um lock e ler
outra sessão que entrou após o início da chamada. Não há parâmetro público de
JWT esperado/CAS/cancelamento dessa operação. Os guards impedem B antes da
chamada e cancelam limpeza/cache/redirect posteriores; não desfazem uma chamada
já iniciada. Uma revogação GLOBAL já iniciada de A também pode atingir novas
sessões do mesmo UID. Não foi usada API privada para mascarar essas limitações.

Não foram comprovados nesta rodada: envio e entrega reais Evolution/WhatsApp,
push com PWA fechada/APNs/FCM, microfone/codec físico, escala de 5–6 mil usuários,
configuração ou catálogo atualmente implantados, nem o backlog de produção.
O piloto futuro precisa cobrir número pessoal e compartilhado, não lead,
transferência com chat aberto, reconexão, mensagens consecutivas, reação,
imagem/áudio, número sem WhatsApp e os destinos de push. O teste local não
substitui esse piloto nem autoriza reprocessar pendências reais.

O registro de gestos de arquivo é apenas em memória, sem bytes. Reload ou
encerramento do runtime descarta esse registro; a mensagem/CID durável continua
no servidor e deve ser consultada por “Verificar envio”. Não há deduplicação
global de conteúdo nem garantia de interceptar uma nova escolha deliberada do
mesmo arquivo após reiniciar a página.

Detalhes de mídia, device e logout:
[runbook complementar](whatsapp-media-push-device-hardening-2026-10-12.md).

# Inventário visual do WhatsApp — 14/10/2026

Complemento da revisão posterior: [correções de lista, presença, compositor e acessibilidade](../runbooks/whatsapp-review-fixes-local-2026-10-14.md). Fallbacks de áudio/vídeo usam ações12/300. Até360px, somente “Ver lead” passa ao menu existente, preservando nome13/300, header56 e controles aprovados. Em toque, ações de documento32×44 e anexo de áudio32×32 efetivos; desktop permanece. Ações enviadas conservam branco no hover, sem troca do laranja aprovado. Mensagens salvas recebem foco visível e navegação por teclado sem alterar fonte/raios. A presença expira localmente em15s pelo timestamp, sem mudar o estilo da prévia ou escrever o cache.

Complemento mais recente: [correções finais de Conversas e balão](../runbooks/whatsapp-conversation-final-fixes-local-2026-10-14.md), com contenção de dados longos, onda adaptativa e superfície mobile no padrão do desktop. Fontes e tokens aprovados permanecem.

Complemento da última rodada: fontes/pesos e tokens de cor/raio abaixo permanecem. Com ponteiro de toque, as ações compartilhadas do cabeçalho usam área clicável36×44 e superfície visual32; as ações laterais da mensagem usam32×44 e superfície visual28. Com mouse, mantêm a geometria anterior. O header mobile reduz apenas o gap da identidade para4px nesse modo, conservando o nome legível. Documentos ficam contidos na largura da rolagem real e o rodapé de áudio longo quebra a linha quando necessário. Spinners/presença/entrada respeitam movimento reduzido. Resultados e limites estão no [fechamento dos quatro pontos](../runbooks/whatsapp-final-four-fixes-local-2026-10-14.md).

Leitura no checkout principal `D:/Vimob/workspaces/vimob-crm`, após a compactação e normalização visual de nomes desta rodada. Nenhum acesso a banco, provedor, credenciais ou produção foi feito para este inventário. Ele complementa [as referências de tipografia e controles](./whatsapp-typography-controls-2026-10-14.md).

## Autoridade e leitura do CSS

Não foi encontrado um manual dedicado chamado `DESIGN_SYSTEM.md` ou `UI_STANDARDS.md`. A autoridade verificável é `app/layout.tsx:2` (Geist/Geist Mono), `app/globals.css:72` (tokens), `app/globals.css:423` (pesos dentro de `.app-shell`), `app/globals.css:574` (títulos nos diálogos), `config/filter-ui.ts:4` (controles) e `config/form-wizard.ts:6` (ação laranja/50). O relatório `docs/audits/home-design-debt.md:24` contém orientação heurística; o CSS aplicado prevalece quando divergem.

Os números da tabela são pixels, com base de 16px. **Fonte** significa tamanho/peso. **Código** identifica uma leitura de classes e cascata, sem prometer medição de cada elemento. **CSS medido** identifica um elemento renderizado com o CSS real em Chromium isolado. `.app-shell` transforma `font-normal/light` em 300 e `font-medium/semibold` em 400. Títulos de Sheet/diálogo recebem 400 pela regra global do portal, mesmo quando o componente pede 300. O corpo das mensagens usa 200 por solicitação explícita do usuário, com 12px fixos e sem aumento em telas grandes.

O harness isolado mede `ui-sans-serif/system-ui` porque não monta o arquivo e a variável gerada por `next/font`. A configuração declara Geist; sua presença na sessão aberta do aplicativo foi observada separadamente pelo ROOT, em desktop. Essa observação não é uma prova de fonte carregada no celular.

## Cores, arredondamento e espaçamento

O laranja oficial é **`#ff4529`** (`--vimob-accent`/`primary`). “Laranja50” significa `rgb(255 69 41 / 0.5)` no fundo, mantendo texto/ícone branco opaco; hover70 segue a ação sutil existente. Balões de saída conservam o laranja sólido, conforme as referências enviadas. Checks lidos usam a cor azul do componente de recibo; falha e incerteza continuam semânticas, não recebem a cor do envio normal. A etapa e as tags usam a cor cadastrada, sem um laranja fixo substituindo a coluna.

| Token visual | Tema claro | Tema escuro |
| --- | --- | --- |
| Superfície sólida | `#ffffff` | `#171717` |
| Superfície suave dos controles | `rgb(15 23 42 / 0.055)` | `rgb(255 255 255 / 0.045)` |
| Hover neutro | `rgb(15 23 42 / 0.075)` | `rgb(255 255 255 / 0.07)` |
| Texto primário | `#151515` | `#ffffff` |
| Texto secundário | `rgb(21 21 21 / 0.68)` | `rgb(255 255 255 / 0.72)` |
| Texto terciário | `rgb(21 21 21 / 0.46)` | `rgb(255 255 255 / 0.48)` |

Blocos/painéis/popup8px, controles6px, chips e agrupamento de mensagem4px; avatares, play e botão ir ao fim permanecem círculos. O foco por teclado conserva indicação neutra ou semântica adequada à superfície, sem retângulo preto. Os principais campos e ações têm32px de altura; o compositor vazio mede42px e cresce apenas por texto multilinha. O picker de responsável mantém44px nas opções com avatar, e o visualizador de mídia conserva as áreas de ação existentes. São exceções explícitas de conteúdo/interação, não crescimento por resolução.

O espaçamento usa as unidades existentes: gaps4/6/8px, padding horizontal8/10/12px conforme o controle, padding vertical4/5/8px conforme a altura e o conteúdo. Header/controles mantêm a densidade em320/390/1440. Nenhum ajuste global de zoom, família, token, largura do aplicativo ou animação foi introduzido para esconder divergências.

## Complemento após as duas auditorias

A rodada posterior mantém os tokens acima e fecha as divergências: menu do cabeçalho 12/300 com raio6; busca dos filtros e picker de vínculo 12/300, altura32, foco neutro; chip de contexto do balão 9/400 com raio4 e funil laranja/10; tags conservam a cor cadastrada e controles de adicionar/remover têm área mínima24 sem aumentar a altura visual do chip. A galeria usa32 no mobile e40 a partir de `sm`. Mensagens continuam12/200; horário e recibo sobre a mídia continuam no overlay branco solicitado. Fontes não crescem por resolução.

O aviso informativo de prévia somente leitura/erro de sessão usa11/300, raio6 e o mesmo laranja/50 branco, sem borda. Busca pendente/erro de paginação usa11/300; contador da Agenda usa11/300 e não apresenta zero durante carregamento. Mais documentos usa a ação discreta existente com11/300. A expansão não altera fonte/peso. O avatar ocupa sempre o espaço anterior, inclusive ao carregar/repetir/trocar de origem; não muda a largura da prévia ou dos checks.

As medições atuais estão em `D:/Vimob/tmp/whatsapp-full-audit-20261014/visual-closure` e `avatar-closure`: CSS real, componentes reais identificados no fixture, bytes/dados sintéticos e rede externa bloqueada. Os harnesses não carregam `next/font`, portanto confirmam tamanhos/pesos, mas não o download de Geist. O documento abaixo é um inventário do código/CSS; as referências de linha antigas são localizadores históricos, não promessa de linha atual após as correções.

## Campos, fontes e geometria

| Campo / origem | Fonte | Raio / altura | Cor e escopo | Evidência |
| --- | --- | --- | --- | --- |
| Nome do card — `ConversationListItem.tsx:133` | 12/300 | texto sem raio; ação 6 | foreground; `.app-shell` | CSS medido |
| Prévia/draft/presença — `ConversationListPreview.tsx:22` | 11/300 | texto livre | auxiliar; presença/draft primário | Prévia CSS medida; demais código |
| Responsável no card — `ConversationListItem.tsx:169` | 9/300 | 4 / 17 | âmbar/15; primeira faixa abaixo da identidade | CSS medido |
| Lead/tags no card — `ConversationListItem.tsx:36` | 9/400 | 4 / 17 | cores semânticas da tag; 400 vem da ênfase | Código |
| Tooltip de responsável — `ConversationListItem.tsx:182` | 12/300; auxiliar 10/300 | popup 8 | superfície sólida / auxiliar | Código |
| Hora / contador da lista — `ConversationListItem.tsx:146` | 10/300 | contador 6 / 19 | contador laranja/50 e texto branco | Código |
| Mais ações do card — `ConversationListItem.tsx:251` | itens 12/300 | gatilho 6 / 28; itens 6 / 32; popup 8 | cinza; remoção destrutiva | Código |
| Busca da lista — `conversation-list-ui.ts:5` | 12/300; placeholder 12/300 | 6 / 32 | superfície neutra; limpar cinza/hover laranja | Prova isolada dos controles da lista, coordenada separadamente |
| Canal WhatsApp / mais conversas — `conversation-list-ui.ts:6` | 12/300 | 6 / 32 | laranja/50; hover/70; texto branco | Código / prova isolada separada |
| Nome no header desktop — `ConversationHeader.tsx:58` | 14/300 | texto livre | foreground; identidade ocultada quando painel já a apresenta | Código + prova de título compactado |
| Nome no header mobile — `MobileConversationHeader.tsx:38` | 13/300 | texto livre | foreground | Código |
| Telefone/presença do header — `ConversationHeader.tsx:59` | 11/300 | texto livre | auxiliar / presença laranja | Código |
| Header do balão — `FloatingChat.tsx` | nome 13/300; telefone 10/300 | janela desktop 8 | título foreground / auxiliar | Código |
| Ações Ver lead / Mais / Busca / Painel — `ConversationHeaderActions.tsx:29` | 12/300 | 6 / 32 | superfície soft / texto secundário | CSS medido; busca precede painel |
| Fechar painel / Sheet — `ConversationLeadPanel.tsx:729`, `ConversationDetailsPane.tsx:34` | ícone 14 | 6 / 28 | cinza soft/secondary; hover muted/primary | CSS medido, clique/Escape e foco |
| Ações/fechar do balão — `FloatingChat.tsx` | ícones 16; auxiliar 12/300 | 6 / 36 desktop ou 44 mobile | cinza soft/secondary; área mobile preservada | Código atual; não confundir com a altura 32 da página |
| Título do painel — `ConversationLeadPanel.tsx:748` e `1288` | 14/300; Sheet 14/400 | texto livre | foreground; exceção de heading no portal | CSS medido |
| Telefone do painel — `ConversationLeadPanel.tsx:753` | registrado 11/300; sem lead 12/300 | texto livre | auxiliar | Código |
| Seção Dados — `ConversationLeadPanel.tsx` | 11/400 | bloco 8 | texto primário; 400 explícito para seção pequena | Código |
| Documentação / Anexar — `ConversationLeadPanel.tsx` | título11/400, igual Dados/Agenda; ação10/300 | linha32; ação24; folga vertical4; raio6 | superfície suave, sem bloco vazio; ação neutra | CSS medido320/1440 claro/escuro após correção do h3 global |
| Labels e valores de Dados — `ConversationLeadPanel.tsx:137` | 12/300 | linha livre | label terciário / valor primário | Valor CSS medido |
| Responsável / status do painel — `ConversationLeadPanel.tsx:782` e `851` | 11/300 | 6 / 32 | superfície soft / secondary | Responsável CSS medido; status código |
| Buscar responsável — `ConversationLeadPanel.tsx:804` | 12/300 | 6 / 32 | portal; sem ring colorido | CSS medido |
| Opções de responsável — `ConversationLeadPanel.tsx:823` | 12/300 | 6 / **44** nesta opção com avatar | portal; texto branco/primário conforme tema | CSS medido; altura 32 é do campo, não desta opção |
| Pipeline / etapa — `ConversationLeadBadges.tsx:14` | 10/300 | 4 / 20 | cor semântica; etapa colorida com texto branco | CSS medido da etapa / código |
| Tags do painel — `ConversationLeadTagBar.tsx:25` | 10/400 | 4 / 20 | cor configurada da tag; Badge semibold → 400 | Código |
| Opções de tags — `ConversationLeadTagBar.tsx:46` | 12/300 | 6 / altura pelo conteúdo | superfície/popover; erro/retry explícitos | Código |
| Editar / Anexar dos blocos — `ConversationLeadPanel.tsx:919` e `970` | 10/300 | 6 / 28 | ação sutil preservada; font-light vence o peso legado400 no shell | CSS medido |
| Selecionar imóvel — `ConversationLeadPanel.tsx:947` | 12/300 | 6 / 32 | botão da seção de imóvel; permissões e ação preservadas | Código; fixture não comprova módulo/picker real |
| Feedback / documentos — `ConversationLeadPanel.tsx` | 12/300 | raio6; feedback64, linhas16 | superfície sólida / texto auxiliar; documentos reais continuam visíveis | CSS medido320/1440 claro/escuro |
| Nome do remetente — `MessageBubble.tsx:268` | recebido 11 compacto / 12 página, 300; enviado 11/300 | texto livre | recebido primário; enviado branco com alpha | Código; autoria validada em provas separadas |
| Texto / apagada — `MessageText.tsx:49`, `MessageBubble.tsx:321` | **12/200 fixos** | grupo 8; cantos de agrupamento/cauda 4 | recebido primário; enviado branco/laranja sólido | Código; CSS do balão validado pelo ROOT |
| Contato/localização recebidos — `MessageStructuredContent.tsx:26` | 12/200 | card 6 | conteúdo da mensagem preservado | Código |
| Citação — `MessageStructuredContent.tsx:52` | autor 12/400; prévia 12/300 | 4; barra lateral 2 | fundo current/5; prévia bruta preservada | Código / roundtrip separado |
| Hora do balão — `MessageBubble.tsx:351` e `367` | 11/300 | texto livre | recebido terciário à esquerda; enviado branco à direita | Código / CSS do ROOT |
| Imagem/vídeo e hora — `MessageMedia.tsx:374` e `425` | hora 11/300 branca | mídia 6; overlay 4; imagem 280/max-full e 300 a partir de sm | scrim sobre imagem; overlay foi restaurado | Código / prova central separada |
| Nome do arquivo / tamanho — `MessageMedia.tsx:612` | 12/300; tamanho 10/300 | card 6 | primário / alpha auxiliar | Código |
| Áudio: duração/hora — `MessageAudioPlayer.tsx:408` e `554` | 11/300 | player/bloco conforme balão; avatar circular | branco para enviado / terciário recebido | Código / 8 casos do responsável de áudio |
| Menu Copiar / Dados — `MessageActionMenu.tsx:27` | 12/300 | trigger 6 / 28; itens 6 / 32; popup 8 | superfície soft/secondary | Código / prova central separada |
| Dados da mensagem — `MessageActionMenu.tsx:55` | heading 14/400; corpo 12/300 | diálogo 8 | portal com heading400 | Código / prova central separada |
| Compositor WhatsApp — `ScopedMessageBox.tsx:19` | entrada **12/300**; placeholder 10,5/300 | bloco 8 / **42 reais**; enviar 6 / 32 | superfície hover; compacto padrão no domínio | 7 casos CSS/callback; primitive não editada |
| Mensagens salvas — `quick-replies/QuickReplyManager.tsx`, `QuickReplySuggestions.tsx` | título/atalho/campo/ação12/300; auxílio/prévia11/300 | painel8; campo/ação6; ações mínimas32 | superfície sólida/neutra; salvar laranja/50 e hover sólido | Código; CRUD e inserção no compositor com transporte sintético |
| Busca de histórico/resultados — `ConversationHistorySearch.tsx:7` | 12/300 | campo 6 / 32; opções 6 | neutro, borda/ring sem extensão visível; hint removido | 7 casos CSS isolados |
| Carregar mensagens anteriores — `LoadOlderMessagesButton.tsx:19` | 11/300 | 6 / 32 | laranja/50, hover/70, texto branco | 7 casos dos controles; mantém callback de paginação |
| Data — `DateSeparator.tsx:30` | 12/300 | 6 | neutro/terciário | Código |
| Entrada no atendimento — `AttendanceTimelineEvents.tsx:30` | texto 10/300; pessoa 10/400 | 6 | fundo primário/8; nome com apresentação normalizada | Código; ajuste do ROOT |
| Faixa de iniciar/conectar — `OwnWhatsAppStartNotice.tsx` | 11/300 | 6; padding vertical8 | laranja/50, texto branco; sem borda | CSS e callback no harness central |
| Ir para o fim — `ScrollToLatestButton.tsx` | contador 10/300 | botão circular / 32; borda0 | fundo branco/seta laranja; hover laranja/seta branca; contador laranja | CSS claro/escuro e callback no harness central |
| Reações rápidas / catálogo — `MessageReactions.tsx` | emoji16 rápido, 18 catálogo; contador10/300; emoji do badge14 | ações6 / 28–32; badge8 | superfície neutra, seleção semântica | Código; seleção/callback/Enter no harness central |
| Busca/outro emoji — `MessageReactions.tsx` | labels e entradas12/300 | campos6 / 32 | neutro, sem borda preta | CSS real e Enter com emoji de família no harness central |
| Autores das reações — `MessageReactions.tsx` | título12/400; pessoas12/300 | popup8 | autor informado/Conta do WhatsApp, nunca “Você” por `fromMe` sozinho | CSS e autoria no harness central |
| Falha/espera/ação da mensagem — `MessageBubble.tsx` | falha definitiva10/300, entrelinha14; incerteza12/300; conteúdo indisponível11/300 | texto externo ao balão | vermelho para falha, âmbar para incerteza, auxiliar para feedback | Código; negativos de falha/entrega no harness central |
| Resposta selecionada no compositor — `ConversationComposer.tsx` | 12/300 | faixa4; barra2 | neutro, destaque primário | Código; conteúdo da citação permanece bruto |
| Seleção de anexos — `AttachmentPreviewComposer.tsx` | arquivo12/300; tamanho11/300 | bloco8, linha/prévia6 | nome real do arquivo, superfície neutra | Código; fechamento CSS/ações separado |
| Legenda/enviar anexos — `AttachmentPreviewComposer.tsx` | 12/300 fixos inclusive desktop | campo/botões6 / 32 | campo neutro; enviar laranja/50 | Fechamento CSS/ações separado, sem upload real |
| Galeria/zoom/espera — `MediaViewer.tsx` | 12/300 | controles6 e 32 mobile/40 desktop; diálogo8 | branco/scrim no visualizador | Código; galeria/cancelamento no harness central |
| Erro no visualizador — `MediaViewer.tsx` | mensagem14/300; descrição12/300; feedback10/300 | ação6 | texto branco, erro de download vermelho | Código; o texto de erro é `p`, não heading de portal |
| Download/retry do visualizador — `MediaViewer.tsx` | 12/300 | controles6; altura de ação existente preservada | branco em controle sobre mídia | Fechamento CSS/ações separado, sem download real |

Os caminhos sem prefixo na tabela pertencem a `components/features/whatsapp/`, com `ConversationList*`, `ConversationHeaderActions`, `MobileConversationHeader`, `ConversationDetailsPane`, `ConversationLeadBadges`, `ConversationLeadTagBar` e `ConversationHistorySearch` dentro de `conversations/`, e `MessageText`, `MessageStructuredContent`, `MessageMedia`, `MessageAudioPlayer` e `MessageActionMenu` dentro de `message-bubble/`. `FloatingChat.tsx` pertence a `components/features/chat/`.

## Nomes, identidade e conteúdo

`lib/whatsapp-person-name.ts:2` formata somente apresentação, sem escrever o cadastro. Os consumidores atuais incluem nome do lead/contato individual, responsável no card e painel, opções de responsável, candidatos ao vínculo e o modelo de autor dos balões/citações. Grupos preservam o nome do grupo. Strings com dígitos ou marcadores de identificador (`<>_/@\\`) permanecem brutas. Fallback de e-mail, telefone, sessão, nomes de arquivos e texto das mensagens permanecem intactos.

O conteúdo de vCard e a ação de copiar contato em `MessageStructuredContent.tsx:29`/`34` continuam com o valor recebido, porque representam conteúdo da mensagem. O nome do participante em `AttendanceTimelineEvents.tsx:33` passou a usar o mesmo formatter de apresentação por ajuste do ROOT. `MetadataHoverValue` em `ConversationLeadPanel.tsx:195` pode conter origem/campanha/identificadores e não deve ser convertido automaticamente em nome pessoal.

## Status da prévia

`ConversationListPreview.tsx:33` só apresenta o ícone quando a conversa WhatsApp tem `last_message_from_me === true`; mensagem recebida, direção ausente, draft e presença não recebem marca de envio. `message-bubble/MessageStatus.tsx:9` também retorna `null` para direção recebida. A projeção canônica exibe relógio para fila/pendente, um check para enviada, dois cinza para entregue, dois azuis para lida/played, relógio âmbar para confirmação/incerteza e alerta vermelho para falha. Isso descreve o estado salvo, sem inventar o recebimento no telefone.

No complemento da prévia de14/10, uma direção de saída conhecida com status ausente/vazio conserva o relógio “Estado do envio indisponível” do mesmo componente; não é convertida em enviada/entregue/lida. Direção ausente continua sem ícone. Nove casos de cards verificaram os estados, a posição do ícone antes do texto e transições nas duas superfícies, incluindo uma nova resposta recebida removendo o check. O recibo representa saída da linha WhatsApp, não necessariamente a pessoa que está olhando a tela.

## Geometria mobile e limites da prova

O wrapper de Conversas em `ConversationsScreen.tsx` usa `.app-card`, com a mesma superfície e raio8 do desktop, e `overflow-hidden` tanto na lista quanto no chat mobile. O próprio cabeçalho móvel declara os cantos superiores8; o contêiner de mensagens aplica `--app-surface-soft` em toda a altura, inclusive nos estados vazio/carregando/erro. Não há compensação negativa sobre a navegação inferior. Os casos fechados em 320/390 verificaram esses cantos, o compositor acima da navegação e ausência de overflow horizontal. O painel abre num Sheet limitado ao viewport; o X do wrapper permanece disponível em loading/erro/lead ausente. Desktop usa coluna de dados de 330px quando há espaço e Sheet no modo estreito. O canvas móvel do balão permanece fullscreen; sua janela desktop conserva raio8.

O log `D:/Vimob/tmp/whatsapp-header-close-controls-20261014/mac/layout-fonts-names-closure.log` contém 13/13 casos, zero skips/tentativas de rede, **antes** dos últimos refinamentos de raio6 do CardMore/FloatBack/ViewLead e cantos agrupados4. As capturas desktop, mobile chat e Sheet dessa fase foram inspecionadas; headers/painel/menus são reais, enquanto a área de mensagens e os dados/API usam fixtures. A rodada posterior `D:/Vimob/tmp/whatsapp-typography-media-local-20261014/final-ui-layout-cards-controls-green.log` passou36/36 e inclui os refinamentos de geometria e tipografia de cards, layout, busca, controles e tags.

O foco posterior `card-app-shell-typography-final.log` passou 1/1, com a versão atual do card e `.app-shell` aplicado. A fotografia anterior do card fora desse scope computava400; foi preservada em `pre-card-shell-scope` e o fixture foi corrigido para representar o host real, sem mudança do produto. O nome computou12/300, a prévia11/300 e o responsável9/300. As outras amostras mediram Info12/300, botão responsável11/300/h32, pickerinput12/300/h32 e opção12/300/h44. Nenhuma dessas provas substitui PWA real, sessão WhatsApp nativa, banco, desempenho de rede ou produção.

## Fechamento do compositor e controles legados

`ScopedMessageBox` aplica compacto por padrão e mantém `compact={false}` explícito. A classe do domínio reduz somente o raio do botão de envio direto para6 e ajusta o padding vertical para5px, sem alterar `components/ui/message-box.tsx`. O teste real anterior mediu entrada13/300, mínimo46 e altura48. Apenas ativar o compacto resultava em mínimo42, mas altura44 por causa de32px das ações mais12px de padding; por isso o domínio usa10px de padding total para atingir42 de fato. O recorder ocioso de32px acompanha o novo bloco com5px de margem superior/inferior; o modo não compacto conserva8px e48px reais. O textarea continua crescendo com várias linhas.

`scoped-message-box.runtime.test.mjs` passou7/7, zero skips/tentativas de rede, em320/1440 e temas claro/escuro: fonte12/300, altura42, envio6, alinhamento do recorder, um callback por gesto, ref de foco, Shift+Enter, handler customizado, override não compacto e guardas de envio. O recorder é um sentinel; estes casos não revalidam permissão de microfone, captura ou upload real. Editar/Anexar e seletor de imóvel usam somente novas classes, preservando link, ação, cor e permissões. As provas e bytes anteriores estão em `D:/Vimob/tmp/whatsapp-compact-composer-20261014/mac/`.

## Última revisão de anexos e fechamento

O Input de legenda herdava `py20` e `md:text-sm` da primitive: a medição original mostrou altura40, fonte12 no mobile e14 no desktop. Foram sobrescritas somente as classes do domínio para12/300, altura32 e raio6; os botões enviar/remover acompanham a densidade. No visualizador, download/retry usavam14px e agora usam12/300, mantendo altura36 e navegação40 onde já existiam. As primitives Input/Button, handlers, limites, seleção/erro e conteúdo não foram alterados.

`attachment-viewer-controls.runtime.test.mjs` passou5/5, zero skips/rede, em320/1440 e claro/escuro: CSS, foco, legenda, envio/remover, busy/unconfirmed, erro/retry, download simulado, galerias/limites/teclado e fechamento. Fonte/primitives/CSS e log estão em `D:/Vimob/tmp/whatsapp-attachment-viewer-controls-20261014/mac/manifest.json`. O harness central também conferiu labels de reação12/300 e autores12/300 com o CSS real do portal. A rodada final de balões/áudio/citação/compositor passou61/61 depois desses ajustes; resultados completos e limites estão no [fechamento local](../runbooks/whatsapp-final-local-closure-2026-10-14.md).

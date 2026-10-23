# Correções da última revisão de Conversas e balão — 14/10/2026

Checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Complemento do [fechamento anterior](whatsapp-conversation-final-fixes-local-2026-10-14.md). Esta rodada trata dos três P2 e cinco P3 encontrados na revisão seguinte, preservando o visual aprovado e as alterações locais preexistentes.

Não houve commit, push, deploy, migração, acesso a banco/provedor, envio real, alteração de credenciais ou ambiente. As mudanças são do frontend no checkout principal; a fila do backend não foi modificada nesta rodada.

## Pontos encerrados

| Prioridade e ponto | Causa reproduzida | Resultado |
| --- | --- | --- |
| P2 — lista reiniciando durante eventos frequentes | Dez hints durante uma leitura pendente produziam onze GETs e cancelamentos, impedindo a publicação fluida do resultado. | A leitura atual termina e publica. Os eventos pendentes são agrupados numa leitura seguinte, compartilhada pela instância real de Query e pelo QueryClient. Página e balão usam o mesmo hook. |
| P2 — digitando/gravando escondendo prévia e checks | O estado persistido não tinha prazo local e não usava `presence_updated_at`. | Uma projeção local expira o sinal em 15 segundos, inclusive sem evento de parada. Timestamp ausente, inválido, futuro ou vencido não oculta a mensagem. Novo timestamp renova somente seu card. Cabeçalhos que já exibiam presença usam a mesma regra. |
| P2 — canal Meta sem campo de resposta | O `readOnly` de Instagram/Messenger dependia da autorização de uma conversa WhatsApp. | Texto volta a ficar disponível com módulos/permissões existentes, na organização original e fora de prévia somente leitura. Envio e estado pendente usam o transporte Meta. Áudio/anexos exclusivos de WhatsApp ficam ocultos nesse canal. |
| P3 — nome sem espaço no header de 320 px | Voltar, avatar e quatro ações disputavam a largura real após os insets da página. | Até 360 px, apenas “Ver lead” passa ao menu existente, também para quem pode visualizar sem operar. A largura do nome mediu 60 px contra 24 px no caso reproduzido. Fonte, altura, busca e painel permanecem. Acima de 360 px, controles anteriores. |
| P3 — convite para digitar sem permissão | O rodapé somente leitura herdava o placeholder de envio. | A página explica “Somente leitura”; o balão conserva sua indicação. Organização original e prévia local continuam com suas mensagens específicas. |
| P3 — mídia enviada perdendo contraste e ação de documento pequena | Hover laranja sobre laranja; ícones de documento tinham cerca de 18 px de alvo. | Ações enviadas conservam ícone branco e hover branco translúcido. Em toque, documento usa 32×44 px; o anexo de áudio usa área efetiva 32×32 px, mantendo o ícone/geometria desktop. Dois pixels de padding inferior no player de toque contêm o alvo no próprio balão, sem cobrir onda, play, recibo ou a mensagem vizinha. |
| P3 — ações de erro de mídia grandes | Fallbacks de áudio/vídeo herdavam 14 px. | Retry/download usam 12 px e peso 300, com contenção/quebra apenas quando necessárias em 320 px. |
| P3 — teclado nas mensagens salvas | Foco pouco visível; Tab chegava à opção, mas setas/Escape só tratavam o campo; abrir gerenciador não levava foco ao painel. | Foco visível, navegação pelas opções, Home/End, inserção única e Escape com retorno ao campo. Gerenciador solicita foco por gesto/montagem e retorna ao controle de origem ao cancelar. Respostas CRUD tardias não puxam o foco de outra conversa. |

Os 15 segundos são um fallback da interface, não uma garantia ou prazo declarado pelo provedor. A presença não escreve nem altera o cache autorizado. A correção da lista também não transforma um hint em mensagem: os dados continuam vindo da leitura canônica autorizada.

A exceção de autorização da lista permanece imediata: cancela inclusive o GET inicial sem cache e revalida o escopo atual. Cancelamento e 401/403/404 encerram a rodada; não há repetição pelo mesmo evento nem retry autônomo. Queries inativas, desabilitadas, removidas/recriadas e clientes/atores/SIDs distintos não compartilham trabalho antigo.

## Visual e arquitetura preservados

Família/tokens globais, laranja aprovado, balões de saída, overlay branco de horário, direção/avatar do áudio, raios de 8 px nos blocos e 6 px nos controles permanecem. Corpo das mensagens: 12/200; ações/menus: 12/300; nome mobile: 13/300; header mobile: 56 px. O laranja/50 com texto branco aprovado não foi redesenhado nesta rodada. O balão continua fullscreen no mobile.

Nenhuma primitive de `components/ui` foi editada. O hook de lista legado terminou com as mesmas 2.046 linhas do baseline; o coalescedor foi isolado em 87 linhas. O novo hook temporal tem 58 linhas. `ConversationsScreen` já excedia o limite de tamanho e recebeu somente o ajuste pontual de autorização/canal e o timestamp do header, sem refatoração ampla de responsabilidades. O hook de mensagens paginadas permanece com o hash `57d3ed2772249d1a97c3e48ef5ccfa5657bf303f1b52cc243d797ddb595dbb5d`.

O [inventário de tipografia e geometria](../audits/whatsapp-typography-inventory-2026-10-14.md) registra os complementos desta rodada. A revisão independente cruzou loading, presença/mobile e compositor/permissões; não encontrou outro defeito reproduzível nesses patches.

## Provas locais

Artefatos: `D:/Vimob/tmp/whatsapp-review-fixes-20261014/`. As reproduções RED e snapshots anteriores foram preservados. Contagem abaixo exclui repetições e resultados históricos.

| Grupo distinto | Resultado final | Log/prova |
| --- | --- | --- |
| P2 lista: refresh, reconciliação e coordenador | 35/35 | `loading/green-final.log`, `loading/proof.json` |
| Presença/mobile e regressão de cards/visual | 46/46 (24 novos + 22 regressões) | `presence-mobile/final.log`, `regression.log`, `proof.json` |
| Mídia/teclado, UI/superfície de mensagens salvas e mídia geral | 92/92 (18 + 11 + 30 + 33) | `media-keyboard/final.log`, `final-proof.json` |
| Compositor Meta/WhatsApp e acesso somente leitura | 18/18 | `root/green-css-final.log` |
| Página/balão integrados, layout e MessageBox | 58/58 (38 + 13 + 7) | `root/integrated-layout-scoped.log` |
| HEAD, corridas e prévia canônica protegidos | 107/107 | `root/canonical-head-regression.log` |

São 356 casos distintos aprovados, sem skips; não corresponde a todos os testes do repositório. O lote de mídia inclui os mesmos 12 casos de paridade de superfície, que não foram somados novamente. Os dois casos de reconciliação pertencem somente ao grupo da lista; a regressão de HEAD não os soma outra vez.

Os casos renderizam componentes, Radix, CSS e QueryClient reais onde indicado, com autenticação, dados, transporte e microfone sintéticos. Página e balão foram exercitados em 320/390/1440 px e temas claro/escuro; a paridade também cobre alturas 568/820 px, insets da aplicação, voltar/reabrir, Sheet, menus, busca, foco/Escape, loading/erro, movimento reduzido e mídia durante renovação de URL. O compositor Meta usa os componentes reais com lista/dados fechados e CSS real; confirma fonte 12/300 e contenção da entrada. Capturas mobile foram inspecionadas visualmente.

Checks gerais após congelar o produto:

- `npm run typecheck`: exit0, sem erros; `root/typecheck.log`.
- `npm run lint`: exit0, zero erros e os mesmos três avisos preexistentes nos testes Supabase `property-inventory-eligibility.test.ts` e `public-property-catalog.test.ts`; `root/lint.log`. Lint focal sem erros/avisos.
- `git diff --check` nos arquivos desta rodada: exit0. Os 23 arquivos de produto/teste conservaram os hashes e não contêm NUL; `root/final-source-manifest.json` e `root/final-source-manifest-after.json`. CSS global idêntico ao snapshot inicial; hash protegido de paginação também idêntico. Consolidação em `closure-proof.json`.

Nenhuma falha reproduzida desses oito pontos ficou pendente. Os testes não comprovam dispositivo físico/Safari, teclado virtual real, sessão com provedor, latência/recebimento real, download de Geist por `next/font`, rotas publicadas ou comportamento em produção. A sessão local conectada à API publicada antiga continua limitada ao contrato daquela API; a correção local de interface não publica backend.

## Arquivos e reversão seletiva

Produtos: `hooks/use-whatsapp-conversations.ts`, `lib/realtime/whatsapp-query-refresh.ts`, `hooks/whatsapp/use-whatsapp-contact-presence.ts`, `hooks/whatsapp/use-quick-reply-composer.tsx`; `ConversationsScreen`, `ConversationHeader`, `ScopedMessageBox`; `ConversationListPreview`, `MobileConversationHeader`, `ConversationHeaderActions`, `ConversationComposer`; `MessageAudioPlayer`, `MessageMedia`; `QuickReplySuggestions` e `QuickReplyManager`.

O manifesto `root/final-source-manifest.json` lista os caminhos a partir do checkout, incluindo os oito testes novos/ajustados. Os snapshots de produto anteriores estão em `root/before`, `loading/before`, `presence-mobile/before` e `media-keyboard/baseline`. Uma reversão futura deve aplicar somente os hunks desta rodada contra esses snapshots, preservando os ajustes anteriores; não restaurar arquivos inteiros ou resetar o checkout principal.

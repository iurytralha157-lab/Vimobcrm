# Correções finais de Conversas e balão — 14/10/2026

Checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Esta rodada complementa a revisão profunda posterior ao [fechamento anterior](whatsapp-final-four-fixes-local-2026-10-14.md) e às [mensagens pessoais salvas](whatsapp-personal-quick-replies-local-2026-10-14.md).

O trabalho preservou as alterações locais preexistentes. Não houve commit, push, deploy, migração, acesso a banco, chamada ao provedor, envio real ou alteração de ambiente/credenciais. São correções do frontend e testes locais; esta rodada não modifica a fila do backend.

## Resultado dos quatro achados e do pedido mobile

| Ponto | Causa reproduzida | Correção |
| --- | --- | --- |
| P2 — status interno divergente da prévia | Uma resposta HEAD antiga, referente à mesma mensagem, podia substituir `read` por `sent` no histórico depois de uma resposta mais recente. | A validade cobre toda a aplicação da resposta, antes do merge e do rebase. Leituras compartilham propriedade por QueryClient e pela instância exata de Query; respostas substituídas e Queries removidas/recriadas não voltam ao cache. O status vem da resposta autorizada atual, sem impor uma classificação artificial de estados. |
| P2 — mensagens salvas após fechar/trocar a conversa | POST/PATCH/DELETE já aceito pelo servidor podia terminar com o editor fechado e deixar a lista pessoal antiga ainda fresca por até 60 segundos. | Fechar retira imediatamente a propriedade da interface sobre o resultado. O encerramento da operação invalida somente a chave pessoal capturada. Um GET autorizado reconcilia a lista; a resposta antiga não preenche outro formulário nem repete a escrita. Troca de usuário/SID não dispara leitura pelo contexto antigo. |
| P2 — painel cortado por dados longos | O contêiner interno `display:table` do Radix permitia largura mínima de 380 px para e-mail válido, mesmo em painéis de 320/360/330 px. | Somente a rolagem do domínio recebe contenção de largura, com quebra segura dos valores longos. Anexar, Agendar, fechar e feedback permanecem dentro do painel; nenhum componente de `components/ui` foi alterado. |
| P3 — onda do áudio invisível em 320 px | As 28 barras disputavam 48 px com 54 px de intervalos fixos e podiam encolher a zero. | O intervalo se adapta ao número de barras e ao espaço disponível. A menor barra medida ficou em 1,21875 px nesse caso. Play, avatar, direção, horário, checks e geometria desktop permaneceram iguais. |
| Mobile — topo e fundo diferentes do desktop | O wrapper era transparente; o fundo cinza não preenchia todo o canvas e havia compensação negativa sobre a navegação inferior. | A página mobile usa a mesma `.app-card` do desktop, com raio de 8 px e recorte dos cantos. O próprio header declara os cantos superiores de 8 px. O canvas inteiro usa `--app-surface-soft`, inclusive vazio/carregando/erro, e o compositor permanece acima da navegação. O balão conserva seu fullscreen mobile. |

A revisão independente acrescentou uma reprodução real ao primeiro P2: quando o observador que iniciou um refetch fechava, o peer ainda aberto descartava a resposta e podia permanecer em `fetching`. Agora a validade do transporte pertence ao fetch/Query e aos observadores vivos; os efeitos de interface continuam limitados ao dono atual. Sucesso atualiza texto/status/prévia e termina em `idle`; 403 limpa as mensagens e a prévia do peer, sem retries e sem callback para a interface fechada. A mesma proteção cobre páginas históricas do infinite query e o HEAD de montagem/poll/evento/retry. O HEAD customizado aplica o merge uma vez, mesmo com vários awaiters. Observadores negados não iniciam nem publicam polls que reabram seu acesso; o refetch canônico autorizado continua podendo restaurar uma concessão. O último observador, a revogação e as trocas A→B→A continuam retirando a propriedade anterior.

As mutações pessoais conservam `retry:false`; fechar, timeout ou resultado incerto não geram replay pelo hook. A política central preexistente de renovar a autenticação após 401 não foi alterada por esta rodada.

## Padrão visual preservado

Não houve troca de família, tamanho ou peso de fonte, tokens globais, cores de envio, avatar, overlay de horário ou controles aprovados. A implementação reaproveita as superfícies existentes: branco/escuro no card e cinza suave no canvas; raios de 8 px nos blocos e 6 px nos controles. O header móvel conserva 56 px de altura. Não foi adicionado aumento por resolução ou animação para disfarçar carregamento.

O [inventário de fontes e geometria](../audits/whatsapp-typography-inventory-2026-10-14.md) foi atualizado para registrar a superfície mobile, a fonte do aviso definitivo de falha já reduzida na rodada anterior e o painel de mensagens salvas. Os componentes legados `ConversationsScreen` e `ConversationLeadPanel` permanecem acima do limite de tamanho do projeto, mas receberam somente substituições de classes nesta rodada, sem crescimento de linhas ou ampliação de responsabilidades. O hook de paginação ficou com 766 linhas; os três testes novos têm menos de 200 linhas cada.

## Validação reproduzível

Artefatos completos: `D:/Vimob/tmp/whatsapp-final-fixes-20261014/`. As reproduções RED e os snapshots anteriores foram conservados. A tabela não soma repetições, REDs ou os testes independentes externos aos resultados versionados.

| Grupo | Resultado e log |
| --- | --- |
| HEAD, corridas, prévia canônica e reconciliação | 109/109; `loading/green-authorized-final.log` e `green-authorized-final-proof.json` |
| Mensagens salvas: hook/API e compositor integrado | 33/33; `behavior/final-33.log` e `behavior/proof.json` |
| Painel e onda adaptativa | 24/24 finais; `visual/fit-final-frozen.log`. Mais 17 controles de painel/histórico em `visual/fit-and-panel-final.log`, que também contém uma rodada anterior dos mesmos 24 casos. |
| Mídia, rolagem e gravador | 33/33; `visual/media-all-green.log` |
| Página/balão integrados, layout e superfície mobile | 63/63; `surfaces-final.log` — layout13, superfície12, integração38. Os mesmos 12 casos de superfície foram reforçados e passaram novamente em `mobile/final-app-insets.log`. |

São 279 casos versionados distintos nesta rodada, todos aprovados, sem skips. Não se trata da execução de todos os testes do repositório. A revisão independente adicional passou 8/8 no mesmo hash final do hook: `behavior/pagination-final-eight-proof.json` e `pagination-final-eight-available.log`.

Foram exercitados 320/390 px, alturas móveis de 568/820 px e desktop de 1440 px, com temas claro/escuro. O teste final de superfície reserva a geometria de AppHeader (64 px), main (20 px nas laterais/8 px acima) e navegação inferior (65 px, safe-area zero), sem montar o comportamento desses controles globais. Inclusive nesse espaço mais estreito, as 28 barras do áudio ficaram visíveis. Os casos incluem voltar/lista/reabrir, Sheet, busca/Escape/foco, menus, textos longos, estados vazio/loading/erro, movimento reduzido e reprodução durante renovação de URL. Capturas do painel, do áudio e da superfície móvel foram inspecionadas visualmente.

Dois testes legados de mídia passaram a verificar o comportamento real: preservação da posição de leitura e ação de ir ao fim, em vez de contar chamadas internas; proteção da fonte ativa de áudio e cancelamento de download após troca de identidade, em vez de assumir um número de fetches. Nenhum teste foi removido ou marcado como skip. As duas falhas legadas descritas no documento anterior de mensagens salvas estão encerradas por essa suíte de 33 casos.

Checks gerais após o último congelamento do produto:

- `npm run typecheck`: exit0, sem erros; `typecheck-final-authorized.log`.
- `npm run lint`: exit0, zero erros e os mesmos três avisos preexistentes de variáveis não usadas nos testes Supabase `property-inventory-eligibility.test.ts` e `public-property-catalog.test.ts`; `lint-final-authorized.log`. Nenhum aviso novo nos arquivos desta rodada.
- `git diff --check` nos arquivos alterados: exit0. Os 13 hashes de produtos/testes permaneceram iguais durante os checks; nenhum arquivo contém NUL. O CSS global também permaneceu idêntico ao snapshot inicial. Manifestos `final-sources-before.json`, `final-sources-after.json` e `closure-proof.json`.

Nenhuma falha reproduzida desta rodada ficou pendente. Isso encerra o escopo local acima; publicação, banco e prova com o provedor continuam separados.

As provas usam componentes, hooks, QueryClient, Radix e CSS reais, com autenticação, dados e transportes sintéticos e rede externa bloqueada. Parte dos testes de superfície usa hooks de dados substituídos; os testes de corrida usam o hook real. O sentinel de microfone verifica continuidade de montagem, não captura nativa. Os testes não comprovam navegador físico/Safari/PWA, latência do provedor, recebimento real, download de Geist por `next/font` ou comportamento em produção. Uma prévia local conectada à API publicada antiga também não publica as rotas de mensagens salvas.

## Arquivos e reversão seletiva

Produtos desta rodada: `hooks/use-whatsapp-messages-paginated.ts`, `hooks/whatsapp/use-whatsapp-quick-replies.ts`, `components/features/whatsapp/ConversationLeadPanel.tsx`, `components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx`, `components/features/whatsapp/ConversationsScreen.tsx`, `components/features/whatsapp/conversations/MobileConversationHeader.tsx` e `components/features/whatsapp/conversations/ConversationMessages.tsx`.

Snapshots anteriores por domínio estão em `loading/before`, `behavior/baseline`, `visual/baseline` e `mobile/before`; o checkpoint intermediário anterior ao ajuste do observador compartilhado está em `loading/before-peer-lifetime`. Para reverter, aplicar somente os hunks desta rodada contra esses snapshots, preservando todo o trabalho anterior. Não restaurar arquivos inteiros nem executar reset no checkout principal.

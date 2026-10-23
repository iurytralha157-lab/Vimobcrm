# Fechamento local dos quatro pontos de Conversas e balão — 14/10/2026

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. A rodada preservou o estado existente do checkout e começou pelos dois P2. Não houve deploy, push, migração, acesso ao banco, chamada ao provedor ou envio de mensagens reais.

## Resultado

| Ponto | Reprodução anterior | Como ficou |
| --- | --- | --- |
| P2 — reprodução durante renovação do link | Áudio e elementos de vídeo embutido/fullscreen pausavam ou voltavam ao início após a troca da URL assinada. | A fonte em reprodução permanece estável dentro da mesma identidade autorizada. Pausa e recuperação adotam o link novo preservando posição, velocidade, volume e mudo. Falha na retomada aparece como erro, sem repetir indefinidamente. |
| P2 — documento e ações em tela estreita | O balão interceptava o toque nas ações em 320 px. Na integração, o conteúdo interno do Radix media 428 px dentro de um viewport de 296/320 px. | Balão e placeholders respeitam a largura disponível. Somente os contêineres de rolagem das mensagens, nas duas superfícies, sobrescrevem o `display:table` interno do Radix. Documento, download e ações continuam visíveis e acessíveis. |
| P3 — movimento reduzido | Parte dos spinners, presença pulsante e entrada de mensagem ignorava a preferência do sistema. | `motion-reduce:animate-none` cobre esses estados. Texto de carregamento, `aria-busy`, bloqueio dos botões e feedback continuam funcionando; o estado pendente não é ocultado. |
| P3 — toque sem perder compactação | Áreas de 28/32 px eram pequenas. Ampliar todas horizontalmente para 44 px comprimia o áudio e seu rodapé em 320 px. | Com ponteiro de toque, ações da mensagem têm 32×44 px, mantendo superfície visual de 28 px; ações compartilhadas do cabeçalho têm 36×44 px, mantendo superfície visual de 32 px. Não há sobreposição e o nome conserva pelo menos 40 px no host de 296 px. Com mouse, a geometria anterior permanece. |

O rodapé de áudios de 10/60 minutos pode quebrar a linha quando a largura exige. A saída conserva horário/recibo à direita e a entrada conserva o horário à esquerda. Avatar, direção do player e desenho das 28 barras permanecem. Os cinco placeholders de referência mantiveram exatamente as dimensões anteriores no desktop.

## Preservação visual e de acesso

Fontes, pesos, cores e tokens de arredondamento não foram alterados nesta rodada. As medições integradas confirmaram texto da mensagem 12 px/peso 200 e título Documentação 11 px/peso 400, com folga vertical de 4 px para Anexar. O laranja sólido dos envios, ações sutis laranja/50, sobreposição branca do horário nas mídias, superfícies neutras e raios aprovados continuam.

O novo hook de reprodução fica em `hooks/whatsapp/use-message-playback-source.ts`. O coordenador puro fica em `lib/whatsapp-audio-playback-coordinator.ts`; o caminho antigo reexporta o mesmo singleton. Players, visualizador e gravador continuam compartilhando a exclusão de reprodução.

A estabilidade da reprodução não amplia TTL nem interrompe a renovação e a verificação de acesso. Fonte nula/403, troca de organização, usuário, acesso, lead, sessão ou mensagem invalidam a fonte anterior. Trocas A→B→A e promises atrasadas não retomam uma reprodução abandonada. Encerramento, erro terminal e desmontagem pausam e liberam o player. Houve revisão independente desses caminhos e dos deltas de geometria.

`app/globals.css` permaneceu idêntico ao snapshot inicial. Não foram editadas primitives em `components/ui`. Os 248 arquivos Go do fechamento anterior da fila permaneceram com os mesmos hashes; esta rodada não mudou a fila nem repetiu seu teste como se fosse uma nova validação.

## Validação final

**161 testes distintos passaram, zero falhas e zero skips.** A soma abaixo usa somente a última rodada de cada grupo, sem somar REDs, repetições ou contagens históricas.

| Grupo | PASS | Evidência em `D:/Vimob/tmp/whatsapp-final-four-fixes-20261014/` |
| --- | ---: | --- |
| Reprodução e negativos de acesso/retomada | 29 | `playback/frozen-volume-final-29.log` e `playback/proof.json` |
| Balões, direção do áudio, retry, layout e toque | 55 | `mobile/regressions-complete-green.log` e `mobile/sources-{before,after}-final.json` |
| Página e balão completos com componentes/CSS reais | 38 | `integration/final-v2-green.log` e `integration/proof.json` |
| URLs, limite de requisições, visualizador, busca e painel | 39 | `root/regressions-final.log` |

A matriz integrada incluiu 24 combinações de documentos (duas superfícies × 320/390/1440 px × dois temas × recebido/enviado), oito reproduções nativas de áudio em 320/390 px atravessando a renovação, dois casos de movimento reduzido e quatro fluxos mobile de resposta/reação/menu/busca/voltar/Sheet/foco. A suíte de geometria também percorreu 96 combinações de tipos de mensagem, largura, tema e direção, além de duração longa e controles desktop.

`npm run typecheck` passou na versão final. O lint global passou com zero erros e três warnings preexistentes em testes de propriedades; o lint final dos 26 arquivos alterados/adicionados passou sem erros ou warnings. Os hashes antes/depois das suítes finais coincidiram. O ROOT inspecionou capturas reais dos dois consumidores em 320/390 px, claro/escuro e controle desktop de 1440 px.

O RED válido está preservado em `playback/final-baseline-red.log`, `mobile/red.log`, `mobile/long-audio-red.log` e `integration/final-baseline-red.log`/`integration/overflow-red/`. Tentativas antigas com erro de import/loader, fixture HTTP sem Range ou caminhos de baseline mal escapados não são prova de regressão e não entram na contagem.

Manifestos, hashes atuais e estado do checkout: `root/source-proof.json` e `root/closure-proof.json`. O snapshot inicial contém 192 arquivos; mais cinco arquivos novos estão identificados separadamente. Há 52 PNG e 32 registros de geometria da matriz integrada em `integration/screenshots-final/`.

## Limites da prova

Os testes são fechados em Chromium, com CSS e componentes de domínio reais, transporte/autenticação/dados/permissões/shell sintéticos e rede externa bloqueada. As reproduções usam PCM/WAV sintético em elementos nativos de áudio e vídeo; não exercitam codec MP4 nem mídia do provedor real. O microfone é um sentinel e seu texto nas capturas não representa o botão real do gravador. Filtros avançados e algumas fronteiras de agenda/imóvel/criação também são sentinels.

Não houve validação em aparelho físico, Safari, teclado móvel real ou PWA instalada. O harness confirma tamanho/peso, mas não carrega Geist via `next/font`. Não foi encontrada pendência reproduzível dos quatro pontos dentro deste escopo local; esses limites não são uma confirmação de comportamento em produção.

## Comandos reproduzíveis

```powershell
npm run typecheck
npm run lint
node --test --test-concurrency=1 components/features/whatsapp/message-playback-renewal.runtime.test.mjs components/features/whatsapp/mobile-media-actions.runtime.test.mjs components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs
node --test --test-concurrency=1 components/features/whatsapp/message-bubble-experience.runtime.test.mjs components/features/whatsapp/message-audio-direction.runtime.test.mjs components/features/whatsapp/message-audio-retry.test.mjs
node --test --test-concurrency=1 hooks/use-whatsapp-message-media-url.runtime.test.mjs hooks/whatsapp-media-slot.test.mjs components/features/whatsapp/attachment-viewer-controls.runtime.test.mjs components/features/whatsapp/conversations/history-controls-ui.runtime.test.mjs components/features/whatsapp/conversations/panel-closure.runtime.test.mjs
```

Os comandos normais usam fixtures locais e não exigem banco ou credenciais. As variáveis de evidência/baseline servem somente para comparação com os snapshots preservados fora do checkout.

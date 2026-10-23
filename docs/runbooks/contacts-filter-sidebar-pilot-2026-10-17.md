# Piloto local: filtros laterais em Contatos

Atualização: a expansão autorizada após este piloto está registrada em
[Filtros do CRM: adoção local da lateral e compatibilidade de tags](crm-filter-sidebar-rollout-2026-10-17.md).
Este documento conserva o histórico do piloto.

Escopo autorizado: checkout principal, visual lateral somente em Contatos,
sem deploy. A adoção nas demais páginas depende da revisão deste piloto.
Na última rodada, o usuário autorizou remover definitivamente a funcionalidade
de filtros salvos e links compartilháveis de todos os consumidores do CRM.
As seções de implementação e validação anteriores registram o histórico;
o estado ao fim do piloto está em "Redesenho visual e remoção de filtros salvos" abaixo.

## Contrato de apresentação

- Contatos opta por `presentation="sidebar"` em `SharedFilters`. O padrão
  continua sendo `popover` para os outros consumidores.
- O botão e o calendário de período conservam o componente e os callbacks
  existentes. Os blocos da toolbar de Contatos são a referência visual.
- O painel entra pela direita. No desktop, mantém a página acessível; no
  celular, usa isolamento modal e reserva no rodapé o espaço do balão.
- Cabeçalho e rodapé permanecem disponíveis enquanto os campos rolam.
  `Buscar` valida a busca e fecha. As seleções continuam sendo aplicadas
  imediatamente; não há uma etapa nova de aplicação em lote.
- Busca inválida impede o fechamento e a abertura do chat pelo balão, com
  retorno do foco ao campo. Menus internos conservam o escopo de camada.
- A toolbar de Contatos mantém uma única árvore de controles ao mudar entre
  mobile e desktop. A disposição responsiva conserva a organização anterior
  sem fechar a lateral nem descartar a busca em edição.

## Coordenação com o WhatsApp

O coordenador contém somente estado temporário de interface. Ele não altera
os critérios compartilhados nem o estado da conversa. A posição escolhida
para o balão é conservada: a lateral solicita uma posição temporária à
esquerda e o fechamento libera essa solicitação.

No celular, a mesma instância do launcher é apresentada no espaço reservado
do rodapé. A troca de posição respeita a preferência de movimento reduzido.
Uma solicitação de abertura do chat valida o fechamento do filtro e aguarda
a saída efetiva do painel. Troca de página, identidade ou organização cancela
solicitações pendentes.

O chat expandido é ocultado temporariamente enquanto o filtro ocupa a tela;
o coordenador não chama `closeChat` para isso. Conversa, texto e anexos não
devem ser descartados por essa ocultação.

A ocultação conserva a identidade do composer e suspende somente a interação
visual: foco, Escape, leitura automática e medições da rolagem. O hook de
rolagem recebe `suspended` opcional, desativado por padrão, para conservar a
âncora do histórico enquanto o elemento está oculto. Os demais consumidores
mantêm o contrato anterior. O contexto de critérios e o contexto de conversa
não foram alterados.

## Verificação local

Regressões da primeira implementação do piloto:

| Comando (`node --test`) | Resultado |
| --- | --- |
| `scripts/tests/contacts-filter-application-runtime.test.mjs` | 5/5 |
| `scripts/tests/filter-state-concurrency-runtime.test.mjs` | 16/16 |
| `scripts/tests/filter-report-period-runtime.test.mjs` | 9/9 |
| `scripts/tests/filter-ui-runtime.test.mjs` | 31/31 |
| `lib/filters/filter-panel-layout.test.mts` (com alias hook) | 9/9 |
| `hooks/use-whatsapp-thread-scroll.runtime.test.mjs` | 20/20 |
| `components/features/chat/floating-frame-scope.runtime.test.mjs` | 7/7 |
| `components/features/whatsapp/conversations/floating-mobile-modal.runtime.test.mjs` | 10/10 |
| `components/features/whatsapp/conversations/reduced-motion-controls.runtime.test.mjs` | 15/15 |
| `scripts/tests/contacts-sidebar-floating-runtime.test.mjs` | 4/4 |
| `scripts/tests/contacts-sidebar-runtime.test.mjs` | 36/36 |

Total: 162 testes locais aprovados, sem falhas ou skips nas execuções finais
desses conjuntos. O teste temporário de captura das prévias não entra no total.
Dados e identidades dos ensaios são sintéticos, com transporte externo
bloqueado. Nenhum resultado local comprova produção, Safari nativo ou um
aparelho físico.

`npm run lint` terminou com exit 0, zero erros e sete avisos em arquivos fora
do piloto. A verificação focal dos arquivos de produto alterados também passou.
O lint dos sete arquivos novos de teste passou sem avisos.

Execução conjunta do piloto:

```powershell
node --test --test-concurrency=1 scripts/tests/contacts-sidebar-runtime.test.mjs scripts/tests/contacts-sidebar-floating-runtime.test.mjs
```

Teste puro do coordenador:

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/filters/filter-panel-layout.test.mts
```

Na primeira implementação, `npm run typecheck` **não passou na execução final**:
exit 2, TS2367 em
`components/features/leads/LeadDetailDialog.tsx:1537`. Dentro de uma condição
que já exclui `pipeline`, a expressão compara novamente `variant` com esse
valor. Esse arquivo não foi alterado pelo piloto. O primeiro typecheck desta
sessão havia passado. Esse resultado é histórico; a rodada adicional abaixo
registra a nova execução dos gates no checkout principal.
O diagnóstico final não apontou erro nos arquivos do piloto. Logs estão na
pasta de evidências ao fim deste documento.

Os testes com `FloatingChat` real verificam rascunho, arquivo, legenda e
identidade do composer; mensagem nova enquanto oculto não é marcada como
lida. Escape fecha somente o filtro. O histórico com 45 mensagens conserva
a posição de leitura distante do fim. O wrapper mobile também conserva o
mesmo DOM e arquivo por três ciclos de ocultação e restauração, com Tab e
Shift+Tab entre os controles extremos.

O ensaio da lateral cobre 320, 390, 768, 1024, 1280 e 1440 px, janelas com
420 px de altura e temas claro/escuro. Inclui campos e seletores aninhados,
busca válida/inválida, composição, fechamento/foco, mudança de breakpoint,
cancelamento de abertura tardia do chat por pathname/organização e animação
sem movimento reduzido em 320/390 px. A coleta por frame confirma um balão
único, dentro da viewport, sem ultrapassar o destino.

Foram conferidos hashes de 12 arquivos preservados. Onze permaneceram
idênticos, incluindo calendário, Sheet, contextos de critérios/conversa e os
cinco consumidores que mantêm popover. A única alteração desse conjunto foi
a toolbar de Contatos, necessária para corrigir o remount no breakpoint.
Os 16 arquivos de produto do piloto permaneceram estáveis durante a rodada
final de testes. Checkout `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`,
sem conflitos Git. Não houve commit, push, banco, serviço real ou deploy.

## Arquivos para revisão

- `ContactsScreen.tsx`: ativa a opção do piloto em uma linha.
- `ContactsToolbar.tsx`: mantém a identidade dos controles no resize, com
  os mesmos tamanhos, textos e organização visual de mobile/desktop.
- `SharedFilters.tsx` e `components/shared/filters/`: conservam os campos e
  separam o transporte existente do novo painel lateral. A primitiva Sheet e
  o calendário permanecem inalterados.
- `FilterPanelLayoutContext.tsx`, coordenador em `lib/filters/` e provider
  escopado: coordenam a presença real do painel, posição temporária e abertura
  do chat; cancelam solicitações pendentes na troca de escopo.
- `FloatingChatButton.tsx` e `FloatingLauncherPlacement.tsx`: conservam uma
  instância do balão e o lado escolhido, com deslocamento temporário animado.
- `FloatingChat.tsx`, `FilterAwareMobileChatSurface.tsx` e hook de rolagem:
  preservam o conteúdo e suspendem a interação visual durante o painel.

O legado `SharedFilters.tsx` diminuiu de tamanho ao extrair o transporte. O
legado `FloatingChat.tsx` recebeu apenas a ligação de apresentação e os gates
visuais necessários. Dividir os campos e o restante do chat fica fora deste
piloto para não misturar as outras auditorias.

## Reversão

Desativar a opção `presentation="sidebar"` em Contatos restaura o transporte
anterior nessa página. Se for necessário retirar a implementação, inverter
somente os hunks do piloto, conferindo alterações posteriores. Não restaurar
arquivos inteiros: o checkout contém contribuições de outras auditorias.

Cópias anteriores, hashes de arquivos preservados e evidências desta sessão:
`C:\Users\andre\AppData\Local\Temp\vimob-contacts-sidebar-20261017-005310`.

## Correções após a revisão do piloto (17/10)

Esta rodada continua somente em Contatos, no checkout principal, sem deploy.
Preserva as alterações das outras auditorias, o calendário, as primitivas e
os consumidores que continuam com popover.

- O balão continua clicável ao passar do mobile para desktop com a lateral
  aberta ou ao ativar redução de movimento. O bloqueio de ponteiro permanece
  durante a retirada do painel e o transporte mobile.
- Ao ceder foco ao calendário, o chat encerra a intenção de restauração
  pendente. Selecionar outra conversa volta a focar o compositor, sem tirar
  o foco de um calendário ainda aberto.
- O nome de favorito em edição fica num contexto efêmero fora do remount do
  conteúdo Radix. Preserva-se apenas enquanto o painel está aberto e dentro
  da mesma conta, organização e assinatura de acesso. Fechar ou trocar esse
  escopo descarta o nome; não há persistência nova nem mudança no popover.
- A toolbar quebra os grupos em linhas quando a área útil não comporta os
  controles. A ordem do DOM acompanha a ordem visual e o foco é preservado
  quando o React move um grupo responsivo. Os blocos mantêm fonte, ícone e
  tamanho da referência de Contatos.
- O contraste de Concluir e dos textos auxiliares foi ajustado apenas dentro
  da lateral. O botão apresenta 5,26:1 no estado normal e 6,13:1 no hover.
- A abertura da exportação aguarda a atualização da busca aplicada. Um diálogo
  já aberto recebe a busca aplicada imediatamente, sem usar o valor atrasado
  da lista. Não se altera a política de cancelamento de uma exportação iniciada.

O provider de rascunho tem 45 linhas. A ligação em `SharedFilters.tsx`, legado
acima de 800 linhas, acrescenta somente import e wrapper; não se refatoram os
campos compartilhados nesta correção. A extração futura desses campos continua
fora do piloto para preservar as auditorias paralelas.

Para reverter esta rodada, inverter somente os hunks correspondentes às
correções acima, preservando mudanças posteriores. A opção de desligar o
sidebar em Contatos permanece disponível; não restaurar arquivos inteiros.

Baselines, patches incrementais e logs da rodada:
`C:\Users\andre\AppData\Local\Temp\vimob-contacts-pilot-fixes-20261017-014818`.
As capturas de geometria e contraste também estão em
`C:\Users\andre\AppData\Local\Temp\vimob-contacts-pilot-fixes-20261017-ui`.

### Validação final desta rodada

| Conjunto | Resultado |
| --- | --- |
| Lateral, chat real, layout/contraste, rascunho de favorito, aplicação em Contatos, concorrência, períodos e UI compartilhada | 118/118 |
| Coordenador de apresentação | 9/9 |
| Hook de rolagem do WhatsApp | 20/20 |
| Escopo do chat, modal mobile e redução de movimento | 32/32 |

Total: **179 testes aprovados, zero falhas e zero pulos**. Os conjuntos
existentes foram mantidos; a rodada acrescenta 17 casos de regressão. Os bugs
de clique, foco, rascunho, exportação, sobreposição, Tab e contraste tiveram
reprodução negativa antes da correção e validação positiva depois.

`npm run typecheck` passou (exit 0). `npm run lint` passou (exit 0), com zero
erros e sete avisos preexistentes fora do piloto, em scripts da fila e testes
Supabase de imóveis. Não se altera configuração de lint ou dependências.

O ensaio geométrico verifica 20 combinações desktop, com menu de 56/208 px,
larguras de 768 a 1280 px e importação ligada/desligada. Também verifica ordem
do Tab, identidade e foco nos dois sentidos do breakpoint, busca/nome em
edição e contraste normal/hover nos temas claro e escuro em 320/1024 px.
Os demais testes da lateral continuam cobrindo telas baixas e mobile.

Os testes usam Chromium local, dados sintéticos e transporte externo
bloqueado. Não comprovam Safari/Mac, VoiceOver, aparelho físico ou produção.
Não houve exportação real, serviço, banco, commit, push ou deploy. A expansão
para outras páginas permanece fora desta rodada.

## Redesenho visual e remoção de filtros salvos (17/10)

Esta seção substitui as referências históricas a favoritos, seus rascunhos,
links de filtros e ao botão Concluir. A remoção da funcionalidade foi uma
solicitação explícita do usuário e vale para todos os consumidores. A lateral
e suas novas regras visuais continuam restritas a Contatos.

- Removidos os componentes de salvar/escolher/excluir/compartilhar filtros,
  o provider de nome em edição, o armazenamento de favoritos, o codec de links
  e a leitura de hashes no contexto. Nenhum controle ficou apenas desativado.
  O snapshot de critérios e a persistência normal por sessão permanecem.
  Dados antigos de favoritos no navegador ficam sem consumidor; os testes
  não apagam nem regravam dados reais do usuário.
- Cabeçalho sem contador, X com fundo cinza, busca com ícone centralizado,
  rodapé com Limpar filtros cinza e Buscar no laranja da marca. O texto escuro
  do botão laranja mantém contraste de leitura.
- Campos ativos têm fundo laranja a 50%, inclusive seletores e busca aplicada.
  Bordas e divisórias pretas foram removidas da lateral e dos seus menus.
  O indicador de foco continua visível. As regras não alteram o tema dos
  popovers usados pelas outras páginas.
- Superfície branca translúcida no tema claro e equivalente escura no tema
  escuro, com blur discreto. A largura é `min(400px, 90vw)`: no mobile fica
  visível uma faixa da página. Cabeçalho e rodapé ficam disponíveis com
  rolagem independente dos campos, incluindo áreas seguras do aparelho.
- O Sheet mantém a mesma árvore de editores ao cruzar o breakpoint. Uma
  camada local ativa isolamento, bloqueio de rolagem e contenção de foco
  somente no mobile. Usa bibliotecas já presentes no lockfile, sem instalar
  dependências ou editar primitivas. Portais pertencentes ao filtro preservam
  foco e acessibilidade. Seleção parcial, cursor e composição IME permanecem
  nos dois sentidos do resize.
- Fechar pelo X, Buscar, Escape ou faixa externa respeita a busca inválida
  e a composição em andamento. No mobile, o fechamento devolve foco ao botão
  de filtros, preservando um diálogo superior que já tenha recebido foco.

O problema de duplicar favoritos durante uma gravação pendente deixa de ter
esse fluxo, pois a funcionalidade foi removida. O problema independente de
perda de foco/cursor/composição foi corrigido e tem regressão dedicada.
O período, as regras dos critérios, os dados do CRM e o comportamento de
negócio do WhatsApp foram preservados.

### Validação do redesenho

| Conjunto | Casos únicos aprovados |
| --- | ---: |
| Piloto lateral, chat flutuante e ausência de controles salvos | 47 |
| Layout, temas, contraste, menus e áreas seguras | 7 |
| Edição, IME nativo, foco e fechamento responsivo | 12 |
| Aplicação em Contatos, períodos, sessão concorrente e UI compartilhada | 53 |
| Contratos puros de critérios | 11 |
| Coordenador de apresentação e mensagens de erro | 13 |
| Rolagem, escopo do chat, modal mobile e movimento reduzido | 52 |
| **Total** | **195** |

Não há casos pulados. O conjunto de 53 teve um seletor de teste corrigido
(`Manual` para o valor `manual`) e o caso foi reexecutado com as regressões
relacionadas; a contagem considera cada caso apenas uma vez. Foram removidos
somente testes específicos da funcionalidade excluída, preservando os demais
contratos e acrescentando verificações de sua ausência e de hashes antigos.

`npm run typecheck` e `npm run lint` passaram na versão final (exit 0).
O lint registrou zero erros e sete avisos preexistentes em arquivos de fila
e testes de imóveis, fora deste escopo. O diff restrito passou sem erros de
espaçamento. Calendário, primitiva Sheet e CSS global coincidem com os hashes
anteriores à rodada. Os arquivos de produto e testes ficaram congelados
durante os gates finais; o manifesto registra também as exclusões esperadas.
Checkout `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, sem conflitos.
Não houve commit, push, instalação de dependências, banco, serviço ou deploy.

Os ensaios são locais em Chromium, com dados sintéticos e chamadas externas
bloqueadas. Incluem 320/390 px, janelas baixas e desktop até 1440 px, temas
claro/escuro, teclado, mudança de breakpoint e menus aninhados. Não comprovam
Safari/Mac nativo, VoiceOver, teclado físico de celular ou produção.

Evidências, baselines incrementais e capturas:
`C:\Users\andre\AppData\Local\Temp\vimob-contacts-visual-20261017-020725`.

Para reverter a apresentação lateral, desativar a opção somente em Contatos
ou inverter seus hunks específicos. A remoção dos filtros salvos é uma
mudança independente e não deve ser desfeita ao reverter o visual. Nunca
restaurar arquivos inteiros neste checkout compartilhado com outras auditorias.

# Pipeline: rolagem dos painéis ao atualizar o lead — item 12/P6

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`.
Base: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com alterações locais preexistentes.
Evidências: `D:/Vimob/outputs/pipeline-detail-scroll-p6-fix-20261019-e132`.

## Causa reproduzida

O efeito de inicialização do formulário em `LeadDetailDialog` dependia do
objeto `leadProp` inteiro e chamava `scrollTo({ top: 0 })` nos painéis de Dados
e Ações. Uma atualização do mesmo lead pelo quadro/consulta substitui esse
objeto sem representar uma nova navegação. A reprodução do efeito real mostrou
posições de 350/420 passando para 0/0, com o mesmo lead, organização e ator.

## Correção e comportamento

As duas chamadas de rolagem saíram do efeito de formulário. Um `useLayoutEffect`
independente executa o reset apenas ao mudar os valores primitivos que
identificam o contexto: ID do lead, organização do lead, organização ativa,
usuário e ID estável da sessão. O helper existente de sessão continua sendo
usado; não houve mudança de autenticação ou autorização.

| Situação | Resultado |
|---|---|
| Novo objeto/revisão do mesmo lead, mantendo o contexto | Posição preservada. |
| Atualização de nome, status, etapa, responsável ou tags | Sem reset forçado da rolagem. |
| Formulário recebe dados novos ou muda seu estado de edição | A sincronização original continua; rolagem não depende mais desse efeito. |
| Renovação de token com o mesmo ID de sessão | Posição preservada. |
| Outro lead, organização, usuário ou sessão | Painéis com as referências montadas começam no topo. |
| Fechar e reabrir o mesmo lead | Os consumidores desmontam o detalhe; novos painéis começam no topo. O ciclo `lead=null` → mesmo ID também é coberto. |

O reset acontece após o commit das referências, antes da pintura do novo
contexto. Não há cache de posições, restauração manual em cada render, nova
chave de componente ou mudança de animações.

O desktop de Pipeline e Contatos compartilha esses dois painéis. O mobile usa
painéis condicionais diferentes, sem essas referências: seu comportamento foi
preservado, incluindo a remontagem existente ao trocar de seção. O histórico
tem rolagem própria em `LeadUnifiedThread` e não foi alterado por esta correção.

A posição ainda obedece ao comportamento nativo do navegador quando o conteúdo
ou a altura disponível diminui: o navegador pode limitar o deslocamento. O
defeito corrigido é o envio indevido ao topo durante uma atualização de dados.

## Preservação do restante

O efeito original de formulário conservou seus guards, campos, dependências,
controle de revisão e microtarefas. Os handlers de atribuição/status/feedback,
as correções financeiras anteriores, abertura/fechamento, Agenda, cadências,
tags, histórico e JSX/estilos não foram modificados.

Os consumidores de Pipeline e Contatos mantêm suas chaves e política de
montagem. A versão de seleção já remonta a boundary na Pipeline; mudanças de
cache ou referências de objetos não viraram novos gatilhos de navegação.

A adição ao componente legado acima de 800 linhas é limitada ao efeito
independente e ao ID estável da sessão. A remoção do editor inline e a divisão
da apresentação permanecem no item 14/P8, sem refatoração incidental aqui.

## Validação e evidências

- `scroll-before-probe.log`: efeito real anterior, mesmo contexto, 350/420 → 0/0.
- `detail-scroll-scope-review.json`: revisão independente por AST; seis
  verificações aprovadas, confirmando somente o delta de rolagem descrito acima.
- O teste `lead-panel-scroll.runtime.test.mjs` usa efeitos/referências e
  atributos de containers extraídos do produto, React e Chromium isolado.
  Dados, contexto e conteúdo são sintéticos; não equivale a abrir o CRM real.
- A primeira execução ampla encontrou 19 falhas de montagem no teste de
  salvamento: seu seletor ainda procurava a condição antiga de permissão.
  A mesma falha foi reproduzida contra o arquivo anterior e o atual. O
  harness passou a localizar o efeito por AST e modelar `poolReadOnly`;
  os 19 casos/asserts originais permanecem idênticos. Um controle adicional
  verifica o bloqueio de contato/imóvel ao entrar em somente leitura.
  A execução isolada passou nos 20 casos, sem skips. Recibo e logs:
  `contact-save-harness-receipt.json`, `contact-save-harness-red.log` e
  `contact-save-harness-green.log`.
- Recibos da execução, regressões do detalhe, typecheck, lint e inventários
  ficam na pasta de evidências indicada no início deste documento.
- Resultado final: **702/702 testes em 37 arquivos**, sem falhas, cancelamentos
  ou skips (`regressions-summary.json`). A contagem inclui os seis casos de
  rolagem; eles não são somados novamente à execução ampla. A execução RED
  do efeito anterior falhou em três casos de rolagem e passou em três controles.
- `npm run typecheck`, `npm run lint` e `npm run audit:check` passaram.
  O lint global mantém sete avisos preexistentes em testes/scripts de outros
  domínios; o lint dos três arquivos de código/teste deste ajuste ficou limpo.
  Os quatro contratos de auditoria passaram. Os inventários gerados não têm
  alteração semântica (`inventory-semantic-diff.json`).
- `preservation-receipt.json` compara os hashes antes/depois, a lista explícita
  de alterações e os ajustes anteriores protegidos.

## Reversão e limites

A reversão é pontual: remover o novo efeito/ID da sessão e recolocar as duas
chamadas no efeito de formulário reintroduz o comportamento anterior. Não
restaurar o arquivo inteiro sobre os ajustes locais de outras tarefas.

Não houve commit, push, deploy, início de serviços do CRM, acesso a banco real,
aplicação de migrations ou alteração de configuração remota. A validação de
mobile usa Chromium com viewport reduzido; não é teste em iPhone/Safari físico.

Este é o item 12 da lista original. Os itens 13/P6 (resposta booleana `false`
dos formulários) e 14/P8 (caminhos legados sem uso) permanecem separados.

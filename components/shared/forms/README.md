# Formulários por etapas

`FormWizardLayout` organiza a navegação textual, a área central, a lateral e o
rodapé dos formulários do CRM. A geometria e as classes dos botões ficam em
`config/form-wizard.ts`; as primitivas de `components/ui` não foram alteradas.

Cada domínio continua responsável por campos, estado, condições, permissões,
validação e salvamento. Navegar ou renderizar uma prévia não deve executar uma
mutação, um upload, uma importação, uma exportação ou uma publicação.

## Composição

- O domínio fornece o `Dialog`/`Sheet` e seu título acessível, sem subtítulo visual.
- As etapas usam `buttonId`, `panelId` e `tourId` quando precisam preservar os
  identificadores dos painéis e do guia. O painel deve ter `role="tabpanel"` e
  `aria-labelledby` apontando para o botão correspondente.
- `onStepChange` é controlado pelo domínio, inclusive bloqueios de execução e
  validações. O layout oferece teclado com setas, Home e End.
- O centro e a lateral têm rolagem própria no desktop; o rodapé fica fora
  dessas áreas. Em tela estreita, a navegação e a lateral reorganizam-se.
- A lateral tem 260 px no tablet e 300 px no desktop; o centro usa o restante.
- O botão principal usa apenas o **fundo** laranja a 50%; o texto usa
  `primary-foreground`. O secundário usa as superfícies e fontes do tema.
- Novidades reutiliza o diálogo existente do produto pela interface pública
  do domínio `news`.

## Consumidores e dados da lateral

Lead mantém suas quatro etapas na criação e três na edição. Importação e
exportação mantêm os parsers, colunas e handlers existentes, com a execução
somente na ação final. A prévia de importação valida uma amostra de identidade;
destinos, permissões, reentradas e tags são confirmados pela execução original.

Equipe e distribuição mostram dados do formulário na criação e seus históricos
existentes na edição. Presença, escala e destinatário efetivo de um lead são
conceitos distintos; ordem e peso configurados não garantem o próximo recebedor.

Imóvel conserva as seções, permissões, guarda de navegação, recuperação de fotos
e publicação automática existentes. A prévia pública da criação exclui campos
privados, fotos ocultas e endereço não autorizado. A edição usa acesso ao
histórico; dados CRM de mídia não substituem a projeção pública da Central.

Site mantém todas as seções e os salvamentos imediatos já existentes de menu,
filtros e imagens. Fechar protege alterações gerais ainda não salvas; não
reverte ações explicitamente salvas por esses controles. A lateral apresenta
as configurações sem executar scripts, pixels ou formulários públicos.

## Validação local

Execute `npm run typecheck`, `npm run lint`, `npm run test:form-wizards` e
`npm run test:property-ui`. Os E2E de lead/equipe/imóvel cobrem seus respectivos
contratos e precisam de um ambiente de teste configurado. Testes que gravam no
banco não devem ser executados contra produção para validar esta interface.

Os URLs atuais foram mantidos. Os editores em rota montam um diálogo; ao fechar,
o domínio retorna ao destino existente de lista/configurações. Nenhum schema,
contrato de API ou publicação de produção faz parte desta alteração visual.

# R2-WORKFLOW-TAG-LABEL — rótulo da tag ao reabrir um fluxo novo

## Causa e mudança

Na QA visual, o primeiro editor do fluxo mostrou “Clique para configurar” no
nó de tag, apesar de a ação por ID ter funcionado. O builder de criação
serializava `tag_id` e `tag_action`, mas descartava `tag_name` já disponível em
memória. O editor hidrata o rótulo a partir de `config.tag_name`; sem esse campo,
o `TagNode` apresenta o placeholder. A ação permanece vinculada pelo ID.

O ramo `tag` de `FollowUpBuilder.tsx` agora usa a mesma resolução já existente
em `FollowUpBuilderEdit.tsx`: nome atual do catálogo selecionado ou, quando
indisponível, o nome configurado no nó. O payload preserva esse `tag_name`.
ID, ação de adicionar/remover, posição, gatilho, filtros e demais tipos de nó
continuam com seus caminhos existentes. Não há cálculo, envio ou execução nova.

`NodeConfigPanel` já preenche nome e ID na seleção. O repositório da API grava
`node.Config` como JSON; não havia enriquecimento que recompusesse o nome
descartado. O editor, o `TagNode` e o servidor não precisaram mudar.

## Evidência e limite temporal

O replay offline executa os callbacks reais de serialização de criação/edição,
faz round-trip JSON, executa o callback real de hidratação do editor e renderiza
o `TagNode` real por React SSR. Os ports do React Flow são inertes no SSR;
não se afirma execução do editor inteiro no navegador, API ou PostgreSQL.

O artefato operacional existente tem `stored_tag_name_present=false` para o
nó **trigger** e `true` para o nó **action** do grafo atual, já editado. Essas
linhas não representam versões 1/2. A lista de versões registra IDs de tag e
contagens, sem presença do nome. Não se deduz desse artefato que a versão 1
armazenada não tinha nome, nem que o problema persistia no grafo atual.

O witness visual inicial, a assimetria dos serializers e o replay antes/depois
sustentam a causa. Não foi feita nova mutação remota, backfill, ativação ou
reexecução de automação para produzir a prova.

## Verificações

O novo `follow-up-tag-label.runtime.test.mjs` tem 13 casos: adicionar/remover,
nome atual do catálogo, fallback do nome em memória quando catálogo não
carregou/está vazio, configuração vazia sem nome inventado, persistência do
editor existente e controle do gatilho sem metadados de tag.

- RED: 13 casos, 8 falhas da omissão e 5 controles aprovados, sem skips.
- GREEN focado: 13/13, sem skips.
- Gate permanente: append ao `test:form-wizards` existente; sem job,
  dependência ou instalação adicional. Na base desta worktree, 82 + 13 = 95;
  a integração com o ajuste de affordance de tags deve preservar os dois
  appends, totalizando 134.
- `npm run test:form-wizards`: 95/95, sem falhas ou skips nesta base.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, zero erros e oito avisos preexistentes.
- `npm run audit:check`: 4/4, sem falhas ou skips; inventários regenerados na
  ordem CRM → Home. `git diff --check`: exit 0.

As duas execuções iniciais do harness apontaram dependência não injetada do
editor e ports do pacote React Flow errado. Foram corrigidas somente no
harness antes do RED válido acima. Os logs iniciais foram preservados;
não são contabilizados como falhas de produto.

## Escopo, dívida e reversão

O builder é legado acima de 800 linhas. O acréscimo local de uma declaração e
de uma propriedade fica no único ramo dono do defeito e reutiliza o contrato
do editor. Extrair serializers/hidratação por tipo é dívida de divisão futura,
com testes dos dois builders; fazer isso neste ajuste ampliaria o risco e o
escopo sem necessidade. Não houve refatoração incidental.

Não foram alterados schema, autorização, workers, API, protocolo de execução
ou regras de negócio. Reverter o commit do ajuste restaura a apresentação
anterior para novos salvamentos; não remove nomes já persistidos. Não há
migration, backfill ou limpeza de dados a desfazer. Reteste visual de criar,
salvar inativo e reabrir depois da release continua separado dos testes locais.

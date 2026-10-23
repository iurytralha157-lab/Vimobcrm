# Pipeline — continuação após mudança de equipe (P5)

Correção local de 20/10/2026 do FBL-01 da auditoria de filtros/busca/carregamento.
Checkout principal; sem deploy, commit, push, migration, banco operacional ou
reinício dos serviços CRM. O P3 do catálogo de equipes permanece preservado.

## Falha e contrato

O quadro carregava 12 de 24 leads. A inclusão de um corretor com um lead antigo
na equipe selecionada fazia a coorte passar a 25 sem mudar o cursor. A página
seguinte trazia 12, mas o cliente usava o total antigo 24 para marcar a coluna
como encerrada e esconder Carregar mais. O 25º só reaparecia após atualização.

A resposta de `GET /v1/pipeline-stage-leads` agora contém
`{stageId,leads,hasMore}`. A leitura usa os mesmos filtros/ACL e cursor, com
uma linha adicional, no máximo 101 para limite público 100. Só os primeiros
`limit` cards são devolvidos/enriquecidos; a sentinela reaparece na página
seguinte, cujo cursor é o último card retornado. O booleano é sempre emitido,
inclusive `false`. Não há count adicional nem alteração do snapshot RR inicial.

Foi preservado o wrapper de consulta anterior. A extração para queryer em
`pipeline_board.go` é mínima para testar o SQL/scanner sem abrir PostgreSQL;
a regra nova fica no arquivo pequeno `pipeline_stage_page.go`. Não houve
refatoração incidental do arquivo legado nem mudança de seus predicados.
O arquivo legado excede 800 linhas e recebeu uma linha líquida. Antes de uma
próxima expansão, separar a consulta de leitura em módulo próprio, mantendo
esse wrapper e os testes de SQL/scanner; essa divisão fica fora deste patch.

## Cliente, contagem e recuperação

O schema/adapter aceita `hasMore` opcional para API anterior, sem default que
confunda ausência com `false`. Com backend novo, o booleano governa continuação;
sem ele, página cheia com progresso mantém Carregar mais, mesmo atingindo o
total antigo. Uma página terminal confirma o fim; pode haver uma requisição
adicional de confirmação com API anterior.

O helper compartilhado mantém a projeção de contagem compatível com os
escritores de movimento/status: enquanto há continuação, usa pelo menos o
prefixo carregado+1; ao terminar, reconcilia o prefixo local. Quando esse piso
supera a contagem anterior, `pagination_count_is_estimate` marca a estimativa:
o contador mostra, por exemplo, 25+, e o botão fica apenas Carregar mais, sem
inventar N restantes. Snapshot novo substitui contagem e remove essa marca.
Não se promete métrica atômica de toda a coorte entre requisições HTTP.

Não houve mudança de fontes, classes, tamanhos, espaçamentos ou CSS.
As verificações de ator/SID/organização, filtros capturados, lease do snapshot,
cursor com microssegundos, movimentos pendentes e deduplicação permanecem.

Página não vazia inteiramente duplicada não esgota o cursor: o caminho manual
faz a reconciliação exata já existente, sem persistir profundidade nem anunciar
sucesso; restauração registra erro limitado à geração, sem loop automático.
Resposta vazia com `hasMore:true` também exige recuperação. O caso anterior de
coluna vazia com lead em outra coluna mantém sua recuperação integral.

Restauração continua sequencial e limitada a 60 por coluna, sem truncar a
profundidade desejada por um total inicial envelhecido quando há continuação.
Esse limite é de restauração automática, não de paginação manual.

## Evidência e checks

RED do hook real: 47 testes anteriores aprovados e 11 novos falharam em assertivas
de paginação/restauração, sem erro de import. Após a correção: 62/62, incluindo
os 47 corpos anteriores preservados e 15 novos casos. Os quatro casos adicionais
de recuperação foram executados somente na fase GREEN, sem alegação de RED.

Go focado: 71 folhas aprovadas, sem pulos; 33 novas. Controle causal externo
retirando apenas o overfetch voltou a falhar no caso 24→25. Usa queryer/rows
sintéticos e construtor SQL/scanner/capacidade reais, sem banco ou leitura de
equipes operacionais. Não confundir isso com SQL executado em PostgreSQL.

A seleção Node inclui helpers, modelo, schemas, adapter/pins, querykeys,
placeholders, cache, restauração e projeções de movimento/status/rollback.
Os dois novos arquivos de teste também foram registrados no runner canônico
`npm run test:pipeline-columns`; nenhum teste anterior foi removido.

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test --test-concurrency=1 hooks/pipelines/pipeline-page.runtime.test.mjs hooks/pipelines/pipeline-background-restore.runtime.test.mjs lib/pipeline-pagination-state.test.ts lib/pipeline-pagination-projections.test.ts lib/api/pipeline-stage-pagination.test.mjs
go test -count=1 ./apps/api/internal/leads ./apps/api/internal/app ./apps/api/internal/httpserver ./apps/api/internal/tenant ./apps/api/internal/teams
npm run typecheck -- --incremental false
npm run lint
npm run audit:check
```

Os recibos/logs finais de cada comando e a preservação Git/SHA ficam fora do
checkout em `D:/Vimob/outputs/pipeline-pagination-p5-fix-20261020-o026`.
O recibo lista separadamente os pulos de integração sem banco/opt-in; não são
aprovações. Um erro inicial de fixture Node foi corrigido no teste novo:
o plano sem relógio incluía campos de cursor undefined que a expectativa não
incluíra; a fixture passou a usar relógio/cursor explícitos. Nenhuma regra de
produto foi alterada para essa divergência de objeto.

## Compatibilidade, limites e reversão

Frontend novo funciona com API anterior; frontend anterior ignora o campo
aditivo, mas precisa do ajuste cliente para eliminar o encerramento pelo total.
Uma publicação futura deve incluir os dois lados desta unidade. Não foram
alteradas permissões, filtros, querykeys, estado global ou armazenamento.

Uma entrada nova acima do cursor ou uma mudança posterior à consulta ainda
depende da atualização normal do quadro. Não existe snapshot mantido entre
requisições; a correção garante a continuação observada naquela leitura.
Equipes/sessões reais, banco, carga de 300 usuários, iPhone/Safari físico e produção
não foram exercitados. O processo da API não foi reiniciado.

Reversão: desfazer seletivamente o helper/integração Go e o campo OpenAPI, mais
schema/adapter/helper/modelo e chamadas nos dois caminhos do cliente; preservar
os ajustes preexistentes e o P3. Retirar testes/documentação apenas junto da
unidade correspondente, sem reset de arquivos completos. Não há banco a
reverter. Voltar à lógica anterior reabre o P5; não publicar como correção.

Os inventários de superfícies e dívida visual foram regenerados pelos scripts
canônicos. A conferência semântica mostrou apenas digests e quatro posições/IDs
de CTA deslocados no próprio PipelineBoard; contagens e achados permaneceram.

Este patch fecha somente FBL-01. Catálogo/retry FBL-02 e os três P6 continuam
em etapas próprias.

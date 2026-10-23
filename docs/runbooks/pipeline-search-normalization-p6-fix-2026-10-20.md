# Pipeline — normalização da busca (FBL-05/P6)

## Escopo e comportamento

Correção local no checkout principal, preservando as alterações preexistentes.
Sem deploy, commit, push, migrations, acesso ao banco operacional ou reinício
dos serviços do CRM. As fixtures PostgreSQL são descartáveis e ficam fora do
checkout, com dados sintéticos.

O contrato do navegador permanece o mesmo: NFKD, remoção de U+0300–U+036F,
lowercase pt-BR com contexto e trim ECMAScript. Nomes armazenados, chaves de
cache, permissões, filtros, ordenação e apresentação não são reescritos.

- `searchtext.PipelineNormalize` passa a usar lowercase contextual, com Caser
  próprio por chamada. `ΟΣ` e `ος` coincidem; `ΟΣ` e `Σ` continuam diferentes,
  conforme o substring match atual do navegador. Não se introduz case folding.
- `PipelineTrim` remove os espaços ECMAScript, incluindo BOM nas bordas. Não
  remove U+0085, zero width space ou BOM interno. O parser aplica esse trim ao
  campo `search` antes do limite de 180 pontos de código e da rejeição de NUL.
  Não se conta o tamanho após decomposição ou remoção de marcas.
- `PipelinePhoneDigits` normaliza o termo antes do gate de formato de telefone;
  `PipelinePhoneSQL` normaliza o valor antes de extrair dígitos ASCII. Assim,
  dígitos/formatos de largura inteira são encontrados nos dois sentidos. Texto
  misto, e-mail, `%`, `_`, dígitos árabe-indianos e menos de quatro dígitos não
  ganham um fallback numérico independente.
- `PipelineSQL` remove as marcas antes de lowercase, usa ICU explícito e aplica
  collation C ao resultado para o LIKE literal. Os parâmetros continuam
  vinculados e `%`, `_`, barra invertida e aspas não viram SQL executável.

Os helpers genéricos `Normalize`, `Pattern`, `SQL`, `AnySQL`, `Contains`,
`PhoneDigits` e `PhoneSQL` mantêm seu comportamento. Frontend de Contatos,
Dashboard e demais abas não recebe alteração de código.

## Compatibilidade do PostgreSQL

O repositório declara PostgreSQL 17. Este caminho requer UTF8 e a collation
determinística `pg_catalog."und-x-icu"`, fornecida por builds com ICU. O uso
explícito evita depender do locale padrão do banco ou da coluna; não cria uma
collation nem executa uma migration durante uma consulta.

Antes de homologar ou publicar o binário em um alvo autorizado, conferir:

```sql
select current_setting('server_version'), current_setting('server_encoding');
select collprovider, collisdeterministic
from pg_catalog.pg_collation
where oid = to_regcollation('pg_catalog."und-x-icu"');
```

Esperado: encoding UTF8, uma linha de collation ICU (`i`), determinística.
Se o alvo não oferecer ICU, adequar explicitamente a infraestrutura suportada
antes de disponibilizar esse binário. Não substituir silenciosamente por
`lower()` dependente do locale, pois isso reabre o defeito. O banco operacional
e a produção não foram consultados nesta correção.

Referências: [collations do PostgreSQL 17](https://www.postgresql.org/docs/17/collation.html),
[lowercase contextual do Go](https://pkg.go.dev/golang.org/x/text/cases#Lower).

## Regressão e evidências

Testes permanentes: `searchtext/pipeline_test.go`,
`searchtext/pipeline_postgres_test.go`,
`leads/pipeline_search_normalization_test.go`, a expectativa específica da
Pipeline em `leads/search_filter_parity_test.go`, os casos de `stage-view.test.ts`
e de `pipeline-board-cache-filter-scope.test.ts`. As expectativas dos helpers
genéricos e de Contatos/Dashboard foram preservadas.

O teste PostgreSQL permanente só executa SELECTs e requer
`SEARCHTEXT_TEST_DATABASE_URL` apontando explicitamente para uma fixture isolada.
Sem essa variável, seu skip deve ser informado, nunca contado como aprovação.

Comandos de verificação na raiz:

```text
go test ./apps/api/internal/searchtext ./apps/api/internal/leads ./apps/api/internal/teams ./apps/api/internal/app
npm run test:pipeline-columns
npm run typecheck -- --incremental false
npm run lint
npm run audit:check
git diff --check
```

Artefatos e recibos desta execução:
`D:/Vimob/outputs/pipeline-search-p6-final-fix-20261020-v1`.
O corpus externo exercita normalizadores, parser, WHERE e argumentos reais,
cards e contadores sob duas organizações, três perfis e filtros combinados.
As consultas são repetidas em fixtures com default ICU e libc/C. A função de
visibilidade de pool é stub NULL na fixture: os testes de busca não representam
uma homologação completa de filas, RLS ou políticas implantadas.

Os checks, a revisão independente e os hashes permitem fechamento técnico
local. Eles não comprovam Safari/iPhone físico, carga de 300 usuários ou
funcionamento em produção. Os riscos condicionais e melhorias opcionais da
auditoria original continuam separados dos seis defeitos.

## Reversão

Reverter somente os trechos desta correção em `searchtext/search.go`,
`leads/pipeline_board.go` e `leads/pipeline_board_types.go`, junto das regressões
e desta documentação. Não restaurar arquivos completos do Git: há alterações
preexistentes de outras tarefas. Preimages e hashes da execução estão nos
artefatos externos. A reversão reabre FBL-05; os outros cinco pontos não devem
ser revertidos nem alterados.

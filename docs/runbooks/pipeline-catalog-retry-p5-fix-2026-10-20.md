# Pipeline — recuperação do catálogo de filtros (FBL-02/P5)

Correção local de 20/10/2026 no checkout principal. Sem banco operacional,
produção, deploy, commit, push, migrations ou reinício dos serviços CRM.

## Causa e comportamento

Um catálogo `[A,B]` continuava em cache após falha de refetch. Se outro gestor
removesse B e a seleção antiga retornasse `invalid_lead_reference`, o retry
crítico repetia board/stages de B sem consultar o catálogo: considerava somente
`isLoadingError`, ignorando `isRefetchError`. Mesmo acrescentar esse segundo
sinal ao Promise.all continuaria disputando o carregamento da referência antiga.

A recuperação agora é local à Pipeline, em
`hooks/pipelines/use-pipeline-critical-load-retry.ts`:

1. Captura acesso e visita da consulta antes do primeiro await. A visita inclui
   pipeline/filtros/visibilidade/SID pela chave canônica do quadro.
2. Em qualquer erro de catálogo ou referência inválida do board, atualiza o
   catálogo antes de buscar as dependências, com `cancelRefetch:false`.
3. Confere a mesma instância Query e um avanço de `dataUpdateCount` para aceitar
   sucesso. Um refetch cancelado pode resolver como sucesso com cache antigo;
   timestamp pode empatar no mesmo milissegundo. Erro só publica aviso após
   avanço de `errorUpdateCount`, evitando repetir erro antigo após cancelamento.
4. Só segue as leituras capturadas se a seleção ainda existir. Se a lista válida
   não contiver B, ou estiver vazia, o efeito de seleção existente faz o fallback.
5. O fallback aguarda catálogo sem erro, inclusive refetch. Falha 401/403/503 não
   é lista vazia, não limpa filtros nem troca a seleção por suposição.

O fallback continua local: uma opção padrão não grava A no seletor global
“todas”. Quando B desaparece, o efeito anterior limpa a seleção global inválida
para null e usa A localmente. Equipe, responsável, tags, busca, status e período
permanecem. O catálogo compartilhado pode refletir a lista atualizada, como
ocorria nas atualizações existentes, mas não ganhou política ou estado paralelo.

## Concorrência e fronteiras preservadas

O hook reutiliza `useLeadRequestScope` e `usePipelineEditorVisit`. Logout,
troca de ator/SID/organização/QueryClient, visita A→B→A e desmontagem aposentam
continuações e avisos da operação anterior. Renovação do token no mesmo SID
continua válida. Mutex por visita impede duplicar leituras por cliques rápidos.
Busy é próprio do retry crítico, composto nas props de Toolbar/Board; uma
tentativa antiga não libera o busy de uma visita nova.

Não foram alterados `usePipelines`, API/schema de pipelines, QueryProvider,
FilterContext, useSharedFilters, SharedFilters, primitivas UI, Go ou SQL.
Existem 17 consumidores runtime de usePipelines; não se generalizou esta política
para Dashboard, Contatos ou configurações. Não há novo cache, dependência ou
armazenamento. A Screen diminuiu 17 linhas e o hook novo tem 88 linhas; a
extração limita a regra nova sem refatorar o legado grande incidentalmente.

Não houve mudança de fontes, classes, estilos, dimensões, filtros, permissões,
cursor/paginação ou comportamentos de outros handlers de refresh. Os P6 da
auditoria original continuam separados desta correção.

## Testes e evidências

Reprodução anterior: quatro falhas comportamentais e um controle aprovado,
usando handler/usePipelines/API/Zod atuais e QueryObserver real; sem falha de
importação ou símbolo ausente. Depois da extração, as mesmas asserções centrais
permaneceram. O conjunto final tem 28 casos aprovados, sem pulos:

- catálogo inicial/cacheado, lista vazia, seleção removida ou ainda válida;
- falhas 401/403/503, consulta lenta, erro de dependência e exceção;
- cliques repetidos, troca de acesso/visita, desmontagem, renovação no mesmo SID;
- cancelamento com cache de sucesso e de erro, remoção/substituição da Query;
- busy de nova visita preservado, efeito de fallback e integração real da Screen.

O caso adicional de substituição da Query expôs durante a implementação um
aviso 503 antigo. A guarda de identidade antes do erro e `errorUpdateCount`
resolveram essa reprodução; o log intermediário foi preservado.

Os dois testes anteriores de retry 401/403 buscavam o callback inline removido
na extração. O harness de `pipeline-recovery.runtime.test.mjs` foi atualizado
para chamar a integração real da Screen e o hook, preservando os três corpos
de teste byte a byte, inclusive avisos/contagens/busy. A quebra inicial foi de
localização da declaração, causada por esta extração, e não falha do produto.

Navegador sintético: quatro casos, Chromium em 1280 e 390 px, catálogo B removido
ou indisponível. Hook real, declarações de catálogo/fallback extraídas por AST,
adapter/Zod/QueryProvider reais, HTTP/Auth/board sintéticos. Confirma transições
e filtros preservados; não é teste da geometria completa do CRM ou Safari físico.

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test hooks/pipelines/pipeline-catalog-recovery.runtime.test.mjs
npm run test:pipeline-columns
npm run typecheck -- --incremental false
npm run lint
npm run audit:check
git diff --check
```

Comandos finais, resultados, limites, falhas de fixtures e comparação Git/SHA
ficam fora do checkout em
`D:/Vimob/outputs/pipeline-catalog-retry-p5-fix-20261020-p137/RESULTADO.md`.
Testes de outras áreas não são apresentados como aprovados se não passaram.

## Reversão e homologação

Reverter seletivamente o wiring/fallback/busy deste delta da Screen e remover
o hook, teste e registro correspondente no runner. Preservar todos os demais
ajustes locais; não restaurar o arquivo completo. Não há banco para reverter.
Voltar ao handler anterior reabre FBL-02 e não constitui uma correção alternativa.

Aceite em homologação autorizada: três perfis e duas organizações, outro gestor
removendo B, retry após falha transitória, lista vazia/negação, troca de sessão
durante leitura e filtros preservados. Não foram acessados tenants ou dados reais,
executado SQL, medidos 300 usuários, reiniciados serviços ou validada produção.

# Pipeline — aviso de atualização após troca de sessão (FBL-03/P6)

Correção local de 20/10/2026 no checkout principal. Sem banco operacional,
produção, deploy, commit, push, migrations ou início/reinício dos serviços CRM.

## Causa e comportamento

Uma atualização manual iniciada na sessão A podia ser cancelada quando a consulta
mudava para B. O `refetch()` do QueryObserver resolve também após cancelamento,
podendo devolver o snapshot anterior sem `isError`. Os callbacks verificavam
apenas esse sinal e publicavam “Atualizado!” ou “Leads atualizados!” enquanto B
ainda carregava. Catch e finally também não tinham proprietário de visita.

Os dois callbacks manuais da Screen agora usam uma única instância local de
`usePipelineRefresh(pipelineBoardQueryKeyId)`. Ela reutiliza
`useLeadRequestScope` e `usePipelineEditorVisit` para capturar acesso e visita
antes de iniciar as leituras. Após o await, só a operação atual pode publicar
sucesso/erro ou encerrar seu próprio carregamento.

A chave canônica contém organização, pipeline, filtros e fingerprint de acesso,
incluindo ator/SID. Visitas A→B→A não reativam operações antigas. Logout, troca
de ator/SID/organização/QueryClient, consulta ou desmontagem aposentam avisos da
operação anterior. Renovação do token dentro do mesmo SID continua válida.

Um mutex comum aos dois botões impede duplicar uma atualização por clique
repetido ou cruzado entre toolbar e aviso do quadro. Busy pertence à visita:
o finally de A não pode liberar o carregamento iniciado posteriormente em B.
O busy do retry crítico P5 permanece independente e composto na interface.

## Escopo preservado

- Os callbacks `handleManualRefresh` e `handlePipelineBoardRefresh` continuam
  na Screen, com as mensagens anteriores.
- O refresh completo continua consultando pipelines/visibilidade e, quando
  aplicável, equipe, opções Meta, tags, colunas, automações e quadro.
- O refresh do aviso continua consultando somente o quadro.
- Timer/foco, recuperação crítica do catálogo P5, paginação, querykeys, filtros,
  permissões e políticas de cache/transporte permanecem sem alteração.
- Não há novo estado global, dependência, cache ou escrita de dados. O estado
  local anterior foi substituído pelo ownership local do hook.
- Nenhuma fonte, classe, CSS, dimensão ou controle visual foi alterado.

A regra nova fica em um hook pequeno por responsabilidade; a Screen legada
diminui, sem refatoração incidental de outros fluxos. A política de cancelamento
explícito na mesma consulta/sessão não é ampliada neste patch: o defeito tratado
é a publicação por uma operação cujo contexto já foi aposentado.

## Evidência e verificações

Antes da correção, os handlers reais e QueryObserver real reproduziram quatro
falhas comportamentais (troca de SID/busca nos dois caminhos), com dois controles
de sucesso aprovados. A consulta A foi abortada e B permaneceu carregando, mas
o callback A emitiu sucesso. Não houve erro de importação/símbolo no RED.

Os testes de regressão usam funções reais de produção e ciclo de vida/Auth/HTTP
sintéticos, com QueryClient/QueryObserver reais. Verificam também erros tardios,
visitas/identidades diferentes, renovação no mesmo SID e ownership do busy.

O harness adjacente de atualização das automações acompanha a extração local;
seus corpos de testes/assertivas são preservados. O novo teste fica registrado
no runner canônico da Pipeline, sem retirar testes ou afrouxar verificações.

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test hooks/pipelines/pipeline-refresh-session.runtime.test.mjs hooks/pipelines/pipeline-automation-refresh.runtime.test.mjs
npm run test:pipeline-columns
npm run typecheck -- --incremental false
npm run lint
npm run audit:check
git diff --check
```

Contagens finais, logs, falhas e limites, inspeção independente e comparação
Git/SHA ficam fora do checkout em
`D:/Vimob/outputs/pipeline-refresh-session-p6-fix-20261020-q248/RESULTADO.md`.
Testes locais/sintéticos não comprovam produção, carga ou SQL/RLS implantados.

## Reversão e homologação

Reverter seletivamente o uso do hook nos dois callbacks e o estado local de
refresh; remover o hook/teste/registro da unidade e a adaptação correspondente do
harness, preservando os ajustes anteriores. Não restaurar a Screen inteira.
Não há banco para reverter. O comportamento anterior reintroduz FBL-03.

Homologar em ambiente autorizado: atualização lenta nos dois botões, troca de
sessão/organização/filtros/pipeline enquanto carrega, nenhum aviso obsoleto,
conclusão atual e erro atual válidos, token renovado no mesmo SID e filtros
preservados. Não foram acessados dados reais, executado SQL, reiniciados serviços
ou validada produção. Os P6 de sobreposição mobile e normalização de busca
continuam separados desta correção.

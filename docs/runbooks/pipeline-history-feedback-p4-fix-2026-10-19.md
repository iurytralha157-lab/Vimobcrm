# Pipeline: feedback preservado no filtro do histórico

19/10/2026. Item 05/P4 da auditoria t927. Checkout principal
`D:/Vimob/workspaces/vimob-crm`, branch main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee` mais alterações locais anteriores.
Evidências: `D:/Vimob/outputs/pipeline-history-feedback-p4-fix-20261019-x055`.

## Causa e correção

shouldShowEvent em LeadUnifiedThread examinava label/content de todos os
eventos para ocultar mensagens técnicas sobre filas. Assim um feedback como
“Cliente veio sem fila de distribuição e pediu retorno amanhã” era gravado,
mas removido da apresentação. “Fila \"Alfa\" sem distribuição” tinha o mesmo
problema. Não era perda de persistência.

O filtro de distribuição agora usa apenas o contrato existente da projeção:

- Fallback sintético: type lead_assigned, source timeline e ID reservado
  lead-fallback-assigned-*. O builder o produz com destinatário preenchido;
  esse placeholder continua oculto independentemente de seu texto.
- Log legado técnico: mesmo tipo/origem, ID distribution-* e nenhum
  assigned_user_id/to_user_id. Continua oculto por sua procedência.
- no_available_members e no_matching_queue continuam visíveis como pendências
  operacionais. Eventos com queue_runtime_event_id também permanecem visíveis,
  inclusive quando o merge conserva um ID distribution-* e o destinatário
  não está disponível na projeção.

Não se decide mais a visibilidade de distribuição pelo texto livre do
feedback, rótulo, nome de responsável ou nome de fila. O helper textual que
ficou sem consumidor foi removido. O filtro independente de campos técnicos
Meta e todas as deduplicações foram preservados; o item06 do motivo de perda
não foi alterado nesta etapa.

Produto alterado somente em LeadUnifiedThread, usado pelo histórico do detalhe
em desktop/mobile e pelos consumidores existentes de Pipeline/Contatos. Sem
mudança na gravação de feedback, API, cache, paginação, autorização, schema ou
dados salvos. Não há backfill ou limpeza de registros.

## Validação

- Regra nova: **103/103 PASS**, sem skips, executando funções reais por AST e
  buildLeadHistory real com raw/projeção congelados. RED no snapshot anterior:
  **81 FAIL/22 PASS**, sem skips. Cobertura de feedback/note/note_created,
  frases exatas e variantes, campos content/label, nomes de filas/usuários,
  atribuições reais, placeholders, pending e merge runtime com ID legado.
- Histórico/paginação/feedback existentes: **210/210 PASS**, sem skips, em 11
  arquivos distintos registrados em history-existing-receipt.json. Total
  desses grupos: **313 testes**, sem somar RED ou execuções repetidas.
- Navegador isolado: **22/22 PASS**, sem skips, pageerrors ou requisições
  externas. Na versão anterior os mesmos casos têm dez falhas de texto ausente
  e 12 controles verdes. LeadUnifiedThread e builder reais em 320, 390 e
  1366 px, readOnly true/false, dados sintéticos e rede bloqueada. Feedbacks
  completos, sem corte/overflow. Detalhes em BROWSER.md e recibos x055; não
  equivale à API/banco reais ou iPhone físico.
- Typecheck e audit:check globais aprovados (quatro contratos do inventário).
  Lint global aprovado, zero erros e os sete avisos preexistentes fora do
  ajuste. Inventários
  gerados foram comparados: mesmas contagens, rotas, superfícies e regras;
  somente localizações/IDs/digests derivados mudam. Scripts do inventário e
  regras de verificação não foram alterados.

A revisão independente aprovou os guards de procedência, as exceções de
runtime/pending e a preservação do filtro Meta, sem bloqueador adicional.
Preservation-receipt.json confere o checkpoint e a allowlist desta etapa,
incluindo as correções anteriores do cache, editor e Agenda. Das 4.096 fontes
monitoradas no início, 4.092 permaneceram idênticas. Quatro existentes mudaram
(um produto e três relatórios gerados) e dois arquivos foram adicionados
(teste e runbook). Diff-check aprovado.

## Limites e continuidade

Sem deploy, migration, commit, push, início de serviços ou alteração de dados
reais. A correção está no candidato local; não foi verificada em produção ou
sob carga de 300 usuários. Reverter somente os hunks desta etapa comparando
com before/; nunca restaurar arquivos inteiros ou resetar o checkout com os
ajustes anteriores.

São **5/14 itens corrigidos localmente**, com nove pendentes. Próximo na ordem:
item06/P4, motivo de perda independente ocultado pela deduplicação temporal.
Esta etapa não é um aceite da Pipeline completa para publicação.

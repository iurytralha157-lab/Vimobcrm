# R2-LEAD-HISTORY-UNCHANGED-SNAPSHOT

## Evidência e causa

Na auditoria visual da Vetter co. em 15/11/2026, mover um lead sintético
entre etapas executou uma automação de tag. O histórico mostrou também uma
transferência para o responsável que já possuía o lead. A leitura do audit
`7372697e-2df7-4ee7-a03e-13d833b9afc0` confirmou a ação `automation_add_tag`
às `23:48:52.380643Z`: responsável, etapa, pipeline, status e imóvel tinham
valores iguais em `old_data` e `new_data`. A atividade de tag e a movimentação
existiam; não foi uma transferência real causada por essa automação.

O produtor `apply_automation_internal_effect` registra snapshots operacionais
antes/depois além da atividade da automação. No navegador, `auditChangedKeys`
tratava toda chave permitida de `new_data` como alteração. Depois da supressão
da etapa já representada por outra atividade, o responsável inalterado fazia
`auditEventType` escolher `assignee_changed` e o rótulo de transferência.

## Mudança e alcance

`hooks/lead-history/audit.ts` compara somente campos cujo valor anterior está
presente. A igualdade é estrutural para JSON: a ordem de chaves dos objetos
não importa, a ordem dos arrays importa e tipos diferentes não são convertidos.
Um campo anterior ausente continua desconhecido, inclusive quando o novo é
`null`. O marcador `[valor protegido]` nunca comprova igualdade, mesmo aninhado.

O caminho é `GET /v1/leads/{id}/history-raw` → transporte `lib/api/leads.ts` →
`use-lead-history` → `buildLeadHistory` → projeção do audit. A correção fica no
comparador compartilhado, sem alterar transporte, autorização, banco, produtor
de eventos, automações ou dados armazenados. Mantém create/delete, transferências
reais, status/perda, movimentação de etapa e a atividade de tag. A precedência
existente do rótulo `move_stage` não foi ampliada nesta correção.

## Verificações

Antes da correção, os 28 casos novos executando a projeção real falharam em
11 verificações, incluindo a falsa transferência. Depois da correção, os
324 testes compilados do histórico passaram, sem pulos. Cobrem snapshots,
mudança real de responsável, etapa, status/perda, legado sem valor anterior,
valores protegidos, igualdade estrutural e preservação dos dados de entrada.

A CI usa o `tsconfig.test.json` existente e executa os testes compilados no
job estático, do qual o build já depende. Não há dependência, job ou serviço novo.
Typecheck, lint sem erros (oito avisos legados) e auditoria 4/4 passaram na
worktree isolada e na integração sobre `f6f8d136`. Na integração, os 324 testes
passaram novamente, os inventários foram regenerados CRM → Home e o contrato
do workflow passou 2/2, sem pulos.
Logs e o resumo saneado ficam no diretório operacional
`D:/Vimob/outputs/vetter-role-retests-20261115/history-audit-*` e
`history-integrated-*`.

## Limites e reversão

A prova de produção descreve a falha observada; o código corrigido ainda exige
deploy e reteste visual. Sem valor anterior conhecido ou com redação protegida,
o audit permanece visível por desenho. O caso de status/perda após movimentação
mantém seu detalhe real; esta mudança não redefine sua classificação de rótulo.

A reversão é retirar a comparação no frontend e publicar novamente. Nenhum
audit foi apagado ou reescrito, portanto não há restauração de dados a executar.

# Pipeline: motivo de perda preservado após mudança de status

19/10/2026. Item 06/P4 da auditoria t927. Checkout principal
`D:/Vimob/workspaces/vimob-crm`, branch main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee` com alterações locais anteriores.
Evidências: `D:/Vimob/outputs/pipeline-history-loss-reason-p4-fix-20261019-y066`.

## Causa e resultado

Uma atividade de status do mesmo ator, ou sem ator, até 15 segundos antes ou
depois apagava deal_status e lost_reason da projeção de qualquer audit próximo.
Editar somente o motivo depois de marcar Perdido não gera outra status_change
no produtor atual: seu audit era removido apesar de representar outra mudança.

Havia dois descartes adicionais no mesmo caminho: uma atividade de etapa podia
eliminar o audit move_stage inteiro, e a bolha de etapa/status não apresentava
seu conteúdo completo mesmo quando a projeção o preservava.

Foram corrigidos três pontos, sem alterar gravações ou autorização:

- audit.ts preserva sempre lost_reason. O produtor atual não fornece o motivo
  anterior na atividade, e a API mascara texto pessoal no audit. Duas ocorrências
  com '[valor protegido]' não comprovam igualdade. Ausente, null e vazio não
  foram equiparados.
- deal_status só é suprimido quando há operation_id/request_id compartilhado
  exato, sem outra identidade conflitante, com transição anterior/posterior
  explícita e consistente. Todos os aliases presentes precisam concordar;
  ator conhecido divergente veta. IDs mascarados, não textuais, vazios ou com
  espaços nas extremidades não servem de prova. A correlação não depende da
  proximidade de horário. As regras temporais dos outros campos permanecem.
- build-history.ts impede o descarte integral de move_stage quando restam
  deal_status/lost_reason sem representação. LeadUnifiedThread mostra o conteúdo
  do audit correspondente antes dos resumos específicos de etapa/status.

O PATCH comum atual não entrega essa identidade compartilhada no audit público.
Esses legados ficam visíveis, mesmo quando os valores de status parecem iguais
às atividades próximas. Pode haver uma linha adicional de auditoria; a decisão
é preservar evidência em vez de inferir uma duplicata. Não foi inventado ID no
cliente nem alterada a API para expor identificadores privados.

O texto protegido continua protegido: o histórico pode mostrar “Motivo de perda
atualizado/adicionado/removido” sem revelar o valor mascarado. A correção não
reconstrói texto que a API decidiu ocultar e não faz backfill ou limpeza.

## Escopo e testes

Produto: hooks/lead-history/audit.ts, hooks/lead-history/build-history.ts e
components/features/leads/LeadUnifiedThread.tsx. O mesmo histórico atende
desktop/mobile e os consumidores existentes da Pipeline/Contatos. As gravações
de feedback/status, cache, paginação, sessões, permissões, backend e redaction
permaneceram inalteradas. O componente legado cresceu quatro linhas para
apresentar os campos preservados; uma extração futura da apresentação pode
reutilizar a matriz de testes, sem refatoração incidental neste lote.

- Nova regressão: **91/91 PASS**, sem skips. RED com os dois módulos anteriores:
  **89 FAIL/2 PASS**. Testa as seis transições, motivo A→B após dez segundos,
  null/vazio/protegido, ciclos repetidos, IDs/atores/aliases conflitantes,
  identidade fora da janela, raw completo/parcial, imutabilidade e move_stage.
  O teste executa auditVisibleKeys e buildLeadHistory reais.
- Histórico, paginação, feedback e visibilidade anteriores: **313/313 PASS**,
  sem skips, em arquivos distintos do novo teste. Total: **404 testes**.
  Não somar RED, pais ou execuções repetidas.
- Chromium isolado: **38/38 PASS**, sem skips/pageerrors/requisições externas.
  Builder e LeadUnifiedThread reais em 320, 390 e 1366 px, readOnly true/false.
  Motivos alterados, protegidos e removidos aparecem completos; movimento exibe
  Status e Motivo sem apagar a etapa canônica. Os três arquivos anteriores
  falham nos mesmos 38 casos. Detalhes e capturas em BROWSER.md.
- Typecheck/lint/audit:check finais e comparação de hashes ficam nos recibos.
  Os relatórios gerados foram comparados antes/depois: mesmas contagens, rotas,
  superfícies e regras; só localizações/IDs/digests derivados foram atualizados.

A revisão independente conferiu produtores, redaction, ponte de ocorrência,
campos explícitos e os três caminhos de apresentação. Os testes são locais:
dados/transporte sintéticos, sem API/banco/upload reais, iPhone físico ou carga
de 300 usuários. Não certificam a versão/configuração instalada em produção.

## Preservação e continuidade

Snapshot inicial de 4.098 fontes e status Git anterior preservados externamente.
O recibo preservation-receipt.json confere a allowlist e os arquivos anteriores,
incluindo as correções de Agenda, cache, editor e filtro do feedback. Reverter
somente os hunks deste lote comparando com before/; não resetar o checkout nem
restaurar arquivos inteiros com ajustes de outras abas.

Sem deploy, migration, commit, push, alteração de dados reais ou início de
serviços. São **6/14 itens corrigidos localmente**, com oito pendentes. Próximo
na ordem: item07/P4, idempotência do registro rápido de ligação/e-mail em
resposta incerta. Este lote não é um aceite da Pipeline inteira para publicação.

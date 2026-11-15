# Vencidos e inadimplência

Regra aprovada pelo usuário em 15/11/2026 para o ajuste F09 da auditoria Vetter.

## Cálculo

- O dia de referência usa `America/Sao_Paulo`. Somente vencimento estritamente
  anterior a esse dia pode ser vencido. Data nula, hoje e datas futuras ficam
  fora, inclusive quando o estado registrado é `overdue` ou `vencido`.
- O saldo vencido inclui contas a receber e pagar com estado `pending`,
  `pendente`, `partial`, `parcial`, `overdue` ou `vencido`, saldo positivo e data
  passada. Pago e cancelado ficam fora.
- Os campos físicos `paid_amount` e `paid_value` representam o mesmo pagamento.
  Use o maior valor não negativo uma única vez. O saldo é o valor nominal menos
  esse pagamento, limitado a zero. Nenhum status é atualizado automaticamente.
- A inadimplência é o saldo vencido de recebíveis dividido pelo valor nominal
  dos recebíveis com vencimento passado, incluindo os liquidados e excluindo
  cancelados, multiplicado por 100. Base zero resulta em 0%.
  O denominador usa os seis estados abertos listados acima e `paid`/`paga`.
  Estados nulos, vazios ou desconhecidos ficam fora dos dois conjuntos.

## Consumidores

O Dashboard financeiro calcula a carteira inteira da organização. O filtro
Vencido de Contas aplica o mesmo critério de vencimento e saldo e conserva os
filtros de tipo e período. Os demais filtros de status consultam o estado
registrado. Relatórios aplica o critério ao período de vencimento escolhido.

Contas identifica valor nominal, saldo aberto e estado registrado. Relatórios
exibe o saldo na lista de vencidos. Os arquivos CSV e Excel de lançamentos
mantêm o valor nominal e incluem saldo aberto e pagamento deduplicado. O resumo
do Dashboard inclui a taxa de inadimplência. Demais indicadores e seus períodos
continuam usando os contratos existentes.

## Verificação e reversão

Publicar a API compatível antes dos consumidores web. O endpoint de Contas
mantém o mesmo parâmetro de filtro, com a nova semântica de vencimento derivada.
Conferir lista, totais e exportações com a mesma versão e organização após a
troca das réplicas.

`TestFinancialOverduePostgres` exige `VIMOB_RUN_DB_TESTS=1` e `DATABASE_URL` de um
banco descartável de loopback cujo nome começa por `vetter_financial_qa_`.
O teste cria somente fixtures sintéticas nesse banco, executa os repositórios
reais para duas organizações, confere a base zero, aliases, pagamentos
espelhados, parciais, limites de data e a virada de Brasília com sessões de banco
em fusos diferentes. O harness deve remover o banco ao terminar.

Os testes de `lib/financial/entry-overdue.test.ts` e
`lib/export-financial.test.ts` conferem o modelo e os valores exportados. A
validação local não comprova publicação ou o recálculo da carteira operacional.

O ajuste não depende de migration nem reclassifica dados. A reversão deve
reverter os consumidores de vencidos e os agregados do Dashboard em conjunto,
incluindo os rótulos e exports, sem alterar lançamentos ou pagamentos gravados.

# Complemento local: DRE e comissões auxiliares

Este complemento corrige duas pendências de APIs auxiliares identificadas após
o lote P1 de 18/10/2026. Não acrescenta widgets à Dashboard principal.

## Contrato

- `GET /v1/analytics/dre-executive` mantém `financial_view` e o contexto da
  organização. Agora exige sessão ativa e disponibilidade do módulo financeiro
  no servidor; o repositório também verifica a autorização antes de consultar.
  O fallback legado por nome/allowlist do Financeiro permanece igual.
- `GET /v1/analytics/vgv-by-broker` exclui `cancelled`/`cancelada` sem distinguir
  maiúsculas, seguindo o relatório financeiro canônico. Soma `amount` quando
  presente e usa `calculated_value` somente quando `amount` é nulo. Zero explícito
  continua sendo zero. Coorte, datas, tenant, responsável e formato da resposta
  permanecem iguais, inclusive `total_commission: null` sem acesso financeiro.

## Evidência local

- Regressões foram adicionadas antes das correções. O DRE falhou no teste de
  sessão e chegou à consulta sem autorização financeira. A SQL antiga somou
  comissões canceladas e ignorou valores calculados sem `amount`.
- Testes focados de rota/handler passaram após a correção: sessões inválidas em
  GET/HEAD, tenant, permissões, módulo financeiro e negação antes do SQL.
- `go test ./apps/api/internal/analytics -count=1 -v` passou com
  `DASHBOARD_ANALYTICS_TEST_DATABASE_URL` apontando para PostgreSQL descartável
  em loopback, banco `dashboard_p1_analytics`. Foram 31 testes principais
  aprovados, incluindo DRE com duas organizações e sete cenários de cálculo de
  comissão. Seis integrações opcionais de Marketing/Site não foram executadas
  por ausência de suas configurações específicas.

Os testes usam dados sintéticos. Este registro não comprova comportamento
publicado e não envolve produção, deploy ou migração remota.

## Reversão

Os arquivos anteriores foram copiados antes da edição para
`work/dashboard-followup/before`, no workspace da tarefa. A reversão deve ser
seletiva: remover apenas o guard DRE deste complemento e restaurar a expressão
anterior de comissão, sem sobrescrever alterações alheias ou o lote P1 anterior.
Reverter o guard reabre a falha de autorização; fazê-lo exige decisão explícita.

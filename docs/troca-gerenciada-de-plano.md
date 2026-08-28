# Troca gerenciada de plano

## Objetivo

Trocar o plano de uma organização paga sem criar duas recorrências no Asaas e
sem liberar os limites do novo plano antes da cobrança que torna a troca
efetiva.

## Decisão por estado

- Assinatura paga ativa com `asaas_subscription_id`: o backend registra a
  mudança em `private.billing_plan_changes` e atualiza a assinatura existente
  com `PUT /v3/subscriptions/{id}`. O payload usa
  `updatePendingPayments: false`; cobranças já emitidas não são alteradas.
- Assinatura paga ativa sem `asaas_subscription_id`: o plano atual e o status
  `active` são preservados, `pending_plan_id` é preenchido e o checkout normal
  é aberto. A promoção continua condicionada à confirmação financeira.
- Conta trial/free: permanece no fluxo de checkout já existente.

## Estado durável

`private.billing_plan_changes` aceita uma única mudança ativa por organização:

1. `provider_updating`: gravado antes da chamada ao Asaas.
2. `scheduled`: o Asaas confirmou valor e ciclo; o plano atual continua ativo.
3. `applying`: estado interno e transacional durante a promoção.
4. `applied`: um pagamento confirmado, com assinatura, valor e vencimento
   compatíveis, promoveu o plano.
5. `failed` ou `cancelled`: estados terminais sem promoção.

A tabela fica no schema `private`, com RLS habilitado e sem privilégios para
`anon`, `authenticated` ou `service_role` via Data API.

## Recuperação e idempotência

Respostas de rede ou HTTP 5xx são ambíguas. O client consulta a assinatura no
Asaas, compara `id`, `value` e `cycle` e só repete o mesmo `PUT` quando a leitura
não confirma o estado esperado. Se o processo cair depois de o Asaas aceitar o
`PUT`, a linha permanece `provider_updating`; uma nova tentativa lê o provedor
antes de repetir qualquer escrita. A tela oferece **Tentar confirmar** para esse
estado.

Uma rejeição HTTP 4xx é definitiva: a mudança vira `failed` e o
`pending_plan_id` é limpo, sem alterar o plano atual.

## Aplicação na renovação

O trigger `asaas_payments_apply_scheduled_plan_change` roda antes, por ordem
alfabética, dos triggers de confirmação de checkout e de emissão do
comprovante. Ele só aplica uma mudança `scheduled` quando o pagamento:

- está confirmado/recebido;
- pertence à mesma organização e assinatura Asaas;
- tem valor igual ao total agendado;
- tem vencimento igual ou posterior a `effective_on`.

A promoção e a atualização de `public.organizations`, `public.subscriptions` e
`public.subscription_logs` acontecem na mesma transação. Reprocessar o mesmo
pagamento não reaplica uma mudança que já esteja `applied`.

## Operação

Aplicar a migration
`20260804023420_schedule_managed_billing_plan_changes.sql` antes de publicar a
API. A API reutiliza `ASAAS_API_URL`, `ASAAS_API_KEY` e
`ASAAS_REQUEST_TIMEOUT`; nenhuma credencial nova é necessária.

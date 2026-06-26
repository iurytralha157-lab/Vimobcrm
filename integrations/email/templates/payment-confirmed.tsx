import { EmailShell } from './email-shell'

export type PaymentConfirmedEmailProps = {
  name?: string
  planName?: string
  amount?: string
  paidAt?: string
  appUrl?: string
}

export function PaymentConfirmedEmail({
  name,
  planName,
  amount,
  paidAt,
  appUrl,
}: PaymentConfirmedEmailProps) {
  return (
    <EmailShell
      title="Pagamento confirmado"
      eyebrow="Financeiro"
      cta={appUrl ? { href: appUrl, label: 'Acessar Vimob CRM' } : undefined}
      note="A liberacao dos recursos contratados acontece automaticamente apos a confirmacao."
    >
      <p>Ola{name ? `, ${name}` : ''}.</p>
      <p>O pagamento{planName ? ` do plano ${planName}` : ''} foi confirmado com sucesso.</p>
      {amount ? <p>Valor: {amount}.</p> : null}
      {paidAt ? <p>Data de confirmacao: {paidAt}.</p> : null}
    </EmailShell>
  )
}

export default PaymentConfirmedEmail

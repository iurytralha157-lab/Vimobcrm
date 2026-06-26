import { EmailShell } from './email-shell'

export type WelcomeEmailProps = {
  name?: string
  organizationName?: string
  planName?: string
  trialEndsAt?: string
  checkoutUrl?: string
  appUrl?: string
}

export function WelcomeEmail({
  name,
  organizationName,
  planName,
  trialEndsAt,
  checkoutUrl,
  appUrl,
}: WelcomeEmailProps) {
  return (
    <EmailShell
      title="Boas-vindas ao Vimob CRM"
      eyebrow="Conta criada"
      cta={appUrl ? { href: appUrl, label: 'Acessar minha conta' } : checkoutUrl ? { href: checkoutUrl, label: 'Continuar pagamento' } : undefined}
      note="Use a senha criada no cadastro. Nunca compartilhe seus dados de acesso."
    >
      <p>Ola{name ? `, ${name}` : ''}. E bom ter voce por aqui.</p>
      <p>
        Sua conta {organizationName ? `na organizacao ${organizationName}` : 'no sistema'} foi preparada com sucesso.
      </p>
      {planName ? <p>Plano selecionado: {planName}.</p> : null}
      {trialEndsAt ? <p>Seu teste gratis fica ativo ate {trialEndsAt}.</p> : null}
    </EmailShell>
  )
}

export default WelcomeEmail

import { EmailShell } from './email-shell'

export type LegalAcceptanceEmailProps = {
  name?: string
  acceptedAt?: string
  termsVersion?: string
}

export function LegalAcceptanceEmail({
  name,
  acceptedAt,
  termsVersion,
}: LegalAcceptanceEmailProps) {
  return (
    <EmailShell
      title="Aceite registrado"
      eyebrow="Registro legal"
      note="Este e-mail serve como comprovante operacional do aceite registrado no sistema."
    >
      <p>Ola{name ? `, ${name}` : ''}.</p>
      <p>Registramos o aceite dos termos{termsVersion ? ` na versao ${termsVersion}` : ''}.</p>
      {acceptedAt ? <p>Data do aceite: {acceptedAt}.</p> : null}
    </EmailShell>
  )
}

export default LegalAcceptanceEmail

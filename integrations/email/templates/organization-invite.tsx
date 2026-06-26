import { EmailShell } from './email-shell'

export type OrganizationInviteEmailProps = {
  invitedEmail: string
  organizationName: string
  inviterName?: string
  inviteUrl?: string
}

export function OrganizationInviteEmail({
  invitedEmail,
  organizationName,
  inviterName,
  inviteUrl,
}: OrganizationInviteEmailProps) {
  return (
    <EmailShell
      title="Convite para organizacao"
      eyebrow="Acesso de equipe"
      cta={inviteUrl ? { href: inviteUrl, label: 'Aceitar convite' } : undefined}
      note={inviteUrl ? 'Se voce nao esperava este convite, ignore este e-mail.' : 'O link de convite sera gerado pelo fluxo oficial.'}
    >
      <p>
        {inviterName ?? 'Um membro da equipe'} convidou {invitedEmail} para acessar a organizacao {organizationName}.
      </p>
    </EmailShell>
  )
}

export default OrganizationInviteEmail

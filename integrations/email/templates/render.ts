import type { EmailPayload, EmailTemplateKey } from '../provider'

type RenderedEmail = {
  html: string
}

type EmailLayoutOptions = {
  title: string
  eyebrow: string
  preheader: string
  intro: string
  content?: string
  cta?: {
    href: string
    label: string
  }
  details?: Array<{
    label: string
    value?: string
  }>
  note?: string
}

const BRAND = {
  accent: '#ff4529',
  accentDark: '#d9341d',
  background: '#f5f6f3',
  border: '#e2e5df',
  card: '#ffffff',
  heading: '#151515',
  muted: '#626872',
  softAccent: '#fff0ed',
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getAssetBaseUrl() {
  return (
    process.env.EMAIL_ASSET_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://vimobcrm.com.br'
  ).replace(/\/$/, '')
}

function getLogoUrl() {
  return `${getAssetBaseUrl()}/images/logo-black.png`
}

function getPublicUrl(path: string) {
  return `${getAssetBaseUrl()}${path}`
}

function textBlock(value?: string) {
  return value
    ? `<p style="margin:0 0 16px;color:${BRAND.heading};font-size:16px;line-height:1.65">${escapeHtml(value)}</p>`
    : ''
}

function ctaButton(cta?: EmailLayoutOptions['cta']) {
  if (!cta?.href || !cta.label) return ''

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px">
      <tr>
        <td bgcolor="${BRAND.accent}" style="border-radius:8px">
          <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;line-height:1;text-decoration:none;border-radius:8px;background:${BRAND.accent}">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>
    </table>`
}

function detailRows(details?: EmailLayoutOptions['details']) {
  const visibleDetails = details?.filter((detail) => detail.value) ?? []

  if (visibleDetails.length === 0) return ''

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:26px 0 0;border-collapse:separate;border-spacing:0;border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden">
      ${visibleDetails
        .map(
          (detail, index) => `
            <tr>
              <td style="padding:${index === 0 ? '16px' : '14px 16px'};border-top:${index === 0 ? '0' : `1px solid ${BRAND.border}`};background:#ffffff">
                <p style="margin:0 0 4px;color:${BRAND.muted};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:.6px">${escapeHtml(detail.label)}</p>
                <p style="margin:0;color:${BRAND.heading};font-size:15px;line-height:1.5;font-weight:700">${escapeHtml(detail.value ?? '')}</p>
              </td>
            </tr>`
        )
        .join('')}
    </table>`
}

function noteBlock(note?: string) {
  return note
    ? `<p style="margin:24px 0 0;padding:14px 16px;border-left:4px solid ${BRAND.accent};background:${BRAND.softAccent};color:${BRAND.heading};font-size:14px;line-height:1.6;border-radius:0 8px 8px 0">${escapeHtml(note)}</p>`
    : ''
}

function hiddenPreheader(preheader: string) {
  const spacer = '&zwnj;&nbsp;'.repeat(40)

  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px">${escapeHtml(preheader)} ${spacer}</div>`
}

function layout(options: EmailLayoutOptions) {
  const logoUrl = getLogoUrl()
  const privacyUrl = getPublicUrl('/politica-de-privacidade')
  const termsUrl = getPublicUrl('/termos-de-uso')

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(options.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.background};color:${BRAND.heading};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased">
    ${hiddenPreheader(options.preheader)}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:${BRAND.background};border-collapse:collapse">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:640px;border-collapse:collapse">
            <tr>
              <td align="left" style="padding:0 0 18px 0">
                <img src="${escapeHtml(logoUrl)}" width="142" alt="Vimob CRM" style="display:block;width:142px;max-width:142px;height:auto;border:0;outline:none;text-decoration:none" />
              </td>
            </tr>
            <tr>
              <td style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;box-shadow:0 16px 42px rgba(21,21,21,.06)">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
                  <tr>
                    <td style="height:6px;background:${BRAND.accent};font-size:0;line-height:0">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="padding:34px 34px 10px">
                      <p style="margin:0 0 10px;color:${BRAND.accentDark};font-size:12px;font-weight:700;line-height:1.4;text-transform:uppercase;letter-spacing:1.8px">${escapeHtml(options.eyebrow)}</p>
                      <h1 style="margin:0;color:${BRAND.heading};font-size:30px;font-weight:700;line-height:1.18;letter-spacing:0">${escapeHtml(options.title)}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 34px 36px">
                      ${textBlock(options.intro)}
                      ${options.content ?? ''}
                      ${ctaButton(options.cta)}
                      ${detailRows(options.details)}
                      ${noteBlock(options.note)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding:22px 8px 0;color:${BRAND.muted};font-size:12px;line-height:1.65">
                <p style="margin:0 0 8px">Por seguranca, o Vimob CRM nunca envia senhas por e-mail.</p>
                <p style="margin:0">
                  <a href="${escapeHtml(termsUrl)}" style="color:${BRAND.muted};text-decoration:underline">Termos de Uso</a>
                  <span style="color:${BRAND.border}">&nbsp;|&nbsp;</span>
                  <a href="${escapeHtml(privacyUrl)}" style="color:${BRAND.muted};text-decoration:underline">Politica de Privacidade</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function renderWelcome(payload: EmailPayload) {
  const name = asString(payload.name)
  const organizationName = asString(payload.organizationName)
  const planName = asString(payload.planName)
  const trialEndsAt = asString(payload.trialEndsAt)
  const checkoutUrl = asString(payload.checkoutUrl)
  const appUrl = asString(payload.appUrl)
  const termsVersion = asString(payload.termsVersion)
  const privacyVersion = asString(payload.privacyVersion)
  const isTrial = payload.isTrial === true
  const trialDays = asNumber(payload.trialDays) ?? 7

  const content = [
    textBlock(
      `Sua conta ${organizationName ? `na organizacao ${organizationName}` : 'no sistema'} foi criada com sucesso.`
    ),
    isTrial
      ? textBlock(
          `Seu teste gratis de ${trialDays} dias ja esta ativo${trialEndsAt ? ` e fica disponivel ate ${trialEndsAt}` : ''}.`
        )
      : '',
    textBlock('Vamos avisar voce antes do fim do periodo de teste para evitar qualquer surpresa.'),
  ].join('')

  return layout({
    title: 'Boas-vindas ao Vimob CRM',
    eyebrow: 'Conta criada',
    preheader: 'Sua conta no Vimob CRM foi criada com sucesso.',
    intro: `Ola${name ? `, ${name}` : ''}. E bom ter voce por aqui.`,
    content,
    cta: appUrl
      ? {
          href: appUrl,
          label: 'Acessar minha conta',
        }
      : checkoutUrl
        ? {
            href: checkoutUrl,
            label: 'Continuar pagamento',
          }
        : undefined,
    details: [
      { label: 'Organizacao', value: organizationName },
      { label: 'Plano', value: planName },
      { label: 'Termos de Uso', value: termsVersion ? `Versao ${termsVersion}` : undefined },
      {
        label: 'Politica de Privacidade',
        value: privacyVersion ? `Versao ${privacyVersion}` : undefined,
      },
    ],
    note: 'Use a senha criada no cadastro. Nunca compartilhe seus dados de acesso.',
  })
}

function renderOrganizationInvite(payload: EmailPayload) {
  const invitedEmail = asString(payload.invitedEmail) ?? asString(payload.email) ?? ''
  const organizationName = asString(payload.organizationName) ?? ''
  const inviterName = asString(payload.inviterName) ?? 'Um membro da equipe'
  const inviteUrl = asString(payload.inviteUrl)

  return layout({
    title: 'Convite para organizacao',
    eyebrow: 'Acesso de equipe',
    preheader: `${inviterName} convidou voce para acessar ${organizationName || 'uma organizacao'} no Vimob CRM.`,
    intro: `${inviterName} convidou ${invitedEmail || 'voce'} para acessar a organizacao ${organizationName || 'no Vimob CRM'}.`,
    cta: inviteUrl
      ? {
          href: inviteUrl,
          label: 'Aceitar convite',
        }
      : undefined,
    details: [
      { label: 'Organizacao', value: organizationName },
      { label: 'Convidado', value: invitedEmail },
      { label: 'Enviado por', value: inviterName },
    ],
    note: inviteUrl
      ? 'Se voce nao esperava este convite, ignore este e-mail.'
      : 'O link de convite sera gerado pelo fluxo oficial antes do envio em producao.',
  })
}

function renderLegalAcceptance(payload: EmailPayload) {
  const name = asString(payload.name)
  const acceptedAt = asString(payload.acceptedAt)
  const termsVersion = asString(payload.termsVersion)
  const privacyVersion = asString(payload.privacyVersion)

  return layout({
    title: 'Aceite registrado',
    eyebrow: 'Registro legal',
    preheader: 'Registramos seu aceite dos termos e politicas do Vimob CRM.',
    intro: `Ola${name ? `, ${name}` : ''}. Registramos seu aceite dos termos e politicas do Vimob CRM.`,
    details: [
      { label: 'Data do aceite', value: acceptedAt },
      { label: 'Termos de Uso', value: termsVersion ? `Versao ${termsVersion}` : undefined },
      {
        label: 'Politica de Privacidade',
        value: privacyVersion ? `Versao ${privacyVersion}` : undefined,
      },
    ],
    note: 'Este e-mail serve como comprovante operacional do aceite registrado no sistema.',
  })
}

function renderPaymentConfirmed(payload: EmailPayload) {
  const name = asString(payload.name)
  const planName = asString(payload.planName)
  const amount = asString(payload.amount)
  const paidAt = asString(payload.paidAt)
  const appUrl = asString(payload.appUrl)

  return layout({
    title: 'Pagamento confirmado',
    eyebrow: 'Financeiro',
    preheader: 'Seu pagamento foi confirmado com sucesso.',
    intro: `Ola${name ? `, ${name}` : ''}. O pagamento${planName ? ` do plano ${planName}` : ''} foi confirmado com sucesso.`,
    cta: appUrl
      ? {
          href: appUrl,
          label: 'Acessar Vimob CRM',
        }
      : undefined,
    details: [
      { label: 'Plano', value: planName },
      { label: 'Valor', value: amount },
      { label: 'Confirmado em', value: paidAt },
    ],
    note: 'A liberacao dos recursos contratados acontece automaticamente apos a confirmacao.',
  })
}

export function renderEmailTemplate(
  template: EmailTemplateKey,
  payload: EmailPayload = {}
): RenderedEmail {
  switch (template) {
    case 'organization_invite':
      return { html: renderOrganizationInvite(payload) }
    case 'legal_acceptance':
      return { html: renderLegalAcceptance(payload) }
    case 'payment_confirmed':
      return { html: renderPaymentConfirmed(payload) }
    case 'welcome':
    default:
      return { html: renderWelcome(payload) }
  }
}

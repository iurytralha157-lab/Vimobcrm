/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from 'react'

type EmailShellProps = {
  title: string
  eyebrow: string
  children: ReactNode
  cta?: {
    href: string
    label: string
  }
  note?: string
}

const assetBaseUrl = process.env.EMAIL_ASSET_BASE_URL || 'https://vimobcrm.com.br'
const logoUrl = `${assetBaseUrl.replace(/\/$/, '')}/images/logo-black.png`

export function EmailShell({ title, eyebrow, children, cta, note }: EmailShellProps) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, padding: 0, background: '#f5f6f3', color: '#151515', fontFamily: 'Arial, sans-serif' }}>
        <table role="presentation" cellPadding="0" cellSpacing="0" width="100%" style={{ background: '#f5f6f3' }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 16px' }}>
                <table role="presentation" cellPadding="0" cellSpacing="0" width="100%" style={{ maxWidth: 640 }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingBottom: 18 }}>
                        <img src={logoUrl} width="142" alt="Vimob CRM" style={{ display: 'block', width: 142, height: 'auto' }} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ background: '#ffffff', border: '1px solid #e2e5df', borderRadius: 14, overflow: 'hidden' }}>
                        <div style={{ height: 6, background: '#ff4529' }} />
                        <div style={{ padding: '34px 34px 36px' }}>
                          <p style={{ margin: '0 0 10px', color: '#d9341d', fontSize: 12, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase' }}>
                            {eyebrow}
                          </p>
                          <h1 style={{ margin: '0 0 22px', color: '#151515', fontSize: 30, lineHeight: 1.18 }}>
                            {title}
                          </h1>
                          <div style={{ color: '#151515', fontSize: 16, lineHeight: 1.65 }}>
                            {children}
                          </div>
                          {cta ? (
                            <p style={{ margin: '26px 0 0' }}>
                              <a href={cta.href} style={{ display: 'inline-block', padding: '14px 22px', borderRadius: 8, background: '#ff4529', color: '#ffffff', fontWeight: 700, textDecoration: 'none' }}>
                                {cta.label}
                              </a>
                            </p>
                          ) : null}
                          {note ? (
                            <p style={{ margin: '24px 0 0', padding: '14px 16px', borderLeft: '4px solid #ff4529', background: '#fff0ed', borderRadius: '0 8px 8px 0', fontSize: 14 }}>
                              {note}
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '22px 8px 0', color: '#626872', fontSize: 12, lineHeight: 1.65 }}>
                        Por seguranca, o Vimob CRM nunca envia senhas por e-mail.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

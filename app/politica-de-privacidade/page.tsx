import type { Metadata } from 'next'

import {
  PublicHero,
  PublicLegalDocument,
  PublicPageShell,
} from '@/components/features/public'
import { LEGAL_DOCUMENTS } from '@/config/legal-documents'

const document = LEGAL_DOCUMENTS.privacy

export const metadata: Metadata = {
  title: `${document.title} | Vimob`,
  description:
    'Política de Privacidade da plataforma Vimob sobre tratamento de dados pessoais em conformidade com a LGPD.',
}

export default function PrivacyPolicyPage() {
  return (
    <PublicPageShell>
      <PublicHero compact eyebrow={document.eyebrow} title={document.title} />
      <PublicLegalDocument document={document} />
    </PublicPageShell>
  )
}

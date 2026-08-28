import type { Metadata } from 'next'

import {
  PublicHero,
  PublicLegalDocument,
  PublicPageShell,
} from '@/components/features/public'
import { LEGAL_DOCUMENTS } from '@/config/legal-documents'

const document = LEGAL_DOCUMENTS.terms

export const metadata: Metadata = {
  title: `${document.title} | Vimob`,
  description:
    'Termos de Uso da plataforma Vimob para licenciamento e utilização do CRM imobiliário.',
}

export default function TermsOfUsePage() {
  return (
    <PublicPageShell>
      <PublicHero compact eyebrow={document.eyebrow} title={document.title} />
      <PublicLegalDocument document={document} />
    </PublicPageShell>
  )
}

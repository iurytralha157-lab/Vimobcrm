import legalDocumentsJson from '../apps/api/internal/admin/legal_documents.json'

export type LegalDocumentList = {
  type: 'ordered' | 'unordered'
  items: string[]
}

export type LegalDocumentSection = {
  title: string
  paragraphs: string[]
  list?: LegalDocumentList
}

export type LegalDocument = {
  kind: 'terms' | 'privacy'
  title: string
  eyebrow: string
  version: string
  effectiveDate: string
  fingerprint: `sha256:${string}`
  introduction: string[]
  sections: LegalDocumentSection[]
}

export type LegalDocumentsManifest = {
  terms: LegalDocument
  privacy: LegalDocument
}

export const LEGAL_DOCUMENTS = legalDocumentsJson as LegalDocumentsManifest

export const CURRENT_TERMS_VERSION = LEGAL_DOCUMENTS.terms.version
export const CURRENT_PRIVACY_VERSION = LEGAL_DOCUMENTS.privacy.version

export function formatLegalEffectiveDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

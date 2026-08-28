import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  LEGAL_DOCUMENTS,
  type LegalDocument,
} from '../../config/legal-documents'

function contentFingerprint(document: LegalDocument) {
  const canonical = JSON.stringify({
    kind: document.kind,
    title: document.title,
    eyebrow: document.eyebrow,
    introduction: document.introduction,
    sections: document.sections,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

test('legal versions expose the effective date and bind the exact content fingerprint', () => {
  for (const document of Object.values(LEGAL_DOCUMENTS)) {
    const digest = contentFingerprint(document)
    assert.equal(document.fingerprint, `sha256:${digest}`)
    assert.equal(
      document.version,
      `${document.effectiveDate}+sha256-${digest.slice(0, 12)}`,
    )
  }
})

test('signup constants are sourced from the same public legal manifest', () => {
  assert.equal(CURRENT_TERMS_VERSION, LEGAL_DOCUMENTS.terms.version)
  assert.equal(CURRENT_PRIVACY_VERSION, LEGAL_DOCUMENTS.privacy.version)
})

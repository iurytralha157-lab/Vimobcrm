import type { LegalDocument } from '@/config/legal-documents'
import { formatLegalEffectiveDate } from '@/config/legal-documents'

import { PublicDocument, PublicDocumentSection } from './PublicDocument'

export function PublicLegalDocument({
  document,
}: Readonly<{
  document: LegalDocument
}>) {
  return (
    <PublicDocument>
      <div className="space-y-8">
        <div className="space-y-3 text-[13px] leading-6 text-[var(--public-muted)] sm:text-sm sm:leading-7">
          {document.introduction.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        {document.sections.map((section) => (
          <PublicDocumentSection key={section.title} title={section.title}>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.list ? (
              section.list.type === 'ordered' ? (
                <ol className="list-decimal space-y-2 pl-5 marker:text-[var(--public-accent)]">
                  {section.list.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              ) : (
                <ul className="list-disc space-y-2 pl-5 marker:text-[var(--public-accent)]">
                  {section.list.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            ) : null}
          </PublicDocumentSection>
        ))}

        <p className="border-t border-[var(--public-border)] pt-5 text-[10px] font-light leading-5 text-[var(--public-tertiary)]">
          Vigente desde {formatLegalEffectiveDate(document.effectiveDate)} · Versão{' '}
          <span className="font-mono">{document.version}</span>
        </p>
      </div>
    </PublicDocument>
  )
}

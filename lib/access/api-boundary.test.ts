import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { getSafeAbsoluteHttpUrl } from '../safe-http-url'

const protectedClientFiles = [
  'lib/api/pipeline-board.ts',
  'lib/api/pipelines.ts',
  'contexts/AuthContext.tsx',
]

test('dados de autorizacao e pipeline passam pela API central', () => {
  for (const relativePath of protectedClientFiles) {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')

    assert.doesNotMatch(source, /\.from\s*\(\s*['"`]/, `${relativePath} must not query Supabase tables directly`)
  }
})

test('distribuicao reconhece formularios Meta por uma leitura propria e limitada', () => {
  const appSource = readFileSync(resolve(process.cwd(), 'apps/api/internal/app/app.go'), 'utf8')
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )
  const tabSource = readFileSync(
    resolve(process.cwd(), 'components/features/crm-management/DistributionTab.tsx'),
    'utf8',
  )

  assert.match(
    appSource,
    /GET \/v1\/round-robin-meta-forms[^\n]+permissions\.DistributionManage/,
  )
  for (const source of [editorSource, tabSource]) {
    assert.match(source, /useRoundRobinMetaForms/)
    assert.doesNotMatch(source, /useMetaFormConfigs|useMetaIntegrations/)
  }
})

test('editor preserva a politica canonica de reentrada ao atualizar uma fila', () => {
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )

  assert.match(
    editorSource,
    /reentry_behavior\?: 'redistribute' \| 'keep_assignee' \| null;/,
  )
  assert.match(
    editorSource,
    /\.\.\.\(queue\.settings \|\| \{\}\),[\s\S]*?reentry_behavior: queue\.reentry_behavior\s*\?\? queue\.settings\?\.reentry_behavior\s*\?\? 'redistribute',/,
  )
})

test('ajustes visuais do fluxo WhatsApp preservam os dados e escondem codigos internos', () => {
  const trackingSource = readFileSync(
    resolve(process.cwd(), 'components/features/leads/LeadDetailDialog.tsx'),
    'utf8',
  )
  const trackingSectionSource = readFileSync(
    resolve(process.cwd(), 'components/features/leads/LeadTrackingSection.tsx'),
    'utf8',
  )
  const historySource = readFileSync(resolve(process.cwd(), 'hooks/use-lead-history.ts'), 'utf8')
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )
  const tagSelectorSource = readFileSync(resolve(process.cwd(), 'components/ui/tag-selector.tsx'), 'utf8')
  const cardSource = readFileSync(resolve(process.cwd(), 'components/features/leads/LeadCard.tsx'), 'utf8')

  assert.match(trackingSource, /rawPayload\?\.source_url/)
  assert.match(trackingSource, /rawSourceReferral\?\.source_url/)
  assert.match(trackingSource, /const safeCreativeLink = getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_link_url\)/)
  assert.match(trackingSource, /\['Link do criativo', safeCreativeLink\]/)
  assert.match(trackingSource, /\['Imagem', getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_url\)\]/)
  assert.match(trackingSource, /\['Video', getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_video_url\)\]/)
  assert.match(trackingSectionSource, /const safeCreativeImageUrl = getSafeAbsoluteHttpUrl\(leadMeta\.creative_url\)/)
  assert.match(trackingSectionSource, /const safeCreativeVideoUrl = getSafeAbsoluteHttpUrl\(leadMeta\.creative_video_url\)/)
  assert.match(trackingSectionSource, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/)
  assert.doesNotMatch(trackingSectionSource, /window\.open\(leadMeta\./)
  assert.match(historySource, /'round_robin_auto',[\s\S]*?'canonical_round_robin'/)
  assert.match(editorSource, /import \{ TagSelector \} from '@\/components\/ui\/tag-selector'/)
  assert.match(editorSource, /<TagSelector[\s\S]*?onSelectTag=\{toggleAutoTag\}/)
  assert.match(editorSource, /allowCreate=\{hasPermission\('tag_manage'\)\}/)
  assert.match(editorSource, /<Command filter=\{commandSearchFilter\}>/)
  assert.match(tagSelectorSource, /allowCreate\?: boolean/)
  assert.match(tagSelectorSource, /allowCreate = true/)
  assert.match(tagSelectorSource, /if \(!allowCreate \|\| !searchTerm\.trim\(\) \|\| exactMatch\) return/)
  assert.match(cardSource, /\{campaignName && \([\s\S]*?\{campaignName\}[\s\S]*?\)\}/)
  assert.doesNotMatch(cardSource, /const label = campaignName \|\| 'WhatsApp';/)
  assert.doesNotMatch(cardSource, /`WhatsApp · \$\{campaignName\}`/)
})

test('resposta automática da fila WhatsApp permanece opt-in e limitada', () => {
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )
  const createHookSource = readFileSync(resolve(process.cwd(), 'hooks/use-create-queue-advanced.ts'), 'utf8')
  const listHookSource = readFileSync(resolve(process.cwd(), 'hooks/use-round-robins.ts'), 'utf8')

  for (const source of [editorSource, createHookSource, listHookSource]) {
    assert.match(source, /whatsapp_distribution_auto_reply_enabled\?: boolean/)
    assert.match(source, /whatsapp_distribution_auto_reply_message\?: string/)
    assert.match(source, /whatsapp_distribution_auto_reply_delay_seconds\?: number/)
  }
  assert.match(editorSource, /whatsapp_distribution_auto_reply_enabled: false/)
  assert.match(editorSource, /DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 30/)
  assert.match(editorSource, /MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 3600/)
  assert.match(editorSource, /\{hasWhatsAppMessageCondition && \([\s\S]*?distribution-queue-whatsapp-auto-reply/)
  assert.match(editorSource, /removedLastWhatsAppCondition[\s\S]*?whatsapp_distribution_auto_reply_enabled: false/)
  assert.match(editorSource, /sanitizedHasWhatsAppMessageCondition && whatsappAutoReplyEnabled/)
})

test('link do criativo aceita somente URL absoluta HTTP ou HTTPS', () => {
  assert.equal(getSafeAbsoluteHttpUrl('https://www.instagram.com/p/creative/'), 'https://www.instagram.com/p/creative/')
  assert.equal(getSafeAbsoluteHttpUrl('http://example.com/creative'), 'http://example.com/creative')
  assert.equal(getSafeAbsoluteHttpUrl('javascript:alert(1)'), null)
  assert.equal(getSafeAbsoluteHttpUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(getSafeAbsoluteHttpUrl('/creative/relative'), null)
})

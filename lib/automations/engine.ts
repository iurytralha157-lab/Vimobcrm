export const DEFAULT_POSITIVE_REPLY_KEYWORDS = [
  'sim',
  'claro',
  'quero',
  'pode',
  'beleza',
  'bora',
  'vamos',
  'aceito',
  'ok',
  'com certeza',
  'fechado',
  'top',
  'pode ser',
  'sem problema',
  'não tem problema',
  'tudo bem',
  'show',
  'perfeito',
  'ótimo',
  'massa',
  'interessado',
].join(', ')

export const DEFAULT_NEGATIVE_REPLY_KEYWORDS = [
  'não',
  'nope',
  'sem interesse',
  'desculpa',
  'obrigado mas não',
  'talvez não',
  'deixa pra lá',
  'não quero',
  'não preciso',
  'não pode ser',
  'agora não',
  'pode parar',
  'dispenso',
  'valeu mas não',
  'nunca',
  'jamais',
  'negativo',
].join(', ')

export const AUTOMATION_CUSTOM_VARIABLES = [
  { value: 'lead.name', label: 'Nome do lead' },
  { value: 'lead.email', label: 'E-mail do lead' },
  { value: 'lead.phone', label: 'Telefone do lead' },
  { value: 'lead.source', label: 'Origem do lead' },
  { value: 'lead.status', label: 'Status do lead' },
  { value: 'lead.pipeline_id', label: 'Pipeline do lead' },
  { value: 'lead.stage_id', label: 'Etapa do lead' },
  { value: 'lead.assigned_user_id', label: 'Responsável pelo lead' },
  { value: 'organization.name', label: 'Nome da organização' },
] as const

export const AUTOMATION_TEMPLATE_VARIABLES = [
  ...AUTOMATION_CUSTOM_VARIABLES.map((variable) => variable.value),
  'date',
] as const

export type ReplyClassification = 'positive' | 'negative' | 'uncertain'
export type AutomationConditionBranch = 'true' | 'false' | 'unknown'

export interface ReplyClassificationResult {
  classification: ReplyClassification
  matchedPositive: string[]
  matchedNegative: string[]
  normalizedContent: string
}

export interface AutomationConditionEvaluation {
  branch: AutomationConditionBranch
  classification?: ReplyClassification
  matchedPositive?: string[]
  matchedNegative?: string[]
  actual?: unknown
}

export function normalizeAutomationText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function parseAutomationKeywordList(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;\n]/)
      : []

  const unique = new Map<string, string>()
  for (const entry of entries) {
    const original = String(entry ?? '').trim()
    const normalized = normalizeAutomationText(original)
    if (normalized && !unique.has(normalized)) unique.set(normalized, original)
  }
  return [...unique.values()]
}

export function resolveReplyKeywordConfig(config: Record<string, unknown>): {
  positiveKeywords: string
  negativeKeywords: string
} {
  const positiveKeywords = typeof config.positive_keywords === 'string'
    ? config.positive_keywords.trim()
    : ''
  const negativeKeywords = typeof config.negative_keywords === 'string'
    ? config.negative_keywords.trim()
    : ''

  if (!positiveKeywords && !negativeKeywords) {
    return {
      positiveKeywords: DEFAULT_POSITIVE_REPLY_KEYWORDS,
      negativeKeywords: DEFAULT_NEGATIVE_REPLY_KEYWORDS,
    }
  }

  return { positiveKeywords, negativeKeywords }
}

function containsNormalizedPhrase(content: string, phrase: string): boolean {
  if (!content || !phrase) return false
  return ` ${content} `.includes(` ${phrase} `)
}

function phraseSpecificity(phrase: string): number {
  const normalized = normalizeAutomationText(phrase)
  if (!normalized) return 0
  return normalized.split(' ').length * 10_000 + normalized.length
}

function matchingPhrases(content: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => containsNormalizedPhrase(content, normalizeAutomationText(keyword)))
}

function strongestMatch(matches: string[]): number {
  return matches.reduce((score, phrase) => Math.max(score, phraseSpecificity(phrase)), 0)
}

export function classifyAutomationReply(
  content: unknown,
  config: Record<string, unknown> = {},
): ReplyClassificationResult {
  const normalizedContent = normalizeAutomationText(content)
  const resolved = resolveReplyKeywordConfig(config)
  const positives = parseAutomationKeywordList(resolved.positiveKeywords)
  const negatives = parseAutomationKeywordList(resolved.negativeKeywords)
  const matchedPositive = matchingPhrases(normalizedContent, positives)
  const matchedNegative = matchingPhrases(normalizedContent, negatives)

  let classification: ReplyClassification = 'uncertain'
  if (matchedPositive.length > 0 && matchedNegative.length === 0) {
    classification = 'positive'
  } else if (matchedNegative.length > 0 && matchedPositive.length === 0) {
    classification = 'negative'
  } else if (matchedPositive.length > 0 && matchedNegative.length > 0) {
    const positiveScore = strongestMatch(matchedPositive)
    const negativeScore = strongestMatch(matchedNegative)
    if (positiveScore > negativeScore) classification = 'positive'
    if (negativeScore > positiveScore) classification = 'negative'
  }

  return { classification, matchedPositive, matchedNegative, normalizedContent }
}

export function nestedAutomationValue(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object' || !path) return undefined
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, source)
}

function comparableText(value: unknown): string {
  return normalizeAutomationText(value)
}

function expectedValues(value: unknown): string[] {
  return parseAutomationKeywordList(value)
}

export function evaluateCustomAutomationCondition(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): { matched: boolean; actual: unknown } {
  const actual = nestedAutomationValue(context, String(config.variable ?? ''))
  const expected = config.value

  switch (config.operator) {
    case 'equals':
      return { matched: comparableText(actual) === comparableText(expected), actual }
    case 'not_equals':
      return { matched: comparableText(actual) !== comparableText(expected), actual }
    case 'contains': {
      const phrase = comparableText(expected)
      return { matched: Boolean(phrase) && containsNormalizedPhrase(comparableText(actual), phrase), actual }
    }
    case 'not_contains': {
      const phrase = comparableText(expected)
      return { matched: !phrase || !containsNormalizedPhrase(comparableText(actual), phrase), actual }
    }
    case 'contains_any': {
      const content = comparableText(actual)
      const phrases = expectedValues(expected).map(normalizeAutomationText)
      return { matched: phrases.some((phrase) => containsNormalizedPhrase(content, phrase)), actual }
    }
    case 'not_contains_any': {
      const content = comparableText(actual)
      const phrases = expectedValues(expected).map(normalizeAutomationText)
      return { matched: phrases.every((phrase) => !containsNormalizedPhrase(content, phrase)), actual }
    }
    case 'greater_than': {
      const left = Number(actual)
      const right = Number(expected)
      return { matched: Number.isFinite(left) && Number.isFinite(right) && left > right, actual }
    }
    case 'less_than': {
      const left = Number(actual)
      const right = Number(expected)
      return { matched: Number.isFinite(left) && Number.isFinite(right) && left < right, actual }
    }
    case 'is_set':
      return { matched: actual !== undefined && actual !== null && actual !== '', actual }
    case 'is_not_set':
      return { matched: actual === undefined || actual === null || actual === '', actual }
    default:
      throw new Error('unsupported_condition_operator')
  }
}

function responseContent(context: Record<string, unknown>): unknown {
  const replyPayload = nestedAutomationValue(context, 'execution.reply_payload')
  if (replyPayload && typeof replyPayload === 'object' && Object.prototype.hasOwnProperty.call(replyPayload, 'content')) {
    return (replyPayload as Record<string, unknown>).content
  }
  return undefined
}

export function evaluateAutomationCondition(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): AutomationConditionEvaluation {
  if (config.condition_type === 'response_sentiment') {
    const result = classifyAutomationReply(responseContent(context), config)
    const branch: AutomationConditionBranch = result.classification === 'positive'
      ? 'true'
      : result.classification === 'negative'
        ? 'false'
        : 'unknown'
    return {
      branch,
      classification: result.classification,
      matchedPositive: result.matchedPositive,
      matchedNegative: result.matchedNegative,
    }
  }

  const result = evaluateCustomAutomationCondition(config, context)
  return { branch: result.matched ? 'true' : 'false', actual: result.actual }
}

export function renderAutomationTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = nestedAutomationValue(context, path)
    return value === undefined || value === null ? '' : String(value)
  })
}

export function unknownAutomationTemplateVariables(template: string): string[] {
  const allowed = new Set<string>(AUTOMATION_TEMPLATE_VARIABLES)
  const unknown = new Set<string>()
  const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  for (const match of template.matchAll(variablePattern)) {
    const variable = match[1]?.trim()
    if (variable && !allowed.has(variable)) unknown.add(variable)
  }
  const remaining = template.replace(variablePattern, '')
  if (remaining.includes('{{') || remaining.includes('}}')) unknown.add('invalid_template_syntax')
  return [...unknown]
}

import { z } from 'zod'

type FinancialField = 'interestValue' | 'commissionPercentage'
const decimal = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/

/** Match Go strings.TrimSpace without accepting a BOM as whitespace. */
function trimFinancialValue(value: string) {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
}

function normalizeFinancialValue(value: string, field: FinancialField, allowBlank: boolean): string | null {
  const text = trimFinancialValue(value)
  if (!text && allowBlank) return null
  if (!text || text.length > 40) throw new Error('Informe um valor decimal com ate 40 caracteres')
  const match = decimal.exec(text)
  if (!match) throw new Error('Informe um valor decimal valido')
  const digits = match[2].replace('.', '').replace(/^0+/, '')
  // Zero is exact even if its exponent would overflow a floating point parser.
  if (!digits) return '0'
  if (match[1] === '-') throw new Error('O valor nao pode ser negativo')
  const numeric = Number(text)
  if (!Number.isFinite(numeric) || numeric === 0) throw new Error('O valor esta fora do intervalo permitido')
  if (field === 'commissionPercentage') {
    // Only parse the bounded exponent after finite/nonzero checks. Never round
    // 100.0000000000000000001 down to 100 before checking the percentage.
    const fractionalDigits = match[2].includes('.') ? match[2].length - match[2].indexOf('.') - 1 : 0
    const integerDigits = BigInt(digits.length) + BigInt(match[3] || '0') - BigInt(fractionalDigits)
    const coefficient = digits.padEnd(3, '0')
    if (integerDigits > BigInt(3) || (integerDigits === BigInt(3) && (coefficient.slice(0, 3) !== '100' || /[1-9]/.test(coefficient.slice(3))))) {
      throw new Error('A comissao deve estar entre 0 e 100')
    }
  }
  return text
}

function financialSchema(field: FinancialField, allowBlank = false) {
  return z.string().transform((value, ctx) => {
    try { return normalizeFinancialValue(value, field, allowBlank) }
    catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Valor financeiro invalido' })
      return z.NEVER
    }
  })
}

export const leadCreateInterestValueSchema = financialSchema('interestValue', true).nullish()
export const leadInterestValueSchema = financialSchema('interestValue').nullish()
export const leadCommissionPercentageSchema = financialSchema('commissionPercentage').nullish()

const legacyFinancialValueSchema = z.union([z.number(), z.string(), z.null()]).optional()
const legacyFinancialFieldsSchema = z.object({
  valor_interesse: legacyFinancialValueSchema,
  commission_percentage: legacyFinancialValueSchema,
})
const numericFinancialFieldsSchema = z.object({
  valor_interesse: z.number().nullish(),
  commission_percentage: z.number().nullish(),
})

/** Validate only finance fields before optimistic UI writes; other lead fields keep their own contracts. */
export function assertLeadFinancialFields(input: { valor_interesse?: unknown; commission_percentage?: unknown }, options: { numbersOnly?: boolean } = {}) {
  const fields = (options.numbersOnly ? numericFinancialFieldsSchema : legacyFinancialFieldsSchema).parse(input)
  leadInterestValueSchema.parse(fields.valor_interesse == null ? fields.valor_interesse : String(fields.valor_interesse))
  leadCommissionPercentageSchema.parse(fields.commission_percentage == null ? fields.commission_percentage : String(fields.commission_percentage))
}

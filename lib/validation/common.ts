import { z } from 'zod'

export const uuidSchema = z.string().trim().uuid()
export const timestampSchema = z.string().trim().min(1)
export const nonNegativeIntegerSchema = z.number().int().min(0)

export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema }).passthrough()
}

export const apiUnknownEnvelopeSchema = apiEnvelopeSchema(z.unknown())
export const apiUnknownListEnvelopeSchema = apiEnvelopeSchema(z.array(z.unknown()))
export const apiRecordEnvelopeSchema = apiEnvelopeSchema(z.record(z.unknown()))
export const apiRecordListEnvelopeSchema = apiEnvelopeSchema(z.array(z.record(z.unknown())))
export const okResponseSchema = z.object({ ok: z.boolean() }).passthrough()

export class DomainValidationError extends Error {
  readonly code = 'domain_validation_error'
  readonly context: string
  readonly direction: 'input' | 'response'
  readonly issues: string[]

  constructor(
    context: string,
    direction: 'input' | 'response',
    error: z.ZodError,
  ) {
    const issues = error.issues.slice(0, 5).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
      return `${path}: ${issue.message}`
    })
    const label = direction === 'input' ? 'entrada' : 'resposta'
    super(`Contrato invalido na ${label} de ${context}: ${issues.join('; ')}`)
    this.name = 'DomainValidationError'
    this.context = context
    this.direction = direction
    this.issues = issues
  }
}

export function parseDomainInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  context: string,
): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new DomainValidationError(context, 'input', result.error)
  }
  return result.data
}

export function validateDomainResponse(
  schema: z.ZodTypeAny,
  response: unknown,
  context: string,
) {
  const result = schema.safeParse(response)
  if (!result.success) {
    throw new DomainValidationError(context, 'response', result.error)
  }
}

import { z } from 'zod'

export const PASSWORD_POLICY = {
  minLength: 8,
  // Supabase Auth uses bcrypt and rejects passwords above 72 UTF-8 bytes.
  // maxLength also keeps native inputs from accepting an obviously invalid
  // value, while the byte check below handles accented characters and emoji.
  maxLength: 72,
  maxBytes: 72,
} as const

export type PasswordRequirementId =
  | 'length'
  | 'uppercase'
  | 'lowercase'
  | 'number'
  | 'symbol'

export type PasswordRequirement = {
  id: PasswordRequirementId
  label: string
  message: string
  isValid: boolean
}

function passwordLength(value: string) {
  return Array.from(value).length
}

function passwordByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

export function evaluatePasswordPolicy(password: string): PasswordRequirement[] {
  const length = passwordLength(password)
  const byteLength = passwordByteLength(password)

  return [
    {
      id: 'length',
      label: `${PASSWORD_POLICY.minLength}–${PASSWORD_POLICY.maxLength} caracteres`,
      message: `Use entre ${PASSWORD_POLICY.minLength} e ${PASSWORD_POLICY.maxLength} caracteres (acentos e emojis podem reduzir o limite)`,
      isValid:
        length >= PASSWORD_POLICY.minLength
        && length <= PASSWORD_POLICY.maxLength
        && byteLength <= PASSWORD_POLICY.maxBytes,
    },
    {
      id: 'uppercase',
      label: 'Maiúscula',
      message: 'Inclua pelo menos uma letra maiúscula',
      isValid: /\p{Lu}/u.test(password),
    },
    {
      id: 'lowercase',
      label: 'Minúscula',
      message: 'Inclua pelo menos uma letra minúscula',
      isValid: /\p{Ll}/u.test(password),
    },
    {
      id: 'number',
      label: 'Número',
      message: 'Inclua pelo menos um número',
      isValid: /\p{N}/u.test(password),
    },
    {
      id: 'symbol',
      label: 'Símbolo',
      message: 'Inclua pelo menos um símbolo',
      isValid: /[\p{P}\p{S}]/u.test(password),
    },
  ]
}

export function isStrongPassword(password: string) {
  return evaluatePasswordPolicy(password).every((requirement) => requirement.isValid)
}

export const strongPasswordSchema = z.string().superRefine((password, context) => {
  for (const requirement of evaluatePasswordPolicy(password)) {
    if (requirement.isValid) continue

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: requirement.message,
    })
  }
})

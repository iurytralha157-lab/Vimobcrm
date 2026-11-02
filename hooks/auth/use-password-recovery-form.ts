'use client'

import { useState, type SetStateAction } from 'react'

type Fields = {
  loading: boolean
  password: string
  confirmPassword: string
  errors: Record<string, string>
  showPassword: boolean
  showConfirmPassword: boolean
  emailNotificationSent: boolean | null
}
const emptyFields = (): Fields => ({ loading: false, password: '', confirmPassword: '', errors: {},
  showPassword: false, showConfirmPassword: false, emailNotificationSent: null })

/** Reset before rendering another identity; stale setters cannot overwrite it. */
export function usePasswordRecoveryForm(identity: string | null) {
  const [state, setState] = useState(() => ({ identity, fields: emptyFields() }))
  if (state.identity !== identity) setState({ identity, fields: emptyFields() })
  const update = <K extends keyof Fields>(key: K, value: SetStateAction<Fields[K]>) => {
    setState(current => {
      if (current.identity !== identity) return current
      const next = typeof value === 'function' ? (value as (previous: Fields[K]) => Fields[K])(current.fields[key]) : value
      return { identity, fields: { ...current.fields, [key]: next } }
    })
  }
  const fields = state.identity === identity ? state.fields : emptyFields()
  return { ...fields,
    setLoading: (value: SetStateAction<boolean>) => update('loading', value),
    setPassword: (value: SetStateAction<string>) => update('password', value),
    setConfirmPassword: (value: SetStateAction<string>) => update('confirmPassword', value),
    setErrors: (value: SetStateAction<Record<string, string>>) => update('errors', value),
    setShowPassword: (value: SetStateAction<boolean>) => update('showPassword', value),
    setShowConfirmPassword: (value: SetStateAction<boolean>) => update('showConfirmPassword', value),
    setEmailNotificationSent: (value: SetStateAction<boolean | null>) => update('emailNotificationSent', value),
  }
}

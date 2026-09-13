const PT_BR_LOCALE = 'pt-BR'
const BRL_CURRENCY_FORMATTER = new Intl.NumberFormat(PT_BR_LOCALE, {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPtBRNumber(value: number): string {
  return value.toLocaleString(PT_BR_LOCALE)
}

export function formatLocalizedBRLCurrency(value: number): string {
  return BRL_CURRENCY_FORMATTER.format(value)
}

export function formatWholePtBRCurrency(
  value: number,
  currency = 'BRL',
): string {
  return new Intl.NumberFormat(PT_BR_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatFixedBRLCurrency(value: number): string {
  return `R$ ${value.toLocaleString(PT_BR_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatBRLCurrencyWithDefaultDecimals(value: number): string {
  return `R$ ${formatPtBRNumber(value)}`
}

export function formatBRLCurrencyWithMinimumTwoDecimals(value: number): string {
  return `R$ ${value.toLocaleString(PT_BR_LOCALE, {
    minimumFractionDigits: 2,
  })}`
}

export function formatUnspacedBRLCurrency(value: number): string {
  return `R$${formatPtBRNumber(value)}`
}

export function formatCompactBRLCurrency(value: number): string {
  if (value >= 1_000_000) {
    const compactValue = value / 1_000_000
    const formatted = compactValue.toLocaleString(PT_BR_LOCALE, {
      maximumFractionDigits: 1,
      minimumFractionDigits: compactValue % 1 === 0 ? 0 : 1,
    })
    return `R$${formatted}M`
  }

  if (value >= 1_000) {
    const compactValue = value / 1_000
    const formatted = compactValue.toLocaleString(PT_BR_LOCALE, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    })
    return `R$${formatted}K`
  }

  return `R$${value.toLocaleString(PT_BR_LOCALE, {
    maximumFractionDigits: 0,
  })}`
}

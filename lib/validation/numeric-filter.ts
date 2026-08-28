export function parseNumericFilter(value?: string | null) {
  let cleaned = value?.trim() || ""
  if (/^R\$/i.test(cleaned)) cleaned = cleaned.slice(2).trim()
  cleaned = cleaned.replace(/\s/g, "")

  if (!cleaned || !/^\d[\d.,]*$/.test(cleaned)) return undefined

  const lastComma = cleaned.lastIndexOf(",")
  const lastDot = cleaned.lastIndexOf(".")
  let normalized = cleaned

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(/,/g, ".")
    } else {
      normalized = cleaned.replace(/,/g, "")
    }
  } else if (lastComma >= 0) {
    const groups = cleaned.split(",")
    if (groups.length > 2) {
      if (!groups.slice(1).every((group) => group.length === 3)) return undefined
      normalized = groups.join("")
    } else if (!groups[1]) {
      normalized = groups[0]
    } else {
      normalized = `${groups[0]}.${groups[1]}`
    }
  } else if (lastDot >= 0) {
    const groups = cleaned.split(".")
    if (groups.length > 2) {
      if (!groups.slice(1).every((group) => group.length === 3)) return undefined
      normalized = groups.join("")
    } else if (!groups[1]) {
      normalized = groups[0]
    } else if (groups[1].length === 3) {
      normalized = groups.join("")
    }
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

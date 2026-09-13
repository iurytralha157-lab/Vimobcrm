export function parseJSONOrNull(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

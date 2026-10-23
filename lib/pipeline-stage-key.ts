export const PIPELINE_STAGE_KEY_MAX_LENGTH = 80

/** Keep established browser aliases while reserving room for collision suffixes. */
export function buildUniquePipelineStageKey(name: string, existingKeys: Iterable<string>) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'coluna'
  const taken = new Set(existingKeys)
  const initial = base.slice(0, PIPELINE_STAGE_KEY_MAX_LENGTH)
  if (!taken.has(initial)) return initial

  for (let suffix = 2; ; suffix++) {
    const ending = `_${suffix}`
    const candidate = `${base.slice(0, PIPELINE_STAGE_KEY_MAX_LENGTH - ending.length)}${ending}`
    if (!taken.has(candidate)) return candidate
  }
}

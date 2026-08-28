export const VIMOB_RELEASE_HEADER = 'x-vimob-release-sha'
export const UNVERSIONED_RELEASE_SHA = 'unversioned'

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/

export function normalizeReleaseSha(value: unknown): string {
  if (typeof value !== 'string') {
    return UNVERSIONED_RELEASE_SHA
  }

  const normalizedValue = value.trim().toLowerCase()

  return FULL_GIT_SHA_PATTERN.test(normalizedValue)
    ? normalizedValue
    : UNVERSIONED_RELEASE_SHA
}

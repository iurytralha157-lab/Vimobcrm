const MEMBER_AVAILABILITY_BATCH_SIZE = 100

export function chunkUniqueTeamMemberIDs(
  values: readonly string[] | null | undefined,
): Array<string[] | undefined> {
  if (!values?.length) return [undefined]

  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (unique.length === 0) return [undefined]

  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += MEMBER_AVAILABILITY_BATCH_SIZE) {
    batches.push(unique.slice(index, index + MEMBER_AVAILABILITY_BATCH_SIZE))
  }
  return batches
}

export function reusePreviousDataWhenKeyPartsMatch<T>(
  previousData: T | undefined,
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[],
  protectedKeyIndexes: readonly number[],
): T | undefined {
  if (previousData === undefined || !previousQueryKey) return undefined;

  return protectedKeyIndexes.every(
    (index) => previousQueryKey[index] === currentQueryKey[index],
  )
    ? previousData
    : undefined;
}

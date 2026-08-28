export type ImportBatchFailure = {
  index: number;
  error: unknown;
};

export type ImportBatchResult = {
  successIndexes: number[];
  failures: ImportBatchFailure[];
};

export async function runLeadImportBatch<T>(
  rows: readonly T[],
  importRow: (row: T, index: number) => Promise<void>,
  concurrency = 3,
): Promise<ImportBatchResult> {
  const workerCount = Math.min(Math.max(1, Math.trunc(concurrency)), rows.length);
  let cursor = 0;
  const successIndexes: number[] = [];
  const failures: ImportBatchFailure[] = [];

  const importNext = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;

      try {
        await importRow(rows[index], index);
        successIndexes.push(index);
      } catch (error) {
        failures.push({ index, error });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => importNext()));

  return {
    successIndexes: successIndexes.sort((left, right) => left - right),
    failures: failures.sort((left, right) => left.index - right.index),
  };
}

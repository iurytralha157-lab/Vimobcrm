export type ImportBatchFailure = {
  index: number;
  error: unknown;
};

export type ImportBatchResult = {
  successIndexes: number[];
  failures: ImportBatchFailure[];
};

export type ImportBatchProgress = {
  total: number;
  processed: number;
  success: number;
  failed: number;
  remaining: number;
};

export type ImportBatchOptions = {
  concurrency?: number;
  onProgress?: (progress: ImportBatchProgress) => void;
};

const DEFAULT_IMPORT_CONCURRENCY = 3;
const MAX_IMPORT_CONCURRENCY = 8;

export async function runLeadImportBatch<T>(
  rows: readonly T[],
  importRow: (row: T, index: number) => Promise<void>,
  options: number | ImportBatchOptions = DEFAULT_IMPORT_CONCURRENCY,
): Promise<ImportBatchResult> {
  const concurrency = typeof options === 'number'
    ? options
    : options.concurrency ?? DEFAULT_IMPORT_CONCURRENCY;
  const onProgress = typeof options === 'number' ? undefined : options.onProgress;
  const requestedConcurrency = Number.isFinite(concurrency)
    ? Math.trunc(concurrency)
    : DEFAULT_IMPORT_CONCURRENCY;
  const workerCount = Math.min(
    Math.max(1, requestedConcurrency),
    MAX_IMPORT_CONCURRENCY,
    rows.length,
  );
  let cursor = 0;
  let processed = 0;
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
      } finally {
        processed += 1;
        onProgress?.({
          total: rows.length,
          processed,
          success: successIndexes.length,
          failed: failures.length,
          remaining: rows.length - processed,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => importNext()));

  return {
    successIndexes: successIndexes.sort((left, right) => left - right),
    failures: failures.sort((left, right) => left.index - right.index),
  };
}

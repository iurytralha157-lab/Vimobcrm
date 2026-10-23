import { countDistributionQueueInputCharacters } from '@/lib/round-robin/input-text';

export const MIN_DISTRIBUTION_QUEUE_NAME_LENGTH = 2;
export const MAX_DISTRIBUTION_QUEUE_NAME_LENGTH = 120;
export const DISTRIBUTION_QUEUE_NAME_ERROR =
  `O nome da fila deve ter entre ${MIN_DISTRIBUTION_QUEUE_NAME_LENGTH} e ${MAX_DISTRIBUTION_QUEUE_NAME_LENGTH} caracteres.`;

/** Count the effective input without changing the field or payload trim policy. */
export function countDistributionQueueNameCharacters(value: string): number {
  return countDistributionQueueInputCharacters(value);
}

export function isValidDistributionQueueName(value: string): boolean {
  const length = countDistributionQueueNameCharacters(value);
  return length >= MIN_DISTRIBUTION_QUEUE_NAME_LENGTH && length <= MAX_DISTRIBUTION_QUEUE_NAME_LENGTH;
}

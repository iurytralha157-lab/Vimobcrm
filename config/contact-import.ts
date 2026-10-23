/** Retention of completed tab-local reports; these limits never cap imported rows. */
export const CONTACT_IMPORT_RECOVERY_TTL_MS = 30 * 60 * 1000;
export const MAX_COMPLETED_CONTACT_IMPORT_RECOVERIES = 3;
export const MAX_CONTACT_IMPORT_RECOVERY_FILE_BYTES = 20 * 1024 * 1024;

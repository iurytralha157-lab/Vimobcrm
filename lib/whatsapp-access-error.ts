export function isWhatsAppAccessRevokedError(error: unknown) {
  return Boolean(error && typeof error === "object"
    && "code" in error && error.code === "whatsapp_access_revoked");
}

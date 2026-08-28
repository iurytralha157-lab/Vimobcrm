export type WhatsAppRealtimeAccess = {
  enabled: boolean;
  modulesLoading: boolean;
  permissionsLoading: boolean;
  hasWhatsAppModule: boolean;
  hasWhatsAppViewPermission: boolean;
};

export function canSubscribeToWhatsAppRealtime(access: WhatsAppRealtimeAccess) {
  return (
    access.enabled &&
    !access.modulesLoading &&
    !access.permissionsLoading &&
    access.hasWhatsAppModule &&
    access.hasWhatsAppViewPermission
  );
}

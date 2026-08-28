export function existingAsaasCustomerUpdatePayload<
  T extends Record<string, unknown>,
>(profile: T, updateExistingProfile: boolean) {
  return updateExistingProfile ? profile : { notificationDisabled: true };
}

export type AsaasCustomerNotificationConfirmation = {
  id?: string;
  notificationDisabled?: boolean;
};

export async function suppressExistingAsaasCustomerNotifications<
  T extends Record<string, unknown>,
>(input: {
  customerId: string;
  profile: T;
  updateExistingProfile: boolean;
  request: (
    path: string,
    init: { method: "PUT"; body: string },
  ) => Promise<AsaasCustomerNotificationConfirmation>;
}) {
  const customer = await input.request(`/customers/${input.customerId}`, {
    method: "PUT",
    body: JSON.stringify(existingAsaasCustomerUpdatePayload(
      input.profile,
      input.updateExistingProfile,
    )),
  });
  if (
    customer.id !== input.customerId ||
    customer.notificationDisabled !== true
  ) {
    throw new Error("Asaas customer notifications were not disabled.");
  }
  return customer;
}

export function assertAsaasCustomerNotificationsDisabled(
  customer: AsaasCustomerNotificationConfirmation,
) {
  if (!customer.id || customer.notificationDisabled !== true) {
    throw new Error("Asaas customer notifications were not disabled.");
  }
}

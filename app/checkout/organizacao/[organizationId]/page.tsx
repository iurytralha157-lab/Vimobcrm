import { Suspense } from "react";

import CheckoutScreen from "@/components/features/auth/screens/CheckoutScreen";

export const metadata = {
  title: "Pagamento",
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer" as const,
};

type OrganizationCheckoutPageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationCheckoutPage({
  params,
}: OrganizationCheckoutPageProps) {
  const { organizationId } = await params;

  return (
    <Suspense fallback={null}>
      <CheckoutScreen
        key={`organization:${organizationId}`}
        organizationId={organizationId}
      />
    </Suspense>
  );
}

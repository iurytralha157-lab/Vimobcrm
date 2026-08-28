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

type CheckoutPageProps = {
  params: Promise<{ token: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { token } = await params;

  return (
    <Suspense fallback={null}>
      <CheckoutScreen key={`payment:${token}`} checkoutToken={token} />
    </Suspense>
  );
}

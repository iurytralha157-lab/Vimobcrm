import type { ReactNode } from 'react';

import { FinancialAccessGate } from '@/components/features/financial/FinancialAccessGate';

export default function FinanceiroLayout({ children }: { children: ReactNode }) {
  return <FinancialAccessGate>{children}</FinancialAccessGate>;
}

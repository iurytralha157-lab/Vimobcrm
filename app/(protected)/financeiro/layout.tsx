import type { ReactNode } from 'react';

import { FinancialAccessGate } from '@/components/features/financial/FinancialAccessGate';
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary';

export default function FinanceiroLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionBoundary title="Financeiro" anyOf={["financial_view", "financial_manage"]}>
      <FinancialAccessGate>{children}</FinancialAccessGate>
    </PermissionBoundary>
  );
}

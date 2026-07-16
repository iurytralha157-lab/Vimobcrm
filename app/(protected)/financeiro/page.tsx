import FinancialDashboardScreen from '@/components/features/financial/screens/FinancialDashboardScreen'
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary'

export default function FinancialPage() {
  return (
    <PermissionBoundary title="Financeiro" anyOf={["financial_view", "financial_manage"]}>
      <FinancialDashboardScreen />
    </PermissionBoundary>
  )
}

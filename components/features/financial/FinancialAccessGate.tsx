"use client";

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { canUseFinancialModule } from '@/lib/financial-access';

export function FinancialAccessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { loading, organization, profile, userOrganizations } = useAuth();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeOrganizationMembership = userOrganizations.find(
    (item) => item.organization_id === activeOrganizationId
  );
  const canAccessFinancialModule = canUseFinancialModule({
    id: activeOrganizationId,
    name: organization?.name || activeOrganizationMembership?.organization_name,
  });

  if (loading) return null;

  if (!canAccessFinancialModule) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] p-6 text-[var(--app-text-primary)]">
        <section className="w-full max-w-md rounded-[8px] bg-[var(--app-surface)] p-8 text-center shadow-none">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]">
            <LockKeyhole className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-light">Financeiro indisponivel</h1>
          <p className="mt-2 text-sm font-light text-[var(--app-text-secondary)]">
            O modulo financeiro esta habilitado apenas para a Vetter Co.
          </p>
          <Button
            type="button"
            className="mt-6 h-10 w-full rounded-[6px] bg-[#FF4529] text-white shadow-none hover:bg-[#f63e24]"
            onClick={() => router.replace('/dashboard')}
          >
            Voltar ao dashboard
          </Button>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}

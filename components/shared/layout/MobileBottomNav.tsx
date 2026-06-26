"use client";

import { useState, useMemo, type ElementType } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Kanban,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Users,
  Calendar,
  Building2,
  DollarSign,
  CreditCard
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { MobileSidebar } from './MobileSidebar';
import { CreateLeadDialog } from '@/components/features/leads/CreateLeadDialog';
import { isBillingBlockedStatus } from '@/lib/billing-access';

interface TabItem {
  icon: ElementType;
  labelKey: string;
  path: string;
}

export function MobileBottomNav() {
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname() || '';
  const { profile, isSuperAdmin, organization } = useAuth();
  const { t } = useLanguage();
  const { hasModule } = useOrganizationModules();
  const isBillingBlocked = !isSuperAdmin && isBillingBlockedStatus(organization?.subscription_status);

  // Build the 4 visible tabs dynamically based on modules
  const tabs = useMemo(() => {
    if (isBillingBlocked) {
      return [{ icon: CreditCard, labelKey: 'Faturamento', path: '/settings?tab=subscription' }] as TabItem[];
    }

    const result: (TabItem | 'fab' | 'more')[] = [];

    // Slot 1: Dashboard (always)
    result.push({ icon: LayoutDashboard, labelKey: 'dashboard', path: '/dashboard' });

    // Slot 2: Pipelines or fallback
    if (hasModule('crm')) {
      result.push({ icon: Kanban, labelKey: 'pipelines', path: '/crm/pipelines' });
    } else if (hasModule('agenda')) {
      result.push({ icon: Calendar, labelKey: 'schedule', path: '/agenda' });
    } else if (hasModule('properties')) {
      result.push({ icon: Building2, labelKey: 'properties', path: '/properties' });
    } else if (hasModule('financial') && (profile?.role === 'admin' || isSuperAdmin)) {
      result.push({ icon: DollarSign, labelKey: 'financial', path: '/financeiro' });
    }

    // Slot 3: FAB
    result.push('fab');

    // Slot 4: Conversas or fallback
    if (hasModule('whatsapp')) {
      result.push({ icon: MessageSquare, labelKey: 'conversations', path: '/crm/conversas' });
    } else if (hasModule('crm')) {
      result.push({ icon: Users, labelKey: 'contacts', path: '/crm/contacts' });
    } else if (hasModule('agenda') && !result.some((r) => typeof r !== 'string' && r.path === '/agenda')) {
      result.push({ icon: Calendar, labelKey: 'schedule', path: '/agenda' });
    }

    // Slot 5: More
    result.push('more');

    return result;
  }, [hasModule, profile?.role, isSuperAdmin, isBillingBlocked]);

  const isActive = (path: string) => {
    return pathname === path || pathname.startsWith(path + '/');
  };

  const getLabel = (labelKey: string): string => {
    return (t.nav as Record<string, string>)[labelKey] || labelKey;
  };

  const showFab = hasModule('crm') && !isBillingBlocked;

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--app-border)] bg-[var(--app-sidebar)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-end justify-around px-1 h-16 py-[4px] pb-[10px]">
          {tabs.map((tab) => {
            if (tab === 'fab') {
              return (
                <div key="fab" className="flex flex-col items-center justify-center -mt-4">
                  {showFab ? (
                    <button
                      onClick={() => setCreateLeadOpen(true)}
                      className="h-12 w-12 rounded-[6px] bg-[#FF4529] text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                      aria-label="Criar lead"
                    >
                      <Plus className="h-6 w-6" />
                    </button>
                  ) : (
                    <div className="h-12 w-12" />
                  )}
                </div>
              );
            }

            if (tab === 'more') {
              return (
                <MobileSidebarTab key="more" label={(t.nav as Record<string, string>).more || 'Mais'} />
              );
            }

            const active = isActive(tab.path);
            const Icon = tab.icon;

            return (
              <button
                key={tab.path}
                onClick={() => router.push(tab.path)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-w-[56px] transition-colors duration-200 active:scale-95",
                  active ? "text-[#FF4529]" : "text-[var(--app-text-tertiary)] hover:text-[var(--app-text-secondary)]"
                )}
              >
                {active && (
                  <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[#FF4529]" />
                )}

                <Icon className="h-5 w-5 mb-0.5" />

                <span className="text-[10px] font-extralight tracking-wide leading-tight truncate max-w-[56px]">
                  {getLabel(tab.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <CreateLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} />
    </>
  );
}

// Wrapper that renders the More tab button and triggers MobileSidebar sheet
function MobileSidebarTab({ label }: { label: string; }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-w-[56px] text-[var(--app-text-tertiary)] hover:text-[var(--app-text-secondary)] transition-colors duration-200 active:scale-95"
      >
        <MoreHorizontal className="h-5 w-5 mb-0.5" />
        <span className="text-[10px] font-extralight tracking-wide leading-tight">{label}</span>
      </button>
      <MobileSidebarSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

// Extracted sheet from MobileSidebar, controlled externally
function MobileSidebarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void; }) {
  return <MobileSidebar externalOpen={open} onExternalOpenChange={onOpenChange} />;
}

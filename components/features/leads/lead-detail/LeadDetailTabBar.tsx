import type { KeyboardEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type LeadDetailTabId = 'atividades' | 'imoveis' | 'arquivos' | 'dados' | 'transferir' | 'origem';

export type LeadDetailTab = {
  id: LeadDetailTabId;
  label: string;
  icon: LucideIcon;
  /** Plain counter (e.g. attachments). */
  count?: number;
  /** Red counter for things that need attention (e.g. overdue cadence tasks). */
  alert?: number;
};

export const leadDetailTabDomId = (prefix: string, id: LeadDetailTabId, part: 'tab' | 'panel') => `${prefix}-${id}-${part}`;

type LeadDetailTabBarProps = {
  idPrefix: string;
  tabs: LeadDetailTab[];
  active: LeadDetailTabId;
  mobile: boolean;
  onChange: (id: LeadDetailTabId) => void;
  /** Desktop only: actions that share the row with the tabs. */
  actions?: ReactNode;
};

export function LeadDetailTabBar({ idPrefix, tabs, active, mobile, onChange, actions }: LeadDetailTabBarProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    onChange(tabs[next].id);
    buttons[next].focus();
  };

  const list = (
    <div
      role="tablist"
      aria-label="Seções do lead"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={mobile ? 'grid' : 'flex min-w-0 items-end gap-4 overflow-hidden xl:gap-5'}
      style={mobile ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        const counter = tab.alert ? tab.alert : tab.count;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={leadDetailTabDomId(idPrefix, tab.id, 'tab')}
            aria-controls={leadDetailTabDomId(idPrefix, tab.id, 'panel')}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 font-light transition-colors',
              mobile ? 'flex min-h-12 flex-col items-center justify-center gap-1 px-0.5 text-[10px]' : 'flex h-9 items-center gap-1 whitespace-nowrap text-[13px]',
              selected ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]',
            )}
          >
            {mobile && <Icon strokeWidth={1.5} className={cn('h-[18px] w-[18px]', selected && 'text-primary')} />}
            <span className="truncate">{tab.label}</span>
            {Boolean(counter) && (
              <span
                aria-label={tab.alert ? `${counter} atrasadas` : `${counter}`}
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none',
                  tab.alert ? 'bg-primary text-white' : 'bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]',
                  mobile ? 'absolute right-1 top-1' : 'ml-1',
                )}
              >
                {counter}
              </span>
            )}
            <span aria-hidden className={cn('absolute inset-x-0 bottom-0 h-0.5 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} />
          </button>
        );
      })}
    </div>
  );

  if (mobile) return <div className="border-b border-[var(--app-border)] bg-[var(--app-surface-solid)]">{list}</div>;
  return (
    <div className="flex min-w-0 items-end justify-between gap-3 border-b border-[var(--app-border)]">
      {list}
      {actions && <div className="flex shrink-0 items-center gap-2 pb-1.5">{actions}</div>}
    </div>
  );
}

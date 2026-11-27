import type { ReactNode } from 'react';
import { FileEdit, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { InfoLine } from './InfoLine';
import { LeadDetailTabBar, leadDetailTabDomId, type LeadDetailTab, type LeadDetailTabId } from './LeadDetailTabBar';

export type LeadDetailTile = { value: string; label: string; alert?: boolean };

export type LeadDetailLayoutProps = {
  readNotice: ReactNode;
  stageNav: ReactNode;
  assignee: ReactNode;
  /** Close/back button built by the dialog (it owns the close side effects). */
  closeButton: ReactNode;
  /** Changes when another lead (or org/user/session) opens, so scroll containers start at the top. */
  scrollKey: string;
  identity: {
    name: string;
    initial: string;
    avatarUrl: string | null;
    /** Phone already formatted for display, or the e-mail when there is no phone. */
    contactLine: string | null;
    badges: ReactNode;
    copyPhone: ReactNode;
  };
  tiles: LeadDetailTile[];
  tags: ReactNode;
  status: ReactNode;
  quickActions: ReactNode;
  interestProperty: ReactNode | null;
  contact: { rows: Array<{ label: string; value: ReactNode }>; onEdit?: () => void };
  tabIdPrefix: string;
  tabs: LeadDetailTab[];
  activeTab: LeadDetailTabId;
  onTabChange: (id: LeadDetailTabId) => void;
  tabActions?: ReactNode;
  /** Only the active panel is rendered; hidden panels must not keep queries or forms alive. */
  panel: ReactNode;
  /** Atividades keeps the history thread in its own scroll; other tabs scroll as a whole. */
  panelScrolls: boolean;
};

const blockTitle = 'text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]';

function Identity({ identity, mobile }: { identity: LeadDetailLayoutProps['identity']; mobile: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className={cn('shrink-0 border-0', mobile ? 'h-10 w-10' : 'h-11 w-11')}>
        <AvatarImage src={identity.avatarUrl || undefined} alt={identity.name} />
        <AvatarFallback className="bg-primary/50 text-[13px] font-light text-white">
          {identity.initial || <User strokeWidth={1.5} className="h-5 w-5" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className={cn('truncate font-normal leading-tight', mobile ? 'text-[15px]' : 'text-[16px]')}>{identity.name}</h2>
          {identity.badges}
        </div>
        {identity.contactLine && <p className="mt-0.5 truncate text-[13px] font-light text-[var(--app-text-secondary)]">{identity.contactLine}</p>}
      </div>
      {identity.copyPhone}
    </div>
  );
}

function Tiles({ tiles, mobile }: { tiles: LeadDetailTile[]; mobile: boolean }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map((tile) => (
        <div key={tile.label} className={cn('min-w-0 rounded-[6px] px-1.5 py-2 text-center', mobile ? 'bg-[var(--app-surface-soft)]' : 'bg-[var(--app-surface-solid)]')}>
          <p className={cn('whitespace-nowrap text-[13px] font-normal leading-tight', tile.alert && 'text-primary')}>{tile.value}</p>
          <p className="mt-0.5 whitespace-nowrap text-[10px] font-light text-[var(--app-text-tertiary)]">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

function ContactBlock({ contact }: { contact: LeadDetailLayoutProps['contact'] }) {
  return (
    <section data-tour="lead-detail-contact" className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={blockTitle}>Dados do contato</h3>
        {contact.onEdit && (
          <button type="button" onClick={contact.onEdit} className="lead-detail-subtle-action inline-flex h-7 items-center gap-1 rounded-[6px] bg-[var(--app-surface-solid)] px-2 text-[11px] font-light hover:text-primary">
            <FileEdit strokeWidth={1.5} className="h-3.5 w-3.5" />
            Editar
          </button>
        )}
      </div>
      <div className="space-y-2">
        {contact.rows.map((row) => <InfoLine key={row.label} label={row.label} value={row.value} />)}
      </div>
    </section>
  );
}

function InterestBlock({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <h3 className={blockTitle}>Imóvel de interesse</h3>
      {children}
    </section>
  );
}

function Panel({ props, className }: { props: LeadDetailLayoutProps; className?: string }) {
  return (
    <div
      key={props.scrollKey}
      role="tabpanel"
      id={leadDetailTabDomId(props.tabIdPrefix, props.activeTab, 'panel')}
      aria-labelledby={leadDetailTabDomId(props.tabIdPrefix, props.activeTab, 'tab')}
      tabIndex={0}
      className={cn('min-h-0 flex-1 outline-none', props.panelScrolls ? 'lead-detail-v2-scroll overflow-y-auto' : 'flex flex-col overflow-hidden', className)}
    >
      {props.panel}
    </div>
  );
}

export function DesktopLeadLayout(props: LeadDetailLayoutProps) {
  return (
    <div className="lead-detail-dialog lead-detail-v3 flex h-full max-h-full flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
      {props.readNotice}
      <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">{props.stageNav}</div>
        {/* A grid cell stretches the picker button so a long name truncates instead of overflowing. */}
        <div className="grid w-[220px] shrink-0">{props.assignee}</div>
        {props.closeButton}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4 px-4 pb-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside key={props.scrollKey} className="lead-detail-v2-scroll min-h-0 space-y-3 overflow-y-auto">
          <section className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
            <Identity identity={props.identity} mobile={false} />
            <Tiles tiles={props.tiles} mobile={false} />
            <div data-tour="lead-detail-tags">{props.tags}</div>
            {props.status}
            {props.quickActions}
          </section>
          {props.interestProperty && <InterestBlock>{props.interestProperty}</InterestBlock>}
          <ContactBlock contact={props.contact} />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col gap-3">
          <LeadDetailTabBar idPrefix={props.tabIdPrefix} tabs={props.tabs} active={props.activeTab} mobile={false} onChange={props.onTabChange} actions={props.tabActions} />
          <Panel props={props} />
        </main>
      </div>
    </div>
  );
}

export function MobileLeadLayout(props: LeadDetailLayoutProps) {
  return (
    <div className="lead-detail-dialog lead-detail-v3 flex h-full min-h-0 flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
      {props.readNotice}
      <div key={props.scrollKey} className="lead-detail-v2-scroll min-h-0 flex-1 overflow-y-auto">
        <header className="space-y-2.5 px-3 pb-3 pt-3">
          <div className="flex items-center gap-2">
            {props.closeButton}
            <div className="min-w-0 flex-1"><Identity identity={props.identity} mobile /></div>
          </div>
          {props.stageNav}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            {props.assignee}
            {props.status}
          </div>
          <Tiles tiles={props.tiles} mobile />
          <div data-tour="lead-detail-tags">{props.tags}</div>
          {props.quickActions}
        </header>
        <div className="sticky top-0 z-10">
          <LeadDetailTabBar idPrefix={props.tabIdPrefix} tabs={props.tabs} active={props.activeTab} mobile onChange={props.onTabChange} />
        </div>
        <div
          role="tabpanel"
          id={leadDetailTabDomId(props.tabIdPrefix, props.activeTab, 'panel')}
          aria-labelledby={leadDetailTabDomId(props.tabIdPrefix, props.activeTab, 'tab')}
          tabIndex={0}
          className="space-y-3 p-3 pb-6 outline-none"
        >
          {props.activeTab === 'dados' && <ContactBlock contact={props.contact} />}
          {props.panel}
        </div>
      </div>
    </div>
  );
}

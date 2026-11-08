import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type StageSettingsFooter = {
  /** Fixed bar at the bottom of the column settings sheet. */
  node: HTMLElement | null;
  /** Closes the sheet, asking before discarding unsaved changes. */
  close: () => void;
};

const StageSettingsFooterContext = createContext<StageSettingsFooter | null>(null);

export const StageSettingsFooterProvider = StageSettingsFooterContext.Provider;

export function useStageSettingsFooter() {
  return useContext(StageSettingsFooterContext);
}

type PrimaryAction = {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  /** Submits this form even though the button is rendered outside it. */
  form?: string;
  onClick?: () => void;
};

/**
 * One action bar for every tab: gray Cancelar on the left of an orange primary
 * action, fixed at the bottom of the sheet. Outside the sheet (standalone use)
 * the same buttons render inline below the content.
 */
export function StageSettingsActions({
  status,
  cancelLabel = 'Cancelar',
  onCancel,
  cancelDisabled,
  primary,
}: {
  status?: ReactNode;
  cancelLabel?: string;
  /** Defaults to closing the sheet. */
  onCancel?: () => void;
  cancelDisabled?: boolean;
  primary?: PrimaryAction;
}) {
  const footer = useStageSettingsFooter();
  const cancel = onCancel ?? footer?.close;
  const actions = (
    <>
      <p className="mr-auto hidden min-w-0 truncate text-[12px] font-light text-[var(--app-text-tertiary)] sm:block">{status}</p>
      {cancel ? (
        <Button
          type="button"
          variant="ghost"
          className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-5 text-xs font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={cancel}
          disabled={cancelDisabled}
        >
          {cancelLabel}
        </Button>
      ) : null}
      {primary ? (
        <Button
          type={primary.form ? 'submit' : 'button'}
          form={primary.form}
          className={cn('h-10 min-w-28 rounded-[6px] bg-primary px-5 text-xs font-normal text-primary-foreground shadow-none hover:bg-primary/90', !cancel && 'w-full sm:w-auto')}
          onClick={primary.onClick}
          disabled={primary.disabled}
        >
          {primary.loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          {primary.label}
        </Button>
      ) : null}
    </>
  );
  if (footer?.node) return createPortal(actions, footer.node);
  return <div className="flex items-center justify-end gap-2 pt-4">{actions}</div>;
}

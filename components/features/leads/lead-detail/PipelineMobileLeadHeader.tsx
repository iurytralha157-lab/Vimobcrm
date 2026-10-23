'use client';

import type { ReactNode } from 'react';

interface PipelineMobileLeadHeaderProps {
  stages: ReactNode;
  closeAction: ReactNode;
  identity: ReactNode;
  assignee: ReactNode;
  status: ReactNode;
  tags: ReactNode;
  actions: ReactNode;
}

/** Presentation only: action slots retain the detail's permission and confirmation handlers. */
export function PipelineMobileLeadHeader({
  stages, closeAction, identity, assignee, status, tags, actions,
}: PipelineMobileLeadHeaderProps) {
  return (
    <div data-pipeline-mobile-header className="lead-mobile-drawer-header shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 pb-2">
      <div className="mb-2 flex items-center gap-2">
        {stages}
        {closeAction}
      </div>
      {identity}
      <div data-lead-header-tags className="mt-2 max-h-[72px] overflow-y-auto overscroll-contain">
        {tags}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
        {assignee}
        {status}
      </div>
      {actions}
    </div>
  );
}

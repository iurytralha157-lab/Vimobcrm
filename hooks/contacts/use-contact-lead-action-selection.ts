'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import {
  MAX_CONTACT_LEAD_ACTION_TARGETS,
  useContactLeadActions,
  type ContactLeadAction,
  type ContactLeadActionReview,
} from '@/hooks/contacts/use-contact-lead-actions';
import type { Contact } from '@/hooks/use-contacts-list';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessageOrFallback as getErrorMessage } from '@/lib/api/vimob-error';
import { createLeadImportScope } from '@/lib/lead-import-scope';

export type ContactLeadActionRequest = {
  kind: ContactLeadAction['kind'];
  contacts: readonly Pick<Contact, 'id' | 'name'>[];
  scope: string;
  isCurrent: () => boolean;
  review?: ContactLeadActionReview;
  error?: string;
  progress?: { completed: number; total: number };
};

export function useContactLeadActionSelection({
  contacts,
  canOperateLeads,
  isContactsTransitioning,
  isSearchSettling,
  periodError,
  selectionAuthScope,
  onCompleted,
}: {
  contacts: readonly Contact[];
  canOperateLeads: boolean;
  isContactsTransitioning: boolean;
  isSearchSettling: boolean;
  periodError?: string | null;
  selectionAuthScope: string;
  onCompleted: (completeIds: ReadonlySet<string>, shouldRefetch: boolean) => void;
}) {
  const { toast } = useToast();
  const leadActions = useContactLeadActions();
  const [actionScope] = useState(createLeadImportScope);
  const [leadActionRequest, setLeadActionRequest] = useState<ContactLeadActionRequest | null>(null);
  const actionVisit = useRef(0);
  const activeLeadAction = useRef<(() => boolean) | null>(null);
  const actionScopeKey = JSON.stringify([selectionAuthScope, canOperateLeads, isSearchSettling, periodError]);
  useLayoutEffect(() => actionScope.activate(actionScopeKey), [actionScope, actionScopeKey]);
  if (leadActionRequest && leadActionRequest.scope !== actionScopeKey) setLeadActionRequest(null);

  const closeLeadAction = () => {
    if (activeLeadAction.current?.()) return;
    actionVisit.current += 1;
    setLeadActionRequest(null);
  };

  const requestLeadAction = async (kind: ContactLeadAction['kind'], ids: readonly string[]) => {
    if (!canOperateLeads || isContactsTransitioning || periodError || ids.length === 0 || activeLeadAction.current?.()) return;
    if (ids.length > MAX_CONTACT_LEAD_ACTION_TARGETS) {
      toast({ title: 'Selecione menos contatos', description: `Cada ação permite até ${MAX_CONTACT_LEAD_ACTION_TARGETS} contatos.`, variant: 'destructive' });
      return;
    }
    const selectedContacts = contacts.filter((contact) => ids.includes(contact.id));
    if (selectedContacts.length !== ids.length) {
      toast({ title: 'A seleção mudou', description: 'Confira os contatos visíveis antes de continuar.', variant: 'destructive' });
      return;
    }

    const visit = ++actionVisit.current;
    const currentScope = actionScope.capture(actionScopeKey);
    const isCurrent = () => currentScope() && actionVisit.current === visit;
    const request = { kind, contacts: selectedContacts, scope: actionScopeKey, isCurrent };
    setLeadActionRequest(request);
    try {
      const review = await leadActions.prepare(selectedContacts.map(({ id }) => id), isCurrent);
      if (isCurrent()) setLeadActionRequest({ ...request, review });
    } catch (error) {
      if (isCurrent()) setLeadActionRequest({ ...request, error: getErrorMessage(error, 'Não foi possível revisar os contatos.') });
    }
  };

  const handleLeadAction = async (action: ContactLeadAction) => {
    const request = leadActionRequest;
    if (!request?.review || request.kind !== action.kind || !request.isCurrent() || activeLeadAction.current?.()) return;
    if (!canOperateLeads || isContactsTransitioning || periodError ||
        !request.review.targets.every(({ id }) => contacts.some((contact) => contact.id === id))) {
      closeLeadAction();
      toast({ title: 'A seleção mudou', description: 'Confira os contatos visíveis e abra a ação novamente.', variant: 'destructive' });
      return;
    }

    activeLeadAction.current = request.isCurrent;
    try {
      const result = await leadActions.run({
        review: request.review,
        action,
        isCurrent: request.isCurrent,
        onProgress: (completed, total) => {
          if (request.isCurrent()) setLeadActionRequest({ ...request, progress: { completed, total } });
        },
      });
      if (!request.isCurrent()) return;
      const completeIds = new Set([...result.succeededIds, ...result.unchangedIds]);
      onCompleted(completeIds, result.unconfirmedIds.length > 0 || result.failures.length > 0);
      const excludedCount = request.review.failures.length + request.review.unstartedIds.length;
      const pendingReview = excludedCount + result.failures.length + result.unconfirmedIds.length + result.unstartedIds.length;
      const description = [
        `${result.succeededIds.length} alterado(s)`,
        `${result.unchangedIds.length} sem mudança`,
        excludedCount > 0 ? `${excludedCount} fora da ação` : null,
        result.failures.length > 0 ? `${result.failures.length} com erro` : null,
        result.unconfirmedIds.length > 0 ? `${result.unconfirmedIds.length} sem confirmação` : null,
        result.unstartedIds.length > 0 ? `${result.unstartedIds.length} sem envio` : null,
        result.financialReviewIds.length > 0 ? `${result.financialReviewIds.length} com revisão financeira pendente` : null,
      ].filter(Boolean).join(' · ');
      const firstError = result.failures[0]?.message ?? request.review.failures[0]?.message;
      toast({
        title: pendingReview ? 'Confira o resultado da ação' : 'Ação concluída',
        description: [description, firstError, result.unconfirmedIds.length ? 'Atualize a lista antes de tentar novamente.' : null].filter(Boolean).join('. '),
        variant: pendingReview && !completeIds.size ? 'destructive' : 'default',
      });
    } catch (error) {
      if (request.isCurrent()) toast({ title: 'Não foi possível concluir a ação', description: getErrorMessage(error, 'Confira os contatos e abra a ação novamente.'), variant: 'destructive' });
    } finally {
      if (activeLeadAction.current === request.isCurrent) {
        activeLeadAction.current = null;
        if (request.isCurrent()) closeLeadAction();
      }
    }
  };

  return {
    leadActionRequest: leadActionRequest?.scope === actionScopeKey ? leadActionRequest : null,
    closeLeadAction,
    requestLeadAction,
    handleLeadAction,
  };
}

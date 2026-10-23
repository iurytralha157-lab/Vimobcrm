'use client';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WhatsAppMessageNavigation } from '@/hooks/use-whatsapp-message-navigation';
import { WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME } from '@/components/features/whatsapp/conversation-list-ui';

const caption = 'text-[length:var(--app-font-size-caption)] font-light';
const quietFocus = WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME;
const searchAction = `h-8 w-8 shrink-0 rounded-[6px] border-0 shadow-none [&_svg]:size-3.5 ${quietFocus}`;

export function ConversationHistorySearch({ navigation, onClose }: { navigation: WhatsAppMessageNavigation; onClose?: () => void }) {
  if (!navigation.open) return navigation.error
    ? <p role="status" className={`px-3 py-2 text-muted-foreground ${caption}`}>{navigation.error}</p> : null;
  const status = navigation.isSearching ? 'Pesquisando…' : navigation.results.length
    ? `${navigation.results.length} resultado(s)` : navigation.query.trim() ? 'Nenhum resultado neste trecho do histórico.' : '';
  const closeSearch = () => { navigation.setOpen(false); onClose?.(); };
  return <section aria-label="Pesquisa no histórico da conversa" className="shrink-0 bg-[var(--app-surface-soft)] px-3 py-2" onKeyDown={event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); closeSearch();
  }}>
    <form className="flex items-center gap-1.5" onSubmit={event => {
      event.preventDefault();
      if (!navigation.isSearching && navigation.query.trim()) void navigation.search();
    }}>
      <Input aria-label="Buscar mensagem nesta conversa" placeholder="Buscar no histórico…" value={navigation.query} maxLength={180} onChange={event => navigation.setQuery(event.target.value)} autoFocus
        className={`h-8 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 py-0 text-base font-light shadow-none md:text-[length:var(--app-font-size-caption)] focus:shadow-none! focus-visible:shadow-none! ${quietFocus}`}
        style={{ fontWeight: 'var(--app-font-weight-body)' }} />
      <Button type="submit" variant="ghost" size="icon" className={searchAction} aria-label="Buscar mensagens" aria-busy={navigation.isSearching} disabled={navigation.isSearching || !navigation.query.trim()}>
        {navigation.isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
      </Button>
      <Button type="button" variant="ghost" size="icon" className={searchAction} aria-label="Fechar pesquisa" onClick={closeSearch}><X className="h-3.5 w-3.5" aria-hidden="true" /></Button>
    </form>
    {navigation.error && <p role="status" className={`mt-2 text-muted-foreground ${caption}`}>{navigation.error}</p>}
    <div aria-live="polite" className={`${status ? 'mt-1' : ''} text-muted-foreground ${caption}`}>{status}</div>
    <div className="max-h-40 overflow-y-auto" aria-label="Resultados da pesquisa">
      {navigation.results.map(message => <button key={message.id} type="button" disabled={navigation.navigating} onClick={() => void navigation.navigateTo(message.id, { conversationId: message.conversation_id, sessionId: message.session_id })} className={`block w-full rounded-[6px] border-0 px-2 py-2 text-left hover:bg-[var(--app-surface-hover)] disabled:opacity-50 ${caption} ${quietFocus}`}>
        <span className="block truncate">{message.content || message.media_filename || 'Mensagem'}</span>
        <time className="text-muted-foreground" dateTime={message.sent_at}>{new Date(message.sent_at).toLocaleString('pt-BR')}</time>
      </button>)}
    </div>
    {navigation.hasMore && <Button type="button" size="sm" variant="ghost" className={`h-8 rounded-[6px] border-0 ${caption} ${quietFocus}`} disabled={navigation.isSearching} onClick={() => void navigation.searchMore()}>Continuar busca no histórico</Button>}
  </section>;
}

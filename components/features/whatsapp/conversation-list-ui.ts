import { FILTER_UI } from '@/config/filter-ui';

/** Keep keyboard focus visible through a neutral surface, without colored borders. */
export const WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME =
  'focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:shadow-none! focus-visible:shadow-none! focus-visible:bg-[var(--app-surface-hover)]!';

/** Presentation shared by the page and floating conversation lists. */
export const CONVERSATION_LIST_UI = {
  search: `${FILTER_UI.control} h-8 py-0 pl-8 pr-3 text-[length:var(--app-font-size-caption)] placeholder:text-[length:var(--app-font-size-caption)] placeholder:font-light md:text-[length:var(--app-font-size-caption)] ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`,
  optionsSearch: `${FILTER_UI.control} h-8 py-0 text-[length:var(--app-font-size-caption)] md:text-[length:var(--app-font-size-caption)] ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`,
  selectedChannel: 'bg-primary/50 text-primary-foreground hover:bg-primary/70 hover:text-primary-foreground',
  pagination: 'h-8 rounded-[6px] border-0 bg-primary/50 px-3 text-[length:var(--app-font-size-caption)] font-light text-primary-foreground shadow-none hover:bg-primary/70 hover:text-primary-foreground [&_svg]:size-3.5',
  clear: 'text-[var(--app-text-secondary)] hover:text-primary',
} as const;

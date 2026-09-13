import type { ElementType } from "react";
import {
  ClipboardList,
  Home,
  Mail,
  MessageSquare,
  Phone,
  Video,
} from "lucide-react";
import type { EventType } from "@/hooks/use-schedule-events";

export const eventTypes: {
  type: EventType;
  label: string;
  icon: ElementType;
}[] = [
  { type: "call", label: "Ligação", icon: Phone },
  { type: "email", label: "E-mail", icon: Mail },
  { type: "meeting", label: "Reunião", icon: Video },
  { type: "task", label: "Tarefa", icon: ClipboardList },
  { type: "message", label: "Mensagem", icon: MessageSquare },
  { type: "visit", label: "Visita ao imóvel", icon: Home },
];

export const agendaFieldClass =
  "rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none outline-none ring-0 placeholder:font-light placeholder:text-[var(--app-text-tertiary)] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0";
export const agendaControlClass =
  "rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors hover:bg-[var(--app-surface-hover)] focus:ring-0 focus-visible:ring-1 focus-visible:ring-primary/30";
export const agendaMutedTextClass = "text-[var(--app-text-tertiary)]";
export const agendaPopoverClass =
  "app-header-popover rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light text-[var(--app-text-primary)] [&_[role=option]]:rounded-[6px] [&_[role=option]]:text-[12px] [&_[role=option]]:font-light";

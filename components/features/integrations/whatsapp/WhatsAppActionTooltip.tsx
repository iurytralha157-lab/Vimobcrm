import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function WhatsAppActionTooltip({
  label,
  children,
  enabled = true,
}: {
  label: string;
  children: ReactNode;
  enabled?: boolean;
}) {
  if (!enabled) return children;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent data-whatsapp-action-tooltip className="text-[10px] !font-extralight leading-4">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

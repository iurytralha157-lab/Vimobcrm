import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AgendaRow } from "@/components/features/schedule/event-sheet/EventSheetPrimitives";
import { agendaFieldClass } from "@/components/features/schedule/event-sheet/config";

export function EventLocationSection({
  locked,
  isMasked,
  location,
  onLocationChange,
}: {
  locked: boolean;
  isMasked: boolean;
  location: string;
  onLocationChange: (value: string) => void;
}) {
  return (
    <AgendaRow icon={<MapPin size={18} />} label="Local" inline>
      {locked ? (
        <p className="break-words text-[12px] font-light text-[var(--app-text-secondary)]">
          {isMasked ? "Informação privada" : location || "Local não informado"}
        </p>
      ) : (
        <Input
          aria-label="Local da atividade"
          value={location}
          onChange={(event) => onLocationChange(event.target.value)}
          placeholder="Endereço, sala ou link da reunião"
          className={`${agendaFieldClass} h-9 text-[12px] font-light`}
        />
      )}
    </AgendaRow>
  );
}

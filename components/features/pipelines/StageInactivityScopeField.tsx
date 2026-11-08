import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StageInactivityStartMode } from '@/lib/validation/stage-inactivity';

export function StageInactivityScopeField({ id, value, onChange, disabled }: {
  id: string;
  value: StageInactivityStartMode;
  onChange: (value: StageInactivityStartMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">Aplicar a quais leads?</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} aria-describedby={`${id}-hint`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new_stage_entries">Só quem entrar após a ativação</SelectItem>
          <SelectItem value="activation">Incluir quem já está na coluna</SelectItem>
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {value === 'activation' ? 'Para quem já está aqui, o prazo começa na ativação.' : 'O prazo começa quando o lead entrar na coluna.'}
      </p>
    </div>
  );
}

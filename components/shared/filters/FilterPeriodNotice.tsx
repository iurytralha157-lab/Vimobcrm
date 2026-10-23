import { Button } from '@/components/ui/button';

export function FilterPeriodNotice({ message, onClear }: { message: string; onClear: () => void }) {
  return (
    <div role="alert" className="app-card-soft space-y-2 rounded-[8px] p-4 text-[12px] text-muted-foreground">
      <p className="font-normal text-foreground">Ajuste o período para consultar estes dados</p>
      <p>{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>Limpar período</Button>
    </div>
  );
}

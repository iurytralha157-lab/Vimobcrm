export function MarketingPeriodNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="app-card-soft space-y-2 rounded-[8px] p-4 text-[12px] text-muted-foreground">
      <p className="font-normal text-foreground">Ajuste o período para consultar estes indicadores</p>
      <p>{message}</p>
      <p>Marketing e campanhas Meta permitem até 366 dias, incluindo o dia inicial e o final. Selecione outro intervalo no filtro de período.</p>
    </div>
  )
}

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function formatBillingDate(
  value: string | null | undefined,
  pattern = "dd/MM/yyyy",
) {
  return value
    ? format(new Date(`${value.slice(0, 10)}T12:00:00`), pattern, {
        locale: ptBR,
      })
    : "Não definido";
}

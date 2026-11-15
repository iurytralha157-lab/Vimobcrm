package financial

import "fmt"

const financialOverdueTodaySQL = "(statement_timestamp() at time zone 'America/Sao_Paulo')::date"

// Aliases and date expressions are trusted source constants, never request input.
func financialOutstandingSQL(alias string) string {
	return fmt.Sprintf(`greatest(coalesce(%[1]s.amount, 0) - greatest(coalesce(%[1]s.paid_amount, 0), coalesce(%[1]s.paid_value, 0), 0), 0)`, alias)
}

func financialOverdueSQL(alias, todaySQL string) string {
	return fmt.Sprintf(`(%[1]s.type in ('receivable', 'payable')
		and %[1]s.due_date < %[2]s
		and lower(btrim(coalesce(%[1]s.status, ''))) in ('pending', 'pendente', 'partial', 'parcial', 'overdue', 'vencido')
		and %[3]s > 0)`, alias, todaySQL, financialOutstandingSQL(alias))
}

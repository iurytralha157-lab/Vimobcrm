package leads

// Never cast a historical free-text timestamp. The structural check bounds
// every subsequent integer conversion, then validates actual calendar days.
// No description/comment/content fallback is consulted for a scheduled time.
func leadHistoryScheduleStartTimeSQL(metadata string) string {
	value := "(" + metadata + "->>'start_time')"
	month := "substring(" + value + ",6,2)::integer"
	year := "substring(" + value + ",1,4)::integer"
	return `(case when jsonb_typeof(` + metadata + `->'start_time') = 'string'
		and ` + value + ` ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
		then case when ` + year + ` > 0 and substring(` + value + `,9,2)::integer <= case
			when ` + month + ` in (4,6,9,11) then 30
			when ` + month + ` = 2 then case when (` + year + ` % 4 = 0 and ` + year + ` % 100 <> 0) or ` + year + ` % 400 = 0 then 29 else 28 end
			else 31 end then ` + value + ` else null end
		else null end)`
}

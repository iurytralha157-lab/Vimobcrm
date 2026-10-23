package schedule

// Preview retains every event through pagination, while open appointments must
// not be buried behind years of completed lead history on the first page.
func scheduleLeadPreviewEventsQuery(whereClause string, canViewOwnLeads ...bool) string {
	// Do not encode a masked slot's result in its position in the preview.
	finalized := "not v.is_masked and coalesce(v.status, '') in ('completed', 'cancelled', 'canceled', 'no_show')"
	return scheduleEventsQueryWithOrder(whereClause, scheduleLeadJoinSQL("v", "l", "$4", "$5", "$6", scheduleCanViewOwnLeadProjection(canViewOwnLeads)),
		"case when "+finalized+" then 1 else 0 end asc, "+
			"case when "+finalized+" then null else v.start_time end asc, "+
			"case when "+finalized+" then v.start_time else null end desc, v.id asc")
}

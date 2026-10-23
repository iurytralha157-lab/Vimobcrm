package leads

// Historical identity is readable for a participant of the row's organization,
// including an inactive/former member, a legacy primary-org user, or a platform
// super administrator. This only limits hydration of current name/avatar data:
// historical IDs, authored content and stored metadata remain unchanged.
// Aliases and organization expressions are fixed internal SQL fragments.
func leadHistoryParticipantSQL(userAlias, organizationExpression string) string {
	return `(
		` + userAlias + `.organization_id = ` + organizationExpression + `
		or ` + userAlias + `.role = 'super_admin'
		or exists (
			select 1 from public.organization_members history_participant
			where history_participant.organization_id = ` + organizationExpression + `
			  and history_participant.user_id = ` + userAlias + `.id
		)
	)`
}

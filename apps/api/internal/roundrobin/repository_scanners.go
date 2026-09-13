package roundrobin

import (
	"github.com/jackc/pgx/v5/pgtype"
)

func scanRoundRobin(row scanner) (RoundRobin, error) {
	var item RoundRobin
	var pipelineID, metadataRaw, createdBy pgtype.Text
	var pipelineSummaryID, pipelineName pgtype.Text
	var stageID, stageName, stageColor pgtype.Text
	var creatorID, creatorName, creatorEmail pgtype.Text

	if err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&item.IsActive,
		&item.LastAssignedIndex,
		&pipelineID,
		&metadataRaw,
		&createdBy,
		&item.CreatedAt,
		&item.UpdatedAt,
		&pipelineSummaryID,
		&pipelineName,
		&stageID,
		&stageName,
		&stageColor,
		&creatorID,
		&creatorName,
		&creatorEmail,
		&item.LeadsDistributed,
	); err != nil {
		return RoundRobin{}, err
	}

	metadata := parseObject(textValue(metadataRaw))
	item.TargetPipelineID = textValue(pipelineID)
	item.CreatedBy = textValue(createdBy)
	item.Strategy = stringFromObject(metadata, "strategy", "simple")
	item.TargetStageID = stringFromObject(metadata, "target_stage_id", "")
	item.Settings = objectFromObject(metadata, "settings")
	item.ReentryBehavior = stringFromObject(metadata, "reentry_behavior", "redistribute")
	item.Rules = []Rule{}
	item.Members = []Member{}

	if pipelineSummaryID.Valid {
		item.TargetPipeline = &PipelineSummary{
			ID:   pipelineSummaryID.String,
			Name: textValue(pipelineName),
		}
	}
	if stageID.Valid {
		item.TargetStage = &StageSummary{
			ID:    stageID.String,
			Name:  textValue(stageName),
			Color: textValue(stageColor),
		}
	}
	if creatorID.Valid {
		item.CreatedByUser = &UserSummary{
			ID:    creatorID.String,
			Name:  textValue(creatorName),
			Email: textValue(creatorEmail),
		}
	}

	return item, nil
}

func scanRule(row scanner) (Rule, error) {
	var rule Rule
	var matchRaw string
	if err := row.Scan(
		&rule.ID,
		&rule.RoundRobinID,
		&rule.MatchType,
		&rule.MatchValue,
		&matchRaw,
		&rule.Priority,
		&rule.IsActive,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	); err != nil {
		return Rule{}, err
	}

	rule.Match = parseObject(matchRaw)
	return rule, nil
}

func scanMember(row scanner) (Member, error) {
	var member Member
	var weight pgtype.Int4
	var memberUserID, teamID, userID, userName, userEmail, avatarURL pgtype.Text
	if err := row.Scan(
		&member.ID,
		&member.RoundRobinID,
		&memberUserID,
		&teamID,
		&member.Position,
		&weight,
		&member.IsActive,
		&userID,
		&userName,
		&userEmail,
		&avatarURL,
		&member.LeadsCount,
	); err != nil {
		return Member{}, err
	}

	member.UserID = textValue(memberUserID)
	member.TeamID = textValue(teamID)
	if weight.Valid {
		member.Weight = int(weight.Int32)
	}
	if member.Weight == 0 {
		member.Weight = 1
	}
	if userID.Valid {
		member.User = &UserSummary{
			ID:        userID.String,
			Name:      textValue(userName),
			Email:     textValue(userEmail),
			AvatarURL: textValue(avatarURL),
		}
	}
	return member, nil
}

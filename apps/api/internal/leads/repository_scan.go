package leads

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

func scanLeadWithTotal(row scanner) (Lead, int64, error) {
	var total int64
	lead, err := scanLeadFields(row, &total)
	return lead, total, err
}

func scanLead(row scanner) (Lead, error) {
	lead, err := scanLeadFields(row, nil)
	return lead, err
}

func scanLeadFields(row scanner, total *int64) (Lead, error) {
	var lead Lead
	var email, phone, source, status, dealStatus, priority, message, propertyCode, propertyID, interestPropertyID pgtype.Text
	var pipelineID, stageID, assignedUserID, teamID, interestValue, commissionPercentage pgtype.Text
	var lostReason, feedback, finalidadeCompra pgtype.Text
	var isOwnResource pgtype.Bool
	var trabalha, procuraFinanciamento pgtype.Bool
	var cargo, empresa, profissao, endereco, bairro, numero, cep, cidade, uf, rendaFamiliar, faixaValorImovel pgtype.Text
	var rawMetadata []byte
	var stageEnteredAt, boardOrderAt, lastContactAt, nextFollowUpAt, firstResponseAt pgtype.Timestamptz
	var firstResponseSeconds pgtype.Int4
	var firstResponseChannel pgtype.Text
	var firstResponseIsAutomation pgtype.Bool
	var legacyWhatsAppAvatarURL, whatsappAvatarStoragePath pgtype.Text
	var whatsappAvatarSyncedAt pgtype.Timestamptz
	var stageIDValue, stageName, stageColor, stageKey pgtype.Text
	var assigneeID, assigneeName, assigneeAvatarURL pgtype.Text

	dest := []any{
		&lead.ID,
		&lead.OrganizationID,
		&lead.Name,
		&email,
		&phone,
		&source,
		&status,
		&dealStatus,
		&priority,
		&message,
		&propertyCode,
		&propertyID,
		&interestPropertyID,
		&pipelineID,
		&stageID,
		&assignedUserID,
		&teamID,
		&interestValue,
		&commissionPercentage,
		&lostReason,
		&feedback,
		&finalidadeCompra,
		&trabalha,
		&procuraFinanciamento,
		&isOwnResource,
		&lead.ReentryCount,
		&cargo,
		&empresa,
		&profissao,
		&endereco,
		&bairro,
		&numero,
		&cep,
		&cidade,
		&uf,
		&rendaFamiliar,
		&faixaValorImovel,
		&rawMetadata,
		&lead.CreatedAt,
		&lead.UpdatedAt,
		&stageEnteredAt,
		&boardOrderAt,
		&lastContactAt,
		&nextFollowUpAt,
		&firstResponseAt,
		&firstResponseSeconds,
		&firstResponseChannel,
		&firstResponseIsAutomation,
		&legacyWhatsAppAvatarURL,
		&whatsappAvatarStoragePath,
		&whatsappAvatarSyncedAt,
		&stageIDValue,
		&stageName,
		&stageColor,
		&stageKey,
		&assigneeID,
		&assigneeName,
		&assigneeAvatarURL,
	}

	if total != nil {
		dest = append([]any{total}, dest...)
	}

	if err := row.Scan(dest...); err != nil {
		return Lead{}, err
	}

	lead.Email = textValue(email)
	lead.Phone = textValue(phone)
	lead.Source = textValueWithDefault(source, "manual")
	lead.Status = textValueWithDefault(status, "new")
	lead.DealStatus = textValueWithDefault(dealStatus, "open")
	lead.Priority = textValueWithDefault(priority, "normal")
	lead.Message = textValue(message)
	lead.PropertyCode = textValue(propertyCode)
	lead.PropertyID = textValue(propertyID)
	lead.InterestPropertyID = textValue(interestPropertyID)
	lead.PipelineID = textValue(pipelineID)
	lead.StageID = textValue(stageID)
	lead.AssignedUserID = textValue(assignedUserID)
	lead.TeamID = textValue(teamID)
	lead.InterestValue = textValue(interestValue)
	lead.CommissionPercentage = textValue(commissionPercentage)
	lead.LostReason = textValue(lostReason)
	lead.Feedback = textValue(feedback)
	lead.FinalidadeCompra = textValue(finalidadeCompra)
	lead.Trabalha = boolPtr(trabalha)
	lead.ProcuraFinanciamento = boolPtr(procuraFinanciamento)
	lead.IsOwnResource = boolPtr(isOwnResource)
	lead.StageEnteredAt = timePtr(stageEnteredAt)
	lead.BoardOrderAt = timePtr(boardOrderAt)
	lead.LastContactAt = timePtr(lastContactAt)
	lead.NextFollowUpAt = timePtr(nextFollowUpAt)
	lead.FirstResponseAt = timePtr(firstResponseAt)
	if firstResponseSeconds.Valid {
		seconds := int(firstResponseSeconds.Int32)
		lead.FirstResponseSeconds = &seconds
	}
	lead.FirstResponseChannel = textPointer(firstResponseChannel)
	lead.FirstResponseIsAutomation = boolPtr(firstResponseIsAutomation)
	lead.WhatsAppAvatarURL = nil
	lead.WhatsAppAvatarStoragePath = textPointer(whatsappAvatarStoragePath)
	lead.WhatsAppAvatarSyncedAt = timePtr(whatsappAvatarSyncedAt)
	lead.AdditionalFields = additionalFields(cargo, empresa, profissao, endereco, bairro, numero, cep, cidade, uf, rendaFamiliar, faixaValorImovel)
	mergeLeadProfileMetadata(lead.AdditionalFields, rawMetadata)

	if stageIDValue.Valid {
		lead.Stage = &Stage{
			ID:       stageIDValue.String,
			Name:     textValue(stageName),
			Color:    textValue(stageColor),
			StageKey: textValue(stageKey),
		}
	}

	if assigneeID.Valid {
		lead.Assignee = &Assignee{
			ID:        assigneeID.String,
			Name:      textValue(assigneeName),
			AvatarURL: textValue(assigneeAvatarURL),
		}
	}

	return lead, nil
}

func additionalFields(values ...pgtype.Text) LeadMetadata {
	keys := []string{"cargo", "empresa", "profissao", "endereco", "bairro", "numero", "cep", "cidade", "uf", "rendaFamiliar", "faixaValorImovel"}
	fields := LeadMetadata{}

	for index, value := range values {
		if value.Valid && value.String != "" {
			fields[keys[index]] = value.String
		}
	}

	return fields
}

func mergeLeadProfileMetadata(fields LeadMetadata, rawMetadata []byte) {
	if fields == nil || len(rawMetadata) == 0 {
		return
	}
	var metadata LeadMetadata
	if err := json.Unmarshal(rawMetadata, &metadata); err != nil {
		return
	}
	if profile, ok := metadata["profile"].(map[string]any); ok {
		for key, value := range profile {
			if key == "cpf" || key == "rg" {
				flagKey := "hasCPF"
				if key == "rg" {
					flagKey = "hasRG"
				}
				fields[flagKey] = strings.TrimSpace(fmt.Sprint(value)) != ""
				continue
			}
			fields[key] = value
		}
	}
	if propertyIDs, ok := metadata["interestPropertyIds"]; ok {
		fields["interestPropertyIds"] = propertyIDs
	}
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointerNonBlank(value)
}

func textValueWithDefault(value pgtype.Text, fallback string) string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return fallback
	}

	return value.String
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	return &value.Time
}

func boolPtr(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}

	return &value.Bool
}

func nullable(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}

	return *value
}

func nullableBool(value *bool) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullableString(value string) any {
	return pgvalue.NullableString(value)
}

func nullablePatchString(value patchString) any {
	if !value.Set || value.Value == nil || strings.TrimSpace(*value.Value) == "" {
		return nil
	}

	return *value.Value
}

func nullablePatchBool(value patchBool) any {
	if !value.Set || value.Value == nil {
		return nil
	}

	return *value.Value
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}

	return string(payload)
}

package meta

import (
	"encoding/json"
	"strings"
)

func filterMessagingPayload(
	payload map[string]any,
	isEnabled func(routeID string, platform string) (bool, error),
) (map[string]any, error) {
	platform := messagingPlatform(textFromAny(payload["object"]))
	if platform == "" {
		return payload, nil
	}
	rawEntries, ok := payload["entry"].([]any)
	if !ok || len(rawEntries) == 0 {
		return payload, nil
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var filtered map[string]any
	if err := json.Unmarshal(encoded, &filtered); err != nil {
		return nil, err
	}
	entries, _ := filtered["entry"].([]any)
	for _, rawEntry := range entries {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}
		if _, hasMessaging := entry["messaging"]; !hasMessaging {
			continue
		}
		routeID := safeMessagingIdentifier(textFromAny(entry["id"]), maxMessagingRouteIDLength)
		enabled := false
		if routeID != "" {
			enabled, err = isEnabled(routeID, platform)
			if err != nil {
				return nil, err
			}
		}
		if enabled {
			continue
		}
		delete(entry, "messaging")
		entry["messaging_redacted"] = true
		entry["storage_decision"] = "skipped_module_disabled"
	}
	return filtered, nil
}

func extractWebhookEventContext(payload map[string]any) webhookEventContext {
	context := webhookEventContext{
		Object: textFromAny(payload["object"]),
	}
	for _, change := range extractLeadgenChanges(payload) {
		context.EventType = "leadgen"
		context.PageID = change.PageID
		context.FormID = change.FormID
		context.LeadgenID = change.LeadgenID
		return context
	}
	for _, event := range extractMessagingEvents(payload) {
		context.EventType = "messages"
		context.PageID = event.EntryID
		context.ProviderEventID = event.ExternalMessageID
		return context
	}
	return context
}

func extractLeadgenChanges(payload map[string]any) []leadgenChange {
	entries, _ := payload["entry"].([]any)
	out := []leadgenChange{}
	for _, entryValue := range entries {
		entry, ok := entryValue.(map[string]any)
		if !ok {
			continue
		}
		entryID := textFromAny(entry["id"])
		changes, _ := entry["changes"].([]any)
		for _, changeValue := range changes {
			change, ok := changeValue.(map[string]any)
			if !ok || !strings.EqualFold(textFromAny(change["field"]), "leadgen") {
				continue
			}
			value, ok := change["value"].(map[string]any)
			if !ok {
				continue
			}
			item := leadgenChange{
				PageID:      firstNonEmpty(textFromAny(value["page_id"]), entryID),
				FormID:      firstNonEmpty(textFromAny(value["form_id"]), textFromAny(value["formID"])),
				LeadgenID:   firstNonEmpty(textFromAny(value["leadgen_id"]), textFromAny(value["lead_id"]), textFromAny(value["id"])),
				CreatedTime: textFromAny(value["created_time"]),
				Raw:         cloneObject(value),
			}
			out = append(out, item)
		}
	}
	return out
}

func aggregateResults(results []LeadgenResult) (string, string, string, int) {
	status := "skipped"
	organizationID := ""
	errorMessage := ""
	processed := 0
	detailsPending := false
	for _, result := range results {
		if organizationID == "" {
			organizationID = result.OrganizationID
		}
		if result.Error != "" && errorMessage == "" {
			errorMessage = result.Error
		}
		detailsPending = detailsPending || result.DetailsPending
		switch result.Status {
		case "failed":
			status = "failed"
		case "processed":
			processed++
			if status != "failed" {
				status = "processed"
			}
		case "duplicate":
			if status != "failed" && status != "processed" {
				status = "duplicate"
			}
		}
	}
	if status != "failed" && detailsPending {
		status = "deferred"
	}
	return status, organizationID, errorMessage, processed
}

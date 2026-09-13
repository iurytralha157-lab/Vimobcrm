package site

import (
	"net/mail"
	"strings"
)

func validatePublicContactRequest(request PublicContactRequest) bool {
	if _, ok := normalizeUUID(request.OrganizationID); !ok {
		return false
	}
	if !validRequiredTrimmedText(&request.Name, 2, 120) ||
		!validRequiredTrimmedText(&request.Phone, 1, 30) ||
		len(phoneDigits(strings.TrimSpace(request.Phone))) < 8 ||
		!validRequiredTrimmedText(request.Message, 2, 1000) ||
		!validRequiredTrimmedText(&request.SubmissionID, 8, 120) ||
		!validOptionalTrimmedText(request.BestTime, 80) ||
		!validOptionalTrimmedText(request.PrivacyURL, 300) ||
		!validOptionalTrimmedText(request.PropertyCode, 80) ||
		!validOptionalTrimmedText(request.Website, 200) ||
		!validOptionalTrimmedText(request.LandingPage, 500) ||
		!validOptionalTrimmedText(request.Referrer, 1000) ||
		!validOptionalTrimmedText(request.UTMSource, 300) ||
		!validOptionalTrimmedText(request.UTMMedium, 300) ||
		!validOptionalTrimmedText(request.UTMCampaign, 300) ||
		!validOptionalTrimmedText(request.UTMTerm, 300) ||
		!validOptionalTrimmedText(request.UTMContent, 300) ||
		!validOptionalTrimmedText(request.GCLID, 300) ||
		!validOptionalTrimmedText(request.FBCLID, 300) ||
		!request.PrivacyAccepted {
		return false
	}
	if request.SessionID != nil {
		if !validRequiredTrimmedText(request.SessionID, 1, maxPublicContactSessionIDRunes) ||
			strings.HasPrefix(strings.TrimSpace(*request.SessionID), publicContactSubmissionSessionPrefix) {
			return false
		}
	}
	if request.PropertyID != nil {
		if _, ok := normalizeUUID(*request.PropertyID); !ok {
			return false
		}
	}
	if request.Email != nil {
		email := strings.TrimSpace(*request.Email)
		if len([]rune(email)) > 254 {
			return false
		}
		if email != "" {
			address, err := mail.ParseAddress(email)
			if err != nil || address.Address != email {
				return false
			}
		}
	}
	return true
}

func validRequiredTrimmedText(value *string, minimumRunes, maximumRunes int) bool {
	if value == nil {
		return false
	}
	length := len([]rune(strings.TrimSpace(*value)))
	return length >= minimumRunes && length <= maximumRunes
}

func validOptionalTrimmedText(value *string, maximumRunes int) bool {
	return value == nil || len([]rune(strings.TrimSpace(*value))) <= maximumRunes
}

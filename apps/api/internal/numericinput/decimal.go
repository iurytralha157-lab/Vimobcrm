package numericinput

import (
	"math"
	"strconv"
	"strings"
	"unicode"
)

func ParseNonNegativeDecimal(raw string) (float64, bool) {
	cleaned := strings.TrimSpace(raw)
	if len(cleaned) >= 2 && strings.EqualFold(cleaned[:2], "R$") {
		cleaned = strings.TrimSpace(cleaned[2:])
	}
	cleaned = strings.Map(func(character rune) rune {
		if unicode.IsSpace(character) {
			return -1
		}
		return character
	}, cleaned)
	if cleaned == "" {
		return 0, false
	}
	for _, character := range cleaned {
		if (character < '0' || character > '9') && character != '.' && character != ',' {
			return 0, false
		}
	}

	lastComma := strings.LastIndex(cleaned, ",")
	lastDot := strings.LastIndex(cleaned, ".")
	normalized := cleaned

	switch {
	case lastComma >= 0 && lastDot >= 0:
		if lastComma > lastDot {
			normalized = strings.ReplaceAll(cleaned, ".", "")
			normalized = strings.ReplaceAll(normalized, ",", ".")
		} else {
			normalized = strings.ReplaceAll(cleaned, ",", "")
		}
	case lastComma >= 0:
		groups := strings.Split(cleaned, ",")
		if len(groups) > 2 {
			if !allThousandsGroups(groups[1:]) {
				return 0, false
			}
			normalized = strings.Join(groups, "")
		} else if groups[1] == "" {
			normalized = groups[0]
		} else {
			normalized = groups[0] + "." + groups[1]
		}
	case lastDot >= 0:
		groups := strings.Split(cleaned, ".")
		if len(groups) > 2 {
			if !allThousandsGroups(groups[1:]) {
				return 0, false
			}
			normalized = strings.Join(groups, "")
		} else if groups[1] == "" {
			normalized = groups[0]
		} else if len(groups[1]) == 3 {
			normalized = groups[0] + groups[1]
		}
	}

	parsed, err := strconv.ParseFloat(normalized, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

func allThousandsGroups(groups []string) bool {
	if len(groups) == 0 {
		return false
	}
	for _, group := range groups {
		if len(group) != 3 {
			return false
		}
	}
	return true
}

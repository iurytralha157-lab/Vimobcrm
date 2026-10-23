package searchtext

import (
	"regexp"
	"strings"
	"testing"
)

func TestPhoneDigitsRecognizesPhoneQueriesAndRejectsMixedText(t *testing.T) {
	for _, item := range []struct {
		query string
		want  string
	}{
		{"(11) 99999-8888", "11999998888"},
		{"+55 (11) 99999-8888", "5511999998888"},
		{" 9999 ", "9999"},
		{"12.34", "1234"},
		{"\t+55\n(11)\r99999-8888", "5511999998888"},
		{"123", ""},
		{"", ""},
		{"Lote 123", ""},
		{"Joao2026", ""},
		{"abc1", ""},
		{"name12@example.invalid", ""},
		{"99_99", ""},
		{"99%99", ""},
		{"phone:+5511999998888", ""},
		{"١٢٣٤", ""},
	} {
		t.Run(item.query, func(t *testing.T) {
			if got := PhoneDigits(item.query); got != item.want {
				t.Fatalf("PhoneDigits(%q)=%q, want %q", item.query, got, item.want)
			}
		})
	}
}

func TestPhoneFallbackCounterexamplesAndBoundSQL(t *testing.T) {
	// Maria has no text containing "Lote 123", but her phone contains 123.
	// A mixed query must never enable that independent numeric alternative.
	name, message, phone := "Maria", "Olá", "5511999123456"
	matches := func(query string) bool {
		text := Contains(name, query) || Contains(message, query) || Contains(phone, query)
		digits := PhoneDigits(query)
		return text || (digits != "" && strings.Contains(regexp.MustCompile(`[^0-9]`).ReplaceAllString(phone, ""), digits))
	}
	for _, query := range []string{"Lote 123", "abc1", "name12@example.invalid", "123"} {
		if query == "123" {
			// A short literal number can still match the raw phone text.
			if !matches(query) || PhoneDigits(query) != "" {
				t.Fatal("short literal matching must remain available")
			}
		} else if matches(query) {
			t.Fatalf("unrelated contact matched a mixed query %q", query)
		}
	}
	if !matches("(11) 99912-3456") {
		t.Fatal("formatted phone no longer matches the stored phone")
	}
	query := PhoneSQL("l.phone", "$6")
	if !strings.Contains(query, "regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') like $6") || strings.Contains(query, phone) {
		t.Fatal("SQL must normalize stored phone and keep the searched value bound separately")
	}
}

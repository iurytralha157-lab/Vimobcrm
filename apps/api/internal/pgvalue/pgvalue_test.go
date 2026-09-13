package pgvalue

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeUUID(t *testing.T) {
	got, ok := NormalizeUUID(" 550E8400-E29B-41D4-A716-446655440000 ")
	if !ok || got != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("NormalizeUUID() = %q, %v", got, ok)
	}
	if _, ok := NormalizeUUID("not-a-uuid"); ok {
		t.Fatal("NormalizeUUID(invalid) ok = true")
	}
}

func TestTextPointerPolicies(t *testing.T) {
	invalid := pgtype.Text{}
	blank := pgtype.Text{String: "   ", Valid: true}
	value := pgtype.Text{String: "  Vimob  ", Valid: true}

	if TextPointer(invalid) != nil || TextPointerNonEmpty(invalid) != nil ||
		TextPointerNonBlank(invalid) != nil || TextPointerTrimmed(invalid) != nil {
		t.Fatal("invalid pgtype.Text must map to nil for every policy")
	}
	if got := TextPointer(blank); got == nil || *got != "   " {
		t.Fatalf("TextPointer(blank) = %#v", got)
	}
	if got := TextPointerNonEmpty(blank); got == nil || *got != "   " {
		t.Fatalf("TextPointerNonEmpty(blank) = %#v", got)
	}
	if TextPointerNonBlank(blank) != nil || TextPointerTrimmed(blank) != nil {
		t.Fatal("blank-aware policies must map whitespace-only text to nil")
	}
	if got := TextPointerNonBlank(value); got == nil || *got != "  Vimob  " {
		t.Fatalf("TextPointerNonBlank(value) = %#v", got)
	}
	if got := TextPointerTrimmed(value); got == nil || *got != "Vimob" {
		t.Fatalf("TextPointerTrimmed(value) = %#v", got)
	}
}

func TestNullableStringPolicies(t *testing.T) {
	blank := "  "
	value := "  Vimob  "

	if NullableString(blank) != nil || NullableTrimmedString(blank) != nil {
		t.Fatal("blank strings must map to nil")
	}
	if got := NullableString(value); got != value {
		t.Fatalf("NullableString(value) = %#v", got)
	}
	if got := NullableTrimmedString(value); got != "Vimob" {
		t.Fatalf("NullableTrimmedString(value) = %#v", got)
	}
	if NullableStringPointer(nil) != nil || NullableTrimmedStringPointer(nil) != nil {
		t.Fatal("nil pointers must map to nil")
	}
	if got := NullableStringPointer(&blank); got != blank {
		t.Fatalf("NullableStringPointer(blank) = %#v", got)
	}
	if NullableTrimmedStringPointer(&blank) != nil {
		t.Fatal("NullableTrimmedStringPointer(blank) must map to nil")
	}
}

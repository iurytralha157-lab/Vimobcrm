package jsonvalue

import "testing"

func TestDecodeObjectRejectsBlankPayload(t *testing.T) {
	if _, err := DecodeObject(nil); err == nil {
		t.Fatal("DecodeObject(nil) error = nil, want an invalid JSON error")
	}
}

func TestDecodeObjectAllowBlankReturnsEmptyObject(t *testing.T) {
	item, err := DecodeObjectAllowBlank(nil)
	if err != nil {
		t.Fatalf("DecodeObjectAllowBlank(nil) error = %v", err)
	}
	if item == nil || len(item) != 0 {
		t.Fatalf("DecodeObjectAllowBlank(nil) = %#v, want an empty object", item)
	}
}

func TestObjectDecodersShareJSONValidation(t *testing.T) {
	for _, decode := range []func([]byte) (map[string]any, error){DecodeObject, DecodeObjectAllowBlank} {
		item, err := decode([]byte(`{"id":"item-1"}`))
		if err != nil {
			t.Fatalf("decode(valid object) error = %v", err)
		}
		if item["id"] != "item-1" {
			t.Fatalf("decode(valid object) = %#v", item)
		}
		if _, err := decode([]byte(`{"id":`)); err == nil {
			t.Fatal("decode(invalid object) error = nil")
		}
	}
}

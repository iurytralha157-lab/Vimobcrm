package jsonvalue

import "encoding/json"

// DecodeObject decodes a database JSON value as an object. A blank payload is
// invalid, matching json.Unmarshal's strict behavior.
func DecodeObject(raw []byte) (map[string]any, error) {
	return decodeObject(raw, false)
}

// DecodeObjectAllowBlank decodes a database JSON value as an object and maps a
// blank payload to an empty object. This policy is explicit because some legacy
// portal rows can contain a blank JSON value.
func DecodeObjectAllowBlank(raw []byte) (map[string]any, error) {
	return decodeObject(raw, true)
}

func decodeObject(raw []byte, allowBlank bool) (map[string]any, error) {
	item := map[string]any{}
	if len(raw) == 0 && allowBlank {
		return item, nil
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

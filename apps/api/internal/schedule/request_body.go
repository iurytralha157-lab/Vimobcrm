package schedule

import (
	"encoding/json"
	"errors"
	"io"
)

func decodeSingleScheduleJSON(decoder *json.Decoder, request any) error {
	if err := decoder.Decode(request); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("schedule request must contain exactly one JSON value")
	}
	return nil
}

package app

import (
	"os"
	"testing"
)

func readAppWiringSource(t *testing.T) string {
	t.Helper()

	var source string
	for _, path := range []string{"app.go", "routes.go"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		source += string(raw)
	}

	return source
}

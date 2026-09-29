package evolutionroute

import (
	"errors"
	"strings"
	"testing"
)

func TestCanaryRouteIsExactAndFailsClosed(t *testing.T) {
	const sessionID = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	config := Config{
		Production:       Destination{APIURL: "https://prod.example", APIKey: "production-key", CallMediaHMACSecret: strings.Repeat("p", 32)},
		Canary:           Destination{APIURL: "https://canary.example", APIKey: "canary-key", CallMediaHMACSecret: strings.Repeat("c", 32), ImageDigest: "sha256:" + strings.Repeat("a", 64)},
		CanarySessionIDs: []string{sessionID},
	}
	selected, err := config.ForSession(strings.ToUpper(sessionID))
	if err != nil || selected.APIURL != "https://canary.example" {
		t.Fatalf("allowlisted route = %+v, %v", selected, err)
	}
	selected, err = config.ForSession("7ec1c269-e28a-41ca-82e7-237df52c550e")
	if err != nil || selected.APIURL != "https://prod.example" {
		t.Fatalf("ordinary session route = %+v, %v", selected, err)
	}
	selected, err = config.ForSession("")
	if err != nil || selected.APIURL != "https://prod.example" {
		t.Fatalf("unscoped route = %+v, %v", selected, err)
	}
	config.CanarySessionIDs = nil
	selected, err = config.ForSession(sessionID)
	if err != nil || selected.APIURL != "https://prod.example" {
		t.Fatalf("no allowlist must preserve production route = %+v, %v", selected, err)
	}
	config.CanarySessionIDs = []string{sessionID}
	config.Canary = Destination{}
	selected, err = config.ForSession(sessionID)
	if !errors.Is(err, ErrCanaryUnavailable) || selected.APIURL != "" {
		t.Fatalf("no canary configuration must fail closed, route = %+v, %v", selected, err)
	}
	config.Canary = Destination{APIURL: "https://canary.example", APIKey: "canary-key", CallMediaHMACSecret: strings.Repeat("c", 32), ImageDigest: "sha256:" + strings.Repeat("a", 64)}
	config.Canary.APIKey = ""
	selected, err = config.ForSession(sessionID)
	if !errors.Is(err, ErrCanaryUnavailable) || selected.APIURL != "" {
		t.Fatalf("missing canary key must fail closed, route = %+v, %v", selected, err)
	}
	config.Canary.APIKey = config.Production.APIKey
	if _, err = config.ForSession(sessionID); !errors.Is(err, ErrCanaryUnavailable) {
		t.Fatalf("production key must not be reused for canary: %v", err)
	}
	config.Canary.APIKey = "canary-key"
	config.Canary.APIURL = "  https://PROD.example:443/  "
	if _, err = config.ForSession(sessionID); !errors.Is(err, ErrCanaryUnavailable) {
		t.Fatalf("same production origin with case, port, and whitespace must not be canary: %v", err)
	}
}

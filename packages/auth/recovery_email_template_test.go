package auth

import (
	"bytes"
	"html"
	"html/template"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
)

var recoveryEmailHrefPattern = regexp.MustCompile(`href="([^"]+)"`)

func TestRecoveryEmailTemplateRendersCanonicalResetLinks(t *testing.T) {
	source, err := os.ReadFile("../../supabase/templates/recovery.html")
	if err != nil {
		t.Fatalf("read recovery email template: %v", err)
	}

	parsed, err := template.New("recovery.html").Parse(string(source))
	if err != nil {
		t.Fatalf("parse recovery email as Go HTML template: %v", err)
	}

	const tokenHash = "canonical-token-hash"
	const redirectTo = "https://app.vimobcrm.com.br/reset-password"
	var rendered bytes.Buffer
	if err := parsed.Execute(&rendered, struct {
		RedirectTo string
		TokenHash  string
	}{
		RedirectTo: redirectTo,
		TokenHash:  tokenHash,
	}); err != nil {
		t.Fatalf("render recovery email template: %v", err)
	}

	renderedHTML := rendered.String()
	if !strings.Contains(renderedHTML, "Redefina sua senha") {
		t.Fatal("rendered recovery email lost the Portuguese heading")
	}
	for _, forbidden := range []string{
		"Reset Your Password",
		"Follow this link",
		"Alternatively",
		"enter the code",
	} {
		if strings.Contains(renderedHTML, forbidden) {
			t.Fatalf("rendered recovery email contains fallback copy %q", forbidden)
		}
	}

	recoveryLinks := make([]string, 0, 2)
	for _, match := range recoveryEmailHrefPattern.FindAllStringSubmatch(renderedHTML, -1) {
		candidate := html.UnescapeString(match[1])
		if strings.Contains(candidate, "token_hash=") {
			recoveryLinks = append(recoveryLinks, candidate)
		}
	}
	if len(recoveryLinks) != 2 {
		t.Fatalf("rendered recovery link count = %d, want 2", len(recoveryLinks))
	}

	for _, rawLink := range recoveryLinks {
		parsedURL, err := url.Parse(rawLink)
		if err != nil {
			t.Fatalf("parse rendered recovery link %q: %v", rawLink, err)
		}
		if parsedURL.Scheme != "https" ||
			parsedURL.Host != "app.vimobcrm.com.br" ||
			parsedURL.Path != "/reset-password" {
			t.Fatalf("rendered recovery destination is not canonical: %s", parsedURL.String())
		}
		query := parsedURL.Query()
		if values := query["token_hash"]; len(values) != 1 || values[0] != tokenHash {
			t.Fatalf("rendered recovery token contract is invalid: %#v", values)
		}
		if values := query["type"]; len(values) != 1 || values[0] != "recovery" {
			t.Fatalf("rendered recovery type contract is invalid: %#v", values)
		}
		if len(query) != 2 {
			t.Fatalf("rendered recovery query has unexpected fields: %#v", query)
		}
	}
}

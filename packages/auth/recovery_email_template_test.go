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

func TestRecoveryEmailTemplatePreservesAuthVerificationPKCEContract(t *testing.T) {
	source, err := os.ReadFile("../../supabase/templates/recovery.html")
	if err != nil {
		t.Fatalf("read recovery email template: %v", err)
	}
	if count := strings.Count(string(source), "{{ .ConfirmationURL }}"); count != 3 {
		t.Fatalf("confirmation URL placeholder count = %d, want CTA, fallback href and visible URL", count)
	}
	for _, forbidden := range []string{"{{ .TokenHash }}", "{{ .RedirectTo }}", "token_hash="} {
		if strings.Contains(string(source), forbidden) {
			t.Fatalf("recovery template must not bypass Auth verification with %q", forbidden)
		}
	}

	parsed, err := template.New("recovery.html").Parse(string(source))
	if err != nil {
		t.Fatalf("parse recovery email as Go HTML template: %v", err)
	}

	for _, environment := range []struct {
		name       string
		siteURL    string
		authOrigin string
	}{
		{"production", "https://app.vimobcrm.com.br", "https://supabase.vimobcrm.com.br"},
		{"staging", "https://homologacao.vimobcrm.com.br", "https://lfkfuhvjvqgwyikzcfep.supabase.co"},
	} {
		t.Run(environment.name, func(t *testing.T) {
			assertRecoveryEmailDestinations(t, parsed, environment.siteURL, environment.authOrigin)
		})
	}
}

func assertRecoveryEmailDestinations(t *testing.T, parsed *template.Template, siteURL, authOrigin string) {
	t.Helper()
	// Auth GET /verify selects PKCE from the token prefix and preserves type
	// recovery in flow_state. POST /verify with token_hash instead issues OTP.
	const tokenHash = "pkce_synthetic-recovery-token-hash"
	redirectTo := siteURL + "/reset-password"
	confirmationURL := authOrigin + "/auth/v1/verify?" + url.Values{
		"token":       {tokenHash},
		"type":        {"recovery"},
		"redirect_to": {redirectTo},
	}.Encode()
	var rendered bytes.Buffer
	if err := parsed.Execute(&rendered, struct {
		SiteURL         string
		RedirectTo      string
		TokenHash       string
		ConfirmationURL string
	}{
		SiteURL:         siteURL,
		RedirectTo:      redirectTo,
		TokenHash:       tokenHash,
		ConfirmationURL: confirmationURL,
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

	for _, legalPath := range []string{"/termos-de-uso", "/politica-de-privacidade"} {
		if !strings.Contains(renderedHTML, `href="`+siteURL+legalPath+`"`) {
			t.Fatalf("legal link %s must stay in the configured environment %s", legalPath, siteURL)
		}
	}

	recoveryLinks := make([]string, 0, 2)
	for _, match := range recoveryEmailHrefPattern.FindAllStringSubmatch(renderedHTML, -1) {
		candidate := html.UnescapeString(match[1])
		if strings.Contains(candidate, "/auth/v1/verify?") {
			recoveryLinks = append(recoveryLinks, candidate)
		}
	}
	if len(recoveryLinks) != 2 {
		t.Fatalf("rendered recovery link count = %d, want 2", len(recoveryLinks))
	}

	for _, rawLink := range recoveryLinks {
		if rawLink != confirmationURL {
			t.Fatalf("template changed Auth's confirmation URL: %s", rawLink)
		}
		parsedURL, err := url.Parse(rawLink)
		if err != nil {
			t.Fatalf("parse rendered recovery link %q: %v", rawLink, err)
		}
		if parsedURL.Scheme != "https" ||
			parsedURL.Host != strings.TrimPrefix(authOrigin, "https://") ||
			parsedURL.Path != "/auth/v1/verify" || parsedURL.Fragment != "" {
			t.Fatalf("rendered recovery destination must be the configured Auth verification endpoint: %s", parsedURL.String())
		}
		query := parsedURL.Query()
		if values := query["token"]; len(values) != 1 || values[0] != tokenHash || !strings.HasPrefix(values[0], "pkce_") {
			t.Fatalf("rendered recovery token contract is invalid: %#v", values)
		}
		if values := query["type"]; len(values) != 1 || values[0] != "recovery" {
			t.Fatalf("rendered recovery type contract is invalid: %#v", values)
		}
		if values := query["redirect_to"]; len(values) != 1 || values[0] != redirectTo {
			t.Fatalf("rendered recovery redirect must target this environment's reset page: %#v", values)
		}
		if len(query) != 3 {
			t.Fatalf("rendered recovery query has unexpected fields: %#v", query)
		}
	}
	if count := strings.Count(renderedHTML, html.EscapeString(confirmationURL)); count != 3 {
		t.Fatalf("rendered confirmation URL count = %d, want two hrefs and one visible fallback", count)
	}
}

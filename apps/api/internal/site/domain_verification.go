package site

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

const domainVerificationPath = "/.well-known/vimob-domain-verification"

var domainLabelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

type DomainVerificationResult struct {
	Domain    string  `json:"domain"`
	Verified  bool    `json:"verified"`
	CheckedAt string  `json:"checked_at"`
	Reason    *string `json:"reason,omitempty"`
}

func (handler Handler) VerifyDomain(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	site, err := handler.repo.GetSite(r.Context(), tenantContext)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	if site == nil || site.CustomDomain == nil || strings.TrimSpace(*site.CustomDomain) == "" {
		httpserver.WriteError(w, r, http.StatusBadRequest, "site_domain_missing", "Configure o dominio antes de verificar.")
		return
	}

	domain := normalizePublicDomain(*site.CustomDomain)
	result := DomainVerificationResult{
		Domain:    domain,
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
	}

	verified, err := verifyDomainChallenge(r.Context(), domain, site.DomainVerificationToken)
	if err != nil {
		reason := "challenge_unavailable"
		result.Reason = &reason
		httpserver.WriteJSON(w, http.StatusOK, Envelope[DomainVerificationResult]{Data: result})
		return
	}
	if !verified {
		reason := "challenge_mismatch"
		result.Reason = &reason
		httpserver.WriteJSON(w, http.StatusOK, Envelope[DomainVerificationResult]{Data: result})
		return
	}

	if _, err := handler.repo.MarkDomainVerified(r.Context(), tenantContext, domain); err != nil {
		writeSiteError(w, r, err)
		return
	}

	result.Verified = true
	httpserver.WriteJSON(w, http.StatusOK, Envelope[DomainVerificationResult]{Data: result})
}

func verifyDomainChallenge(ctx context.Context, domain string, expectedToken string) (bool, error) {
	domain = normalizePublicDomain(domain)
	expectedToken = strings.TrimSpace(expectedToken)
	if !isValidPublicDomain(domain) || expectedToken == "" {
		return false, ErrInvalidInput
	}

	lookupCtx, cancelLookup := context.WithTimeout(ctx, 5*time.Second)
	defer cancelLookup()

	ips, err := net.DefaultResolver.LookupIP(lookupCtx, "ip", domain)
	if err != nil {
		return false, err
	}

	publicIPs := make([]net.IP, 0, len(ips))
	for _, ip := range ips {
		if isAllowedVerificationIP(ip) {
			publicIPs = append(publicIPs, ip)
		}
	}
	if len(publicIPs) == 0 {
		return false, errors.New("domain did not resolve to a public address")
	}

	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 15 * time.Second}
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
		DialContext: func(dialCtx context.Context, network string, address string) (net.Conn, error) {
			host, port, splitErr := net.SplitHostPort(address)
			if splitErr != nil || !strings.EqualFold(strings.TrimSuffix(host, "."), domain) {
				return nil, errors.New("unexpected domain verification destination")
			}

			var lastErr error
			for _, ip := range publicIPs {
				conn, dialErr := dialer.DialContext(dialCtx, network, net.JoinHostPort(ip.String(), port))
				if dialErr == nil {
					return conn, nil
				}
				lastErr = dialErr
			}
			if lastErr == nil {
				lastErr = errors.New("domain verification connection failed")
			}
			return nil, lastErr
		},
	}
	defer transport.CloseIdleConnections()

	client := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("domain verification redirects are not allowed")
		},
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("https://%s%s", domain, domainVerificationPath),
		nil,
	)
	if err != nil {
		return false, err
	}
	request.Header.Set("Accept", "text/plain")
	request.Header.Set("User-Agent", "Vimob-Domain-Verifier/1.0")

	response, err := client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return false, nil
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, 1024))
	if err != nil {
		return false, err
	}

	return strings.TrimSpace(string(body)) == expectedToken, nil
}

func isValidPublicDomain(domain string) bool {
	if len(domain) < 3 || len(domain) > 253 || strings.Contains(domain, "..") {
		return false
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if !domainLabelPattern.MatchString(label) {
			return false
		}
	}
	return !allNumeric(labels[len(labels)-1])
}

func allNumeric(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func isAllowedVerificationIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}

	ipv4 := ip.To4()
	if ipv4 == nil {
		return true
	}

	// Carrier-grade NAT is globally routed inside providers, but it is not an
	// acceptable destination for a server-side ownership check.
	return !(ipv4[0] == 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
}

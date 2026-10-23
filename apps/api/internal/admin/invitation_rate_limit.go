package admin

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

// Public invitation links are bearer capabilities. Limit both the source IP
// and the specific link before looking it up or attempting account creation.
func publicInvitationAllowed(
	ctx context.Context,
	queryer publicingress.QueryRower,
	environment, operation, clientIP, token string,
) (bool, error) {
	var ipLimit, tokenLimit int
	switch operation {
	case "preview":
		ipLimit, tokenLimit = 120, 30
	case "accept":
		ipLimit, tokenLimit = 30, 8
	default:
		return false, errors.New("invalid public invitation operation")
	}

	options := publicingress.AllowOptions{
		ProcessFallbackEnabled: environment == "development" || environment == "local" || environment == "test",
	}
	for _, rule := range []struct {
		scope   string
		subject string
		limit   int
	}{
		{scope: "invitation_" + operation + "_ip", subject: clientIP, limit: ipLimit},
		{scope: "invitation_" + operation + "_token", subject: strings.ToLower(strings.TrimSpace(token)), limit: tokenLimit},
	} {
		allowed, err := publicingress.AllowWithOptions(
			ctx, queryer, rule.scope, []string{rule.subject}, rule.limit, 10*time.Minute, options,
		)
		if err != nil || !allowed {
			return allowed, err
		}
	}
	return true, nil
}

func (handler Handler) requirePublicInvitationAllowance(
	w http.ResponseWriter,
	r *http.Request,
	operation string,
) bool {
	if handler.repo.db == nil || handler.repo.db.Pool() == nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "invitation_rate_limit_unavailable", "Nao foi possivel validar o convite agora. Tente novamente em alguns instantes.")
		return false
	}
	allowed, err := publicInvitationAllowed(
		r.Context(),
		handler.repo.db.Pool(),
		handler.repo.environment,
		operation,
		handler.publicClientIPResolver.Resolve(r),
		r.PathValue("token"),
	)
	if err != nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "invitation_rate_limit_unavailable", "Nao foi possivel validar o convite agora. Tente novamente em alguns instantes.")
		return false
	}
	if !allowed {
		httpserver.WriteError(w, r, http.StatusTooManyRequests, "invitation_rate_limited", "Muitas tentativas. Aguarde alguns minutos para tentar novamente.")
		return false
	}
	return true
}

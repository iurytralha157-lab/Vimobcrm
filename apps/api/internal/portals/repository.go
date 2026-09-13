package portals

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db                         *dbpkg.Postgres
	webhookSecret              string
	importReportWorkerEnabled  bool
	importReportWorkerInterval time.Duration
	importReportWorkerBatch    int
	chavesNaMaoEnabled         bool
}

type portalQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type Config struct {
	// WebhookSecret is the CRM-wide Grupo OLX SECRET_KEY. Grupo OLX provisions
	// one credential per CRM, not per customer account.
	WebhookSecret              string
	ImportReportWorkerEnabled  bool
	ImportReportWorkerInterval time.Duration
	ImportReportWorkerBatch    int
	// ChavesNaMaoEnabled is a server-side release gate. It must remain false
	// until the Vimob/customer feed has been accepted by the provider.
	ChavesNaMaoEnabled bool
}

func NewRepository(db *dbpkg.Postgres, configs ...Config) Repository {
	var config Config
	if len(configs) > 0 {
		config = configs[0]
	}
	if config.ImportReportWorkerInterval <= 0 {
		config.ImportReportWorkerInterval = 2 * time.Second
	}
	if config.ImportReportWorkerBatch < 1 {
		config.ImportReportWorkerBatch = 25
	}
	if config.ImportReportWorkerBatch > 500 {
		config.ImportReportWorkerBatch = 500
	}
	return Repository{
		db: db, webhookSecret: strings.TrimSpace(config.WebhookSecret),
		importReportWorkerEnabled:  config.ImportReportWorkerEnabled,
		importReportWorkerInterval: config.ImportReportWorkerInterval,
		importReportWorkerBatch:    config.ImportReportWorkerBatch,
		chavesNaMaoEnabled:         config.ChavesNaMaoEnabled,
	}
}

func (repo Repository) requireChavesNaMaoHomologation() error {
	if !repo.chavesNaMaoEnabled {
		return ErrChavesNaMaoHomologation
	}
	return nil
}

func (repo Repository) ValidGrupoOLXWebhookAuthorization(authorization string) bool {
	return validWebhookAuthorization(authorization, repo.webhookSecret)
}

func (repo Repository) allowGrupoOLXPublicIngress(ctx context.Context, scope string, clientIP string, token string, limit int) error {
	// The path token is included only in the one-way limiter digest. This keeps
	// tenants behind the same Grupo OLX NAT isolated without logging credentials.
	allowed, err := publicingress.Allow(ctx, repo.db.Pool(), scope, []string{clientIP, token}, limit, time.Minute)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrRateLimited
	}
	return nil
}

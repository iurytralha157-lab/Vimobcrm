package whatsapp

import (
	"testing"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWebhookWorkerDatabaseCloneKeepsOriginalPoolIndependent(t *testing.T) {
	requestDB := &dbpkg.Postgres{}
	workerDB := &dbpkg.Postgres{}
	stats := &whatsappRuntimeCounters{}
	requestRepository := Repository{
		db:                requestDB,
		functions:         functionsClient{db: requestDB, runtimeStats: stats},
		webhookSchemaGate: &evolutionWebhookSchemaGate{},
	}

	workerRepository := requestRepository.WithWorkerDatabase(workerDB, nil)
	if requestRepository.db != requestDB || requestRepository.functions.db != requestDB {
		t.Fatal("cloning the worker repository changed the HTTP/outbox database pool")
	}
	if workerRepository.db != workerDB || workerRepository.functions.db != workerDB {
		t.Fatal("webhook queue processing must use its dedicated database pool")
	}
	if workerRepository.functions.runtimeStats != stats {
		t.Fatal("webhook worker must retain shared provider runtime counters")
	}
	if workerRepository.webhookSchemaGate == requestRepository.webhookSchemaGate {
		t.Fatal("webhook worker schema state must be scoped to its database pool")
	}
}

package properties

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type historyActivityTx struct {
	pgx.Tx
	eventType string
	payload   map[string]any
}

type historyActivityRow struct{ eventsTable bool }

func (row historyActivityRow) Scan(dest ...any) error {
	if !row.eventsTable {
		return pgx.ErrNoRows
	}
	*dest[0].(*bool) = true
	return nil
}

func (tx *historyActivityTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	return historyActivityRow{eventsTable: strings.Contains(query, "to_regclass")}
}

func (tx *historyActivityTx) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	tx.eventType = args[1].(string)
	err := json.Unmarshal([]byte(args[3].(string)), &tx.payload)
	return pgconn.NewCommandTag("INSERT 0 1"), err
}

func TestPropertyHistoryClassifiesActualStatusChanges(t *testing.T) {
	for _, tc := range []struct {
		name, before, after, eventType string
	}{
		{"same canonical status", "active", "active", "property_updated"},
		{"same Portuguese alias", "active", "ativo", "property_updated"},
		{"same legacy alias", "Disponível", "active", "property_updated"},
		{"legacy empty status defaults to active", " ", "active", "property_updated"},
		{"same draft alias", "privado", "rascunho", "property_updated"},
		{"actual status transition", "active", "draft", "property_status_changed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx := &historyActivityTx{}
			err := (Repository{}).insertPropertyUpdatedActivity(context.Background(), tx,
				tenant.Context{OrganizationID: "org-synthetic", UserID: "actor-synthetic"},
				propertySnapshot{ID: "property-synthetic", Title: "Imóvel sintético", Status: tc.before},
				propertyRequest{"status": tc.after, "comentarios_internos": "Comentário sintético"},
				Property{"id": "property-synthetic"})
			if err != nil {
				t.Fatal(err)
			}
			if tx.eventType != tc.eventType {
				t.Fatalf("event type = %s, want %s", tx.eventType, tc.eventType)
			}
			changes := tx.payload["changes"].(map[string]any)
			_, statusChanged := changes["status"]
			if statusChanged != (tc.eventType == "property_status_changed") {
				t.Fatalf("status change metadata = %#v", changes)
			}
		})
	}
}

func TestPropertyHistoryFullFormDoesNotInventPriceOrPublicationChanges(t *testing.T) {
	price, rent := 250000.0, 0.0
	for _, tc := range []struct {
		name, eventType string
		input           propertyRequest
		changedField    string
	}{
		{"comment only", "property_updated", propertyRequest{}, ""},
		{"sale price", "property_price_updated", propertyRequest{"preco": 260000.0}, "preco"},
		{"rental price", "property_price_updated", propertyRequest{"valor_locacao": 1200.0}, "valor_locacao"},
		{"remove price", "property_price_updated", propertyRequest{"preco": nil}, "preco"},
		{"publication", "property_publication_changed", propertyRequest{"published_on_site": true}, "published_on_site"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := propertyRequest{"status": "ativo", "preco": price, "valor_locacao": rent,
				"published_on_site": false, "comentarios_internos": "Comentário sintético"}
			for field, value := range tc.input {
				input[field] = value
			}
			tx := &historyActivityTx{}
			err := (Repository{}).insertPropertyUpdatedActivity(context.Background(), tx,
				tenant.Context{OrganizationID: "org-synthetic", UserID: "actor-synthetic"},
				propertySnapshot{ID: "property-synthetic", Status: "active", Price: &price, RentalPrice: &rent},
				input, Property{"id": "property-synthetic"})
			if err != nil {
				t.Fatal(err)
			}
			if tx.eventType != tc.eventType {
				t.Fatalf("event type = %s, want %s", tx.eventType, tc.eventType)
			}
			changes := tx.payload["changes"].(map[string]any)
			if tc.changedField == "" && len(changes) != 0 {
				t.Fatalf("unchanged classifiers appeared as changes: %#v", changes)
			}
			if tc.changedField != "" {
				if _, exists := changes[tc.changedField]; !exists || len(changes) != 1 {
					t.Fatalf("expected only %s change: %#v", tc.changedField, changes)
				}
			}
		})
	}
}

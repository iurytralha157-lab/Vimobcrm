package marketing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func storeFailure(err error) error {
	return newFailure("marketing_store_failed", http.StatusInternalServerError, err)
}

func (store *PostgresStore) CreateFlow(ctx context.Context, flow Flow) (string, error) {
	if _, err := store.pool.Exec(ctx, `
		delete from public.marketing_oauth_flows where expires_at < now() - interval '1 day'
	`); err != nil {
		return "", storeFailure(err)
	}
	var id string
	err := store.pool.QueryRow(ctx, `
		insert into public.marketing_oauth_flows (
		  organization_id, user_id, provider, nonce_hash, return_url, expires_at
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6)
		returning id::text
	`, flow.OrganizationID, flow.UserID, flow.Provider, flow.NonceHash, flow.ReturnURL, flow.ExpiresAt).Scan(&id)
	if err != nil {
		return "", storeFailure(err)
	}
	return id, nil
}

// ConsumeFlow is atomic and single use, so a replayed callback is rejected.
func (store *PostgresStore) ConsumeFlow(ctx context.Context, flowID string, nonceHash string) (Flow, error) {
	if !uuidPattern.MatchString(flowID) {
		return Flow{}, newFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	flow := Flow{ID: flowID}
	err := store.pool.QueryRow(ctx, `
		update public.marketing_oauth_flows
		set consumed_at = now()
		where id = $1::uuid
		  and nonce_hash = $2
		  and consumed_at is null
		  and expires_at > now()
		returning organization_id::text, user_id::text, provider, return_url, expires_at
	`, flowID, nonceHash).Scan(&flow.OrganizationID, &flow.UserID, &flow.Provider, &flow.ReturnURL, &flow.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Flow{}, newFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	if err != nil {
		return Flow{}, storeFailure(err)
	}
	return flow, nil
}

func (store *PostgresStore) SaveConnection(ctx context.Context, input SaveConnectionInput) (string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return "", storeFailure(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var connectionID, oldSecretRef string
	err = tx.QueryRow(ctx, `
		select id::text, access_token_secret_ref::text
		from public.marketing_connections
		where organization_id = $1::uuid and provider = $2 and external_user_id = $3
		for update
	`, input.OrganizationID, input.Provider, input.ExternalUserID).Scan(&connectionID, &oldSecretRef)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", storeFailure(err)
	}
	// QueryExecModeExec keeps the token out of prepared statement caches.
	var secretRef string
	err = tx.QueryRow(ctx, `
		select vault.create_secret($1, 'marketing-connection:' || gen_random_uuid()::text, $2)::text
	`, pgx.QueryExecModeExec, input.AccessToken, "Marketing read-only token").Scan(&secretRef)
	if err != nil {
		return "", newFailure("marketing_store_failed", http.StatusInternalServerError)
	}
	err = tx.QueryRow(ctx, `
		insert into public.marketing_connections (
		  organization_id, provider, external_user_id, external_user_name, status,
		  granted_scopes, access_token_secret_ref, token_expires_at,
		  last_validated_at, connected_by
		)
		values ($1::uuid, $2, $3, $4, 'active', $5, $6::uuid, $7, now(), $8::uuid)
		on conflict (organization_id, provider, external_user_id) do update
		set external_user_name = excluded.external_user_name,
		    status = 'active',
		    granted_scopes = excluded.granted_scopes,
		    access_token_secret_ref = excluded.access_token_secret_ref,
		    token_expires_at = excluded.token_expires_at,
		    last_validated_at = now(),
		    last_error = null,
		    connected_by = excluded.connected_by,
		    updated_at = now()
		returning id::text
	`, input.OrganizationID, input.Provider, input.ExternalUserID, input.ExternalUserName,
		input.GrantedScopes, secretRef, input.TokenExpiresAt, input.UserID).Scan(&connectionID)
	if err != nil {
		return "", storeFailure(err)
	}
	if oldSecretRef != "" {
		if err := deleteSecret(ctx, tx, oldSecretRef); err != nil {
			return "", err
		}
	}
	if err := replaceAssets(ctx, tx, input.OrganizationID, connectionID, input.Assets); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", storeFailure(err)
	}
	return connectionID, nil
}

// replaceAssets keeps earlier choices and drops assets the login lost access to.
func replaceAssets(ctx context.Context, tx pgx.Tx, organizationID string, connectionID string, assets []DiscoveredAsset) error {
	keys := make([]string, 0, len(assets))
	for _, asset := range assets {
		metadata, err := json.Marshal(asset.Metadata)
		if err != nil {
			return storeFailure(err)
		}
		if _, err := tx.Exec(ctx, `
			insert into public.marketing_connection_assets (
			  organization_id, connection_id, asset_type, external_id, name, metadata
			)
			values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
			on conflict (connection_id, asset_type, external_id) do update
			set name = excluded.name, metadata = excluded.metadata, updated_at = now()
		`, organizationID, connectionID, asset.Type, asset.ExternalID, asset.Name, string(metadata)); err != nil {
			return storeFailure(err)
		}
		keys = append(keys, asset.Type+":"+asset.ExternalID)
	}
	if _, err := tx.Exec(ctx, `
		delete from public.marketing_connection_assets
		where connection_id = $1::uuid
		  and organization_id = $2::uuid
		  and not (asset_type || ':' || external_id = any($3::text[]))
	`, connectionID, organizationID, keys); err != nil {
		return storeFailure(err)
	}
	return nil
}

func deleteSecret(ctx context.Context, tx pgx.Tx, secretRef string) error {
	if _, err := tx.Exec(ctx, `
		delete from vault.secrets
		where id = $1::uuid and name like 'marketing-connection:%'
	`, secretRef); err != nil {
		return storeFailure(err)
	}
	return nil
}

func (store *PostgresStore) ListConnections(ctx context.Context, organizationID string) ([]Connection, error) {
	rows, err := store.pool.Query(ctx, `
		select id::text, provider, coalesce(external_user_name, ''), status, granted_scopes,
		       token_expires_at, last_validated_at, coalesce(last_error, ''), created_at
		from public.marketing_connections
		where organization_id = $1::uuid
		order by created_at
	`, organizationID)
	if err != nil {
		return nil, storeFailure(err)
	}
	defer rows.Close()
	connections := []Connection{}
	positions := map[string]int{}
	for rows.Next() {
		connection := Connection{Assets: []Asset{}}
		if err := rows.Scan(
			&connection.ID, &connection.Provider, &connection.ExternalUserName, &connection.Status,
			&connection.GrantedScopes, &connection.TokenExpiresAt, &connection.LastValidatedAt,
			&connection.LastError, &connection.CreatedAt,
		); err != nil {
			return nil, storeFailure(err)
		}
		positions[connection.ID] = len(connections)
		connections = append(connections, connection)
	}
	if err := rows.Err(); err != nil {
		return nil, storeFailure(err)
	}
	assetRows, err := store.pool.Query(ctx, `
		select connection_id::text, id::text, asset_type, external_id, coalesce(name, ''), metadata, is_selected
		from public.marketing_connection_assets
		where organization_id = $1::uuid
		order by asset_type, name, external_id
	`, organizationID)
	if err != nil {
		return nil, storeFailure(err)
	}
	defer assetRows.Close()
	for assetRows.Next() {
		var connectionID string
		var raw []byte
		asset := Asset{}
		if err := assetRows.Scan(&connectionID, &asset.ID, &asset.Type, &asset.ExternalID, &asset.Name, &raw, &asset.IsSelected); err != nil {
			return nil, storeFailure(err)
		}
		_ = json.Unmarshal(raw, &asset.Metadata)
		if position, ok := positions[connectionID]; ok {
			connections[position].Assets = append(connections[position].Assets, asset)
		}
	}
	if err := assetRows.Err(); err != nil {
		return nil, storeFailure(err)
	}
	return connections, nil
}

func (store *PostgresStore) UpdateSelection(ctx context.Context, organizationID string, connectionID string, assetIDs []string) error {
	if !uuidPattern.MatchString(connectionID) {
		return newFailure("marketing_connection_not_found", http.StatusNotFound)
	}
	for _, id := range assetIDs {
		if !uuidPattern.MatchString(strings.TrimSpace(id)) {
			return newFailure("invalid_asset_selection", http.StatusBadRequest)
		}
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return storeFailure(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var total, matching int
	err = tx.QueryRow(ctx, `
		select count(*), count(*) filter (where id = any($3::uuid[]))
		from public.marketing_connection_assets
		where connection_id = $1::uuid and organization_id = $2::uuid
	`, connectionID, organizationID, assetIDs).Scan(&total, &matching)
	if err != nil {
		return storeFailure(err)
	}
	if matching != len(uniqueStrings(assetIDs)) {
		return newFailure("invalid_asset_selection", http.StatusBadRequest)
	}
	if _, err := tx.Exec(ctx, `
		update public.marketing_connection_assets
		set is_selected = (id = any($3::uuid[])), updated_at = now()
		where connection_id = $1::uuid and organization_id = $2::uuid
	`, connectionID, organizationID, assetIDs); err != nil {
		return storeFailure(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return storeFailure(err)
	}
	return nil
}

func (store *PostgresStore) DeleteConnection(ctx context.Context, organizationID string, connectionID string) error {
	if !uuidPattern.MatchString(connectionID) {
		return newFailure("marketing_connection_not_found", http.StatusNotFound)
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return storeFailure(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var secretRef string
	err = tx.QueryRow(ctx, `
		delete from public.marketing_connections
		where id = $1::uuid and organization_id = $2::uuid
		returning access_token_secret_ref::text
	`, connectionID, organizationID).Scan(&secretRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return newFailure("marketing_connection_not_found", http.StatusNotFound)
	}
	if err != nil {
		return storeFailure(err)
	}
	if err := deleteSecret(ctx, tx, secretRef); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return storeFailure(err)
	}
	return nil
}

// LoadSyncTarget reads the chosen assets and the token for a server-side sync.
func (store *PostgresStore) LoadSyncTarget(ctx context.Context, organizationID string, connectionID string) (SyncTarget, error) {
	if !uuidPattern.MatchString(connectionID) {
		return SyncTarget{}, newFailure("marketing_connection_not_found", http.StatusNotFound)
	}
	target := SyncTarget{}
	err := store.pool.QueryRow(ctx, `
		select secret.decrypted_secret
		from public.marketing_connections as connection
		join vault.decrypted_secrets as secret
		  on secret.id = connection.access_token_secret_ref
		where connection.id = $1::uuid and connection.organization_id = $2::uuid
	`, connectionID, organizationID).Scan(&target.AccessToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return SyncTarget{}, newFailure("marketing_connection_not_found", http.StatusNotFound)
	}
	if err != nil {
		return SyncTarget{}, newFailure("marketing_store_failed", http.StatusInternalServerError)
	}
	rows, err := store.pool.Query(ctx, `
		select asset_type, external_id, coalesce(name, ''), coalesce(metadata->>'page_id', '')
		from public.marketing_connection_assets
		where connection_id = $1::uuid and organization_id = $2::uuid and is_selected
		order by asset_type, external_id
	`, connectionID, organizationID)
	if err != nil {
		return SyncTarget{}, storeFailure(err)
	}
	defer rows.Close()
	for rows.Next() {
		var assetType, externalID, name, pageID string
		if err := rows.Scan(&assetType, &externalID, &name, &pageID); err != nil {
			return SyncTarget{}, storeFailure(err)
		}
		switch assetType {
		case AssetAdAccount:
			target.AdAccounts = append(target.AdAccounts, externalID)
		case AssetInstagram:
			target.Instagram = append(target.Instagram, SyncInstagram{ID: externalID, Username: name, PageID: pageID})
		}
	}
	if err := rows.Err(); err != nil {
		return SyncTarget{}, storeFailure(err)
	}
	return target, nil
}

func (store *PostgresStore) MarkSyncResult(ctx context.Context, organizationID string, connectionID string, status string, lastError string) error {
	if _, err := store.pool.Exec(ctx, `
		update public.marketing_connections
		set status = $3,
		    last_error = nullif($4, ''),
		    last_validated_at = case when $3 = 'active' then now() else last_validated_at end,
		    updated_at = now()
		where id = $1::uuid and organization_id = $2::uuid
	`, connectionID, organizationID, status, lastError); err != nil {
		return storeFailure(err)
	}
	return nil
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	unique := make([]string, 0, len(values))
	for _, value := range values {
		key := strings.ToLower(strings.TrimSpace(value))
		if _, ok := seen[key]; !ok {
			seen[key] = struct{}{}
			unique = append(unique, key)
		}
	}
	return unique
}

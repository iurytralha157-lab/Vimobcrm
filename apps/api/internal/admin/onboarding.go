package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const defaultSignupPlanSlug = "starter-197"

var defaultStarterModules = []string{"crm", "agenda", "whatsapp", "campaigns"}

var planControlledModules = []string{
	"crm",
	"properties",
	"financial",
	"whatsapp",
	"agenda",
	"cadences",
	"tags",
	"round_robin",
	"reports",
	"automations",
	"webhooks",
	"site",
	"campaigns",
	"api",
	"performance",
}

func (repo Repository) PublicOnboardingSignup(ctx context.Context, request OnboardingSignupRequest) (map[string]any, error) {
	companyName := strings.TrimSpace(request.CompanyName)
	adminName := strings.TrimSpace(request.AdminName)
	email, err := normalizeEmail(request.Email)
	if err != nil {
		return nil, err
	}
	if companyName == "" || adminName == "" || len(request.Password) < 8 || !request.TermsAccepted || !request.PrivacyAccepted {
		return nil, ErrInvalidInput
	}

	planSlug := strings.TrimSpace(request.PlanSlug)
	if planSlug == "" {
		planSlug = defaultSignupPlanSlug
	}
	plan, err := repo.activeSignupPlan(ctx, planSlug)
	if err != nil {
		return nil, err
	}

	createdUserID, err := repo.createAuthUser(ctx, email, request.Password, adminName)
	if err != nil {
		return nil, err
	}
	createdOrganizationID := ""
	cleanupAuthUser := true
	defer func() {
		if cleanupAuthUser {
			_ = repo.deleteAuthUser(context.Background(), createdUserID)
		}
	}()

	now := time.Now().UTC()
	trialDays := 0
	if boolValue(plan["trial_enabled"]) {
		trialDays = intValue(plan["trial_days"])
	}
	isTrial := trialDays > 0
	var trialEndsAt *time.Time
	if isTrial {
		value := now.Add(time.Duration(trialDays) * 24 * time.Hour)
		trialEndsAt = &value
	}

	brokersCount := request.BrokersCount
	if brokersCount < 1 {
		brokersCount = 1
	}
	maxUsers := maxInt(brokersCount, intValue(plan["max_users"]), 1)
	fullPhone := strings.TrimSpace(strings.TrimSpace(request.PhoneCountryCode) + " " + strings.TrimSpace(request.Phone))
	organizationSlug := slugifyAdmin(companyName)
	if organizationSlug == "" {
		organizationSlug = "organizacao"
	}
	organizationSlug = fmt.Sprintf("%s-%s", organizationSlug, createdUserID[:8])
	signupPath := "paid"
	if isTrial {
		signupPath = "trial"
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var checkoutToken sql.NullString
	err = tx.QueryRow(ctx, `
		insert into public.organizations (
			name,
			slug,
			segment,
			cnpj,
			razao_social,
			nome_fantasia,
			telefone,
			whatsapp,
			email,
			plan_id,
			subscription_status,
			subscription_type,
			subscription_value,
			trial_ends_at,
			max_users,
			created_by
		)
		values (
			$1,
			$2,
			'imobiliario',
			$3,
			$1,
			$1,
			$4,
			$4,
			$5,
			$6::uuid,
			$7,
			'paid',
			$8,
			$9,
			$10,
			$11::uuid
		)
		returning id::text, checkout_token
	`,
		companyName,
		organizationSlug,
		nullableText(onlyDigitsAdmin(request.DocumentNumber)),
		nullableText(fullPhone),
		email,
		stringValue(plan["id"]),
		statusForTrial(isTrial),
		floatValue(plan["price"]),
		trialEndsAt,
		maxUsers,
		createdUserID,
	).Scan(&createdOrganizationID, &checkoutToken)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.users (
			id,
			organization_id,
			name,
			email,
			role,
			is_active,
			whatsapp,
			cpf
		)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', true, $5, $6)
	`, createdUserID, createdOrganizationID, adminName, email, nullableText(fullPhone), nullableText(onlyDigitsAdmin(request.DocumentNumber))); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'owner', true)
	`, createdOrganizationID, createdUserID); err != nil {
		return nil, err
	}

	selectedModules := selectedPlanModules(plan)
	if err := writeOrganizationModules(ctx, tx, createdOrganizationID, selectedModules); err != nil {
		return nil, err
	}

	subscriptionMetadata, _ := json.Marshal(map[string]any{
		"signup_path": signupPath,
		"plan_slug":   stringValue(plan["slug"]),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.subscriptions (
			organization_id,
			plan_id,
			status,
			current_period_start,
			current_period_end,
			trial_ends_at,
			metadata
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $5, $6::jsonb)
	`, createdOrganizationID, stringValue(plan["id"]), statusForTrial(isTrial), now, trialEndsAt, string(subscriptionMetadata)); err != nil {
		return nil, err
	}

	consentMetadata, _ := json.Marshal(map[string]any{
		"terms_accepted":   request.TermsAccepted,
		"privacy_accepted": request.PrivacyAccepted,
	})
	if _, err := tx.Exec(ctx, `
		insert into public.legal_consents (
			user_id,
			organization_id,
			terms_version,
			privacy_version,
			ip_address,
			user_agent,
			source,
			metadata
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, 'signup', $7::jsonb)
	`,
		createdUserID,
		createdOrganizationID,
		defaultText(request.TermsVersion, "2026-06-15"),
		defaultText(request.PrivacyVersion, "2026-06-15"),
		nullableText(request.IPAddress),
		nullableText(request.UserAgent),
		string(consentMetadata),
	); err != nil {
		return nil, err
	}

	auditData, _ := json.Marshal(map[string]any{
		"company_name": companyName,
		"signup_path":  signupPath,
		"plan_slug":    stringValue(plan["slug"]),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			user_id,
			action,
			entity_type,
			entity_id,
			new_data,
			ip_address,
			user_agent
		)
		values ($1::uuid, $2::uuid, 'signup_completed', 'organization', $1::uuid, $3::jsonb, $4, $5)
	`, createdOrganizationID, createdUserID, string(auditData), nullableText(request.IPAddress), nullableText(request.UserAgent)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	cleanupAuthUser = false

	checkoutTokenValue := ""
	if checkoutToken.Valid {
		checkoutTokenValue = checkoutToken.String
	}
	redirectTo := "/select-organization"
	if !isTrial && checkoutTokenValue != "" {
		redirectTo = "/checkout/" + checkoutTokenValue
	}

	return map[string]any{
		"ok":             true,
		"message":        "Cadastro criado com sucesso.",
		"redirectTo":     redirectTo,
		"checkoutToken":  nullableText(checkoutTokenValue),
		"organizationId": createdOrganizationID,
	}, nil
}

func (repo Repository) PublicCheckoutPlan(ctx context.Context, request CheckoutPlanRequest) (map[string]any, error) {
	checkoutToken := strings.TrimSpace(request.CheckoutToken)
	planSlug := strings.TrimSpace(request.PlanSlug)
	if checkoutToken == "" || planSlug == "" {
		return nil, ErrInvalidInput
	}

	organization, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', o.id::text,
			'checkout_token', o.checkout_token,
			'max_users', o.max_users,
			'is_active', o.is_active,
			'subscription_status', o.subscription_status
		)
		from public.organizations o
		where o.checkout_token = $1
		  and o.is_active = true
		limit 1
	`, checkoutToken)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	status := stringValue(organization["subscription_status"])
	if status != "pending_payment" && status != "trial" {
		return nil, ErrInvalidInput
	}

	plan, err := repo.activeSignupPlan(ctx, planSlug)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	trialDays := 0
	if boolValue(plan["trial_enabled"]) {
		trialDays = intValue(plan["trial_days"])
	}
	isTrial := trialDays > 0
	var trialEndsAt *time.Time
	if isTrial {
		value := now.Add(time.Duration(trialDays) * 24 * time.Hour)
		trialEndsAt = &value
	}
	organizationID := stringValue(organization["id"])
	maxUsers := maxInt(intValue(organization["max_users"]), intValue(plan["max_users"]), 1)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.organizations
		set
			plan_id = $2::uuid,
			subscription_status = $3,
			subscription_type = 'paid',
			subscription_value = $4,
			trial_ends_at = $5,
			max_users = $6,
			next_billing_date = null,
			updated_at = now()
		where id = $1::uuid
	`, organizationID, stringValue(plan["id"]), statusForTrial(isTrial), floatValue(plan["price"]), trialEndsAt, maxUsers); err != nil {
		return nil, err
	}

	if err := writeOrganizationModules(ctx, tx, organizationID, selectedPlanModules(plan)); err != nil {
		return nil, err
	}

	subscriptionMetadata, _ := json.Marshal(map[string]any{
		"signup_path":           checkoutSignupPath(isTrial),
		"plan_slug":             stringValue(plan["slug"]),
		"changed_from_checkout": true,
	})
	if _, err := tx.Exec(ctx, `
		update public.subscriptions
		set
			plan_id = $2::uuid,
			status = $3,
			current_period_end = $4,
			trial_ends_at = $4,
			metadata = $5::jsonb,
			updated_at = now()
		where organization_id = $1::uuid
	`, organizationID, stringValue(plan["id"]), statusForTrial(isTrial), trialEndsAt, string(subscriptionMetadata)); err != nil {
		return nil, err
	}

	auditData, _ := json.Marshal(map[string]any{
		"plan_slug":   stringValue(plan["slug"]),
		"signup_path": checkoutSignupPath(isTrial),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			action,
			entity_type,
			entity_id,
			new_data
		)
		values ($1::uuid, 'checkout_plan_changed', 'organization', $1::uuid, $2::jsonb)
	`, organizationID, string(auditData)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return map[string]any{
		"ok":              true,
		"message":         "Plano atualizado com sucesso.",
		"requiresPayment": !isTrial,
		"checkoutToken":   checkoutToken,
		"organizationId":  organizationID,
	}, nil
}

func (repo Repository) activeSignupPlan(ctx context.Context, slug string) (map[string]any, error) {
	plan, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', p.id::text,
			'slug', p.slug,
			'name', p.name,
			'price', p.price,
			'trial_enabled', p.trial_enabled,
			'trial_days', p.trial_days,
			'max_users', p.max_users,
			'modules', coalesce(to_jsonb(p.modules), '[]'::jsonb)
		)
		from public.admin_subscription_plans p
		where p.slug = $1
		  and p.is_active = true
		limit 1
	`, slug)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return plan, err
}

func writeOrganizationModules(ctx context.Context, tx pgx.Tx, organizationID string, selectedModules []string) error {
	selected := map[string]bool{}
	for _, moduleName := range selectedModules {
		moduleName = strings.TrimSpace(moduleName)
		if moduleName != "" {
			selected[moduleName] = true
		}
	}
	for _, moduleName := range allPlanModules(selectedModules) {
		_, err := tx.Exec(ctx, `
			insert into public.organization_modules (
				organization_id,
				module_name,
				is_enabled
			)
			values ($1::uuid, $2, $3)
			on conflict (organization_id, module_name)
			do update set is_enabled = excluded.is_enabled, updated_at = now()
		`, organizationID, moduleName, selected[moduleName])
		if err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) deleteAuthUser(ctx context.Context, userID string) error {
	if repo.projectURL == "" || repo.apiKey == "" || strings.TrimSpace(userID) == "" {
		return nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, repo.projectURL+"/auth/v1/admin/users/"+strings.TrimSpace(userID), nil)
	if err != nil {
		return err
	}
	request.Header.Set("apikey", repo.apiKey)
	request.Header.Set("Authorization", "Bearer "+repo.apiKey)
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return fmt.Errorf("auth admin delete user failed: %s", strings.TrimSpace(string(raw)))
}

func selectedPlanModules(plan map[string]any) []string {
	modules := stringSliceValue(plan["modules"])
	if len(modules) > 0 {
		return modules
	}
	return append([]string{}, defaultStarterModules...)
}

func allPlanModules(selected []string) []string {
	seen := map[string]bool{}
	modules := []string{}
	allModules := make([]string, 0, len(planControlledModules)+len(selected))
	allModules = append(allModules, planControlledModules...)
	allModules = append(allModules, selected...)
	for _, moduleName := range allModules {
		moduleName = strings.TrimSpace(moduleName)
		if moduleName == "" || seen[moduleName] {
			continue
		}
		seen[moduleName] = true
		modules = append(modules, moduleName)
	}
	return modules
}

func stringSliceValue(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		items := []string{}
		for _, item := range typed {
			text := strings.TrimSpace(stringValue(item))
			if text != "" {
				items = append(items, text)
			}
		}
		return items
	default:
		return nil
	}
}

func boolValue(value any) bool {
	typed, ok := value.(bool)
	return ok && typed
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	default:
		return 0
	}
}

func maxInt(values ...int) int {
	maxValue := values[0]
	for _, value := range values[1:] {
		if value > maxValue {
			maxValue = value
		}
	}
	return maxValue
}

func onlyDigitsAdmin(value string) string {
	builder := strings.Builder{}
	for _, char := range value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func slugifyAdmin(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	builder := strings.Builder{}
	lastDash := false
	for _, char := range value {
		isAlphaNumber := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if isAlphaNumber {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteRune('-')
			lastDash = true
		}
		if builder.Len() >= 48 {
			break
		}
	}
	return strings.Trim(builder.String(), "-")
}

func statusForTrial(isTrial bool) string {
	if isTrial {
		return "trial"
	}
	return "pending_payment"
}

func checkoutSignupPath(isTrial bool) string {
	if isTrial {
		return "trial"
	}
	return "paid"
}

func nullableText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func defaultText(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

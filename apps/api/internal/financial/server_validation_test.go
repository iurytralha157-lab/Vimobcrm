package financial

import (
	"errors"
	"math"
	"testing"
)

const validationTestUserID = "11111111-1111-4111-8111-111111111111"

func validFinancialEntryPayload() map[string]any {
	return map[string]any{
		"type":        "receivable",
		"category":    "Venda",
		"description": "Parcela do contrato",
		"amount":      100.50,
		"due_date":    "2026-08-31",
	}
}

func validContractPayload() map[string]any {
	return map[string]any{
		"contract_type": "sale",
		"client_name":   "Cliente",
		"value":         100.0,
		"down_payment":  20.0,
		"installments":  10,
	}
}

func validCommissionRulePayload() map[string]any {
	return map[string]any{
		"name":             "Comissão padrão",
		"business_type":    "sale",
		"commission_type":  "percentage",
		"commission_value": 5.0,
	}
}

func TestPrepareFinancialEntryCreatePayloadOwnsStateAndAuthorship(t *testing.T) {
	payload := validFinancialEntryPayload()
	payload["status"] = "pending"
	if err := prepareFinancialEntryCreatePayload(payload, validationTestUserID); err != nil {
		t.Fatalf("valid entry rejected: %v", err)
	}
	if payload["status"] != "pending" {
		t.Fatalf("status = %#v, want pending", payload["status"])
	}
	if payload["created_by"] != validationTestUserID {
		t.Fatalf("created_by = %#v, want authenticated user", payload["created_by"])
	}

	for name, mutation := range map[string]func(map[string]any){
		"client authorship": func(value map[string]any) { value["created_by"] = "attacker" },
		"paid status":       func(value map[string]any) { value["status"] = "paid" },
		"paid amount":       func(value map[string]any) { value["paid_amount"] = 100 },
		"paid value":        func(value map[string]any) { value["paid_value"] = 100 },
		"paid date":         func(value map[string]any) { value["paid_date"] = "2026-08-16" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := validFinancialEntryPayload()
			mutation(candidate)
			if err := prepareFinancialEntryCreatePayload(candidate, validationTestUserID); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestPrepareFinancialEntryCreatePayloadValidatesRequiredEnumsNumbersAndDates(t *testing.T) {
	for name, mutation := range map[string]func(map[string]any){
		"missing type":        func(value map[string]any) { delete(value, "type") },
		"invalid type":        func(value map[string]any) { value["type"] = "income" },
		"missing category":    func(value map[string]any) { delete(value, "category") },
		"missing description": func(value map[string]any) { delete(value, "description") },
		"zero amount":         func(value map[string]any) { value["amount"] = 0 },
		"nan amount":          func(value map[string]any) { value["amount"] = math.NaN() },
		"infinite amount":     func(value map[string]any) { value["amount"] = math.Inf(1) },
		"invalid due date":    func(value map[string]any) { value["due_date"] = "2026-02-30" },
		"invalid group":       func(value map[string]any) { value["category_group"] = "other" },
		"invalid recurrence":  func(value map[string]any) { value["recurring_type"] = "daily" },
		"missing recurrence":  func(value map[string]any) { value["is_recurring"] = true },
		"fractional parcels":  func(value map[string]any) { value["total_installments"] = 1.5 },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := validFinancialEntryPayload()
			mutation(candidate)
			if err := prepareFinancialEntryCreatePayload(candidate, validationTestUserID); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestValidateFinancialEntryMutationRejectsAuthorship(t *testing.T) {
	err := validateFinancialEntryMutation(financialEntryMutationState{status: "pending"}, map[string]any{
		"created_by": validationTestUserID,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
	for name, payload := range map[string]map[string]any{
		"negative amount": {"amount": -1},
		"invalid date":    {"due_date": "2026-02-31"},
		"invalid type":    {"type": "transfer"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateFinancialEntryMutation(financialEntryMutationState{status: "pending"}, payload); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestValidateContractPayloadOwnsIdentifiersAndValidatesMoney(t *testing.T) {
	if err := validateContractPayload(validContractPayload(), nil, true, nil); err != nil {
		t.Fatalf("valid contract rejected: %v", err)
	}
	for _, field := range []string{"created_by", "contract_number"} {
		candidate := validContractPayload()
		candidate[field] = "client-controlled"
		if err := validateContractPayload(candidate, nil, true, nil); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("create field %s error = %v, want ErrInvalidInput", field, err)
		}
	}

	state := &contractValidationState{value: 100, downPayment: 20, installments: 10}
	for _, field := range []string{"status", "created_by", "contract_number"} {
		candidate := map[string]any{field: "client-controlled"}
		if err := validateContractPayload(candidate, nil, false, state); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("update field %s error = %v, want ErrInvalidInput", field, err)
		}
	}

	for name, mutation := range map[string]func(map[string]any){
		"zero value":              func(value map[string]any) { value["value"] = 0 },
		"nan value":               func(value map[string]any) { value["value"] = math.NaN() },
		"down payment over value": func(value map[string]any) { value["down_payment"] = 101 },
		"invalid installments":    func(value map[string]any) { value["installments"] = 361 },
		"fractional installments": func(value map[string]any) { value["installments"] = 2.5 },
		"invalid percentage":      func(value map[string]any) { value["commission_percentage"] = 100.01 },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := validContractPayload()
			mutation(candidate)
			if err := validateContractPayload(candidate, nil, true, nil); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestValidateContractPayloadCapsInstallmentsByRemainingCents(t *testing.T) {
	tooMany := validContractPayload()
	tooMany["value"] = 1.00
	tooMany["down_payment"] = 0
	tooMany["installments"] = 101
	if err := validateContractPayload(tooMany, nil, true, nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("101 installments for 100 cents error = %v, want ErrInvalidInput", err)
	}

	exact := validContractPayload()
	exact["value"] = 1.00
	exact["down_payment"] = 0
	exact["installments"] = 100
	if err := validateContractPayload(exact, nil, true, nil); err != nil {
		t.Fatalf("100 installments for 100 cents rejected: %v", err)
	}

	fullyPaid := validContractPayload()
	fullyPaid["value"] = 100.0
	fullyPaid["down_payment"] = 100.0
	fullyPaid["installments"] = nil
	if err := validateContractPayload(fullyPaid, nil, true, nil); err != nil {
		t.Fatalf("fully paid contract without installments rejected: %v", err)
	}
}

func TestValidateContractBrokersRejectsDuplicatesAndInvalidPercentages(t *testing.T) {
	firstID := "11111111-1111-4111-8111-111111111111"
	secondID := "22222222-2222-4222-8222-222222222222"
	valid := []map[string]any{
		{"user_id": firstID, "commission_percentage": 40.0},
		{"user_id": secondID, "commission_percentage": 60.0},
	}
	if err := validateContractBrokers(valid); err != nil {
		t.Fatalf("valid brokers rejected: %v", err)
	}

	for name, brokers := range map[string][]map[string]any{
		"duplicate": {
			{"user_id": firstID, "commission_percentage": 10.0},
			{"user_id": firstID, "commission_percentage": 20.0},
		},
		"sum over 100": {
			{"user_id": firstID, "commission_percentage": 60.0},
			{"user_id": secondID, "commission_percentage": 40.01},
		},
		"negative": {{"user_id": firstID, "commission_percentage": -1.0}},
		"nan":      {{"user_id": firstID, "commission_percentage": math.NaN()}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateContractBrokers(brokers); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestValidateCommissionRulePayloadUsesEffectiveType(t *testing.T) {
	if err := validateCommissionRulePayload(validCommissionRulePayload(), true, nil); err != nil {
		t.Fatalf("valid percentage rule rejected: %v", err)
	}
	fixed := validCommissionRulePayload()
	fixed["commission_type"] = "fixed"
	fixed["commission_value"] = 500.0
	if err := validateCommissionRulePayload(fixed, true, nil); err != nil {
		t.Fatalf("valid fixed rule rejected: %v", err)
	}

	for name, mutation := range map[string]func(map[string]any){
		"missing name":        func(value map[string]any) { delete(value, "name") },
		"invalid business":    func(value map[string]any) { value["business_type"] = "rent" },
		"invalid type":        func(value map[string]any) { value["commission_type"] = "tiered" },
		"zero value":          func(value map[string]any) { value["commission_value"] = 0 },
		"nan value":           func(value map[string]any) { value["commission_value"] = math.NaN() },
		"percentage over 100": func(value map[string]any) { value["commission_value"] = 100.01 },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := validCommissionRulePayload()
			mutation(candidate)
			if err := validateCommissionRulePayload(candidate, true, nil); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}

	currentFixed := &commissionRuleValidationState{commissionType: "fixed", commissionValue: 500}
	if err := validateCommissionRulePayload(map[string]any{"name": "Novo nome"}, false, currentFixed); err != nil {
		t.Fatalf("ordinary partial update rejected: %v", err)
	}
	if err := validateCommissionRulePayload(map[string]any{"commission_type": "percentage"}, false, currentFixed); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("fixed value converted to invalid percentage error = %v, want ErrInvalidInput", err)
	}
}

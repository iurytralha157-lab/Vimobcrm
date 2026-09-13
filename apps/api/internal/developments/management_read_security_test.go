package developments

import (
	"context"
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDevelopmentManagementReadsRequirePropertyManageBeforeDatabaseAccess(t *testing.T) {
	viewer := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyView},
	}
	developmentID := "33333333-3333-4333-8333-333333333333"
	repository := Repository{}

	tests := []struct {
		name string
		read func() error
	}{
		{
			name: "catalog",
			read: func() error {
				_, err := repository.List(context.Background(), viewer, ListFilter{Limit: 24})
				return err
			},
		},
		{
			name: "workspace",
			read: func() error {
				_, err := repository.GetWorkspace(context.Background(), viewer, developmentID)
				return err
			},
		},
		{
			name: "units",
			read: func() error {
				_, err := repository.ListUnits(context.Background(), viewer, developmentID, UnitListFilter{Limit: 50})
				return err
			},
		},
		{
			name: "reservations",
			read: func() error {
				_, err := repository.ListReservations(context.Background(), viewer, developmentID, ReservationListFilter{Limit: 50})
				return err
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.read(); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("management read error = %v, want organization access denied", err)
			}
		})
	}
}

func TestDevelopmentManagementReadsAdmitPropertyManagerToReferenceValidation(t *testing.T) {
	manager := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyManage},
	}
	repository := Repository{}

	for name, read := range map[string]func() error{
		"workspace": func() error {
			_, err := repository.GetWorkspace(context.Background(), manager, "invalid")
			return err
		},
		"units": func() error {
			_, err := repository.ListUnits(context.Background(), manager, "invalid", UnitListFilter{Limit: 50})
			return err
		},
		"reservations": func() error {
			_, err := repository.ListReservations(context.Background(), manager, "invalid", ReservationListFilter{Limit: 50})
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := read(); !errors.Is(err, ErrNotFound) {
				t.Fatalf("manager reference validation error = %v, want ErrNotFound", err)
			}
		})
	}
}

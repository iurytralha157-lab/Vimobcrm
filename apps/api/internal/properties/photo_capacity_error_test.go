package properties

import (
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsPropertyPhotoCapacityViolation(t *testing.T) {
	capacityError := fmt.Errorf("update property: %w", &pgconn.PgError{
		Code:           "23514",
		ConstraintName: "property_assets_photo_capacity",
	})
	if !isPropertyPhotoCapacityViolation(capacityError) {
		t.Fatal("canonical photo-capacity constraint must be recognized")
	}

	for _, databaseError := range []*pgconn.PgError{
		{Code: "23505", ConstraintName: "property_assets_photo_capacity"},
		{Code: "23514", ConstraintName: "properties_preco_nonnegative_check"},
	} {
		if isPropertyPhotoCapacityViolation(databaseError) {
			t.Fatalf("unrelated database error was classified as photo capacity: %#v", databaseError)
		}
	}
}

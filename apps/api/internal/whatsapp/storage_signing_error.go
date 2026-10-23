package whatsapp

import "fmt"

type storageSigningHTTPError struct{ statusCode int }

func (err storageSigningHTTPError) Error() string {
	return fmt.Sprintf("supabase storage signing rejected HTTP %d", err.statusCode)
}

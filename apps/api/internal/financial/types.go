package financial

import (
	"errors"
)

var (
	ErrInvalidInput     = errors.New("invalid financial input")
	ErrNotFound         = errors.New("financial resource not found")
	ErrPermissionDenied = errors.New("financial permission denied")
	ErrStorageFailed    = errors.New("financial storage operation failed")
	ErrStorageMissing   = errors.New("financial storage is not configured")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type FieldSpec struct {
	Column string
	Kind   string
}

type ContractActivationRequest struct {
	SkipCommissions bool `json:"skipCommissions"`
}

type CommissionStatusRequest struct {
	PaymentProof *string `json:"payment_proof"`
	Notes        *string `json:"notes"`
}

type ContractDocumentRequest struct {
	Path string `json:"path"`
}

package leads

import "fmt"

// Keep ErrInvalidReference in the chain for canonical automation classification
// and legacy callers, while exposing the actionable cause to human commands.
var (
	ErrMoveStageDestinationUnavailable = fmt.Errorf("%w: destination stage is unavailable", ErrInvalidReference)
	ErrMoveStageConfigurationConflict  = fmt.Errorf("%w: destination stage has conflicting commercial rules", ErrInvalidReference)
	ErrLeadLinkedPropertyInvalid       = fmt.Errorf("%w: linked property is unavailable in this organization", ErrInvalidReference)
)

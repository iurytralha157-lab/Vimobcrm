package leads

import (
	"context"
	"errors"
)

func runRedistributionCycle(ctx context.Context, process func(context.Context) error) (err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("lead redistribution cycle panic")
		}
	}()
	return process(ctx)
}

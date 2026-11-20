package leads

import "testing"

func TestSLAStatusAndEvent(t *testing.T) {
	for _, tc := range []struct {
		name, before, status, event string
		elapsed                     int
		warned, overdue             bool
	}{
		{name: "negative clock offset", before: "ok", elapsed: -1, status: "ok"},
		{name: "below warning threshold", before: "ok", elapsed: 59, status: "ok"},
		{name: "at warning threshold", before: "ok", elapsed: 60, status: "warning", event: "sla_warning"},
		{name: "already warning", before: "warning", elapsed: 60, status: "warning"},
		{name: "warning delivered earlier", before: "ok", elapsed: 60, status: "warning", warned: true},
		{name: "at overdue threshold", before: "warning", elapsed: 90, status: "overdue", event: "sla_overdue", warned: true},
		{name: "already overdue", before: "overdue", elapsed: 90, status: "overdue"},
		{name: "overdue delivered earlier", before: "warning", elapsed: 90, status: "overdue", overdue: true},
		{name: "directly overdue", before: "ok", elapsed: 150, status: "overdue", event: "sla_overdue"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, event := slaStatusAndEvent(slaCandidate{
				status: tc.before, warned: tc.warned, overdue: tc.overdue, warnAfter: 60, overdueAfter: 90,
			}, tc.elapsed)
			if status != tc.status || event != tc.event {
				t.Fatalf("got (%s, %s), want (%s, %s)", status, event, tc.status, tc.event)
			}
		})
	}
}

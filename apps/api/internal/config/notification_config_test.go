package config

import "testing"

func TestNotificationDispatchWorkerFlagFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "unset equivalent", value: "", want: false},
		{name: "whitespace", value: "   ", want: false},
		{name: "malformed", value: "tru", want: false},
		{name: "explicit false", value: "false", want: false},
		{name: "explicit true", value: "true", want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("NOTIFICATION_DISPATCH_WORKER_ENABLED", test.value)

			got := loadNotificationConfig().DispatchWorkerEnabled
			if got != test.want {
				t.Fatalf("DispatchWorkerEnabled = %v, want %v", got, test.want)
			}
		})
	}
}

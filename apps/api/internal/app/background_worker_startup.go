package app

type backgroundWorkerStartup struct {
	enabled bool
}

func newBackgroundWorkerStartup(enabled bool) backgroundWorkerStartup {
	return backgroundWorkerStartup{enabled: enabled}
}

func (startup backgroundWorkerStartup) Run(start func()) bool {
	if !startup.enabled || start == nil {
		return false
	}

	start()
	return true
}

func (startup backgroundWorkerStartup) RunWithError(start func() error) (bool, error) {
	if !startup.enabled || start == nil {
		return false, nil
	}

	return true, start()
}

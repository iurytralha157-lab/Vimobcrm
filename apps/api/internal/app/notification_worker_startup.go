package app

func startNotificationDispatchWorker(enabled bool, start func()) bool {
	if !enabled {
		return false
	}

	start()
	return true
}

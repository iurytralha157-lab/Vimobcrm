package health

import "strings"

const unversionedRelease = "unversioned"
const releaseHeader = "X-Vimob-Release-Sha"

// releaseSHA is set at build time with -ldflags. Keep the runtime fallback
// fail-closed so local builds and malformed values never expose arbitrary data.
var releaseSHA = unversionedRelease

func currentRelease() string {
	return normalizeReleaseSHA(releaseSHA)
}

func normalizeReleaseSHA(value string) string {
	value = strings.TrimSpace(value)
	if len(value) != 40 {
		return unversionedRelease
	}

	for index := 0; index < len(value); index++ {
		character := value[index]
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') &&
			(character < 'A' || character > 'F') {
			return unversionedRelease
		}
	}

	return strings.ToLower(value)
}

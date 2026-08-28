package publications

import "strings"

// sitePublisher is intentionally local: the public site reads the immutable
// database snapshot, so publishing is the atomic state transition performed by
// the worker rather than a remote provider call.
type sitePublisher struct{}

func (sitePublisher) Publish(source publicationSource) (string, error) {
	if !source.SiteActive {
		return "", ErrSiteUnavailable
	}
	return strings.TrimSpace(source.SitePublicURL), nil
}

func (sitePublisher) Unpublish() error {
	// Withdrawal must remain available even when the site or module is disabled.
	return nil
}

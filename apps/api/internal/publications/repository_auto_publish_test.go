package publications

import (
	"testing"
	"time"
)

func TestSitePublishRequestCurrentCoalescesOnlyTheSameSavedSource(t *testing.T) {
	updatedAt := time.Date(2026, time.September, 28, 12, 34, 56, 123456000, time.UTC)
	source := publicationSource{
		UpdatedAt: updatedAt,
		Property: map[string]any{
			"codigo":    "CA0065",
			"titulo":    "Casa de teste",
			"descricao": "Descrição pública",
			"bairro":    "Riviera Fluminense",
			"cidade":    "Macaé",
			"estado":    "RJ",
		},
		SitePublicURL:  "https://site.example/imoveis/CA0065",
		HasAssetPhotos: true,
		Assets: []sourceAsset{{
			ID: "11111111-1111-4111-8111-111111111111", AssetType: "photo", Visibility: "public",
			StoragePath: "property-media/photo.jpg", MIMEType: "image/jpeg", IsPrimary: true,
		}},
	}
	publication := publicationRecord{
		ID: "22222222-2222-4222-8222-222222222222", DesiredState: DesiredPublished,
		ObservedState: ObservedQueued, CurrentVersion: 2,
	}
	const publicBaseURL = "https://api.example"
	hash, err := siteSnapshotHash(buildSiteSnapshot(source, publicBaseURL, publication.ID, publication.CurrentVersion))
	if err != nil {
		t.Fatal(err)
	}
	version := versionRecord{
		Version: 2, SourcePropertyUpdatedAt: updatedAt, PayloadHash: hash,
	}

	for _, state := range []string{ObservedQueued, ObservedPublishing, ObservedPublished} {
		publication.ObservedState = state
		if state == ObservedPublished {
			publishedVersion := publication.CurrentVersion
			publication.PublishedVersion = &publishedVersion
		}
		current, err := sitePublishRequestCurrent(publication, version, source, publicBaseURL)
		if err != nil || !current {
			t.Fatalf("same source in %s state: current=%t error=%v", state, current, err)
		}
	}
	publication.PublishedVersion = nil
	assertNotCurrentSitePublish(t, publication, version, source, publicBaseURL)
	lastGoodVersion := publication.CurrentVersion - 1
	publication.PublishedVersion = &lastGoodVersion
	assertNotCurrentSitePublish(t, publication, version, source, publicBaseURL)
	publication.PublishedVersion = &version.Version

	publication.ObservedState = ObservedError
	assertNotCurrentSitePublish(t, publication, version, source, publicBaseURL)
	publication.ObservedState = ObservedPublished
	publication.LastErrorCode = stringPointer("snapshot_changed")
	assertNotCurrentSitePublish(t, publication, version, source, publicBaseURL)
	publication.LastErrorCode = nil
	publication.DesiredState = DesiredUnpublished
	assertNotCurrentSitePublish(t, publication, version, source, publicBaseURL)
	publication.DesiredState = DesiredPublished

	changedRevision := source
	changedRevision.UpdatedAt = updatedAt.Add(time.Microsecond)
	assertNotCurrentSitePublish(t, publication, version, changedRevision, publicBaseURL)

	changedContent := source
	changedContent.Property = map[string]any{}
	for key, value := range source.Property {
		changedContent.Property[key] = value
	}
	changedContent.Property["bairro"] = "Centro"
	assertNotCurrentSitePublish(t, publication, version, changedContent, publicBaseURL)

	changedMedia := source
	changedMedia.Assets = append([]sourceAsset{}, source.Assets...)
	changedMedia.Assets[0].StoragePath = "property-media/new-photo.jpg"
	assertNotCurrentSitePublish(t, publication, version, changedMedia, publicBaseURL)

	version.Version = 1
	assertNotCurrentSitePublish(t, publication, version, source, publicBaseURL)
}

func assertNotCurrentSitePublish(t *testing.T, publication publicationRecord, version versionRecord, source publicationSource, publicBaseURL string) {
	t.Helper()
	current, err := sitePublishRequestCurrent(publication, version, source, publicBaseURL)
	if err != nil || current {
		t.Fatalf("changed or withdrawn source: current=%t error=%v", current, err)
	}
}

func TestPublishPublicationRevisionChecksExistingAndMissingRows(t *testing.T) {
	revision := time.Date(2026, time.September, 28, 13, 0, 0, 0, time.UTC)
	publication := &publicationRecord{UpdatedAt: revision}
	matching := revision.Format(time.RFC3339Nano)
	stale := revision.Add(-time.Second).Format(time.RFC3339Nano)
	empty := ""
	for _, tc := range []struct {
		name        string
		publication *publicationRecord
		expected    *string
		want        bool
	}{
		{name: "legacy absent row", publication: nil, expected: nil, want: true},
		{name: "legacy existing row", publication: publication, expected: nil, want: true},
		{name: "observed absent row", publication: nil, expected: &empty, want: true},
		{name: "unexpectedly created row", publication: publication, expected: &empty},
		{name: "matching row", publication: publication, expected: &matching, want: true},
		{name: "stale row", publication: publication, expected: &stale},
		{name: "unexpectedly removed row", publication: nil, expected: &matching},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := publishPublicationRevisionMatches(tc.publication, tc.expected); got != tc.want {
				t.Fatalf("revision match = %t, want %t", got, tc.want)
			}
		})
	}
}

func TestNewestSitePublicationJobSupersedesAnOlderQueuedVersion(t *testing.T) {
	firstVersion := int64(1)
	latestVersion := int64(2)
	publication := publicationRecord{
		Channel: SiteChannel, DesiredState: DesiredPublished, CurrentVersion: latestVersion,
	}
	olderJob := pendingJob{Channel: SiteChannel, Action: ActionPublish, Version: &firstVersion}
	latestJob := pendingJob{Channel: SiteChannel, Action: ActionUpdate, Version: &latestVersion}
	if publishJobIsCurrent(publication, olderJob) {
		t.Fatal("older queued or claimed Site job must be superseded after a newer save")
	}
	if !publishJobIsCurrent(publication, latestJob) {
		t.Fatal("latest Site update job must remain publishable")
	}
	publication.DesiredState = DesiredUnpublished
	if publishJobIsCurrent(publication, latestJob) {
		t.Fatal("withdrawal must supersede an in-flight Site update")
	}
}

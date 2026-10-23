package publications

import (
	"context"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLegacySiteViewReportsVisibilityWithoutCreatingCanonicalIntention(t *testing.T) {
	t.Parallel()

	source := readyPublicationSource()
	source.LegacySitePublished = true
	source.SiteModuleActive = false
	repo := NewRepository(nil, Config{Worker: WorkerConfig{Enabled: false}})
	actor := tenant.Context{UserID: "actor", OrganizationID: "org", MemberRole: "admin", EnabledModules: []string{"properties"}}
	view, err := repo.buildPublicationView(context.Background(), nil, actor, source, sitePublicationScope(), nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if !view.LegacyVisible || view.PublicURL == nil || *view.PublicURL != source.SitePublicURL {
		t.Fatalf("live legacy publication was hidden: %#v", view)
	}
	if view.ID != nil || view.DesiredState != DesiredUnpublished || view.ObservedState != ObservedDraft || view.CurrentVersion != 0 {
		t.Fatal("observing legacy visibility must not synthesize canonical intention or a version")
	}
	if view.Available || view.ReadinessState != ReadinessBlocked || view.Capabilities.CanPublish || view.Capabilities.CanUnpublish {
		t.Fatal("legacy visibility must not bypass new-publication or withdrawal capabilities")
	}
}

func TestLegacySiteVisibilityRespectsLiveSafetyAndDurableWithdrawal(t *testing.T) {
	t.Parallel()

	version := int64(1)
	for _, tc := range []struct {
		name        string
		channel     string
		publication *publicationRecord
		mutate      func(*publicationSource)
		want        bool
	}{
		{name: "no canonical row", want: true},
		{name: "first canonical delivery", publication: &publicationRecord{DesiredState: DesiredPublished}, want: true},
		{name: "explicit withdrawal", publication: &publicationRecord{DesiredState: DesiredUnpublished}},
		{name: "explicit pause", publication: &publicationRecord{DesiredState: DesiredPaused}},
		{name: "canonical version already delivered", publication: &publicationRecord{DesiredState: DesiredPublished, PublishedVersion: &version}},
		{name: "legacy private", mutate: func(s *publicationSource) { s.LegacySitePublished = false }},
		{name: "site inactive", mutate: func(s *publicationSource) { s.SiteActive = false }},
		{name: "commercialization denied", mutate: func(s *publicationSource) { s.CommercializationDenied = true }},
		{name: "reserved", mutate: func(s *publicationSource) { s.Status = "reserved" }},
		{name: "unknown status", mutate: func(s *publicationSource) { s.Status = "unknown" }},
		{name: "empty status", mutate: func(s *publicationSource) { s.Status = "" }},
		{name: "available accented", mutate: func(s *publicationSource) { s.Status = " Disponível " }, want: true},
		{name: "site module disabled", mutate: func(s *publicationSource) { s.SiteModuleActive = false }, want: true},
		{name: "other channel", channel: GrupoOLXChannel},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := readyPublicationSource()
			source.LegacySitePublished = true
			if tc.mutate != nil {
				tc.mutate(&source)
			}
			scope := sitePublicationScope()
			if tc.channel != "" {
				scope.Channel = tc.channel
			}
			if got := legacySitePublicationVisible(scope, source, tc.publication); got != tc.want {
				t.Fatalf("legacy visibility = %t, want %t", got, tc.want)
			}
		})
	}
}

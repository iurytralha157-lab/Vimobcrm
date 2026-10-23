package whatsapp

import (
	"context"
	pathpkg "path"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	conversationAvatarTTLSeconds   = 60 * 60
	conversationAvatarCacheSkew    = 15 * time.Minute
	conversationAvatarFailureCache = 20 * time.Second
	conversationAvatarBatchTimeout = 2 * time.Second
	conversationAvatarConcurrency  = 6
)

// This read model uses WhatsApp's existing Storage transport and bounded cache.
// Its policy mirrors the private lead-avatar projection without depending on
// the Leads repository or borrowing webhook/outbox concurrency.
type conversationAvatarReference struct {
	OrganizationID    string  `json:"organizationId"`
	LeadID            string  `json:"leadId"`
	StoragePath       *string `json:"storagePath"`
	HistoricalContact bool    `json:"historicalContact"`
}

// to_jsonb keeps the older database schema readable until the avatar column is
// deployed. The reference is internal and belongs to the lead in this projection,
// which may differ from a historical conversation's current persisted binding.
func conversationAvatarReferenceSQL(historical bool) string {
	contact := "false"
	if historical {
		contact = "true"
	}
	return `case when l.id is not null then jsonb_build_object(
	  'organizationId', l.organization_id::text, 'leadId', l.id::text,
	  'storagePath', to_jsonb(l)->>'whatsapp_avatar_storage_path',
	  'historicalContact', ` + contact + `)::text end`
}

func conversationAvatarPathBelongsToLead(objectPath, organizationID, leadID string) bool {
	if objectPath == "" || strings.TrimSpace(objectPath) != objectPath ||
		strings.ContainsAny(objectPath, `\?#%`) || pathpkg.Clean(objectPath) != objectPath {
		return false
	}
	for _, character := range objectPath {
		if unicode.IsControl(character) {
			return false
		}
	}
	organizationID, organizationOK := normalizeUUID(organizationID)
	leadID, leadOK := normalizeUUID(leadID)
	if !organizationOK || !leadOK {
		return false
	}
	prefix := "orgs/" + organizationID + "/profile-pictures/" + leadID + "/"
	if !strings.HasPrefix(objectPath, prefix) {
		return false
	}
	name := strings.TrimPrefix(objectPath, prefix)
	if strings.Contains(name, "/") {
		return false
	}
	extension := pathpkg.Ext(name)
	if extension != ".jpg" && extension != ".png" && extension != ".webp" {
		return false
	}
	digest := strings.TrimSuffix(name, extension)
	if len(digest) != 64 {
		return false
	}
	for _, character := range digest {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func validConversationAvatarReference(organizationID string, conversation *Conversation, reference *conversationAvatarReference) bool {
	organizationID, validOrganization := normalizeUUID(organizationID)
	if !validOrganization || conversation == nil || reference == nil || conversation.IsGroup ||
		conversation.Lead == nil || conversation.LeadID == nil {
		return false
	}
	referenceOrg, referenceOrgOK := normalizeUUID(reference.OrganizationID)
	referenceLead, referenceLeadOK := normalizeUUID(reference.LeadID)
	leadID, leadOK := normalizeUUID(conversation.Lead.ID)
	bindingLead, bindingOK := normalizeUUID(*conversation.LeadID)
	return referenceOrgOK && referenceLeadOK && leadOK && bindingOK && referenceOrg == organizationID &&
		referenceLead == leadID && referenceLead == bindingLead
}

func (repo Repository) signedConversationAvatarURL(ctx context.Context, organizationID, leadID, objectPath string) string {
	if !conversationAvatarPathBelongsToLead(objectPath, organizationID, leadID) || ctx.Err() != nil {
		return ""
	}
	key := repo.storage.projectURL + "\x00" + objectPath
	if repo.avatarURLs != nil {
		if cached, found := repo.avatarURLs.Load(key); found {
			return cached.url
		}
	}
	if repo.avatarSlots != nil {
		select {
		case repo.avatarSlots <- struct{}{}:
			defer func() { <-repo.avatarSlots }()
		case <-ctx.Done():
			return ""
		}
		if repo.avatarURLs != nil {
			if cached, found := repo.avatarURLs.Load(key); found {
				return cached.url
			}
		}
	}
	signed, err := repo.storage.signedURL(ctx, whatsappMediaBucket, objectPath, conversationAvatarTTLSeconds)
	if err != nil || strings.TrimSpace(signed) == "" {
		if repo.avatarURLs != nil && ctx.Err() == nil {
			repo.avatarURLs.Store(key, cachedWhatsAppMediaSignedURL{expiresAt: time.Now().Add(conversationAvatarFailureCache)})
		}
		return ""
	}
	if repo.avatarURLs != nil {
		repo.avatarURLs.Store(key, cachedWhatsAppMediaSignedURL{url: signed,
			expiresAt: time.Now().Add(time.Duration(conversationAvatarTTLSeconds)*time.Second - conversationAvatarCacheSkew)})
	}
	return signed
}

func (repo Repository) hydrateConversationAvatar(ctx context.Context, organizationID string, conversation *Conversation) {
	repo.hydrateConversationAvatars(ctx, organizationID, []*Conversation{conversation})
}

// Call only after the conversation query has authorized every returned record.
// No additional database reads, provider requests or browser requests are made.
func (repo Repository) hydrateConversationAvatars(ctx context.Context, organizationID string, conversations []*Conversation) {
	type target struct {
		conversation *Conversation
		reference    *conversationAvatarReference
		path         string
	}
	targets := make([]target, 0, len(conversations))
	unique := make(map[string]*conversationAvatarReference)
	for _, conversation := range conversations {
		if conversation == nil || conversation.avatarReference == nil {
			continue
		}
		reference := conversation.avatarReference
		if !validConversationAvatarReference(organizationID, conversation, reference) {
			if conversation.Lead != nil {
				conversation.Lead.WhatsAppAvatarURL = nil
			}
			if reference.HistoricalContact {
				conversation.ContactPicture = nil
			}
			continue
		}
		// Keep the already authorized legacy projection when the older schema has
		// no private object path. A present but invalid path never uses that fallback.
		if reference.StoragePath == nil {
			continue
		}
		conversation.Lead.WhatsAppAvatarURL = nil
		if reference.HistoricalContact {
			conversation.ContactPicture = nil
		}
		if !conversationAvatarPathBelongsToLead(*reference.StoragePath, organizationID, reference.LeadID) {
			continue
		}
		path := *reference.StoragePath
		targets = append(targets, target{conversation, reference, path})
		unique[path] = reference
	}
	if len(unique) == 0 {
		return
	}
	signingCtx, cancel := context.WithTimeout(ctx, conversationAvatarBatchTimeout)
	defer cancel()
	type result struct{ path, url string }
	jobs := make(chan string, len(unique))
	results := make(chan result, len(unique))
	for path := range unique {
		jobs <- path
	}
	close(jobs)
	count := min(len(unique), conversationAvatarConcurrency)
	var workers sync.WaitGroup
	workers.Add(count)
	for index := 0; index < count; index++ {
		go func() {
			defer workers.Done()
			for path := range jobs {
				reference := unique[path]
				if signed := repo.signedConversationAvatarURL(signingCtx, organizationID, reference.LeadID, path); signed != "" {
					results <- result{path, signed}
				}
			}
		}()
	}
	workers.Wait()
	close(results)
	urls := make(map[string]string, len(unique))
	for signed := range results {
		urls[signed.path] = signed.url
	}
	for _, target := range targets {
		conversation, reference := target.conversation, target.reference
		if conversation.avatarReference != reference || !validConversationAvatarReference(organizationID, conversation, reference) ||
			reference.StoragePath == nil || *reference.StoragePath != target.path || urls[target.path] == "" {
			continue
		}
		url := urls[target.path]
		conversation.Lead.WhatsAppAvatarURL = &url
		if reference.HistoricalContact {
			conversation.ContactPicture = &url
		}
	}
}

func conversationAvatarPointers(conversations []Conversation) []*Conversation {
	result := make([]*Conversation, len(conversations))
	for index := range conversations {
		result[index] = &conversations[index]
	}
	return result
}

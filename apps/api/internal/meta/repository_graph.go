package meta

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const metaLeadDetailsFields = "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform"

const metaAdWithCreativeFields = "id,name,creative{id,name,thumbnail_url,image_url,object_url,object_type,object_story_spec,asset_feed_spec,instagram_permalink_url,effective_object_story_id,effective_instagram_story_id,video_id,url_tags,template_url}"

const metaVideoDetailsFields = "id,source,permalink_url,picture,thumbnails"

const metaStoryDetailsFields = "id,permalink_url,full_picture,attachments{media,type,target,subattachments}"

func (repo Repository) leadDetails(ctx context.Context, change leadgenChange, integration metaIntegration) (map[string]any, error) {
	if hasFieldData(change.Raw) {
		body := cloneObject(change.Raw)
		repo.enrichLeadDetailsWithCreative(ctx, body, change, integration)
		return body, nil
	}
	if integration.AccessToken == nil || strings.TrimSpace(*integration.AccessToken) == "" {
		return nil, errors.New("Meta page access token is missing")
	}

	body, err := repo.metaGraphGet(ctx, change.LeadgenID, *integration.AccessToken, metaLeadDetailsFields)
	if err != nil {
		return nil, err
	}

	for key, value := range change.Raw {
		if _, exists := body[key]; !exists {
			body[key] = value
		}
	}
	repo.enrichLeadDetailsWithCreative(ctx, body, change, integration)
	return body, nil
}

func (repo Repository) metaGraphGet(ctx context.Context, objectID string, accessToken string, fields string) (map[string]any, error) {
	objectID = strings.TrimSpace(objectID)
	accessToken = strings.TrimSpace(accessToken)
	if objectID == "" {
		return nil, errors.New("Meta Graph object id is missing")
	}
	if accessToken == "" {
		return nil, errors.New("Meta access token is missing")
	}

	endpoint, err := url.Parse(strings.TrimRight(repo.config.GraphBaseURL, "/") + "/" + strings.Trim(strings.TrimSpace(repo.config.GraphVersion), "/") + "/" + url.PathEscape(objectID))
	if err != nil {
		return nil, err
	}

	query := endpoint.Query()
	if strings.TrimSpace(fields) != "" {
		query.Set("fields", fields)
	}
	if strings.TrimSpace(repo.config.AppSecret) != "" {
		query.Set("appsecret_proof", oauthAppSecretProof(repo.config.AppSecret, accessToken))
	}
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+accessToken)

	response, err := repo.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&body); err != nil {
		return nil, err
	}
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("Meta Graph returned HTTP %d: %s", response.StatusCode, metaGraphErrorMessage(body))
	}
	return body, nil
}

func (repo Repository) enrichLeadDetailsWithCreative(ctx context.Context, details map[string]any, change leadgenChange, integration metaIntegration) {
	if details == nil || integration.AccessToken == nil || strings.TrimSpace(*integration.AccessToken) == "" {
		return
	}

	adID := metaText(details, change.Raw, "ad_id")
	if adID == "" {
		return
	}

	adObject, err := repo.metaGraphGet(ctx, adID, *integration.AccessToken, metaAdWithCreativeFields)
	if err != nil {
		details["creative_fetch_error"] = err.Error()
		return
	}
	details["ad_object"] = adObject

	creative := objectMap(adObject["creative"])
	if len(creative) == 0 {
		details["creative_fetch_error"] = "Meta ad creative object was not returned"
		return
	}
	details["creative"] = creative

	normalized := normalizeMetaCreative(adObject, creative)

	if videoID := textFromAny(normalized["creative_video_id"]); videoID != "" {
		video, err := repo.metaGraphGet(ctx, videoID, *integration.AccessToken, metaVideoDetailsFields)
		if err != nil {
			details["creative_video_fetch_error"] = err.Error()
		} else {
			details["creative_video"] = video
			setFirstURL(normalized, "creative_video_url", video["source"])
			setFirstURL(normalized, "creative_permalink_url", video["permalink_url"])
			setFirstURL(normalized, "creative_url", video["picture"])
			setFirstURL(normalized, "creative_thumbnail_url", video["picture"])
			if thumbnail := firstVideoThumbnailURL(video); thumbnail != "" {
				setFirstURL(normalized, "creative_url", thumbnail)
				setFirstURL(normalized, "creative_thumbnail_url", thumbnail)
			}
		}
	}

	if storyID := metaText(creative, nil, "effective_object_story_id"); storyID != "" {
		story, err := repo.metaGraphGet(ctx, storyID, *integration.AccessToken, metaStoryDetailsFields)
		if err != nil {
			details["creative_story_fetch_error"] = err.Error()
		} else {
			details["creative_story"] = story
			setFirstURL(normalized, "creative_permalink_url", story["permalink_url"])
			setFirstURL(normalized, "creative_url", story["full_picture"])
			setFirstURL(normalized, "creative_thumbnail_url", story["full_picture"])
			if attachmentURL := firstAttachmentMediaURL(story); attachmentURL != "" {
				setFirstURL(normalized, "creative_url", attachmentURL)
				setFirstURL(normalized, "creative_thumbnail_url", attachmentURL)
			}
		}
	}

	for key, value := range normalized {
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				details[key] = strings.TrimSpace(typed)
			}
		default:
			details[key] = typed
		}
	}
}

func metaGraphErrorMessage(body map[string]any) string {
	if errorObject, ok := body["error"].(map[string]any); ok {
		if message := textFromAny(errorObject["message"]); message != "" {
			return message
		}
	}
	return "unknown error"
}

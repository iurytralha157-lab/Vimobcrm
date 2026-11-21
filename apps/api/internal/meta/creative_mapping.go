package meta

import (
	"net/url"
	"strings"
)

func normalizeMetaCreative(adObject map[string]any, creative map[string]any) map[string]any {
	storySpec := objectMap(creative["object_story_spec"])
	assetFeed := objectMap(creative["asset_feed_spec"])
	linkData := objectMap(storySpec["link_data"])
	videoData := objectMap(storySpec["video_data"])
	photoData := objectMap(storySpec["photo_data"])

	videoID := firstNonEmpty(
		textFromAny(videoData["video_id"]),
		textFromAny(creative["video_id"]),
		firstAssetVideoID(assetFeed),
		firstChildAttachmentVideoID(linkData),
	)

	imageURL := firstURL(
		creative["effective_image_url"],
		creative["image_url"],
		creative["thumbnail_url"],
		creative["object_url"],
		linkData["picture"],
		photoData["url"],
		videoData["image_url"],
		videoData["thumbnail_url"],
		firstAssetImageURL(assetFeed),
		firstChildAttachmentImageURL(linkData),
	)

	thumbnailURL := firstURL(creative["thumbnail_url"], imageURL)
	instagramURL := firstURL(creative["instagram_permalink_url"])
	destinationURL := firstURL(creative["template_url"], linkData["link"], nestedValue(videoData, "call_to_action", "value", "link"), nestedValue(linkData, "call_to_action", "value", "link"))

	out := map[string]any{
		"creative_id":                 textFromAny(creative["id"]),
		"creative_name":               firstNonEmpty(textFromAny(creative["name"]), textFromAny(adObject["name"])),
		"creative_type":               inferMetaCreativeType(creative, storySpec, assetFeed, videoID),
		"creative_url":                imageURL,
		"creative_thumbnail_url":      thumbnailURL,
		"creative_video_id":           videoID,
		"creative_instagram_url":      instagramURL,
		"creative_permalink_url":      instagramURL,
		"creative_destination_url":    destinationURL,
		"creative_object_story_id":    textFromAny(creative["effective_object_story_id"]),
		"creative_instagram_story_id": textFromAny(creative["effective_instagram_story_id"]),
	}
	return out
}

func inferMetaCreativeType(creative map[string]any, storySpec map[string]any, assetFeed map[string]any, videoID string) string {
	if videoID != "" {
		return "video"
	}
	if len(anySlice(assetFeed["carousels"])) > 0 || len(anySlice(objectMap(storySpec["link_data"])["child_attachments"])) > 0 {
		return "carousel"
	}
	objectType := strings.ToLower(textFromAny(creative["object_type"]))
	if strings.Contains(objectType, "video") {
		return "video"
	}
	if strings.Contains(objectType, "carousel") {
		return "carousel"
	}
	return "image"
}

func firstAssetImageURL(assetFeed map[string]any) string {
	for _, item := range anySlice(assetFeed["images"]) {
		image := objectMap(item)
		if url := firstURL(image["url"], image["thumbnail_url"], image["image_url"]); url != "" {
			return url
		}
	}
	return ""
}

func firstAssetVideoID(assetFeed map[string]any) string {
	for _, item := range anySlice(assetFeed["videos"]) {
		video := objectMap(item)
		if id := firstNonEmpty(textFromAny(video["video_id"]), textFromAny(video["id"])); id != "" {
			return id
		}
	}
	return ""
}

func firstChildAttachmentImageURL(linkData map[string]any) string {
	for _, item := range anySlice(linkData["child_attachments"]) {
		attachment := objectMap(item)
		if url := firstURL(attachment["picture"], attachment["image_url"], attachment["thumbnail_url"]); url != "" {
			return url
		}
	}
	return ""
}

func firstChildAttachmentVideoID(linkData map[string]any) string {
	for _, item := range anySlice(linkData["child_attachments"]) {
		attachment := objectMap(item)
		if id := firstNonEmpty(textFromAny(attachment["video_id"]), textFromAny(attachment["id"])); id != "" {
			return id
		}
	}
	return ""
}

func firstVideoThumbnailURL(video map[string]any) string {
	thumbnails := objectMap(video["thumbnails"])
	for _, item := range anySlice(thumbnails["data"]) {
		thumbnail := objectMap(item)
		if url := firstURL(thumbnail["uri"]); url != "" {
			return url
		}
	}
	return ""
}

func firstAttachmentMediaURL(story map[string]any) string {
	attachments := objectMap(story["attachments"])
	for _, item := range anySlice(attachments["data"]) {
		attachment := objectMap(item)
		if url := firstURL(nestedValue(attachment, "media", "image", "src"), nestedValue(attachment, "media", "source")); url != "" {
			return url
		}
		for _, child := range anySlice(objectMap(attachment["subattachments"])["data"]) {
			childAttachment := objectMap(child)
			if url := firstURL(nestedValue(childAttachment, "media", "image", "src"), nestedValue(childAttachment, "media", "source")); url != "" {
				return url
			}
		}
	}
	return ""
}

func nestedValue(source map[string]any, keys ...string) any {
	var current any = source
	for _, key := range keys {
		currentMap := objectMap(current)
		if len(currentMap) == 0 {
			return nil
		}
		current = currentMap[key]
	}
	return current
}

func anySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func firstURL(values ...any) string {
	for _, value := range values {
		text := textFromAny(value)
		if text == "" {
			continue
		}
		parsed, err := url.Parse(text)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			continue
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			continue
		}
		return text
	}
	return ""
}

func setFirstURL(target map[string]any, key string, values ...any) {
	if textFromAny(target[key]) != "" {
		return
	}
	if url := firstURL(values...); url != "" {
		target[key] = url
	}
}

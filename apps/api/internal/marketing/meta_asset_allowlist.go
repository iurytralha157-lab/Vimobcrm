package marketing

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
)

var metaAssetIDPattern = regexp.MustCompile(`^[0-9]{1,32}$`)

// MetaAssetAllowlist limits a Marketing login to the provider assets assigned to its organization.
type MetaAssetAllowlist map[string][]string

func ParseMetaAssetAllowlist(value string) (MetaAssetAllowlist, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	var configured MetaAssetAllowlist
	invalid := errors.New("invalid MARKETING_META_ASSET_ALLOWLIST")
	if err := json.Unmarshal([]byte(value), &configured); err != nil || configured == nil {
		return nil, invalid
	}
	allowlist := make(MetaAssetAllowlist, len(configured))
	for organizationID, keys := range configured {
		organizationID = strings.ToLower(organizationID)
		if _, duplicate := allowlist[organizationID]; duplicate || !uuidPattern.MatchString(organizationID) || keys == nil {
			return nil, invalid
		}
		for _, key := range keys {
			parts := strings.Split(key, ":")
			if len(parts) < 2 || !metaAssetIDPattern.MatchString(parts[1]) {
				return nil, invalid
			}
			switch parts[0] {
			case AssetAdAccount, AssetPage:
				if len(parts) != 2 {
					return nil, invalid
				}
			case AssetInstagram:
				if len(parts) != 3 || !metaAssetIDPattern.MatchString(parts[2]) || !slices.Contains(keys, AssetPage+":"+parts[2]) {
					return nil, invalid
				}
			default:
				return nil, invalid
			}
		}
		allowlist[organizationID] = keys
	}
	return allowlist, nil
}

func (allowlist MetaAssetAllowlist) allows(organizationID string, assetType string, assetID string, pageID string) bool {
	keys, scoped := allowlist[strings.ToLower(organizationID)]
	if !scoped {
		return true
	}
	if assetType == AssetAdAccount {
		assetID = strings.TrimPrefix(assetID, "act_")
	}
	key := assetType + ":" + assetID
	if assetType == AssetInstagram {
		key += ":" + pageID
	}
	return slices.Contains(keys, key)
}

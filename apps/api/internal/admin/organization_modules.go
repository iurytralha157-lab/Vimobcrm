package admin

import "strings"

var coreOrganizationModules = []string{"crm", "whatsapp", "round_robin"}

var coreOrganizationModuleSet = map[string]struct{}{
	"crm":         {},
	"whatsapp":    {},
	"round_robin": {},
}

func canonicalOrganizationModuleName(moduleName string) string {
	moduleName = strings.ToLower(strings.TrimSpace(moduleName))
	switch moduleName {
	case "dashboard", "leads", "contacts", "pipelines":
		return "crm"
	default:
		return moduleName
	}
}

func isCoreOrganizationModule(moduleName string) bool {
	_, ok := coreOrganizationModuleSet[canonicalOrganizationModuleName(moduleName)]
	return ok
}

func organizationModulesWithCore(modules []string) []string {
	result := make([]string, 0, len(modules)+len(coreOrganizationModules))
	seen := make(map[string]struct{}, len(modules)+len(coreOrganizationModules))

	appendModule := func(moduleName string) {
		moduleName = canonicalOrganizationModuleName(moduleName)
		if moduleName == "" {
			return
		}
		if _, exists := seen[moduleName]; exists {
			return
		}
		seen[moduleName] = struct{}{}
		result = append(result, moduleName)
	}

	for _, moduleName := range coreOrganizationModules {
		appendModule(moduleName)
	}
	for _, moduleName := range modules {
		appendModule(moduleName)
	}

	return result
}

package httpserver

import (
	"net/http"
	"strings"
)

var exactUserErrorMessages = map[string]string{
	"analytics_failed":                     "Não foi possível carregar os indicadores. Tente novamente.",
	"ai_autoreply_disabled":                "A resposta automática da IA ainda não está configurada.",
	"automation_execution_already_active":  "Este lead já possui uma automação em execução.",
	"automation_execution_not_cancellable": "Esta execução já terminou e não pode mais ser cancelada.",
	"automation_flow_in_use":               "Esta automação possui uma execução ativa e ainda não pode ser alterada.",
	"automation_media_in_use":              "Este arquivo está sendo usado por uma automação ativa.",
	"automation_misconfigured":             "A automação está incompleta ou configurada incorretamente.",
	"empty_body":                           "Nenhum dado foi enviado na solicitação.",
	"financial_module_unavailable":         "O módulo financeiro não está disponível para esta organização.",
	"gamification_schema_not_ready":        "A gamificação ainda não está pronta para esta organização.",
	"integration_function_not_allowed":     "Esta função de integração não está disponível.",
	"invitation_already_pending":           "Já existe um convite pendente para este usuário nesta imobiliária.",
	"invitation_email_failed":              "Não foi possível enviar o convite por e-mail. Verifique a configuração de envio.",
	"invitation_email_missing":             "Este convite não possui um e-mail para reenvio.",
	"invitation_user_already_member":       "Este usuário já está cadastrado na sua imobiliária.",
	"lead_already_exists":                  "Este lead já está cadastrado.",
	"lead_phone_conflict":                  "Já existe um lead cadastrado com este telefone.",
	"meta_app_secret_missing":              "A chave secreta da Meta ainda não foi configurada.",
	"meta_verify_token_missing":            "O token de verificação da Meta ainda não foi configurado.",
	"method_not_allowed":                   "Esta ação não é permitida neste endereço.",
	"module_unavailable":                   "Este módulo não está disponível para esta organização.",
	"organization_access_denied":           "Você não tem acesso a esta organização.",
	"organization_required":                "Não foi possível identificar a organização. Atualize a página e tente novamente.",
	"permission_denied":                    "Você não tem permissão para realizar esta ação.",
	"permission_storage_unavailable":       "O armazenamento de permissões ainda não está disponível.",
	"pipeline_has_leads":                   "Esta pipeline possui leads e não pode ser excluída.",
	"portal_module_unavailable":            "O módulo de portais não está disponível para esta organização.",
	"site_contact_rate_limited":            "Muitas tentativas. Aguarde um minuto e tente novamente.",
	"streaming_not_supported":              "A atualização em tempo real não está disponível neste ambiente.",
	"tag_already_exists":                   "Já existe uma tag com este nome.",
	"team_in_use":                          "Não é possível excluir esta equipe porque ela está sendo usada em uma fila de distribuição. Remova-a da fila antes de tentar novamente.",
	"tenant_resolution_failed":             "Não foi possível identificar a organização. Atualize a página e tente novamente.",
	"unauthorized":                         "Sua sessão expirou ou não é válida. Entre novamente.",
	"user_conflict":                        "Já existe um usuário cadastrado com esses dados.",
	"user_inactive":                        "Este usuário está inativo.",
	"whatsapp_provider_failed":             "O WhatsApp não respondeu à solicitação. Tente novamente.",
	"whatsapp_feature_unavailable":         "Este recurso do WhatsApp não está disponível.",
	"whatsapp_webhook_session_mismatch":    "A conexão do WhatsApp recebida não corresponde à sessão configurada.",
}

func userFacingErrorMessage(code string, original string, status int) string {
	code = strings.ToLower(strings.TrimSpace(code))
	if message := exactUserErrorMessages[code]; message != "" {
		return message
	}

	// Business conflicts may contain useful context such as the existing queue name.
	if code == "round_robin_condition_conflict" {
		return strings.TrimSpace(original)
	}
	normalizedOriginal := strings.ToLower(original)
	if code == "invalid_round_robin_input" && strings.Contains(normalizedOriginal, "whatsapp message distribution") && strings.Contains(normalizedOriginal, "required check-in") {
		return "O check-in obrigatório ainda não é compatível com esta regra do WhatsApp. Desative essa configuração para ativar a fila."
	}
	if code == "invalid_round_robin_input" && strings.Contains(normalizedOriginal, "whatsapp message distribution") && strings.Contains(normalizedOriginal, "requires team entries") {
		return "Para respeitar a escala nesta versão, adicione uma equipe à fila. Corretores individuais só podem ser usados quando “Ignorar escala dos corretores” estiver ativado."
	}
	if code == "invalid_round_robin_input" && strings.Contains(normalizedOriginal, "whatsapp message distribution") {
		return "Para ativar esta regra do WhatsApp, escolha uma conexão válida e ativa."
	}
	if code == "invalid_lead_input" && strings.Contains(normalizedOriginal, "managed whatsapp message distribution") {
		return "Este lead pertence a uma campanha do WhatsApp e não pode usar a redistribuição genérica. Você ainda pode transferi-lo manualmente para outro corretor."
	}
	if strings.HasPrefix(code, "no_") && strings.HasSuffix(code, "_changes") {
		return "Nenhuma alteração foi informada."
	}
	if strings.Contains(code, "limit_exceeded") || strings.HasSuffix(code, "_rate_limited") {
		return "O limite desta operação foi atingido. Aguarde e tente novamente."
	}
	if strings.HasSuffix(code, "_body_too_large") || code == "body_too_large" {
		return "O conteúdo enviado é muito grande. Reduza o tamanho e tente novamente."
	}
	if strings.HasPrefix(code, "invalid_") {
		if strings.Contains(code, "token") || strings.Contains(code, "auth") {
			return "A autenticação informada é inválida."
		}
		if strings.Contains(code, "reference") {
			return "Uma ou mais informações relacionadas são inválidas ou não pertencem a esta organização."
		}
		return "Os dados informados são inválidos. Revise os campos e tente novamente."
	}
	if strings.HasSuffix(code, "_unauthorized") || strings.HasSuffix(code, "_verification_failed") {
		return "Não foi possível validar a autenticação desta solicitação."
	}
	if strings.HasSuffix(code, "_not_found") {
		return "O registro solicitado não foi encontrado. Ele pode ter sido removido."
	}
	if strings.HasSuffix(code, "_not_configured") || strings.HasSuffix(code, "_unavailable") {
		return "Este recurso não está disponível ou ainda não foi configurado."
	}
	if strings.HasSuffix(code, "_missing") {
		return "Uma configuração necessária ainda não foi informada."
	}
	if strings.HasSuffix(code, "_already_exists") || strings.HasSuffix(code, "_conflict") {
		return "Já existe um registro com essas informações."
	}
	if strings.HasSuffix(code, "_not_retryable") {
		return "Esta operação não pode ser repetida com segurança."
	}
	if strings.HasSuffix(code, "_operation_failed") || strings.HasSuffix(code, "_storage_failed") ||
		strings.HasSuffix(code, "_auth_failed") || strings.HasSuffix(code, "_enqueue_failed") ||
		strings.HasSuffix(code, "_dispatch_failed") {
		return "Não foi possível concluir a operação. Tente novamente."
	}

	switch status {
	case http.StatusUnauthorized:
		return "Sua sessão expirou ou não é válida. Entre novamente."
	case http.StatusForbidden:
		return "Você não tem permissão para realizar esta ação."
	case http.StatusNotFound:
		return "O registro solicitado não foi encontrado."
	case http.StatusRequestEntityTooLarge:
		return "O conteúdo enviado é muito grande. Reduza o tamanho e tente novamente."
	case http.StatusTooManyRequests:
		return "Muitas tentativas. Aguarde um momento e tente novamente."
	}
	if status >= http.StatusInternalServerError {
		return "Não foi possível concluir a operação. Tente novamente."
	}

	message := strings.TrimSpace(original)
	if message == "" {
		return "Não foi possível concluir a operação. Tente novamente."
	}
	return message
}

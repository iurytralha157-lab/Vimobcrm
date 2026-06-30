package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Service struct {
	repo       Repository
	httpClient *http.Client
	config     Config
}

func NewService(repo Repository, config Config) Service {
	if config.OpenAIBaseURL == "" {
		config.OpenAIBaseURL = "https://api.openai.com/v1"
	}
	if config.DefaultModel == "" {
		config.DefaultModel = defaultModel
	}
	return Service{
		repo:       repo,
		config:     config,
		httpClient: &http.Client{Timeout: 45 * time.Second},
	}
}

func (service Service) Run(ctx context.Context, tenantContext tenant.Context, request RunRequest) (RunResponse, error) {
	request, err := request.Validate()
	if err != nil {
		return RunResponse{}, err
	}
	agents, err := service.repo.ListRunnableAgents(ctx, tenantContext.OrganizationID)
	if err != nil {
		return RunResponse{}, err
	}
	if len(agents) == 0 {
		return RunResponse{}, ErrAgentNotFound
	}

	selected := selectRequestedOrDefaultAgent(agents, request.AgentID)
	if selected.ID == "" {
		return RunResponse{}, ErrAgentNotFound
	}
	previous := selected
	handoff := service.detectHandoff(selected, agents, request.Message)
	if handoff != nil {
		selected = agentByType(agents, handoff.ToAgent.Type)
	}

	contextData, err := service.repo.LoadLeadContext(ctx, tenantContext, request.LeadID, request.Message)
	if err != nil {
		return RunResponse{}, err
	}

	toolsUsed := []ToolResult{
		{Name: "getLeadContext", Data: map[string]any{
			"hasLead":    len(contextData.Lead) > 0,
			"activities": len(contextData.Activities),
			"properties": len(contextData.Properties),
		}},
	}
	if len(contextData.Properties) > 0 {
		toolsUsed = append(toolsUsed, ToolResult{Name: "searchProperties", Data: contextData.Properties})
	}

	output, responseID, mode, err := service.generate(ctx, selected, request, contextData)
	if err != nil {
		return RunResponse{}, err
	}

	memory := map[string]any{
		"activeAgentId":   selected.ID,
		"activeAgentType": selected.Config.Type,
		"lastMessage":     request.Message,
		"leadId":          request.LeadID,
		"handoff":         handoff,
		"updatedAt":       time.Now().UTC().Format(time.RFC3339),
	}
	service.repo.SaveConversationState(ctx, tenantContext, request.ConversationID, responseID, memory)
	service.repo.SaveAIEvent(ctx, tenantContext, "ai.agent_run", map[string]any{
		"agentId":        selected.ID,
		"agentType":      selected.Config.Type,
		"leadId":         request.LeadID,
		"conversationId": request.ConversationID,
		"mode":           mode,
		"handoff":        handoff,
	})

	response := RunResponse{
		Mode:             outputMode(mode),
		Agent:            agentSummary(selected),
		Output:           output,
		ToolsUsed:        toolsUsed,
		Memory:           memory,
		RequiresApproval: suggestedActions(selected, request, contextData),
	}
	if handoff != nil {
		response.PreviousAgent = &AgentSummary{ID: previous.ID, Name: previous.Name, Type: previous.Config.Type}
		response.Handoff = handoff
	}
	return response, nil
}

func (service Service) generate(ctx context.Context, agent Agent, request RunRequest, contextData LeadContext) (string, string, string, error) {
	if strings.TrimSpace(service.config.OpenAIAPIKey) == "" {
		return service.simulatedResponse(agent, request, contextData), "", "simulated", nil
	}

	instructions := buildInstructions(agent)
	input := buildInput(request, contextData)
	payload := map[string]any{
		"model":        agent.Config.Model,
		"instructions": instructions,
		"input":        input,
		"temperature":  agent.Config.Temperature,
	}
	body, _ := json.Marshal(payload)
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(service.config.OpenAIBaseURL, "/")+"/responses", bytes.NewReader(body))
	if err != nil {
		return "", "", "", err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+service.config.OpenAIAPIKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := service.httpClient.Do(httpRequest)
	if err != nil {
		return "", "", "", err
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", "", "", fmt.Errorf("%w: openai status %d", ErrInvalidInput, response.StatusCode)
	}

	var decoded map[string]any
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return "", "", "", err
	}
	text := extractResponseText(decoded)
	if text == "" {
		text = "Nao consegui gerar uma resposta agora. Revise o prompt do agente e tente novamente."
	}
	responseID, _ := decoded["id"].(string)
	return text, responseID, "openai", nil
}

func (service Service) simulatedResponse(agent Agent, request RunRequest, contextData LeadContext) string {
	name := "esse lead"
	if contextData.Lead != nil {
		if value, ok := contextData.Lead["name"].(string); ok && value != "" {
			name = value
		}
	}
	switch agent.Config.Type {
	case "mcmv":
		return fmt.Sprintf("Entendi o perfil do %s como possivel Minha Casa Minha Vida. Eu validaria renda familiar, entrada disponivel, cidade de interesse e se pretende financiar. Posso preparar uma mensagem curta para confirmar esses pontos.", name)
	case "high_value":
		return fmt.Sprintf("Pelo contexto, trataria %s com uma abordagem consultiva. Eu destacaria localizacao, liquidez, privacidade e diferenciais do imovel antes de sugerir visita ou proposta.", name)
	case "launch":
		return fmt.Sprintf("O perfil do %s parece uma busca por lancamento. Eu consultaria tabela, unidade, fluxo de pagamento e prazo de entrega antes de avancar para agendamento.", name)
	default:
		return fmt.Sprintf("Vou fazer a triagem do %s: identificar faixa de valor, objetivo da compra, regiao e urgencia. Se o perfil ficar claro, transfiro internamente para o agente especialista.", name)
	}
}

func (service Service) detectHandoff(current Agent, agents []Agent, message string) *HandoffResult {
	if current.Config.Type != "triage" {
		return nil
	}
	targetType := classifyIntent(message)
	if targetType == "" || targetType == current.Config.Type {
		return nil
	}
	target := agentByType(agents, targetType)
	if target.ID == "" {
		return nil
	}
	return &HandoffResult{
		FromAgent: agentSummary(current),
		ToAgent:   agentSummary(target),
		Reason:    handoffReason(targetType),
	}
}

func classifyIntent(message string) string {
	normalized := normalizeText(message)
	if strings.Contains(normalized, "minha casa minha vida") || strings.Contains(normalized, "mcmv") || strings.Contains(normalized, "subsidio") || strings.Contains(normalized, "fgts") {
		return "mcmv"
	}
	if strings.Contains(normalized, "alto padrao") || strings.Contains(normalized, "luxo") || strings.Contains(normalized, "condominio fechado") || strings.Contains(normalized, "mansao") {
		return "high_value"
	}
	if strings.Contains(normalized, "lancamento") || strings.Contains(normalized, "planta") || strings.Contains(normalized, "obra") || strings.Contains(normalized, "entrega") {
		return "launch"
	}
	if price := extractPrice(normalized); price > 0 {
		if price <= 380000 {
			return "mcmv"
		}
		if price >= 1000000 {
			return "high_value"
		}
	}
	return ""
}

func extractPrice(value string) int {
	re := regexp.MustCompile(`(\d{2,3}(?:[\.\s]\d{3})+|\d{5,7})`)
	matches := re.FindAllString(value, -1)
	for _, match := range matches {
		clean := strings.NewReplacer(".", "", " ", "").Replace(match)
		price, err := strconv.Atoi(clean)
		if err == nil && price >= 50000 {
			return price
		}
	}
	return 0
}

func buildInstructions(agent Agent) string {
	return strings.TrimSpace(`Voce e um agente de IA dentro do Vimob CRM.
Regras fixas:
- Responda em portugues do Brasil.
- Nao invente dados de imoveis, lead, agenda, financiamento ou disponibilidade.
- Use apenas o contexto fornecido e diga quando precisar consultar algo.
- Nao prometa aprovacao de credito, financiamento, desconto ou disponibilidade.
- Nao execute acoes destrutivas. Quando sugerir mover lead, enviar mensagem, agendar ou alterar responsavel, descreva como sugestao para aprovacao.
- Continue a conversa naturalmente; se houve handoff, nao se apresente novamente.

Prompt configurado do agente:
` + agent.Config.Prompt)
}

func buildInput(request RunRequest, contextData LeadContext) string {
	payload := map[string]any{
		"userMessage":         request.Message,
		"leadContext":         contextData.Lead,
		"recentActivities":    contextData.Activities,
		"candidateProperties": contextData.Properties,
	}
	body, _ := json.MarshalIndent(payload, "", "  ")
	return string(body)
}

func extractResponseText(decoded map[string]any) string {
	if text, ok := decoded["output_text"].(string); ok {
		return strings.TrimSpace(text)
	}
	output, _ := decoded["output"].([]any)
	var builder strings.Builder
	for _, item := range output {
		itemMap, _ := item.(map[string]any)
		content, _ := itemMap["content"].([]any)
		for _, contentItem := range content {
			contentMap, _ := contentItem.(map[string]any)
			if text, ok := contentMap["text"].(string); ok {
				builder.WriteString(text)
			}
		}
	}
	return strings.TrimSpace(builder.String())
}

func suggestedActions(agent Agent, request RunRequest, contextData LeadContext) []SuggestedAction {
	actions := []SuggestedAction{}
	if contains(agent.Config.AllowedTools, "draftWhatsAppMessage") {
		actions = append(actions, SuggestedAction{
			Type:        "draft_whatsapp",
			Label:       "Preparar mensagem",
			Description: "Gerar rascunho para WhatsApp. Envio exige confirmacao.",
			Payload:     map[string]any{"leadId": request.LeadID},
		})
	}
	if contains(agent.Config.AllowedTools, "createFollowUpTask") {
		actions = append(actions, SuggestedAction{
			Type:        "create_task",
			Label:       "Criar follow-up",
			Description: "Criar tarefa de acompanhamento. Criacao exige confirmacao.",
			Payload:     map[string]any{"leadId": request.LeadID},
		})
	}
	return actions
}

func selectRequestedOrDefaultAgent(agents []Agent, agentID string) Agent {
	if agentID != "" {
		for _, agent := range agents {
			if agent.ID == agentID {
				return agent
			}
		}
	}
	for _, agent := range agents {
		if agent.Config.Type == "triage" && agent.Config.IsDefault {
			return agent
		}
	}
	for _, agent := range agents {
		if agent.Config.Type == "triage" {
			return agent
		}
	}
	return agents[0]
}

func agentByType(agents []Agent, agentType string) Agent {
	for _, agent := range agents {
		if agent.Config.Type == agentType {
			return agent
		}
	}
	return Agent{}
}

func agentSummary(agent Agent) AgentSummary {
	return AgentSummary{ID: agent.ID, Name: agent.Name, Type: agent.Config.Type}
}

func handoffReason(agentType string) string {
	switch agentType {
	case "mcmv":
		return "Mensagem indica perfil Minha Casa Minha Vida ou faixa economica."
	case "high_value":
		return "Mensagem indica interesse em alto padrao ou ticket elevado."
	case "launch":
		return "Mensagem indica interesse em lancamento, planta ou obra."
	default:
		return "Perfil especializado identificado."
	}
}

func outputMode(mode string) string {
	if mode == "openai" {
		return "openai"
	}
	return "simulated"
}

func normalizeText(value string) string {
	value = strings.ToLower(value)
	replacer := strings.NewReplacer("á", "a", "à", "a", "ã", "a", "â", "a", "é", "e", "ê", "e", "í", "i", "ó", "o", "ô", "o", "õ", "o", "ú", "u", "ç", "c")
	return replacer.Replace(value)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

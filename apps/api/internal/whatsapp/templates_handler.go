package whatsapp

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func (handler Handler) ListMessageTemplates(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	templates, err := handler.repo.ListMessageTemplates(r.Context(), tenantContext)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]MessageTemplate]{Data: templates})
}

func (handler Handler) CreateMessageTemplate(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request MessageTemplateRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<20) {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	template, err := handler.repo.CreateMessageTemplate(r.Context(), tenantContext, input)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	handler.publishWhatsAppEvent(tenantContext, "whatsapp.template.created", "", nil, map[string]any{
		"templateId": template.ID,
	})
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[MessageTemplate]{Data: template})
}

func (handler Handler) UpdateMessageTemplate(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request MessageTemplatePatchRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<20) {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	template, err := handler.repo.UpdateMessageTemplate(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	handler.publishWhatsAppEvent(tenantContext, "whatsapp.template.updated", "", nil, map[string]any{
		"templateId": template.ID,
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[MessageTemplate]{Data: template})
}

func (handler Handler) DeleteMessageTemplate(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteMessageTemplate(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	handler.publishWhatsAppEvent(tenantContext, "whatsapp.template.deleted", "", nil, map[string]any{
		"templateId": r.PathValue("id"),
	})
	w.WriteHeader(http.StatusNoContent)
}

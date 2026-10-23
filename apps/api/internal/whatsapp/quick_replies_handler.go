package whatsapp

import (
	"errors"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func requireQuickReplyActor(w http.ResponseWriter, r *http.Request, permission string) (tenant.Context, bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, ok := requireTenant(w, r)
	if !ok {
		return tenant.Context{}, false
	}
	if err := authorizeQuickReplyActor(actor, permission); err != nil {
		writeWhatsAppError(w, r, err)
		return tenant.Context{}, false
	}
	return actor, true
}

func (handler Handler) ListQuickReplies(w http.ResponseWriter, r *http.Request) {
	actor, ok := requireQuickReplyActor(w, r, permissions.WhatsAppView)
	if !ok {
		return
	}
	items, err := handler.repo.ListQuickReplies(r.Context(), actor)
	if err != nil {
		writeQuickReplyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]QuickReply]{Data: items})
}

func (handler Handler) CreateQuickReply(w http.ResponseWriter, r *http.Request) {
	actor, ok := requireQuickReplyActor(w, r, permissions.WhatsAppOperate)
	if !ok {
		return
	}
	var request QuickReplyRequest
	if err := httpserver.DecodeJSON(w, r, &request, 64<<10); err != nil {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeQuickReplyError(w, r, err)
		return
	}
	item, err := handler.repo.CreateQuickReply(r.Context(), actor, input)
	if err != nil {
		writeQuickReplyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[QuickReply]{Data: item})
}

func (handler Handler) UpdateQuickReply(w http.ResponseWriter, r *http.Request) {
	actor, ok := requireQuickReplyActor(w, r, permissions.WhatsAppOperate)
	if !ok {
		return
	}
	var request QuickReplyPatchRequest
	if err := httpserver.DecodeJSON(w, r, &request, 64<<10); err != nil {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeQuickReplyError(w, r, err)
		return
	}
	item, err := handler.repo.UpdateQuickReply(r.Context(), actor, r.PathValue("id"), input)
	if err != nil {
		writeQuickReplyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[QuickReply]{Data: item})
}

func (handler Handler) DeleteQuickReply(w http.ResponseWriter, r *http.Request) {
	actor, ok := requireQuickReplyActor(w, r, permissions.WhatsAppOperate)
	if !ok {
		return
	}
	if err := handler.repo.DeleteQuickReply(r.Context(), actor, r.PathValue("id")); err != nil {
		writeQuickReplyError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeQuickReplyError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrQuickReplyNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "whatsapp_quick_reply_not_found", "Mensagem pessoal não encontrada.")
	case errors.Is(err, ErrQuickReplyConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "whatsapp_quick_reply_shortcut_conflict", "Você já tem uma mensagem pessoal com esse atalho.")
	case errors.Is(err, ErrQuickReplyLimit):
		httpserver.WriteError(w, r, http.StatusConflict, "whatsapp_quick_reply_limit_reached", "O limite é de 200 mensagens pessoais por usuário nesta organização.")
	case errors.Is(err, ErrInvalidInput), errors.Is(err, tenant.ErrOrganizationAccessDenied):
		writeWhatsAppError(w, r, err)
	default:
		// PostgreSQL constraint details can contain the saved personal text.
		// Do not pass raw database errors to the generic WhatsApp logger.
		httpserver.WriteError(w, r, http.StatusInternalServerError, "whatsapp_quick_reply_failed", "Não foi possível salvar ou carregar suas mensagens pessoais.")
	}
}

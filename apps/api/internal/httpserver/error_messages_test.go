package httpserver

import (
	"net/http"
	"testing"
)

func TestUserFacingErrorMessage(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		original string
		status   int
		want     string
	}{
		{name: "permission", code: "permission_denied", original: "You do not have permission.", status: http.StatusForbidden, want: "Você não tem permissão para realizar esta ação."},
		{name: "organization", code: "organization_required", original: "Organization context is required.", status: http.StatusForbidden, want: "Não foi possível identificar a organização. Atualize a página e tente novamente."},
		{name: "invalid input", code: "invalid_round_robin_input", original: "invalid round robin input", status: http.StatusBadRequest, want: "Os dados informados são inválidos. Revise os campos e tente novamente."},
		{name: "redistribution capacity", code: "invalid_round_robin_input", original: "invalid round robin input: automatic redistribution requires at least two active eligible users", status: http.StatusBadRequest, want: "A redistribuição automática precisa de pelo menos dois corretores ativos. Adicione outro corretor ou desative a redistribuição."},
		{name: "WhatsApp distribution input", code: "invalid_round_robin_input", original: "invalid round robin input: active WhatsApp message distribution requires a valid active connection", status: http.StatusBadRequest, want: "Para ativar esta regra do WhatsApp, escolha uma conexão válida e ativa."},
		{name: "WhatsApp check-in input", code: "invalid_round_robin_input", original: "invalid round robin input: active WhatsApp message distribution does not support required check-in", status: http.StatusBadRequest, want: "O check-in obrigatório ainda não é compatível com esta regra do WhatsApp. Desative essa configuração para ativar a fila."},
		{name: "WhatsApp legacy schedule input", code: "invalid_round_robin_input", original: "invalid round robin input: active WhatsApp message distribution requires team entries while availability schedules are enforced", status: http.StatusBadRequest, want: "Não foi possível validar os participantes desta fila. Revise os corretores e as equipes e tente novamente."},
		{name: "managed WhatsApp lead redistribution", code: "invalid_lead_input", original: "invalid lead input: managed WhatsApp message distribution does not support generic round-robin redistribution", status: http.StatusBadRequest, want: "Este lead pertence a uma campanha do WhatsApp e não pode usar a redistribuição genérica. Você ainda pode transferi-lo manualmente para outro corretor."},
		{name: "not found", code: "property_not_found", original: "Property was not found.", status: http.StatusNotFound, want: "O registro solicitado não foi encontrado. Ele pode ter sido removido."},
		{name: "selected pipeline without stage", code: "lead_destination_unavailable", original: "internal tenant reference details", status: http.StatusBadRequest, want: "O funil selecionado precisa ter uma coluna ativa. Revise o destino do lead e tente novamente."},
		{name: "lead destination busy", code: "lead_destination_busy", original: "internal lock details", status: http.StatusConflict, want: "O destino do lead está sendo alterado em outra sessão. Aguarde e revise a coluna antes de tentar novamente."},
		{name: "public contact destination", code: "lead_intake_destination_unavailable", original: "internal tenant reference details", status: http.StatusServiceUnavailable, want: "Não foi possível receber o contato neste momento. Tente novamente mais tarde."},
		{name: "pipeline fallback queue busy", code: "round_robin_busy", original: "internal lock details", status: http.StatusConflict, want: "A fila está sendo alterada em outra sessão. Aguarde e revise o destino antes de tentar novamente."},
		{name: "operation", code: "property_operation_failed", original: "Unable to complete property operation.", status: http.StatusInternalServerError, want: "Não foi possível concluir a operação. Tente novamente."},
		{name: "inactive property location identity", code: "property_location_identity_conflict", original: "internal unique violation", status: http.StatusConflict, want: "Já existe uma cidade, bairro ou condomínio com os mesmos dados, possivelmente desativado. Reative o cadastro existente ou use dados diferentes."},
		{name: "marketing schema", code: "marketing_schema_unavailable", original: "internal schema details", status: http.StatusServiceUnavailable, want: "A estrutura de dados de Marketing ainda não está disponível neste ambiente."},
		{name: "marketing capacity", code: "marketing_capacity_unavailable", original: "internal pool details", status: http.StatusServiceUnavailable, want: "O serviço de dados atingiu o limite temporário de conexões. Aguarde alguns instantes e tente novamente."},
		{name: "marketing timeout", code: "marketing_query_timeout", original: "internal timeout details", status: http.StatusServiceUnavailable, want: "A consulta de Marketing demorou mais que o esperado. Aguarde alguns instantes e tente novamente."},
		{name: "team in use", code: "team_in_use", original: "Team is used by a distribution queue.", status: http.StatusConflict, want: "Não é possível excluir esta equipe porque ela está sendo usada em uma fila de distribuição. Remova-a da fila antes de tentar novamente."},
		{name: "dynamic conflict", code: "round_robin_condition_conflict", original: `Esta condição já está na fila "Equipe A".`, status: http.StatusConflict, want: `Esta condição já está na fila "Equipe A".`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := userFacingErrorMessage(test.code, test.original, test.status); got != test.want {
				t.Fatalf("userFacingErrorMessage() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestUserFacingLeadPropertyUnavailableMessage(t *testing.T) {
	tests := []struct {
		name     string
		original string
		want     string
	}{
		{
			name:     "reserved",
			original: "Este imovel ja esta reservado. Consulte o administrador antes de marcar o lead como ganho.",
			want:     "O imóvel selecionado já está reservado. Consulte o administrador antes de marcar o lead como ganho.",
		},
		{
			name:     "sold",
			original: "Este imovel ja esta vendido e nao pode ser marcado como ganho.",
			want:     "O imóvel selecionado já está vendido. Confira o cadastro antes de marcar o lead como ganho.",
		},
		{
			name:     "rented",
			original: "Este imovel ja esta alugado e nao pode ser marcado como ganho.",
			want:     "O imóvel selecionado já está alugado. Confira o cadastro antes de marcar o lead como ganho.",
		},
		{
			name:     "draft",
			original: "Este imovel esta em rascunho e nao pode ser marcado como ganho.",
			want:     "O imóvel selecionado está em rascunho. Confira o cadastro antes de marcar o lead como ganho.",
		},
		{
			name:     "archived",
			original: "Este imovel esta arquivado e nao pode ser marcado como ganho.",
			want:     "O imóvel selecionado está arquivado. Confira o cadastro antes de marcar o lead como ganho.",
		},
		{
			name:     "unit reservation",
			original: "Este imóvel pertence ao espelho de um empreendimento. Faça a reserva pela unidade vinculada.",
			want:     "Este imóvel está vinculado a uma unidade de empreendimento. Faça a reserva nessa unidade.",
		},
		{
			name:     "unit release",
			original: "Este imóvel pertence ao espelho de um empreendimento. Reabra a disponibilidade pela unidade vinculada.",
			want:     "Este imóvel está vinculado a uma unidade de empreendimento. Reabra a disponibilidade nessa unidade.",
		},
		{
			name:     "concurrent edit",
			original: "O imóvel de interesse está sendo alterado. Aguarde e tente novamente.",
			want:     "O imóvel de interesse está sendo alterado. Aguarde e tente novamente.",
		},
		{
			name:     "unsafe detail attached to known reason",
			original: "Este imovel ja esta vendido e nao pode ser marcado como ganho. SQLSTATE 23514 em public.properties",
			want:     "Não foi possível concluir a operação com este imóvel. Confira o cadastro do imóvel e tente novamente.",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := userFacingErrorMessage("lead_property_unavailable", test.original, http.StatusConflict); got != test.want {
				t.Fatalf("userFacingErrorMessage() = %q, want %q", got, test.want)
			}
		})
	}
}

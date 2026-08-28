package users

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthAdminClientDeleteUser(t *testing.T) {
	t.Parallel()

	const userID = "11111111-1111-4111-8111-111111111111"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodDelete {
			t.Errorf("method = %q, want %q", request.Method, http.MethodDelete)
		}
		if request.URL.Path != "/auth/v1/admin/users/"+userID {
			t.Errorf("path = %q, want auth admin user path", request.URL.Path)
		}
		if request.Header.Get("apikey") != "sb_secret_users_test" {
			t.Errorf("apikey header was not sent")
		}
		if request.Header.Get("Authorization") != "" {
			t.Errorf("opaque Supabase secret must not be sent as Bearer authorization")
		}

		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := newAuthAdminClient(AuthAdminConfig{
		ProjectURL: server.URL,
		APIKey:     "sb_secret_users_test",
	})

	if err := client.deleteUser(context.Background(), userID); err != nil {
		t.Fatalf("deleteUser() error = %v", err)
	}
}

func TestAuthAdminClientDeleteUserReturnsProviderError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, `{"message":"provider unavailable"}`, http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client := newAuthAdminClient(AuthAdminConfig{
		ProjectURL: server.URL,
		APIKey:     "service-key",
	})

	err := client.deleteUser(context.Background(), "11111111-1111-4111-8111-111111111111")
	if !errors.Is(err, ErrAuthAdminOperation) {
		t.Fatalf("deleteUser() error = %v, want ErrAuthAdminOperation", err)
	}
}

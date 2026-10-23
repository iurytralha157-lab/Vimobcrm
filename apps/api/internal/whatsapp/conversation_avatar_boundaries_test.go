package whatsapp

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

func TestConversationAvatarSigningStaysOutsideOperationalMessageReads(t *testing.T) {
	cases := []struct {
		file, method string
		signs        bool
	}{
		{"handler.go", "ShowConversation", true},
		{"handler.go", "ShowConversationSnapshot", true},
		{"repository.go", "listConversationsPage", true},
		{"message_operations.go", "listLeadHistoryConversations", true},
		{"conversation_start_operations.go", "StartConversation", true},
		{"conversation_start_operations.go", "FindConversation", true},
		{"repository.go", "GetConversation", false},
		{"repository.go", "GetConversationSnapshot", false},
		{"repository.go", "GetConversationForExpectedLead", false},
		{"message_operations.go", "SendMessage", false},
		{"message_operations.go", "findConversationForLead", false},
		{"outbound_status.go", "GetSendStatus", false},
	}
	for _, test := range cases {
		t.Run(test.method, func(t *testing.T) {
			file, err := parser.ParseFile(token.NewFileSet(), test.file, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			var found *ast.FuncDecl
			for _, declaration := range file.Decls {
				if method, ok := declaration.(*ast.FuncDecl); ok && method.Name.Name == test.method {
					found = method
					break
				}
			}
			if found == nil {
				t.Fatalf("missing method%s in%s", test.method, test.file)
			}
			signs := false
			ast.Inspect(found.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if selector.Sel.Name == "hydrateConversationAvatar" || selector.Sel.Name == "hydrateConversationAvatars" {
					signs = true
				}
				return true
			})
			if signs != test.signs {
				t.Fatalf("avatar signing=%v,want%v", signs, test.signs)
			}
		})
	}
}

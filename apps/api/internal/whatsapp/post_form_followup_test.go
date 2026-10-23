package whatsapp

import (
	"encoding/json"
	"os"
	"testing"
)

func TestWhatsAppPostFormSharedFixtures(t *testing.T) {
	contents, err := os.ReadFile("testdata/post_form_followup.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name    string `json:"name"`
		Content string `json:"content"`
		Want    bool   `json:"want"`
	}
	if err := json.Unmarshal(contents, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("shared post-form fixtures must not be empty")
	}
	for _, fixture := range cases {
		t.Run(fixture.Name, func(t *testing.T) {
			if got := isWhatsAppPostFormFollowUp(fixture.Content); got != fixture.Want {
				t.Fatalf("post-form classification = %v, want %v", got, fixture.Want)
			}
		})
	}
}

func TestIsWhatsAppPostFormFollowUp(t *testing.T) {
	const portugueseIntro = "Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa."
	const englishIntro = "Hi! I filled out your form and would like to learn more about your business."
	const portugueseFields = "\nNúmero de telefone: +55 11 00000-0000\nNome completo: Pessoa Exemplo"
	const englishFields = "\nPhone number: +1 202 555 0100\nFull name: Example Person"
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{
			name:    "Portuguese structured follow up",
			content: portugueseIntro + portugueseFields,
			want:    true,
		},
		{
			name:    "English structured follow up",
			content: englishIntro + englishFields,
			want:    true,
		},
		{
			name:    "CRLF blank lines and reverse field order",
			content: "\r\n" + englishIntro + "\r\n\r\nFull name: Example Person\r\nPhone number: +1 202 555 0100\r\n",
			want:    true,
		},
		{
			name:    "case accents and repeated whitespace",
			content: "  OLA!  PREENCHI\tSEU FORMULARIO E GOSTARIA DE SABER MAIS SOBRE SUA EMPRESA.\n  NUMERO  DE\tTELEFONE : +55 11 00000-0000\nNOME COMPLETO: Pessoa Exemplo  ",
			want:    true,
		},
		{
			name:    "decomposed accents and non breaking spaces",
			content: "Ola\u0301! Preenchi seu formula\u0301rio e gostaria de saber mais sobre sua empresa.\nNu\u0301mero\u00a0de telefone: +55 11 00000-0000\nNome completo: Pessoa Exemplo",
			want:    true,
		},
		{
			name:    "wrapped introduction",
			content: "Olá! Preenchi seu formulário e gostaria\nde saber mais sobre sua empresa." + portugueseFields,
			want:    true,
		},
		{
			name:    "additional structured form field",
			content: englishIntro + "\nEmail: example@example.invalid" + englishFields,
			want:    true,
		},
		{
			name:    "empty content",
			content: "",
		},
		{
			name:    "ordinary click to WhatsApp ad",
			content: "Olá! Vi o anúncio e gostaria de saber mais sobre o apartamento.",
		},
		{
			name:    "ordinary ad with structured identity",
			content: "Olá! Tenho interesse no anúncio." + portugueseFields,
		},
		{
			name:    "casual form mention",
			content: "Já preenchi seu formulário ontem. Podemos conversar?" + portugueseFields,
		},
		{
			name:    "Portuguese introduction alone",
			content: portugueseIntro,
		},
		{
			name:    "English introduction alone",
			content: englishIntro,
		},
		{
			name:    "missing phone field",
			content: portugueseIntro + "\nNome completo: Pessoa Exemplo",
		},
		{
			name:    "missing full name field",
			content: englishIntro + "\nPhone number: +1 202 555 0100",
		},
		{
			name:    "empty phone value",
			content: portugueseIntro + "\nNúmero de telefone: \t\nNome completo: Pessoa Exemplo",
		},
		{
			name:    "empty full name value",
			content: englishIntro + "\nPhone number: +1 202 555 0100\nFull name: \t",
		},
		{
			name:    "unstructured identity values",
			content: portugueseIntro + "\n+55 11 00000-0000\nPessoa Exemplo",
		},
		{
			name:    "inline identity is not structured lines",
			content: englishIntro + " Full name: Example Person; Phone number: +1 202 555 0100",
		},
		{
			name:    "quoted full template",
			content: "> " + englishIntro + "\n> Phone number: +1 202 555 0100\n> Full name: Example Person",
		},
		{
			name:    "quotation marks around template",
			content: "\"" + portugueseIntro + portugueseFields + "\"",
		},
		{
			name:    "fenced template",
			content: "```\n" + englishIntro + englishFields + "\n```",
		},
		{
			name:    "narration before template",
			content: "A mensagem automática era esta:\n" + portugueseIntro + portugueseFields,
		},
		{
			name:    "casual text after template",
			content: englishIntro + englishFields + "\nThis is an example of a message, not my form.",
		},
		{
			name:    "quoted fields after valid introduction",
			content: englishIntro + "\n> Phone number: +1 202 555 0100\n> Full name: Example Person",
		},
		{
			name:    "duplicate identity fields are ambiguous",
			content: englishIntro + englishFields + "\nFull name: Another Example",
		},
		{
			name:    "renamed identity labels are not known envelope",
			content: englishIntro + "\nPhone: +1 202 555 0100\nName: Example Person",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isWhatsAppPostFormFollowUp(test.content); got != test.want {
				t.Errorf("isWhatsAppPostFormFollowUp() = %v, want %v", got, test.want)
			}
		})
	}
}

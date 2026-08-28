# Página inicial

A rota autenticada `/inicio` é a entrada padrão do Vimob. Ela mantém o `AppLayout`
existente e carrega o conteúdo em camadas para não depender do Dashboard:

1. saudação, busca e atalhos são renderizados imediatamente;
2. atenção, tarefas e agenda são consultadas em paralelo conforme módulos e
   permissões do usuário.

Os cards editoriais permanecem desativados por `HOME_PAGE_SECTIONS.publications`.
O superadministrador pode preparar rascunhos, mas a Home não consulta nem
renderiza esse canal enquanto a chave estiver desligada.

## Responsabilidades

- `HomeScreen.tsx`: composição da página e controle de acesso dos atalhos;
- `HomeAssistant.tsx`: pesquisa determinística na ajuda e nos leads visíveis;
- `HomePublicationGrid.tsx`: cards editoriais configurados pela plataforma;
- `HomeFocusList.tsx`: prioridades reais do usuário;
- `home-catalog.ts`: atalhos e destinos internos permitidos.

Dados e validação ficam fora dos componentes:

- `hooks/home/`: React Query e composição do resumo operacional;
- `lib/api/home.ts`: cliente HTTP da Vimob API;
- `lib/validation/home.ts`: contratos Zod;
- `apps/api/internal/admin/home_publications.go`: autorização, consulta,
  armazenamento e busca na documentação.

## Administração

Superadministradores preparam os rascunhos em `/admin/home-content`. O editor
permite título, texto, CTA interno, layout, cor, ordem, período, público e imagem,
mas informa claramente que o canal está desativado.
Imagens são enviadas pelo backend para `site-images/platform/home/`; o browser
não recebe credenciais de Storage.

## Assistente de ajuda

A busca consulta artigos ativos pela API de ajuda e, em paralelo, a API de leads
com o mesmo escopo de organização e visibilidade já aplicado ao CRM. A interface
mostra no máximo três guias e quatro leads, aceita resposta parcial quando uma
fonte fica indisponível e nunca gera texto com IA.

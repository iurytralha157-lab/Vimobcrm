# Página inicial

A rota autenticada `/inicio` é a entrada padrão do Vimob. Ela mantém o `AppLayout`
existente e carrega o conteúdo em camadas para não depender do Dashboard:

1. saudação, busca e atalhos são renderizados imediatamente;
2. atenção, tarefas e agenda são consultadas em paralelo conforme módulos e
   permissões do usuário.

Há um único carrossel abaixo dos avisos críticos, alimentado pelas publicações
ativas configuradas pelo superadministrador. Imagens ocupam o slide inteiro,
preservam a proporção e não recebem texto sobreposto nem ação de clique; o título
é seu texto alternativo. Cada slide aceita uma arte de desktop e outra opcional
para celular (telas abaixo de 768 px), escolhida pelo navegador sem baixar as duas.
Sem uma arte mobile, a versão de desktop é usada em qualquer tela. A imagem mantém
sua altura natural, sem fundo sólido, altura mínima ou recorte imposto pelo slide.
Recomenda-se arte horizontal de 2070 × 228 px para desktop. Slides sem
imagem mantêm o conteúdo editorial existente e o filtro por acesso ao destino.
O backend aplica período e público-alvo a todos os slides, inclusive às imagens.
O carrossel avança automaticamente e pausa durante interação, aba oculta ou
preferência por movimento reduzido. Não há outro banner fixo sobre ele.

A arte institucional original permanece em `public/images/vimob-home-banner.svg`
e pode ser cadastrada como publicação na homologação; sua ordem e visibilidade
são gerenciadas pelo mesmo superadmin, sem depender de novo deploy.

## Responsabilidades

- `HomeScreen.tsx`: composição da página e controle de acesso dos atalhos;
- `HomeAssistant.tsx`: pesquisa determinística na ajuda e nos leads visíveis;
- `HomePublicationCarousel.tsx`: carrossel de novidades configuradas pela plataforma;
- `HomeFocusList.tsx`: prioridades reais do usuário;
- `home-catalog.ts`: atalhos e destinos internos permitidos.

Dados e validação ficam fora dos componentes:

- `hooks/home/`: React Query e composição do resumo operacional;
- `lib/api/home.ts`: cliente HTTP da Vimob API;
- `lib/validation/home.ts`: contratos Zod;
- `apps/api/internal/admin/home_publications.go`: autorização, consulta,
  armazenamento e busca na documentação.

## Administração

Superadministradores gerenciam os slides em `/admin/home-content`. O editor
permite imagens separadas de desktop e celular, título acessível, ordem, período e público; conteúdo editorial
sem imagem continua disponível. Os itens ativos são publicados na Página inicial.
Imagens são enviadas pelo backend para `site-images/platform/home/`; o browser
não recebe credenciais de Storage. Os arquivos ficam no Storage; URLs, ordem,
período e público ficam no banco. O editor só ativa um novo slide depois de salvar
todas as imagens selecionadas e permite repetir um upload que falhou sem criar
outra publicação ou reenviar a imagem já salva.

## Assistente de ajuda

A busca consulta artigos ativos pela API de ajuda e, em paralelo, a API de leads
com o mesmo escopo de organização e visibilidade já aplicado ao CRM. A interface
mostra no máximo três guias e quatro leads, aceita resposta parcial quando uma
fonte fica indisponível e nunca gera texto com IA.

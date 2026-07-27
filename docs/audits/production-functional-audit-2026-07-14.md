# Auditoria funcional de produção — 2026-07-14

## Objetivo

Este documento consolida, de forma sanitizada, as continuações 24 a 46 da
auditoria funcional executada em produção em 2026-07-14. Os 23 relatórios
intermediários e suas capturas foram retirados da raiz do repositório porque
não eram consumidos pela aplicação, fragmentavam o histórico e continham dados
visíveis do ambiente de produção.

Os achados abaixo representam o estado observado naquela data. Eles não devem
ser considerados pendentes ou resolvidos sem uma nova verificação.

## Rastreabilidade

Os relatórios brutos foram introduzidos nos commits históricos:

- `a2f3943ff` — `Release CRM access and agenda updates`;
- `8cab7cf33` — `Atualiza imoveis e auditoria de producao`.

As capturas permanecem no histórico remoto até que uma eventual sanitização do
histórico seja planejada e coordenada separadamente. Este resumo não contém
nomes, mensagens, endereços de e-mail ou outras informações observadas nas
telas de produção.

## Cobertura consolidada

| Continuação | Área principal |
| --- | --- |
| 24 | Financeiro |
| 25 | Imóveis |
| 26 | Agenda |
| 27 | Dashboard |
| 28 | Contatos |
| 29 | Pipelines |
| 30 | Conversas |
| 31 | Configurações |
| 32 | Gestão |
| 33 | Automações |
| 34 | Cabeçalho, perfil e notificações |
| 35 | Autenticação e recuperação de senha |
| 36 | Proteção de rotas sem autenticação |
| 37 | Administração da plataforma |
| 38 | Rotas auxiliares e integrações |
| 39 | Rotas públicas |
| 40 | Suporte e seleção de organização |
| 41 | Rotas dinâmicas com identificadores inválidos |
| 42 | Experiência mobile |
| 43 | Formulários de contatos |
| 44 | Detalhe de lead e contato |
| 45 | Tabelas de contatos |
| 46 | Filtros de contatos |

## Temas que exigem revalidação

### Permissões e exposição de ações

- acesso direto de perfil padrão a shells, modais ou rotas administrativas;
- opções de importação e exportação visíveis para perfil padrão;
- seletor de responsável e ações operacionais potencialmente amplos no detalhe
  de leads;
- ações administrativas críticas apresentadas sem uma etapa clara de
  confirmação;
- inconsistências entre o menu visível e o acesso por URL direta.

### Privacidade e retenção de evidências

- telas de conversas e administração exibiam informações reais do ambiente de
  produção;
- capturas de tela não devem ser usadas como documentação permanente no Git;
- qualquer nova evidência deve ser sanitizada e armazenada em local privado com
  prazo de retenção definido.

### Acessibilidade e experiência

- dialogs e overlays emitindo avisos por ausência de descrição acessível;
- redirecionamentos silenciosos ou mensagens pouco claras quando o acesso era
  negado;
- identificadores inválidos ignorados, abrindo formulários ou exibindo erros
  técnicos em vez de estados controlados;
- estados vazios ou incompletos durante carregamento e hidratação;
- navegação mobile sobreposta por prompts ou guias flutuantes.

### Comportamento e observabilidade

- avisos recorrentes de gráficos com dimensões inválidas;
- cards sem drilldown perceptível;
- filtros, seletores e controles sem feedback suficiente;
- páginas públicas ou auxiliares apresentando fallback genérico, conteúdo
  vazio ou erro técnico.

## Controles positivos observados

- validações obrigatórias impediram o avanço de alguns formulários vazios;
- parte das rotas administrativas bloqueou corretamente perfis sem permissão;
- configurações de empresa respeitaram permissões no cenário mobile testado;
- identificadores inválidos de organização permaneceram bloqueados em áreas de
  superadmin;
- rotas anônimas protegidas redirecionaram para autenticação.

## Próximos passos

1. Revalidar primeiro os temas de autorização e exposição de dados com os
   perfis `admin` e padrão.
2. Transformar somente achados reproduzidos em issues rastreáveis, com critério
   de aceite e sem anexos contendo dados reais.
3. Revalidar acessibilidade, rotas inválidas, estados de carregamento e mobile.
4. Decidir separadamente se o histórico remoto precisa ser sanitizado; essa
   operação reescreve commits e exige coordenação com todos os clones.
5. Manter relatórios futuros consolidados em `docs/audits/` e armazenar
   evidências temporárias fora do repositório.

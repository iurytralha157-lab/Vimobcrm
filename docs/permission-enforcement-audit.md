# Auditoria de permissoes

## Regra central

- Permissao de visualizacao define quais registros chegam ao cliente.
- `lead_operate` autoriza todas as alteracoes em um lead que ja esteja visivel.
- O backend repete a verificacao; esconder ou desabilitar um botao nao e a barreira de seguranca.
- Administradores, owners e superadministradores recebem `*`.
- Permissoes de gerenciamento implicam a permissao de visualizacao do mesmo modulo.

## Matriz por pagina

| Pagina ou fluxo | Visualizacao | Alteracao | Escopo aplicado | Estado |
| --- | --- | --- | --- | --- |
| Dashboard geral | `dashboard_view` | Somente leitura | proprio, equipe explicita ou organizacao | Protegido na rota, API e filtros |
| Dashboard do site | `dashboard_site_view` | Somente leitura | organizacao | Protegido na rota e API |
| Dashboard de campanhas | `dashboard_campaigns_view` | Somente leitura | organizacao | Protegido na rota e API |
| Pipeline | `lead_view_own`, `lead_view_team` ou `lead_view_all` | `lead_operate` | proprio, `team_id` liderado ou organizacao | Protegido na rota, consultas e mutacoes |
| Contatos | mesmas permissoes de leads | `lead_operate` | mesmo escopo do Pipeline | Protegido na rota, consultas e mutacoes |
| Conversas | `whatsapp_view` | `whatsapp_operate` | somente conversas de leads visiveis | Protegido na rota e em todos os endpoints |
| Conexoes WhatsApp | `whatsapp_view` | `whatsapp_manage` | organizacao | Protegido na interface e API |
| Agenda | `schedule_view` | `schedule_manage` | proprio, participantes e equipe; lead vinculado tambem precisa estar visivel | Protegido na rota e API |
| Imoveis | `property_view` | `property_manage` | escopo do modulo | Protegido nas rotas e API |
| Automacoes | `automations_view` | `automations_manage` | organizacao | Protegido nas rotas e API |
| Financeiro | `financial_view` | `financial_manage` | organizacao | Leitura e escrita separadas no backend |
| Gamificacao | `gamification_view` | `gamification_manage` | proprio ou organizacao conforme a operacao | Protegido na rota e API |
| Central de atencao | `attention_view` | item visivel + `lead_operate`; politicas exigem gestao | proprio, equipe ou organizacao | Protegido na rota, API e maquina de estados |
| Gestao de equipes | `team_view` | `team_manage` | equipes lideradas ou organizacao | Abas e backend filtrados |
| Distribuicao | sem acesso padrao de lider | `distribution_manage` | organizacao | Aba e backend protegidos |
| Configuracao de pipeline | leitura operacional para usuarios | `pipeline_manage` | organizacao | Mutacoes protegidas no backend |
| Tags globais | leitura para uso em leads | `tag_manage` | organizacao | Gestao protegida; aplicar tag usa `lead_operate` |
| Permissoes de usuarios | `permissions_manage` | `permissions_manage` | organizacao | Leitura, salvar e restaurar protegidos |

## Acoes no lead

Todas as acoes abaixo exigem que o lead esteja visivel e que o usuario tenha `lead_operate`:

- editar dados de contato e interesse;
- mover etapa, alterar status, ganhar, perder e reabrir;
- trocar ou remover responsavel;
- adicionar e remover tags;
- registrar feedback e atividades;
- anexar documentos;
- selecionar imovel, desde que `property_view` tambem esteja ativo;
- concluir cadencia e registrar resultado;
- ligar, iniciar contato e registrar primeiro atendimento.

Agendar, editar, concluir, comentar ou excluir compromisso exige tambem `schedule_manage`. Enviar mensagem, midia ou reacao exige `whatsapp_operate`.

## Importacao e exportacao

- Criacao manual: `lead_create`.
- Importacao em massa: `lead_import` e marcador de importacao validado pelo backend.
- Exportacao: `lead_export`, validada antes da consulta de exportacao.
- Exclusao: `lead_delete`, sempre limitada ao escopo visivel.

## `team_id` e rollout

A autorizacao ja prioriza o `team_id` explicito. Quando ele estiver nulo, o sistema usa temporariamente o responsavel e a composicao historica da equipe como compatibilidade.

A estrutura nullable de `leads.team_id` foi aplicada no projeto remoto Vimob em 16/07/2026, sem backfill. A verificacao posterior confirmou coluna UUID nullable, FK composta para impedir equipe de outra organizacao e indice parcial. Os `12.237` leads historicos permaneceram com `team_id` nulo. Antes do rollout do backfill:

1. gerar relatorio de candidatos ao backfill;
2. rejeitar casos ambiguos em vez de escolher uma equipe automaticamente;
3. aplicar em ambiente de teste;
4. validar contagens por equipe antes e depois;
5. liberar em producao de forma controlada;
6. manter rollback somente para os valores preenchidos pela migration.

## Testes

- Matriz unitaria de lead proprio, lead de equipe explicita, lead de outra equipe, leitura global e exclusao.
- Matriz de agenda para visualizar, gerenciar e impedir alcance global indevido.
- Contratos de importacao e exportacao.
- Escopo de conversas com `lead_view_own` negado e `team_id` explicito.
- Implicacoes entre permissoes de gerenciamento e visualizacao.

### Matriz E2E local

Os testes usam clones descartaveis dos perfis reais e nunca exigem senha nem alteram dados de producao:

| Persona | Perfil exercitado | Escopo principal |
| --- | --- | --- |
| Andre | administrador | organizacao completa |
| Andrezinho | lider | equipe liderada |
| Yuri Teste | usuario padrao | leads proprios |

A suite cobre 14 cenarios no Chromium:

- listar, abrir e editar leads como administrador, lider e usuario padrao;
- negar leitura e alteracao direta de lead fora do escopo, mesmo conhecendo o UUID;
- validar Dashboard, Pipeline, Contatos, Conversas, Imoveis, Gestao e Distribuicao por perfil;
- ocultar exportacao para nao administradores e negar a chamada correspondente na API;
- conceder `lead_export` individualmente ao usuario padrao, confirmar interface e API e restaurar o padrao;
- confirmar a navegacao administrativa dos tres perfis.

Resultado da revisao de 16/07/2026: `14/14` testes E2E, `86/86` testes TypeScript de contrato e validacao e todos os pacotes Go aprovados. `tsc --noEmit`, ESLint e o build de producao do Next.js tambem passaram. Um reset completo do Supabase local aplicou todas as migrations desde uma base vazia; nenhuma migration foi aplicada em producao.

## Segunda revisao

- `property_view` ficou estritamente de leitura; criar, editar, atribuir, alterar disponibilidade e excluir usam `property_manage` no front e na API.
- O papel `manager` nao concede mais atalhos ocultos em imoveis, configuracoes, politicas de atencao, equipes, agenda ou escopo global do WhatsApp. Vale sempre o conjunto efetivo resolvido para o usuario.
- Dashboard, IA, integracoes, site, cobranca, permissoes, usuarios, equipes, pipelines, distribuicao, tags e configuracoes de etapa receberam uma barreira adicional no roteador, alem dos guards internos.
- Os aliases antigos (`property_delete`, `property_assign` e similares) permanecem apenas para compatibilidade de dados e sao convertidos para as chaves canonicas.

Alguns jobs de notificacao ainda selecionam destinatarios administrativos por papel diretamente em SQL. A conversao desses destinatarios para permissoes efetivas deve acompanhar a migration de `user_permission_overrides`; nao deve ser liberada antes da tabela existir e do comportamento ser validado em ambiente de teste.

## Terceira revisao

- As mutacoes de leads, anexos, atividades e tarefas agora exigem a permissao funcional ja no roteador; o repositorio continua validando o escopo do registro.
- O backend de automacoes passou a usar somente `automations_view` e `automations_manage`; `automations_edit` ficou restrito aos testes de compatibilidade do alias.
- Configuracoes de organizacao, integracoes, IA, cobranca, site e imoveis deixaram de depender do cargo administrativo na interface.
- Uma permissao individual agora controla em conjunto o item de menu, a aba, os controles e as chamadas de dados correspondentes.
- `team_manage` concedido a um usuario que nao e lider libera a gestao global de equipes; lideres continuam limitados as equipes lideradas.
- Financeiro usa `financial_view` na navegacao e a configuracao da gamificacao usa `gamification_manage`.

## Quarta revisao

- O board, a paginacao de etapas e as contagens nao usam mais fallback direto para tabelas do Supabase quando a API falha.
- Pipelines e etapas tambem falham de forma fechada; timeout nao troca a consulta autorizada por uma leitura alternativa.
- Trocar ou impersonar uma organizacao recarrega o perfil completo pela API, incluindo permissoes, modulos e escopos da nova organizacao.
- A lista de organizacoes do usuario e a verificacao de superadministrador passaram a usar endpoints autenticados.
- Um teste de arquitetura impede novas consultas diretas de tabela nos clientes de pipeline e no contexto de autenticacao.

O E2E com administrador, lider e usuario padrao depende do Supabase local e de `.env.e2e.local`. Ele deve ser executado antes do rollout do banco.

## Quinta revisao

- O cache de consultas agora pertence a uma assinatura formada por usuario, organizacao, papel, permissoes, modulos e escopos liderados.
- Troca de organizacao, impersonacao ou alteracao do alcance recria o cliente de consultas e cancela requisicoes do contexto anterior.
- Alterar ou restaurar permissoes publica um sinal realtime sem dados sensiveis, direcionado ao usuario afetado.
- Ao receber esse sinal, a sessao afetada recarrega o contexto autenticado; a nova assinatura descarta imediatamente dados carregados com o acesso anterior.
- Os canais de gamificacao e WhatsApp ja permanecem limitados por organizacao; o inbox do WhatsApp usa topico privado e as chaves incluem usuario e assinatura de acesso.
- Rascunhos de cadastro de imovel passaram a ser separados por organizacao e usuario, inclusive durante a troca de contexto na mesma rota.

## Sexta revisao

- A suite E2E passou a criar uma organizacao, duas equipes, tres usuarios e leads proprio, de equipe e externo de forma deterministica e idempotente no Supabase local.
- A interface e a API foram exercitadas juntas; conhecer uma rota ou UUID nao permite contornar o escopo do perfil.
- Salvar e restaurar overrides individuais agora persiste o JSON de auditoria corretamente e publica o evento de alteracao de acesso.
- O barramento realtime de acesso foi montado globalmente e passou a reconectar quando o stream termina, sincronizando `/v1/me` ao conectar novamente.
- O teste de override aguarda tanto o contexto de permissoes quanto o perfil autenticado apos recarga, evitando validar uma tela ainda hidratada por snapshot antigo.
- O ambiente E2E usa diretorio de build isolado, API e frontend em portas proprias e preserva os servidores normais de desenvolvimento.

### Limites antes do rollout

- Enquanto existirem leads historicos com `team_id` nulo, o backend mantem o fallback temporario pela equipe atual do responsavel. A regra estrita de lider enxergar somente `team_id` explicito deve ser ativada apenas depois do relatorio, backfill controlado e conferencia dos casos ambiguos.
- A concessao e a restauracao foram comprovadas na API e na interface apos sincronizacao completa por recarga. O evento realtime e a reconexao possuem cobertura de backend, mas a atualizacao visual sem recarga ainda nao e um contrato E2E certificado.
- O Playwright registra avisos de dimensao inicial do Recharts e de LCP do favicon durante navegacoes rapidas. Eles nao alteraram os resultados de autorizacao, mas permanecem como divida de interface e performance.

## Setima revisao

- A rota direta `/settings/users/[id]` passou a exigir `permissions_manage` antes de montar a tela ou carregar seus dados.
- O E2E agora tenta acessar essa URL diretamente: administrador entra; lider e usuario padrao recebem bloqueio na pagina e `403` no endpoint correspondente.
- O agrupamento legado do editor de funcoes foi alinhado ao catalogo canonico (`team_manage`, `users_manage`, `permissions_manage`, configuracoes, distribuicao, pipelines e tags), eliminando chaves antigas que nao representavam o contrato atual.
- O `tenantContext` autenticado passou a ser a unica fonte de permissoes da interface; a copia paralela mantida no React Query foi removida para impedir estados divergentes.
- Carregamentos de perfil possuem controle de versao e eventos realtime de acesso sao processados em fila. Uma resposta antiga nao pode mais sobrescrever uma concessao ou restauracao mais recente.
- O ciclo de override foi repetido tres vezes consecutivas, alem da matriz completa, para validar que concessao e restauracao permanecem estaveis sob eventos proximos.
- A listagem organizacional de usuarios continua disponivel para seletores de responsavel, agenda, imoveis e automacoes. Ela ainda carrega e-mail e WhatsApp no contrato completo; separar um DTO publico resumido do DTO administrativo e um endurecimento de privacidade recomendado, mas exige migrar todos esses consumidores e nao altera o isolamento de leads comprovado nesta auditoria.

## Oitava revisao: cadastro de imoveis

- O formulario foi percorrido em criacao e edicao nas dez areas: proprietario, dados do imovel, localizacao, valores, caracteristicas, extras, midia e descricoes, publicacao, comissoes e dados confidenciais.
- Administradores criam e editam por padrao. Lideres e usuarios comuns com apenas `property_view` nao acessam as rotas de cadastro ou edicao e recebem `403` ao tentar gravar diretamente pela API.
- A concessao individual de `property_manage` foi testada para lider e usuario comum. Em ambos os perfis, a interface, o `POST` de criacao, o `PATCH` de edicao e a exclusao de limpeza respeitaram a permissao; o override foi removido ao final de cada cenario.
- Todos os campos monetarios aceitam agrupamento de milhar e centavos no formato brasileiro, por exemplo `1.500,80`. A edicao de um valor existente nao concatena mais o conteudo anterior e persiste o numero decimal correto.
- Upload de imagem principal e galeria, extras, dados de publicacao, comissao e campos confidenciais foram persistidos dentro do mesmo ciclo E2E.
- Os rascunhos continuam separados por organizacao e usuario, evitando que o cadastro incompleto de uma sessao apareca para outro perfil.

Resultado: `3/3` ciclos completos de perfil e `1/1` teste dedicado de moeda aprovados, incluidos na regressao geral de `14/14` cenarios E2E. TypeScript, `86/86` contratos, testes Go, ESLint, build de producao e `git diff --check` tambem passaram.

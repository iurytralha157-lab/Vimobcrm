# lib/api

Camada de acesso a APIs do frontend.

## Direcao da migracao

O frontend deve migrar chamadas de dominio para a Vimob API:

```txt
Frontend -> Vimob API -> Postgres
```

Supabase no browser continua permitido para Auth enquanto a migracao estiver em andamento.

## Client da Vimob API

`vimob-client.ts`:

- usa `supabase.auth.getSession()` para obter o access token;
- envia `Authorization: Bearer <token>`;
- envia `X-Organization-ID` quando o dominio exige organizacao ativa;
- usa `NEXT_PUBLIC_VIMOB_API_URL`, com fallback local para `http://localhost:8081`.

## Leads

`leads.ts` ja usa a Vimob API para:

- `getLeads`
- `getLead`
- `createLead`

Os hooks de leitura (`useLeads`, `useLead`) ja passam pela API nova.
`useCreateLead` tambem passa pela API nova: o backend valida payload, resolve pipeline/stage padrao, detecta reentrada por telefone, registra tags, atividades, auditoria, notificacoes in-app e vinculos com conversas WhatsApp.
`useUpdateLead` tambem passa pela API nova: o backend valida referencias, aplica permissoes por escopo, atualiza o lead e registra auditoria.
`useDealStatusChange` usa `PATCH /v1/leads/{id}`: o backend altera status, timestamps e atividades de status/venda.
`useDeleteLead`, `useAddLeadTag` e `useRemoveLeadTag` tambem passam pela API nova.
Movimentacao no funil usa `POST /v1/leads/{id}/move-stage` via `leadsAPI.moveLeadStage`, substituindo o RPC `move_lead_stage`.
Transferencia de responsavel usa `POST /v1/leads/{id}/assign` via `leadsAPI.assignLead`, substituindo o RPC `transfer_lead_assignee`.
Round-robin usa `POST /v1/leads/{id}/redistribute` via `leadsAPI.redistributeLeadRoundRobin`, substituindo o RPC `redistribute_lead_round_robin`.

`lead-enrichments.ts` e `pipeline-board.ts` usam a Vimob API para carregar o funil com tags, tarefas, meta ads, usuario responsavel, imovel de interesse, contagens por etapa e paginacao de colunas. O board deixa de montar essas consultas auxiliares no browser.

## Dashboard

`dashboard.ts` usa a Vimob API para:

- carregar KPIs e conversao de vendas;
- agregar funil por etapa;
- agregar fontes de leads;
- listar ranking de corretores;
- listar proximas tarefas;
- montar a evolucao temporal de ganhos, perdas e abertos.

`use-dashboard-stats.ts` agora e um hook fino sobre esse cliente, sem consultas diretas a tabelas no browser.

## Pipelines, stages e filas

`pipelines.ts` usa a Vimob API para:

- listar/criar/editar/deletar pipelines;
- listar/criar/editar/deletar colunas;
- reordenar colunas;
- vincular a fila padrao da pipeline.

`round-robins.ts` usa a Vimob API para:

- listar/criar/editar/deletar filas;
- criar/editar/deletar regras;
- adicionar/editar/remover membros.

Esses clientes mantem o formato legado em snake_case para os componentes atuais, enquanto a API HTTP usa camelCase.

## Imoveis

`properties.ts` usa a Vimob API para:

- listar e buscar imoveis;
- cadastrar imovel com codigo gerado no backend;
- atualizar imovel, incluindo regeneracao de codigo quando o tipo muda;
- excluir imovel com permissao validada no backend.

`property-catalog.ts` usa a Vimob API para:

- listar/criar tipos de imovel;
- listar/criar e semear caracteristicas padrao;
- listar/criar e semear proximidades padrao.

`property-locations.ts` usa a Vimob API para:

- listar/criar/remover cidades;
- listar/criar/remover bairros;
- listar/criar/remover condominios.

`property-images.ts` usa a Vimob API para:

- enviar imagem principal e galeria de imoveis via `multipart/form-data`;
- manter o bucket `properties` acessado apenas pelo backend, nunca pelo componente React.

`property-support.ts` usa a Vimob API para:

- buscar dados minimos do captador exibido no preview do imovel;
- buscar dominio/subdominio ativo usado pelo seletor de imoveis.
- buscar resumos de imoveis por id para cards de funil e analytics sem consultar `properties` direto no browser.

## Usuarios

`user-summaries.ts` usa a Vimob API para buscar apenas `id`, `name` e `avatar_url` de usuarios visiveis na organizacao ativa. O funil usa esse cliente para enriquecer cards de leads sem consultar `users` direto no browser.

Ainda pendente de migracao:

- outros dominios fora de Leads.

# Inventario da origem Supabase - 2026-08-13

Este snapshot foi levantado somente por leitura no projeto `Vimob`
(`iemalzlfnbouobyjwlwi`), organizacao `wotvbcgrnwsufendbfqx`, regiao
`us-west-2`. Ele nao contem valores de secrets, API keys, senhas, tokens nem
URLs privadas de conexao.

## Plataforma e volume

| Item | Snapshot |
| --- | ---: |
| Postgres | 17.6 |
| Banco fisico | ~184 GB |
| Schema `public` | ~182 GB |
| Storage | 72.627 objetos / 35.347.340.473 bytes (~32,92 GiB) |
| Buckets | 7 |
| Edge Functions ativas | 81 |
| Registros remotos de migration | 486 |

As maiores relacoes fisicas sao `whatsapp_webhook_inbox` (~111 GB, dos quais
~109 GB sao TOAST), `whatsapp_messages` (~39 GB) e
`chatbot_inbound_messages` (~31 GB). Transferir o projeto nao copia nem
reconstroi essas relacoes; ele apenas muda a organizacao proprietaria.

## Auth

| Item | Snapshot |
| --- | ---: |
| Usuarios | 183 |
| Identities por email | 183 |
| Refresh tokens | 13.291 |
| Sessoes | 526 |

A transferencia nativa preserva o mesmo Auth e as sessoes. Um restore para
outro projeto exige configurar manualmente Site URL, redirects, SMTP,
templates, providers, hooks e signing keys.

## Banco e seguranca

- 213 tabelas e 199 funcoes no schema `public`;
- 12 tabelas e 129 funcoes no schema `private`;
- 433 policies em `public` e 445 policies considerando tambem Storage e
  Realtime;
- 47 tabelas publicas com RLS ativo e nenhuma policy, intencionalmente ou por
  revisao pendente;
- 202 triggers;
- nenhuma trigger HTTP/Database Webhook encontrada;
- 8 extensoes ativas: `pg_cron`, `pg_net`, `pg_stat_statements`, `pg_trgm`,
  `pgcrypto`, `plpgsql`, `supabase_vault` e `uuid-ossp`.

## Realtime, cron e Vault

- duas publications, incluindo `supabase_realtime` com 9 tabelas de negocio;
- 12 cron jobs, 11 ativos;
- 6 cron jobs e uma funcao privada contem o project ref atual em URLs;
- 14 nomes de secrets no Vault foram inventariados, sem descriptografar ou
  exportar valores.

Essas referencias permanecem validas no Plano A, porque o `project ref` nao
muda. No Plano B elas precisam de rewrite seletivo.

## Storage

O bucket `whatsapp-media` representa aproximadamente 28,38 GB e `properties`
aproximadamente 6,80 GB. O restante esta distribuido entre os outros cinco
buckets. Uma copia database-only leva metadados de Storage, nao os bytes dos
objetos; por isso o fallback exige copia separada e verificacao por bucket.

## Estado versionado versus producao

O repositorio nao e uma reproducao completa da producao hoje:

- 58 de 73 migrations ativas e dezenas de fontes de Edge Functions aparecem
  como arquivos ainda nao versionados no worktree principal;
- o ledger local de migrations diverge dos 486 registros remotos;
- o manifesto local de Edge Functions esta desatualizado em relacao a pelo
  menos `asaas-create-charge` e `evolution-go-webhook`;
- configuracoes de Auth, SMTP, providers, project settings e valores de Edge
  secrets nao estao integralmente no Git.

Consequencia: nao executar `supabase db push` nem deploy em massa de Edge
Functions como parte da transferencia. Para o Plano A, congele deploys e
transfira o projeto intacto. A reconciliacao do repositorio deve ser um trabalho
posterior e independente.

## Itens ainda manuais no painel

Antes da janela, registrar sem copiar valores sensiveis:

- Owner/membros e ID da organizacao destino;
- plano, compute, disco, PITR, IPv4 e spend cap;
- GitHub Integration, Log Drains e project-scoped roles;
- Auth Site URL, redirects, SMTP, providers, hooks e templates;
- Custom Domain/DNS;
- callbacks de Meta, Evolution/WhatsApp, Google, Asaas, Vista e Imoview.

No acesso atual, somente a organizacao `Vimob` aparece. A organizacao destino
precisa ser criada pela nova conta e a conta executora precisa ser convidada
antes que o preflight final possa ser concluido.

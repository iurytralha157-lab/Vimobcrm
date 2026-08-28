# Migração emergencial do Supabase Vimob

Este diretório contém o material operacional para migrar o projeto gerenciado
`iemalzlfnbouobyjwlwi` para uma instalação self-hosted sem levar credenciais
para o Git.

## Snapshot de origem

Capturado em 2026-08-09 12:41 UTC:

- PostgreSQL 17.6;
- banco: 172.163.214.483 bytes (aprox. 160,3 GiB);
- Auth: 177 usuários;
- Storage: 7 buckets, 522.510 objetos e 242.773.678.474 bytes
  (aprox. 226,1 GiB);
- Edge Functions: 81 ativas;
- Cron: 12 jobs, 11 ativos;
- Vault: 14 segredos.

O computador de desenvolvimento tem somente 103 GiB livres. O dump não deve
ser executado nele. Faça a exportação diretamente no servidor de destino.

## Infraestrutura mínima para esta janela

Para a migração emergencial, use PostgreSQL 17 e reserve, no mínimo:

- 16 vCPU;
- 64 GiB de RAM;
- 1 TiB de NVMe quando o Storage usar um backend S3 separado;
- 2 TiB de NVMe quando os objetos também ficarem no mesmo host;
- backup externo fora do servidor.

Os valores acima são um piso operacional do Vimob, não os mínimos genéricos do
Supabase. O banco restaurado, o dump lógico temporário, índices e WAL precisam
caber ao mesmo tempo.

Use o Docker Compose oficial do Supabase e registre o commit exato instalado:

```sh
git rev-parse HEAD
```

Não acompanhe `master` automaticamente em produção. A pilha self-hosted está
em transição para PostgreSQL 17 e Envoy. Termine TLS em Caddy, Nginx ou Traefik
e mantenha somente a porta HTTPS pública.

Configuração de URL esperada, usando o domínio definitivo escolhido:

```dotenv
SUPABASE_PUBLIC_URL=https://supabase.vimobcrm.com.br
API_EXTERNAL_URL=https://supabase.vimobcrm.com.br/auth/v1
SITE_URL=https://app.vimobcrm.com.br
```

## Ordem de execução

### 1. Antes da janela de manutenção

1. Provisionar o host e o backend S3.
2. Instalar Docker, Compose, Supabase CLI atual, PostgreSQL client 17, `jq` e
   `rclone`.
3. Subir a pilha oficial vazia com PostgreSQL 17.
4. Gerar chaves novas e configurar SMTP, URLs e os secrets de
   `edge-functions.env.example` fora do Git.
5. Copiar `supabase/functions/_shared` e somente as funções listadas em
   `supabase/functions/production-manifest.json` para `volumes/functions`.
6. Instalar o roteador em `functions-main/index.ts` e o override
   `docker-compose.vimob-functions.yml`. Ele preserva `verify_jwt` por função.
7. Habilitar o endpoint S3 no self-hosted, gerar credenciais e iniciar a
   primeira cópia com `copy-storage.sh`.

O comando `supabase secrets list` devolve nomes e hashes, não os valores. Os
valores reais devem vir do cofre operacional/Portainer ou ser rotacionados nos
provedores antes do corte.

### 2. Janela de manutenção

1. Colocar o app em manutenção e interromper todos os writers: web, API Go,
   workers, Edge Functions, Cron, webhooks e sincronizadores.
2. Confirmar que a fila de entrada do WhatsApp não está crescendo.
3. Executar `dump-restore.sh` no host de destino.
4. Executar `copy-vault.sh`. O dump oficial exclui o schema `vault`; sem essa
   etapa, Google Calendar, Vista, Imoview e jobs privados quebram.
5. Executar `post-restore-rewrite.sql` para trocar as referências ao projeto
   antigo em seis Cron jobs e na função `private.invoke_google_calendar_worker`.
6. Executar novamente `copy-storage.sh` para trazer o delta dos objetos.
7. Reiniciar os serviços e executar `verify.sql`.

O banco recebe escrita durante o dump lógico. Por isso, depois do início do
dump final, a origem deve permanecer em manutenção até o cutover. Não faça
dual-write entre os dois bancos.

### 3. Cutover

Atualize ao mesmo tempo:

- `NEXT_PUBLIC_SUPABASE_URL` e a chave pública no build do Next.js;
- `SUPABASE_PROJECT_URL`, JWKS, issuer e chaves server-side da API Go;
- callbacks de Auth e OAuth;
- webhooks Meta, Evolution/WhatsApp, Google Calendar e Asaas;
- jobs e integrações que chamem `*.supabase.co`;
- DNS/Cloudflare do domínio do Supabase.

Os 177 usuários são preservados com seus hashes de senha, mas as sessões do
projeto gerenciado não são válidas com as novas chaves. Planeje logout e novo
login no primeiro acesso.

## Critérios obrigatórios de aceite

- `verify.sql` sem erro e contagens compatíveis com a origem congelada;
- 177 usuários em `auth.users`;
- 7 buckets e igualdade de contagem/tamanho no `rclone size`;
- download real de amostras dos 7 buckets;
- 81 funções presentes e regras JWT iguais ao manifest;
- 12 Cron jobs presentes, com 11 ativos e nenhuma URL do projeto antigo;
- 14 entradas do Vault, com `anon_key` substituída pela chave nova;
- login, reset de senha e convite por e-mail;
- recebimento de lead Meta;
- envio e recebimento WhatsApp, incluindo mídia;
- Google Calendar OAuth/sync/webhook;
- Asaas checkout/webhook;
- Vista e Imoview;
- Realtime do CRM;
- backup completo criado e restauração de teste validada.

Não desligue nem apague a origem manualmente. Mantenha o dump, os checksums e
uma cópia externa até o novo ambiente passar pelos testes.

## Referências oficiais

- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/self-hosting/restore-from-platform
- https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3
- https://supabase.com/docs/guides/self-hosting/self-hosted-functions


# Banco de homologação no Supabase Cloud

O destino deve ser um **projeto novo e independente**, com contas de teste,
arquivos sintéticos e credenciais próprias. Os scripts de inventário abaixo
funcionam offline: não conectam ao Supabase, não restauram SQL e não declaram
o banco pronto.

## Projeto de homologação criado

Em 2026-10-23 foi confirmado o projeto `vimob-homologacao`, organização
`vimob teste` (`snqyytbmmbfasotklrje`), plano Free, região São Paulo (`sa-east-1`).
A referência é `lfkfuhvjvqgwyikzcfep`; o painel e a API de gerenciamento
confirmaram `ACTIVE_HEALTHY`. Isso comprova o provisionamento da infraestrutura,
sem certificar a instalação do esquema ou o funcionamento do CRM.

- [Painel do projeto de homologação](https://supabase.com/dashboard/project/lfkfuhvjvqgwyikzcfep).
- [Alvo público validado, sem credenciais](../deploy/staging/supabase-target.json).
- [Leitura do catálogo Cloud, sem dados de usuários ou credenciais](../deploy/staging/cloud-catalog.json).

A inspeção remota usou somente metadados e consultas `SELECT` ao catálogo.
Confirmou PostgreSQL 17.11, papel `postgres` sem superuser, zero objetos de
domínio em `public`/`private`, leitura permitida de `auth.sessions` e publicação
`supabase_realtime` já existente e vazia. O relatório lista também permissões,
interfaces e extensões disponíveis; não houve instalação de extensões, grants,
policies, triggers ou migrations. Esses resultados não substituem o ensaio
do instalador Cloud com as permissões reais.

Para conferir o inventário local com esse alvo:

```powershell
node scripts/staging/cloud-baseline-readiness.mjs --target D:/Vimob/workspaces/vimob-crm/deploy/staging/supabase-target.json
```

O projeto novo foi criado separadamente; nenhuma conexão ou variável da produção
foi substituída. A instalação Cloud descrita abaixo continua pendente.

## Material existente e impedimentos

A baseline em `supabase/reconciliation/local-bootstrap/` representa 238
migrations canônicas. Na revisão de 2026-10-23 havia outras 20 migrations
posteriores; o comando abaixo recalcula o sufixo e confere seus hashes no lock.
O histórico permanece imutável. Não executar a cadeia histórica literalmente:
ela contém precondições de dados/cutovers que não existem em banco vazio.
Integridade no lock não certifica compatibilidade desses forwards com o Cloud;
essa revisão é um bloqueio separado no relatório.

Essa baseline local contém também a plataforma Supabase completa e seu executor
exige `supabase_admin` com superuser. O Cloud fornece `postgres` sem superuser
e mantém Auth/Storage sob papéis da plataforma. Portanto, **não executar o dump
completo nem o executor local contra o Cloud**. Também não copiar os wrappers
GraphQL, os corpos internos de `pg_net` ou as ACLs locais da plataforma.

O preparador gera uma projeção concreta por objeto: arquivo, linha, schema,
tipo, nome, proprietário e hash. Distingue objetos de aplicação, plataforma
preservada, overlays para revisão e extensões necessárias. Objetos, owners,
schemas e policies desconhecidos geram bloqueio explícito. Essa projeção é
inventário para construir o instalador; não é um pacote SQL executável.

## Gerar e revisar o plano

Na raiz do checkout:

```powershell
node scripts/staging/cloud-baseline-readiness.mjs
node --test scripts/staging/cloud-baseline.test.mjs
```

Para salvar o inventário completo, escolha um caminho novo fora do repositório:

```powershell
node scripts/staging/cloud-baseline-readiness.mjs --output C:/caminho-existente/plano-cloud.json
```

O comando recusa sobrescrever arquivo existente. A saída padrão traz somente
contagens e bloqueios. O JSON não inclui corpos SQL nem dados das tabelas.
`ready: false` significa que a instalação continua impedida, mesmo quando o
comando termina com sucesso. Erros de contrato/integridade encerram com código 1.

O alvo público já registrado pode ser fornecido com `--target`. Para outro
projeto de homologação autorizado, o contrato desse arquivo é:

```json
{
  "kind": "vimob-cloud-staging-target-v1",
  "environment": "staging",
  "projectRef": "SUBSTITUIR_PELA_REF_DO_PROJETO_NOVO",
  "supabaseUrl": "https://SUBSTITUIR_PELA_REF_DO_PROJETO_NOVO.supabase.co"
}
```

Esse arquivo não aceita outros campos, conexões ou segredos. A referência de
produção conhecida e URLs que não correspondam exatamente ao projeto novo são
recusadas. Um alvo válido apenas identifica a preparação: **não autoriza nem
prova compatibilidade, acesso remoto ou implantação**.

## Trabalho necessário antes da instalação

1. Conferir no projeto novo PostgreSQL, schemas nativos, extensões disponíveis
   e interfaces usadas pela aplicação. Não exigir igualdade de versão de todos
   os objetos internos da plataforma: as diferenças devem ser analisadas.
2. Derivar SQL somente de `public`/`private`, com owners `postgres` e ACLs de
   aplicação preservadas. Revisar separadamente `on_auth_user_created`, policies
   próprias de Storage/Realtime e a publicação `supabase_realtime`/suas tabelas.
   A publicação já pode existir no Cloud; não recriá-la cegamente.
3. Ensaiar instalação com permissões equivalentes às de `postgres`, sem elevar
   privilégios ou alterar o executor local. Conferir os grants necessários de
   leitura de `auth.sessions` usados pela API. A compatibilidade real dos
   overlays depende também das permissões específicas da plataforma Cloud.
4. Comparar catálogo projetado: owners, grants efetivos, funções, triggers,
   constraints, índices, RLS, policies e publicação. O hash atual inclui a
   plataforma local inteira e não certifica equivalência com o Cloud.
5. Carregar exclusivamente as cinco tabelas estáticas permitidas no manifesto;
   depois executar as migrations posteriores revisadas em ordem e registrar
   evidência própria. Não preencher o ledger canônico alegando execução do
   histórico representado pela baseline.
6. Criar buckets vazios com nomes/opções revisados, configurar Auth/redirects
   para o subdomínio de homologação e contas próprias. Publicar somente uma
   lista explícita de Edge Functions necessárias e com seus contratos JWT.
   Não copiar usuários, sessões, arquivos, Vault, cron jobs, outboxes ou tokens
   da produção. Os dados de referência não provisionam buckets nem usuários.
7. Validar login/convites, isolamento entre duas organizações, CRUD de teste,
   acesso a arquivos, sessão revogada e Realtime antes de liberar testes gerais.

## Destinatários e integrações

A preparação detecta literais de e-mail nas funções da baseline e nos forwards
sem reproduzir seus valores.
Na função `private.create_billing_payment_receipt_from_payment`, o literal está
no campo `support_email` do fallback do emissor usado no snapshot do recibo.
É um contato operacional embutido; sua presença não comprova destinatário nem
disparo de e-mail. Revisar e, quando necessário, sanitizar esse contato na
configuração derivada da homologação, preservando o arquivo canônico e seus
hashes. O relatório exige revisão do contexto e não considera esse campo uma
prova de envio externo. Endereços reservados de exemplo e sufixos JID do WhatsApp
não são classificados como e-mails operacionais.

Manter workers, cron e integrações externas sem credenciais até configurar
destinos próprios de teste. Desligar somente workers da API não demonstra que
triggers SQL, Edge Functions ou provedores não possam produzir efeitos externos.
O relatório não resolve esse isolamento e não permite remover seus bloqueios.

## Fontes e limites

- [Supabase: superuser e operações não suportadas](https://supabase.com/docs/guides/database/postgres/roles-superuser).
- [Supabase: ownership esperado em Auth e Storage](https://supabase.com/docs/guides/platform/permissions).
- [Supabase: restore, customizações Auth/Storage e Realtime](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
- [Fluxo canônico e bloqueio de db push](../supabase/README.md).
- [Baseline estritamente local](../supabase/reconciliation/local-bootstrap/README.md).

Os scripts locais de inventário não acessam um banco. Ainda faltam o exporter/instalador
Cloud específico e a validação real de compatibilidade. Não há modo
`apply`, conexão por `.env`, restauração de produção ou alteração de DNS neste fluxo.

# Homologação do banco no Supabase Cloud

Estado em 2026-10-23: **schema instalado e smoke SQL aprovado; liberação geral em HOLD**.
A aprovação do banco descrita aqui não certifica o CRM publicado.

## Projeto e evidências

- Projeto `vimob-homologacao`, referência `lfkfuhvjvqgwyikzcfep`.
- Organização `vimob teste` (`snqyytbmmbfasotklrje`), Free, São Paulo (`sa-east-1`).
- PostgreSQL 17.11; execução com `postgres` sem superuser.
- [Alvo público, sem credenciais](../deploy/staging/supabase-target.json).
- [Verificação atual de schema, fases e smoke SQL](../deploy/staging/cloud-verification.json).
- [Verificação dos buckets privados](../deploy/staging/cloud-storage-verification.json).
- [Catálogo inicial, anterior à instalação](../deploy/staging/cloud-catalog.json).
- [Painel do projeto](https://supabase.com/dashboard/project/lfkfuhvjvqgwyikzcfep).

Produção não foi alterada nem usada como fonte de usuários, objetos ou credenciais.

## Instalação comprovada

Foram aplicadas **15 fases da baseline derivada e 20 forwards canônicos**.
O ledger privado `vimob_cloud_staging.phase_history` possui 35 fases, ordinais
0–34, com hashes dos payloads correspondentes aos manifestos revisados.
A sentinela registra o projeto, a execução e a cadeia de origem.

A baseline `local-20261016-238-v1` representa 238 migrations históricas por
equivalência de estrutura. Não se declara execução literal dessas 238 migrations.
Os 20 forwards foram executados depois, em ordem, com seus corpos e precondições
preservados. As fontes, hashes e o histórico canônico continuam imutáveis.

O readback registra:

- 321 tabelas e 830 funções de domínio; nenhuma função de domínio com owner diferente de `postgres`.
- Nenhuma tabela pública sem RLS habilitada; isso, isoladamente, não certifica todas as autorizações.
- Fingerprint das cinco tabelas estáticas igual ao canônico: `private.queue_timezone_catalog`
  (1.196 registros), `public.admin_subscription_plans` (3), `public.available_permissions`
  (38), `public.help_articles` (30) e `public.home_publications` (4).
- Um registro estrutural em `private.queue_runtime_configuration_cursor`, criado pela cadeia.
- Zero usuários Auth, objetos Storage e entradas Vault no readback; `cron` ausente.
- Nenhuma Edge Function publicada no inventário realizado (`[]`).

Os objetos nativos de Auth, Storage e Realtime mantiveram seus owners da plataforma.
Não foram copiados usuários, sessões, arquivos, jobs, tokens ou conexões de produção.

Artefatos aplicados, fora do Git, em
`D:/Vimob/_safety/homologacao-20261023-070614/`: `cloud-trial-v2/` e
`cloud-forwards-v1/`. Os antigos `cloud-draft-v1/` e `cloud-trial-v1/` foram
invalidados antes de qualquer aplicação.

## Smoke e seus limites

O [smoke SQL](../scripts/staging/cloud-smoke.sql) passou com duas organizações
sintéticas, papéis reais, trigger Auth, sessão ativa/revogada, isolamento por
tenant, ACLs de atividades e policy/envio Realtime no banco. A transação foi
revertida; os dados sintéticos não permaneceram.

A primeira execução falhou porque o Realtime gerenciado ainda não tinha
partições de broadcast. Uma conexão pública pelo SDK oficial retornou
`SUBSCRIBED`; o serviço inicializou as partições nativas. Os mesmos bytes SQL
passaram no novo ensaio. Não houve DDL manual na plataforma nem enfraquecimento
do teste. A conexão pública não enviou mensagens da aplicação.

Continuam sem validação: Auth por HTTP, onboarding real, CRM publicado,
upload/download por aplicação e autorização de WebSocket privado. O smoke SQL
não substitui esses testes nem a comparação completa de definições e ACLs efetivas.

## Storage

Os três buckets privados core foram criados pela UI; o readback confirmou
`public=false`, limites e todos os MIMEs exatamente iguais à
[especificação local](../deploy/staging/storage-buckets.json). Permanecem vazios.

| Bucket core | Limite | Uso |
| --- | ---: | --- |
| `property-private` | 10.485.760 bytes (10 MiB) | Originais, plantas e documentos de imóveis |
| `whatsapp-media` | 52.428.800 bytes (50 MiB) | Também anexos manuais de Leads, mesmo com a integração desligada |
| `contract-documents` | 26.214.400 bytes (25 MiB) | Documentos de contratos |

A API de anexos manuais limita cada upload a 25 MiB; o bucket aceita até 50 MiB.
A especificação contém oito buckets canônicos. Os cinco restantes estão
pendentes: `avatars`, `logos`, `site-images`, `automation-media` e `properties`.
Esse último atende URLs legadas; o antigo upload de imóveis foi aposentado.

Criações futuras devem usar Storage API/UI, sem INSERT direto no schema
gerenciado. Configuração de bucket não comprova upload, download ou autorização
com sessão revogada; esses testes continuam pendentes.

## Segurança e liberação

**Manter HOLD para acesso geral até concluir a triagem de ACLs e advisors.**
Consultar a [revisão de segurança](staging-security-review.md) e o
[readback das permissões efetivas de RPC](../deploy/staging/cloud-rpc-grants.json).
O relatório contém quatro categorias WARN: visibilidade GraphQL para `anon`
e `authenticated`, e execução de funções SECURITY DEFINER por esses dois papéis.
Há também uma categoria INFO de RLS habilitada sem policy.

O catálogo confirmou `EXECUTE` efetivo de `anon` e `authenticated` em cinco
funções SECURITY DEFINER de owner `postgres`, incluindo
`public.cancel_disabled_automation_runtime(integer)`, de escopo global, e
`rebind_whatsapp_conversation_session(uuid,uuid)`. A variante
`rebind_whatsapp_conversation_session(uuid,uuid,text)` não permite execução
por esses dois papéis. Não houve execução funcional nem chamada HTTP dessas RPCs.
Esses caminhos e os grants herdados exigem triagem específica. Preservar ACLs
canônicas e aprovar o smoke não equivale a aprovar todas essas permissões.
Não remover bloqueios ou enfraquecer testes apenas para obter aprovação.

## Ferramentas e próximos passos

Os preparadores abaixo são offline e não contêm cliente remoto:

- `scripts/staging/cloud-baseline-readiness.mjs`: inventário e bloqueios locais.
- `scripts/staging/cloud-export.mjs`: draft derivado para ensaio local.
- `scripts/staging/cloud-export-promote.mjs`: preparação de fases Cloud com sentinela e hashes.
- `scripts/staging/cloud-forward.mjs`: preparação dos forwards com ordem e hashes verificados.

Por contrato, os manifestos offline sempre declaram `ready=false`.
Prontidão e resultados de execução ficam em evidências externas separadas;
os preparadores não consultam o projeto nem substituem esses relatórios.
SQL e manifestos de execução ficam fora do Git; cada fase é transacional e
registra sucesso no ledger somente junto do commit.

O [bootstrap de identidade](../scripts/staging/cloud-bootstrap-identity.sql)
é o registro do preparo inicial do projeto vazio. **Não o executar novamente**
no banco instalado. Não usar o dump completo, o executor local com superuser
ou `supabase db push` no Cloud. Não alterar migrations históricas nem preencher
o ledger canônico alegando execução do prefixo representado pela baseline.

Faltam a triagem de segurança, testes HTTP e de aplicação, WebSocket privado,
Storage por usuário real e a publicação isolada do CRM. Hospedagem, proxy,
subdomínio, redirects Auth e segredos próprios de homologação seguem pendentes.
O login do Portainer ainda precisa ser concluído para verificar a hospedagem.
Workers e integrações externas permanecem desligados e sem credenciais de produção.

Referências: [fluxo canônico do banco](../supabase/README.md),
[baseline local](../supabase/reconciliation/local-bootstrap/README.md) e
[revisão Cloud](staging-cloud-review.md).

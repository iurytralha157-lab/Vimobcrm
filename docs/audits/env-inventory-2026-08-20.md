# Inventário e contrato de ambientes — 2026-08-20

Este relatório não contém valores, fragmentos, hashes ou comprimentos de segredos.

## Resultado

- O workspace tinha 27 arquivos dotenv e 4 na raiz antes da limpeza.
- O estado final tem 12 arquivos dotenv no workspace e 3 na raiz.
- Os três arquivos da raiz são `.env.local`, `.env.e2e.local` e `.env.example`.
- `.env.local` tem 54 chaves únicas, sem valores vazios. `DATABASE_URL` ainda contém um placeholder e não deve ser tratado como credencial real.
- `.env.e2e.local` tem 7 chaves únicas.
- `.env.example` tem 134 chaves e é o contrato versionado, sem segredos reais.
- Não restou nenhuma cópia `.next*/standalone/.env`.

## Responsabilidade de cada ambiente

| Fonte | Responsabilidade | Deve conter segredo real? |
|---|---|---|
| `.env.local` | desenvolvimento local | sim, somente local e ignorado |
| `.env.e2e.local` | E2E isolado | sim, somente ambiente descartável |
| `.env.example` | nomes, defaults e documentação | não |
| Portainer `stack.env` | Web/API de produção | sim, fora do Git |
| GitHub Actions secrets/vars | valores públicos incorporados no build e credenciais de build | sim, fora do Git |
| Supabase Secrets / `.env.functions` no servidor | Edge Functions | sim, fora do Git |

Os valores `NEXT_PUBLIC_*` são incorporados à imagem Web durante o build. Alterá-los apenas no Portainer depois do build não altera o bundle publicado.

## Comparação com a captura do Portainer

A captura contém 57 nomes. No estado final de `.env.local`, 31 desses nomes existem e 26 não existem. Isso não deve ser corrigido copiando todos para o arquivo local: imagens, domínios, portas e Traefik pertencem ao ambiente de implantação.

A captura não contém quatro valores exigidos pelo stack atual:

- `API_TRUSTED_PROXY_CIDRS`
- `BILLING_EDGE_CLIENT_IP_SIGNING_SECRET`
- `PUBLIC_SIGNUP_RECOVERY_SECRET`
- `SUPABASE_SECRET_KEY`

Além disso, `RESEND_WEBHOOK_SECRET` aparece apenas como placeholder. O `.env.local` possui `SUPABASE_SECRET_KEY`, mas ainda faltam localmente as duas imagens e os outros quatro itens necessários ao prebuilt stack. Portanto, nem a captura isolada nem o arquivo local isolado comprovam um ambiente de produção completo.

Outras lacunas relevantes:

- `DATABASE_URL` local ainda é placeholder.
- `GRUPO_OLX_WEBHOOK_SECRET` não está provisionado; a integração permanece opcional/fail-closed.
- O stack Web/API não prova os segredos das Edge Functions.
- `deploy/supabase-self-hosted/.env.functions` é referenciado pelo compose, mas não existe no workspace.
- O template Edge documenta 61 nomes e continua majoritariamente vazio.
- `META_APP_SECRET` aparece na captura, mas não há comprovação de `META_APP_ID`; o OAuth Meta não está completo só com esse valor.

## Limpeza aplicada

- Removido o `.env` raiz redundante e conflitante.
- Removidas 14 cópias geradas de `.env` dentro de artefatos standalone.
- Removidos de `.env.local` aliases vazios, duplicados ou enganosos:
  - `DIRECT_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` quando era apenas duplicata de uma chave moderna `sb_secret_`
  - `SUPABASE_JWT_SECRET` vazio, pois o runtime usa JWKS
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, não consumida pelo stack atual
- Adicionado `NOTIFICATION_DISPATCH_WORKER_ENABLED=false` como default local fail-closed.
- Valores com cifrão literal agora são serializados com escape compatível com Next e com o carregador Go.
- `.codex-tmp`, `.codex-worktrees`, `.cache` e `.next-*` foram excluídos do Git e do contexto Docker.
- Cinco flags operacionais existentes passaram a ser encaminhadas pelos dois stacks:
  - `AUTOMATION_RUNTIME_WORKER_ENABLED`
  - `PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED`
  - `PROPERTY_PUBLICATION_WORKER_ENABLED`
  - `ASAAS_RECONCILIATION_ENABLED`
  - `META_WEBHOOK_WORKER_ENABLED`

O arquivo `.codex-tmp/app-cutover/cutover-env.template` foi isolado do Git/Docker, mas preservado porque contém três valores privilegiados conflitantes com o estado local. Ele não deve ser usado como fonte canônica sem validação externa.

## Segurança

A captura expõe credenciais completas. Elas devem ser consideradas comprometidas e rotacionadas de forma coordenada depois de instalar os novos valores em todos os consumidores:

- banco de dados;
- Supabase privilegiado;
- Resend;
- OpenAI;
- Asaas;
- Evolution;
- Meta;
- VAPID privado;
- token interno de IA.

Não revogar primeiro: instalar os novos valores, publicar/canariar Web, API e Edge compatíveis, confirmar saúde e somente então revogar os anteriores.

## Gates executados

- normalizador idempotente e sem impressão de valores;
- carregamento Next preservando cifrão literal;
- testes Node de higiene e release: 9/9;
- testes Go de configuração;
- ESLint focado;
- parsing dos dois YAMLs;
- `docker compose config` dos dois stacks com placeholders deliberados para os segredos ainda ausentes.

## Conclusão

O repositório está mais limpo e possui uma fonte local canônica, mas o ambiente real de produção ainda não está completo nem verificável. Os valores faltantes precisam ser obtidos nos respectivos provedores/servidor e instalados por canal seguro; não devem ser inventados nem copiados de uma captura exposta.

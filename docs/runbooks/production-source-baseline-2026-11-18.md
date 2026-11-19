# Baseline de código da produção — 18/11/2026

A `main` foi reconciliada com o código efetivamente publicado na API e no Web,
preservando os registros do cutover de banco já aplicado. Esta reconciliação
não realizou deploy, migração, replay de fila nem alteração de configuração.

## Imagens observadas

Conferência por SSH no host `vimob-app-prod-01`, serviço Docker Swarm e estado
dos contêineres, além dos endpoints públicos `/readyz` e `/login`:

| Serviço | Commit | Digest | Estado observado |
| --- | --- | --- | --- |
| API | `e255df7e60150c1ccbd88fe43238ba2b9b52af53` | `sha256:cae617acc923bf732e9559aa3cabc42c024e828f4df1f6ca170b284ed25f9d91` | 2/2 healthy |
| Web | `e8a7f35c7daf24669489441234edc73557879935` | `sha256:6c1d7449ca5c7f700672142094d9f8910187e0800a3abf8f162a4714ada668f7` | 1/1 healthy |
| Bridge | `13187c03ea7665612ce85cc141af27aeb66b4ad6` | `sha256:7e683b9a464ec0af99239a089c0ae6bf477640b5fb4ae6b55687b8210f9a6a0f` | 2/2 healthy |

Os três serviços apresentavam `UpdateStatus=completed`. Esta tabela é um
registro da conferência, não uma afirmação permanente sobre o ambiente.

## Conteúdo da main

O código da API, suas dependências, Dockerfiles, frontend, contratos e
migrations vêm da árvore `e255df7e`. O frontend dessa árvore é idêntico ao
publicado em `e8a7f35c`: as diferenças entre os dois commits ficam em
`apps/api/`, `.env.example` e `docs/runbooks/whatsapp-inbox.md`.

Quatro artefatos de `db4e3542` foram mantidos, pois registram uma alteração
ativa do banco que é posterior à árvore de código da API:

- `supabase/cutovers/20261117_prefilter_notification_blocked_push_claim.sql`
- `scripts/tests/notification-claim-prefilter.local.mjs`
- `docs/runbooks/notification-claim-prefilter-2026-11-17.md`
- `docs/runbooks/notification-claim-prefilter-2026-11-17.validation.json`

Em 18/11, às 20:59:36 no horário de São Paulo, uma consulta de catálogo em
transação somente leitura no host dono do banco confirmou o MD5 normalizado
do corpo de
`private.claim_notification_deliveries(text,integer,interval,text[])`:
`5745e185e04aeafdde8d0486bed3de60`, igual ao postimage desse cutover. A função
não foi executada pela conferência.

A reconciliação é descendente da `main` remota anterior `db4e3542` e preserva
seu histórico. As mudanças de fila presentes nessa versão e ausentes da API
publicada deixam de fazer parte do runtime desta baseline. Sua recuperação
continua possível pelo histórico; não devem voltar incidentalmente numa imagem.

## Diferença da bridge e próxima publicação

A bridge usa o mesmo executável completo da API, em uma imagem anterior.
Desligar seus workers de fundo não demonstra equivalência de todos os caminhos
de ingresso. Portanto, a baseline representa o código da API e Web atuais;
ela não significa que os três binários publicados tenham o mesmo SHA.

Gerar uma imagem a partir da nova `main` atribui um SHA novo ao mesmo código
da API/Web. Instalar essa imagem na bridge é uma mudança de versão e exige
validar seu ingresso e encaminhamento separadamente. Preserve suas flags e
imagens até uma publicação explicitamente autorizada.

O workflow versionado publica imagens no GHCR depois dos gates, incluindo a
tag `latest`, e não contém passo de deploy. A operação de limpeza não mudou
nenhuma referência de imagem no Swarm. A próxima publicação deve conferir
novamente o ambiente, os digests e a compatibilidade do banco conforme
[deploy-portainer.md](../deploy-portainer.md) e
[whatsapp-inbox.md](whatsapp-inbox.md).

## Checkouts, recuperação e reversão

O checkout canônico permanece em `D:\Vimob\workspaces\vimob-crm`, branch
`main`. O backup local da limpeza fica em
`D:\Vimob\backups\production-alignment-20261118`, com instruções no README,
bundles Git, patches e arquivos locais dos checkouts removidos. Ele inclui
trabalho não publicado e configurações privadas e não deve ser enviado ao Git.

Para recuperar trabalho antigo, consulte o manifesto desse backup e restaure
somente o checkout ou branch necessário em um destino escolhido. Para desfazer
a reconciliação da `main`, use um novo commit de reversão após conferir a
versão desejada; não reescreva o histórico remoto. Uma reversão de código não
reverte o banco nem altera imagens já em execução.

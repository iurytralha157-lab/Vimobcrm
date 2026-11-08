# Conexões de Marketing

Login somente leitura usado pela dashboard de Marketing para puxar campanhas,
mídias e dados sociais. Fica em `apps/api/internal/marketing`, separado da
entrada de leads.

## Regras que protegem a entrada de leads

`apps/api/internal/marketing/contract_test.go` falha se alguma for quebrada.

- Não lê nem grava `meta_integrations`, `meta_oauth_flows` ou tabelas de lead.
- Não importa os pacotes `meta`, `leads`, `webhooks` e `publicingress`.
- O cliente da Graph API só envia GET, então não altera `subscribed_apps`.
- Desconectar só apaga o login no CRM. Nunca chamar `DELETE /me/permissions`:
  isso retira o app da conta da pessoa, inclusive o acesso usado pelos leads.
- Não pede `leads_retrieval`, `pages_manage_*`, `ads_management` nem
  `business_management`, e nunca pede nem guarda token de Página.

## Sincronização

`MarketingSyncService.SyncConnection` reaproveita o importador de fatos, grava sem
`integration_id` e não atualiza `meta_integrations`. O botão Sincronizar antigo
continua gravando nessa tabela: use-o só onde a integração de leads já o usa.

## Rotas

Todas exigem o módulo `campaigns` e a permissão de integrações, menos o callback.

| Rota | Função |
| --- | --- |
| `GET /v1/marketing/connections` | Lista conexões e ativos, sem token |
| `POST /v1/marketing/connections/meta/start` | Devolve a URL de login |
| `PUT /v1/marketing/connections/{id}/assets` | Escolhe os ativos usados |
| `POST /v1/marketing/connections/{id}/sync` | Importa os dados, até 90 dias por chamada |
| `DELETE /v1/marketing/connections/{id}` | Esquece o login no CRM |
| `GET /v1/public/marketing/oauth/meta/callback` | Conclui o login |

O callback é público para receber o retorno da Meta. Ele valida um `state` de
uso único, com validade de 10 minutos, antes de chamar a Meta. O trabalho tem
limite de 60 segundos e a resposta leva só um status e um código de erro.

## Variáveis

Ficam em `.env.example`. Sem elas, o recurso fica desligado.
`MARKETING_CONNECTIONS_ENABLED_ORGS` libera por organização.

As variáveis são separadas de `META_APP_ID`. Na homologação, preencha só as de
Marketing: o OAuth de leads continua desligado e nada desconecta uma Página real.

A tela fica em Configurações > Integrações > Meta Marketing.

## Homologação

1. Aplicar `20261104120000_add_marketing_connections.sql` no banco de homologação.
2. Cadastrar no app da Meta o callback
   `https://api-homologacao.vimobcrm.com.br/v1/public/marketing/oauth/meta/callback`.
3. No Portainer, preencher as variáveis `MARKETING_*`, com a organização de teste.
4. Em Integrações > Meta Marketing, entrar, escolher os ativos e sincronizar.

## Reversão

Esvaziar `MARKETING_CONNECTIONS_ENABLED_ORGS` desliga o recurso sem novo deploy
de imagem. Para remover os dados, apagar `marketing_connections`,
`marketing_connection_assets` e `marketing_oauth_flows`, além dos segredos
`marketing-connection:%` do Vault.

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

Na conexão dedicada, os Insights do período são lidos antes dos detalhes dos
anúncios e criativos. O erro de sincronização é exibido separadamente da
validade do login. Um limite informado pela Meta encerra as requisições
pendentes da conta e interrompe os demais intervalos daquela tentativa.

A dashboard consulta os fatos já gravados. Para importar datas antigas,
selecione o período no Marketing e use **Sincronizar período**. A interface
envia janelas consecutivas de até 30 dias na conexão dedicada. A mesma data
atualiza o fato existente. Se a Meta interromper uma janela, as anteriores
continuam disponíveis. O aviso de cobertura mostra as datas com registros,
que podem incluir dias sem veiculação entre a primeira e a última data.

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
Em produção, `MARKETING_META_ASSET_ALLOWLIST` é obrigatório para cada organização liberada.
Ele recebe um objeto JSON com os UUIDs das organizações e as chaves dos ativos permitidos.
Use IDs da Meta sem `act_` e inclua a página vinculada ao Instagram.

```json
{"11111111-1111-4111-8111-111111111111":["ad_account:101","page:202","instagram_account:303:202"]}
```

Com a lista por organização, o login consulta diretamente as contas de anúncios
e as páginas aprovadas. O Instagram só é disponibilizado se a Meta o devolver
vinculado à página autorizada e se o par constar na lista. Escolha contas de
anúncios exclusivas da organização porque a sincronização carrega os dados da
conta inteira.

As variáveis são separadas de `META_APP_ID`. Na homologação, preencha só as de
Marketing: o OAuth de leads continua desligado e nada desconecta uma Página real.

A tela fica em Configurações > Integrações > Meta Marketing.

O cartão usa a disponibilidade `enabled` e `meta_configured` da mesma listagem
de conexões usada pela página de gestão. Sem liberação da organização ou sem
configuração do app, a ação de configurar fica indisponível com o motivo
exibido. Erros de consulta continuam com status indisponível e retentativa.
O módulo `campaigns` e a permissão de integrações são exigidos também para
consultar esse status no catálogo. A autorização permanece na API.

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

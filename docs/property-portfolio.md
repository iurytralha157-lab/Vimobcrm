# Carteira de imóveis e configurações de carteira

Migration: `supabase/migrations/20261105120000_add_property_portfolio_and_settings.sql`
(aplicar antes da API, que passa a ler as colunas; a API anterior continua funcionando).

## Classificação do imóvel

`properties.portfolio_type` vale `ready`, `launch` ou `third_party`.

- `launch` acompanha a modalidade Lançamento. Um gatilho classifica quem omite o campo
  (API anterior, importações). A API recusa `launch` sem Lançamento e `ready` com Lançamento.
- `third_party` exige `third_party_kind`. `partner` exige `partner_name` e aceita
  `partner_contact`; `private_owner` usa os campos de proprietário.
- Sair de `third_party` limpa os dados de terceiros. Um update que omite esses campos não os altera.

Privacidade: `partner_contact` segue a regra de `property_owner_contact_visibility`. Quem não
pode vê-lo não o recebe, não consegue alterá-lo e não consegue apagá-lo.
`commission_split_percent` e `third_party_authorized_until` são campos internos, como as
comissões: só gestores os recebem e alteram.

## Configurações

`GET` e `PUT /v1/properties/settings/portfolio`, tabela `property_settings`.

**Estas configurações são apenas gravadas nesta versão.** Nenhuma delas altera publicação,
edição, chaves ou comissão. As duas configurações que já têm efeito (política de edição e
visibilidade do contato do proprietário) continuam em `PATCH /v1/settings/properties`.

As chaves, tipos, faixas e valores padrão estão em
`apps/api/internal/properties/portfolio_settings.go`, com espelho em
`lib/validation/property-portfolio-settings.ts`.

## Histórico de chaves

`GET /v1/properties/{id}/keys/movements`. A custódia física é visível só para gestores, como
no workspace; os demais recebem página vazia com `meta.can_view_key_custody = false`.

## URLs de fotos

Fotos não confidenciais usam URL assinada de 2 horas, reaproveitada enquanto restarem mais de
70 minutos. Assim a miniatura não expira com a lista em cache e o navegador não baixa a foto de
novo a cada atualização. Uma URL já entregue continua válida até expirar, mesmo que a foto mude
de visibilidade depois. Documentos e fotos confidenciais continuam com 90 segundos, sem reuso.

## Telas

Rotas `/properties/ready` e `/properties/third-party` listam por `portfolio_type`, com as mesmas
permissões de `/properties`. O formulário não deixa montar um par recusado pela API: Lançamento
acompanha a modalidade (`property-form-portfolio.ts`). `?tab=responsibles` abre a aba Comercial.

Os cards não mostram cadastro %, leads, visitas e propostas porque `GET /v1/properties` não os
devolve. Contagem de fotos só aparece em galerias legadas: fotos em `property_assets` não têm
contagem nessa resposta.

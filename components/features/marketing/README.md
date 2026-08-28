# Marketing

O domínio combina fatos diários da Meta com o histórico canônico do CRM sem
consultas Supabase dentro dos componentes.

## Camadas

- `components/features/marketing`: navegação, estados e visualização.
- `hooks/marketing`: composição dos dados e estado da integração.
- `hooks/use-campaign-insights.ts`: contrato React Query com a API Go.
- `apps/api/internal/analytics`: agregação, último toque Meta e funil do CRM.
- `apps/api/internal/integrations`: OAuth, seleção segura de Página e conta
  de anúncios e sincronização da Graph API.

## Semântica

- Investimento, impressões, cliques e resultados reportados vêm dos fatos
  diários da Meta.
- Leads CRM usam o último toque Meta canônico dentro do período, definido antes
  de qualquer filtro de campanha.
- Respondidos usam fatos de contato efetivo; qualificados usam o histórico de
  entrada em uma etapa marcada com `is_qualified`; ganhos e perdidos usam os
  timestamps do negócio depois da entrada atribuída.
- O alcance pago exibido no período é a soma do alcance diário do escopo e não
  representa pessoas únicas entre dias.
- Valores monetários só são somados quando há uma única moeda; múltiplas moedas
  permanecem separadas no contrato de qualidade.

## Integração

Uma conexão pronta para Marketing exige Page token e long-lived User token em
segredos Vault distintos, além de ao menos uma conta de anúncios selecionada.
Conexões antigas continuam recebendo leads, mas devem ser reconectadas antes de
sincronizar Ads Insights.

As tabelas de fatos não têm acesso direto para `anon` ou `authenticated`. A UI
passa pela API Go e pela permissão `dashboard_campaigns_view`.

O aplicativo da Meta usa como callback público
`https://api.vimobcrm.com.br/v1/public/integrations/meta/oauth/callback`. As
ações autenticadas usam `POST /v1/integrations/meta/oauth/actions` e a
sincronização usa `POST /v1/integrations/meta/marketing/sync`; nenhuma dessas
operações passa por Edge Functions.

# Dashboard de Marketing — prontidão para produção

## Escopo canônico

O caminho suportado é único:

`Meta OAuth / Graph API -> API Go -> PostgreSQL normalizado -> /v1/analytics/campaign-insights -> abas de Marketing`

O navegador nunca recebe tokens da Meta e não consulta a Graph API diretamente. As Edge Functions Meta antigas são inventário aposentado e não podem permanecer roteáveis em produção.

## Contrato de cada aba

| Aba | Fonte real | Semântica |
| --- | --- | --- |
| Visão geral | fatos diários da Meta + atribuição e etapas do CRM | compara resultados reportados pela Meta com leads efetivamente atribuídos no CRM |
| Campanhas | campanha -> conjunto -> anúncio, agregados no período | resultados são eventos reportados pela plataforma; não representam pessoas únicas |
| Mídia | anúncios pagos agregados no período + conteúdo orgânico do Instagram | o pago respeita o período; o orgânico mostra o acumulado do conteúdo publicado no período até a última sincronização |
| Aquisição | fatos Meta + entrada, contato, resposta, qualificação e ganho no CRM | custo por lead usa leads atribuídos no CRM, não apenas o resultado reportado pela Meta |
| Social | Instagram profissional | métricas orgânicas de Página do Facebook ainda não fazem parte desta versão |

Filtros de conta, objetivo, campanha, conjunto e anúncio valem somente para dados pagos. Na aba Social apenas o período é aplicado; os demais filtros ficam preservados para quando o usuário retornar às abas pagas.

## Gates obrigatórios

O deploy só está apto quando todos os itens abaixo estiverem comprovados em homologação:

1. O histórico de migrations existe e corresponde aos objetos reais. Se `supabase_migrations.schema_migrations` não existir, não executar `supabase db push` nem marcar versões manualmente antes de comparar o schema com um clone ou PITR.
2. Migrations já aplicadas permanecem imutáveis. Toda evolução deve estar em uma nova migration aditiva.
3. A restrição `meta_integrations_access_token_vault_check` está validada e nenhuma integração conectada está sem referência no Vault.
4. As seis FKs das tabelas de Marketing possuem índices de suporte.
5. A API de produção usa um role que consegue ler e gravar as tabelas backend-only; `anon` e `authenticated` continuam sem grants diretos.
6. O App Meta está em modo Live, o callback é exatamente `/v1/public/integrations/meta/oauth/callback` e o webhook é exatamente `/v1/public/integrations/meta/webhook` na API Go.
7. A autorização devolve `ads_read` para mídia paga. Instagram orgânico requer também `instagram_basic` e `instagram_manage_insights`.
8. O token efetivo, incluindo `data_access_expires_at`, está válido. Token expirado ou sem `ads_read` deve desabilitar o sync e orientar reconexão.
9. As funções antigas `instagram-oauth`, `meta-campaign-insights`, `meta-messenger-proxy`, `meta-oauth`, `meta-token-healthcheck`, `meta-webhook` e `meta-webhook-replay` retornam 404 no ambiente implantado.
10. Duas solicitações simultâneas da mesma organização não executam reconciliações concorrentes.
11. O proxy aceita pelo menos 150 segundos para o sync manual e o cliente não encerra a requisição antes disso.
12. Existe decisão explícita sobre atualização: manual por administrador ou worker automático com lease, retry, alerta de atraso e janela retroativa.

## Diagnóstico somente leitura

Execute no SQL Editor do ambiente alvo. O bloco não altera dados:

```sql
begin read only;

select
  current_setting('server_version') as postgres_version,
  to_regclass('supabase_migrations.schema_migrations') as migration_history,
  to_regclass('public.marketing_performance_daily') as performance_table,
  to_regclass('public.marketing_media_assets') as media_table;

select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.meta_integrations'::regclass
  and conname = 'meta_integrations_access_token_vault_check';

select count(*) as connected_without_page_token_ref
from public.meta_integrations
where coalesce(is_connected, false)
  and access_token_secret_ref is null;

select
  page_name,
  coalesce(granted_scopes, array[]::text[]) @> array['ads_read']::text[] as ads_read,
  token_status,
  token_expires_at,
  nullif(btrim(ad_account_id), '') is not null
    or jsonb_array_length(coalesce(selected_ad_accounts, '[]'::jsonb)) > 0 as has_ad_account
from public.meta_integrations
where coalesce(is_connected, false)
order by updated_at desc;

rollback;
```

Nunca copie tokens, segredos do Vault ou `DATABASE_URL` para tickets, prints ou logs de validação.

## Prova funcional mínima

Use uma conta de homologação ou uma autorização real controlada:

1. Conectar uma Página e uma conta de anúncios pelo fluxo OAuth do Vimob.
2. Confirmar `ads_read` e executar sync de 7 dias.
3. Comparar investimento, impressões, cliques, formulários e conversas com o Ads Manager usando a mesma conta, timezone e janela.
4. Repetir em 30 dias. O card pago da aba Mídia precisa mudar; conteúdo orgânico pode permanecer igual porque é acumulado por publicação.
5. Abrir Campanhas e expandir campanha, conjunto e anúncio.
6. Confirmar que Leads no CRM contém somente leads atribuídos à dimensão Meta correspondente.
7. Revogar `ads_read` ou usar um token expirado em homologação: o sync deve ficar indisponível e a interface deve pedir reconexão.
8. Disparar duas sincronizações simultâneas: apenas uma pode possuir a execução da organização.
9. Confirmar que uma organização não enxerga contas, campanhas, mídias ou leads de outra.
10. Verificar que não existem erros no console, runs presos em `running` ou métricas pagas fora do período escolhido.

## Critério de liberação

"100%" significa que os gates e a prova funcional acima passaram no mesmo artefato que será implantado. Testes locais verdes, sozinhos, não comprovam permissões, volume, rate limit, configuração do App Meta nem o estado das migrations do banco de produção.

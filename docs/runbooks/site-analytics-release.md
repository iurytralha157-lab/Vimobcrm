# Release do analytics do site

Status atual: **HOLD para produção**. As mudanças foram validadas no banco
local, mas este roteiro não autoriza nem substitui a reconciliação do ledger
remoto descrita em `supabase/README.md`.

## Ordem obrigatória

1. Reconciliar e conferir o histórico remoto de migrations.
2. Fazer o preflight de tamanho, volume e locks de
   `public.site_analytics_events`. A criação do índice de `last_seen_at` não é
   concorrente e precisa de janela compatível com o volume real.
3. Aplicar, nesta ordem:
   - `20260906201339_lock_site_analytics_to_backend_gateway.sql`
   - `20260906210000_track_site_analytics_last_seen.sql`
4. Verificar a coluna e o índice de `last_seen_at`, ausência de policies diretas
   na tabela e CRUD somente para `service_role`.
5. Publicar um canário da API usando a tag imutável do commit.
6. Confirmar que um usuário autorizado recebe o resumo via API e que acesso
   direto pelo Data API continua negado.
7. Publicar o Web com exatamente o mesmo SHA da API.

A migration precisa anteceder a API nova: as escritas e consultas novas usam
`last_seen_at`. A API antiga tolera a coluna adicional, portanto migration-first
é a única ordem compatível durante o rollout.

A API nova também precisa anteceder o Web: o cliente atualizado envia
`gclid`/`fbclid` no contrato de tracking, e o decoder estrito da API antiga
recusa campos desconhecidos. No rollback, retirar o Web novo antes de voltar a
API.

## Rollback

- A API pode voltar para a imagem anterior mantendo as duas migrations.
- Não remover `last_seen_at` enquanto qualquer réplica da API nova estiver
  ativa.
- Não usar `latest` para coordenar o par Web/API; implantar os dois pelo mesmo
  SHA imutável.

## Gates antes de liberar tráfego

- Executar os pgTAP de boundary, `last_seen_at` e hardening.
- Fazer soak na carga esperada, acompanhando p95/p99, pool, CPU, WAL, locks,
  deadlocks, tuplas mortas, autovacuum e crescimento dos índices.
- Definir com produto/jurídico a base legal da coleta própria, retenção,
  granularidade geográfica e experiência de consentimento/revogação.

Sem essas evidências, build e testes locais aprovados não significam que o
dashboard está pronto para produção.

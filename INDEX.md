# Índice de documentação

## Comece aqui

1. `README.md`: instalação, execução local, gates e limites das evidências.
2. `ARCHITECTURE.md`: fronteiras atuais entre frontend, API Go e Supabase.
3. `QUICK_REFERENCE.md`: decisões rápidas para implementação.
4. `AGENTS.md`: regras obrigatórias para agentes que trabalham no repositório.

Não existe `.CLAUDE_SYSTEM_PROMPT.md` neste workspace. `AGENTS.md` é a fonte de
instruções versionada; `CLAUDE.md` apenas encaminha para ela.

## Produto e superfícies

- `docs/levantamento-funcional-vimob-crm.md`: inventário funcional e lacunas.
- `docs/audits/crm-surface-inventory.md`: rotas, overlays, formulários e CTAs
  gerados estaticamente.
- `docs/audits/home-design-debt-inventory.md`: inventário gerado da Home.

Os arquivos em `docs/audits/` são artefatos gerados e devem ser atualizados
pelos scripts em `scripts/audits/`, nunca ajustados manualmente para mascarar
uma divergência.

## Backend e contratos

- `apps/api/README.md`: responsabilidades, endpoints e configuração da API Go.
- `packages/contracts/openapi/v1.yaml`: contrato HTTP público versionado.
- `docs/catalogo-contratos-backend.md`: catálogo gerado das rotas registradas.
- `.env.example`: catálogo de variáveis e gates operacionais.

## Supabase e release

- `supabase/config.toml`: configuração local e políticas explícitas das funções.
- `supabase/edge-functions.manifest.json`: ciclo de vida, auth e hashes das Edge
  Functions.
- `supabase/migrations.source-lock.json`: origem imutável das migrações
  aplicadas/conhecidas.
- `.github/workflows/docker-images.yml`: gates e publicação das imagens.

## Documentos históricos

- `COMPONENTS_REORGANIZATION.md` e `CODE_EXAMPLES.md` registram a direção
  original do projeto. Antes de copiar um exemplo, confirme o padrão atual em
  `ARCHITECTURE.md` e no código do domínio.

## Comandos úteis

```powershell
# localizar código
rg "termo" app components hooks lib apps/api

# gates frontend
npm run validation:test
npm run typecheck
npm run lint
npm run audit:check

# backend e Supabase
npm run api:test
node scripts/supabase/verify-migrations.mjs
node scripts/supabase/verify-edge-functions.mjs
```

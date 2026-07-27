# Fluxo de banco de dados do Supabase

Este projeto usa migrations imperativas e incrementais. O projeto remoto de
produção é `iemalzlfnbouobyjwlwi` (`Vimob`).

## Contrato de diretórios

- `migrations/`: mudanças de schema e de dados duráveis que precisam ser
  executadas em todos os ambientes. Crie arquivos somente com
  `supabase migration new <nome>`.
- `legacy-migrations/`: cadeia anterior à baseline de 2026-07-22. É um arquivo
  histórico e nunca deve ser executado automaticamente.
- `reconciliation/`: manifestos, evidências e roteiro protegido do reparo do
  ledger remoto.
- `tests/`: testes de contrato em pgTAP e SQL. Arquivos de teste nunca fazem
  parte do histórico de migrations.
- `cutovers/`: operações de produção pontuais e protegidas. São aplicadas
  somente por meio de um roteiro de implantação, nunca por um `db push` comum.
- `drafts/`: trabalho ainda em revisão. Um rascunho deve ser promovido para uma
  migration recém-gerada ou removido; nunca deve ser executado diretamente.
- `functions/`: Edge Functions do Supabase e suas configurações.

## Regras

1. Nunca edite, renomeie, unifique ou remova uma migration que já faça parte do
   histórico canônico de algum ambiente, exceto dentro de uma reconciliação
   formal com backup, baseline validada e reparo documentado do ledger.
2. Nunca execute `db push` enquanto `supabase migration list --linked`
   apresentar uma divergência sem explicação.
3. Prefira `db push` para migrations revisadas. Se uma alteração de schema for
   executada por outra ferramenta, reconcilie imediatamente sua versão; não
   deixe a mesma migration registrada com um segundo timestamp.
4. Visualize o trabalho remoto com `supabase db push --dry-run`.
5. Valide a cadeia completa com `supabase db reset` e os testes SQL antes de
   enviar mudanças para produção.
6. Mantenha instaladores específicos de clientes e correções avulsas de dados
   fora de `migrations/`. Preserve o roteiro somente enquanto a operação
   estiver ativa e remova-o depois de verificar o resultado.

## Bloqueio de segurança atual

Ainda não execute `supabase db push`. A baseline foi validada, mas o ledger de
produção ainda contém as 444 versões antigas. Consulte
`AUDITORIA_SQL_2026-07-22.md`, `reconciliation/README.md` e
`migration-history-aliases.json`.

Documentação relevante do Supabase:

- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/reference/cli/supabase-migration-list
- https://supabase.com/docs/reference/cli/supabase-migration-repair

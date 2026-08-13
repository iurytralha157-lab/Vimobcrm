# Transferencia do projeto Supabase para outra conta

Este runbook cobre a troca de controle e cobranca do projeto Supabase do Vimob
sem criar um banco novo. O projeto de origem e
`iemalzlfnbouobyjwlwi`, na regiao `us-west-2` e atualmente na organizacao
`Vimob` (`wotvbcgrnwsufendbfqx`, plano Pro).

> Regra principal: se o objetivo for apenas outra pessoa controlar ou pagar o
> Supabase, mantenha o projeto atual. Convide a nova conta como Owner da
> organizacao atual. Se o projeto precisar ficar em outra organizacao, use a
> transferencia nativa de projeto. Nao copie fisicamente banco e Storage para
> resolver apenas uma troca de conta.

## Por que a transferencia e o Plano A

A documentacao oficial descreve a transferencia entre organizacoes como uma
mudanca sem tocar na infraestrutura. Portanto, banco, Auth, Storage, Edge
Functions e o `project ref` permanecem no mesmo projeto. Isso evita copiar mais
de 200 GB e evita um cutover de URL, chaves e callbacks.

A transferencia nao muda a regiao. Se o objetivo tambem for mudar de regiao,
obter outro `project ref` ou compactar fisicamente o banco por dump logico, use
o plano de contingencia em
[`supabase-cloud-to-cloud-fallback.md`](supabase-cloud-to-cloud-fallback.md).

## Snapshot da origem em 2026-08-13

O inventario somente leitura atual esta registrado em
[`supabase-source-inventory-2026-08-13.md`](supabase-source-inventory-2026-08-13.md).
Os numeros que mais influenciam a decisao sao:

- Postgres 17.6 e aproximadamente 184 GB fisicos de banco;
- 72.627 objetos de Storage, somando 35.347.340.473 bytes;
- 183 usuarios Auth, 13.291 refresh tokens e 526 sessoes;
- 81 Edge Functions ativas, 12 cron jobs e 486 registros remotos de migration;
- apenas a organizacao de origem `Vimob` aparece para a conta conectada hoje.

O tamanho fisico e a divergencia entre producao e Git tornam uma copia muito
mais arriscada do que a transferencia nativa. Como a transferencia preserva o
mesmo projeto, essas divergencias nao precisam ser resolvidas durante a troca
de conta. Elas devem ser reconciliadas depois, em uma frente separada.

## Decisao antes de qualquer mudanca

| Objetivo | Acao |
| --- | --- |
| Outra conta passa a administrar/pagar, mantendo a organizacao `Vimob` | Convidar a nova conta como Owner; atualizar billing; manter o Owner antigo durante a validacao |
| Projeto deve pertencer a outra organizacao Supabase | Criar a organizacao destino, colocar em plano compativel e transferir o projeto |
| Mudar regiao, gerar novo project ref ou reconstruir fisicamente o banco | Executar a migracao cloud-to-cloud de contingencia |

## Pre-requisitos bloqueantes da transferencia

Todos os itens abaixo precisam estar verdes antes do clique em **Transfer
Project**:

- [ ] A conta executora e Owner da organizacao de origem.
- [ ] A conta executora ja e membro da organizacao destino.
- [ ] A organizacao destino e gerenciada diretamente pelo Supabase, nao pelo
      Vercel Marketplace.
- [ ] O plano destino e Pro/Team/Enterprise e suporta compute, disco, PITR,
      IPv4, MFA e dominio customizado atualmente usados.
- [ ] Nao existe GitHub Integration ativa no projeto. Registrar a configuracao
      e desconectar temporariamente.
- [ ] Nao existem Log Drains configurados. Registrar destino/filtros e remover
      temporariamente.
- [ ] Nao existem project-scoped roles apontando para o projeto.
- [ ] A cobranca da organizacao destino esta ativa, sem invoice vencida e com
      spend cap compativel com o uso atual.
- [ ] Ha backup fisico recente/PITR valido e o horario foi registrado.
- [ ] Nenhuma rotacao de JWT, API keys ou secrets sera feita junto com a
      transferencia.

## Artefatos de preflight

Execute o coletor somente leitura antes da janela:

```powershell
pwsh -File scripts/supabase-transfer-preflight.ps1 `
  -SourceProjectRef iemalzlfnbouobyjwlwi `
  -TargetOrganizationId <organization-id-destino> `
  -OutputDirectory C:\vimob-migration\preflight
```

O coletor nao le valores de secrets e nao lista API keys. Ele registra somente
configuracoes administrativas, nomes/hashes fornecidos oficialmente pelo CLI e
o resultado de comandos de diagnostico.

Capture tambem o fingerprint SQL imediatamente antes e depois da transferencia:

```powershell
psql "service=vimob-source-readonly" -X -v ON_ERROR_STOP=1 `
  -f supabase/transfer-fingerprint.sql
```

Configure o servico `vimob-source-readonly` em `pg_service.conf` e a senha em
`pgpass.conf`, ambos fora do repositorio. Isso evita expor a URL/senha completa
na linha de comando. Nao grave connection strings, access token, API keys ou
JWT secret nos artefatos nem no Git.

## Inventario que deve ser conferido

- projeto/ref, regiao, versao do Postgres, compute e disco;
- backup/PITR, IPv4, SSL e restricoes de rede;
- Auth: quantidade de usuarios, Site URL, redirects, providers, SMTP, hooks e
  politica de signup;
- Storage: buckets, publico/privado, limites, MIME types, objetos e bytes;
- Edge Functions: nome, versao, status e `verify_jwt`;
- apenas nomes dos Edge secrets e do Vault, nunca valores;
- Realtime publications e tabelas publicadas;
- extensoes, Database Webhooks, `pg_net`, cron, wrappers e read replicas;
- dominio customizado ou vanity subdomain;
- GitHub Integration, Log Drains e project-scoped roles;
- callbacks externos Meta, Evolution/WhatsApp, Google Calendar, Asaas, Vista,
  Imoview, Resend e DNS.

## Janela de transferencia

Reserve 30 minutos, embora uma transferencia Pro para Pro normalmente nao
exija copiar dados.

1. Congelar deploys e mudancas de schema. Nao e necessario parar o CRM apenas
   para convidar um novo Owner.
2. Confirmar que o destino continua em plano compativel.
3. Confirmar que GitHub Integration, Log Drains e project-scoped roles foram
   tratados.
4. Manter as duas contas como membros/Owners durante toda a validacao.
5. Gerar um segundo preflight informando o ID da organizacao destino; ele deve
   terminar sem comandos obrigatorios com falha.
6. Em **Project Settings > General**, iniciar **Transfer Project** e selecionar
   a organizacao destino.
7. Registrar horario, executor, organizacao origem/destino e resultado.
8. Nao rotacionar chaves, nao mudar dominio e nao fazer deploy na mesma janela.

## Validacao imediata

Validar na ordem abaixo e interromper qualquer outra mudanca ao primeiro erro:

1. O projeto continua `ACTIVE_HEALTHY`, com ref
   `iemalzlfnbouobyjwlwi` e regiao `us-west-2`.
2. URL, publishable/anon key, secret/service key e JWKS continuam aceitos.
3. Fingerprint SQL, usuarios Auth, buckets, funcoes, cron, publications e
   extensoes continuam compativeis com o snapshot anterior.
4. Login por senha, convite, reset de senha e os providers sociais configurados.
5. REST/Data API com RLS: leitura e escrita de um tenant de teste.
6. Storage: upload, download, signed URL e remocao de um objeto de teste.
7. Realtime do CRM e WhatsApp.
8. Edge Functions publicas e privadas.
9. Recebimento e processamento de webhook Meta, WhatsApp/Evolution e Asaas.
10. Google Calendar OAuth, sync e webhook; Vista e Imoview.
11. Workers, cron, filas e logs sem crescimento anormal.
12. Custom Domain/TLS, se usado.

Depois dos testes, reconectar GitHub Integration e recriar Log Drains com a
configuracao registrada. Revalidar mais uma vez.

## Rollback

- Se o convite/alteracao de billing falhar, a organizacao e o projeto atuais
  permanecem intactos.
- Se a transferencia falhar antes de concluir, nao tente contornar repetindo
  varias vezes: registre a mensagem e abra suporte do Supabase.
- Se ela concluir mas houver problema de permissao/plano, mantenha o Owner
  antigo no destino e transfira de volta somente apos confirmar que os mesmos
  pre-requisitos estao verdes.
- Nao apague a organizacao antiga, nao remova o Owner antigo e nao rotacione
  chaves por pelo menos 72 horas apos a validacao.

## Fontes oficiais

- https://supabase.com/docs/guides/platform/project-transfer
- https://supabase.com/docs/guides/platform/access-control
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase
- https://supabase.com/docs/guides/platform/clone-project

# Convites: retirada do token em texto

## Comportamento da API compatível

- Contas estabelecidas com `public.users.is_active` diferente de `true` não
  podem ganhar outra organização por convite. Perfis provisórios do próprio
  convite só são ativados quando a identidade Auth mantém o marcador de origem
  e o ID exato do convite. O aceite autenticado também exige sessão ativa.
- A remoção do último vínculo de uma organização não altera
  `public.users.is_active`: esse campo representa suspensão global da conta.
  O usuário sem organizações ativas pode autenticar-se e receber um novo convite,
  mas continua sem acesso aos dados do CRM até entrar em uma organização.
  Contas históricas já marcadas como inativas não são reativadas automaticamente,
  pois o registro não distingue com segurança suspensão manual de efeitos antigos
  da remoção do último vínculo.
- Reentrada por convite cria um novo ciclo de acesso. Vínculos anteriores de
  equipe, distribuição, papéis personalizados e exceções de permissão não são
  restaurados automaticamente; o administrador deve configurá-los de novo.
  Alterações de papéis e permissões pela API publicam eventos de acesso para
  atualizar a interface; a autorização efetiva é recalculada no servidor na
  requisição seguinte.
- A consulta pública do link usa limite compartilhado de 120 requisições por
  IP e 30 por token em 10 minutos. O aceite público usa 30 por IP e 8 por token
  no mesmo período. Falha do limitador bloqueia a operação. Os identificadores
  são persistidos no limitador como hashes. Antes de publicar, confira os CIDRs
  de proxies confiáveis: sem eles, várias pessoas podem compartilhar o IP do
  proxy e atingir o mesmo limite.
- `email_status=accepted` significa aceite pelo provedor, não entrega. A
  listagem associa o registro de e-mail ao token atualmente válido. Reenviar
  troca o token: o link anterior deixa de funcionar. Em resultado ambíguo do
  provedor, o novo link continua válido e o status deve ser conferido antes de
  solicitar outro reenvio.

O esquema atual usa `is_active=false` tanto para suspensão quanto para perfil
provisório. Uma suspensão manual de um perfil provisório antes do primeiro
aceite não fica registrada separadamente; esse caso exige estado próprio em
uma evolução de esquema antes de ser considerado totalmente distinguível.

O cadastro, o reenvio e a criação de organização pela API gravam `token` e
`token_hash` enquanto a coluna legada existir. O link usa o token enviado ao
destinatário; consulta e aceite usam o SHA-256 desse token. A API compatível
também grava somente o hash quando a coluna não existir. O arquivo
`supabase/cutovers/20261009_retire_invitation_plaintext_token.sql` é **manual**:
não o execute com `db push` nem durante uma troca de réplicas.

## Antes do cutover

1. Confirme a reconciliação do ledger de migrations e o deploy de um SHA
   imutável contendo os dois caminhos de armazenamento em **todas** as réplicas
   da API. Leia novamente imagem, SHA e instâncias; uma réplica antiga lendo
   `invitations.token` impede o cutover.
2. Faça backup seguro do banco e confirme que pode restaurá-lo. Registre o
   horário, o responsável e a contagem de convites pendentes. Não exporte tokens
   em consultas, logs ou arquivos de diagnóstico.
3. Faça canários antes do cutover: convite novo, reenvio, aceite por conta nova
   e existente, incluindo pelo menos um link pendente emitido antes do deploy.
   Verifique acesso à organização correta e ausência de reativação de conta
   suspensa. Confirme que a versão compatível atende sozinha todo o tráfego.
4. Verifique dependências do banco remoto sobre `public.invitations.token`. A
   auditoria do repositório não prova que o schema remoto esteja idêntico.

## Execução controlada

Execute o SQL manual com `psql -v compatible_api_sha=<SHA de 40 caracteres>
-v old_replicas_drained=true -v backup_confirmed=true -f
supabase/cutovers/20261009_retire_invitation_plaintext_token.sql` no banco
explicitamente escolhido. Os três parâmetros são atestações operacionais;
o SQL verifica o formato do SHA e a consistência de todos os pares token/hash,
e aborta se não conseguir o lock em cinco segundos. Não rode em produção sem
autorização específica para a implantação.

Depois, execute `supabase/cutovers/tests/invitation_plaintext_token_retired.test.sql`
em ambiente descartável ou no ambiente alvo conforme o roteiro de implantação.
Repita os canários de convite novo, reenvio, aceite e link pendente anterior.
Leia a contagem de pendentes antes/depois; a retirada da coluna preserva o hash
e, portanto, não deve invalidar os links.

## Reversão e limite

Até o `COMMIT`, erro ou cancelamento devolve o esquema anterior. Após o
`COMMIT`, o token original não pode ser reconstruído do hash. Volte a uma
versão da API **compatível com hash-only** e corrija o defeito à frente; não
reimplante uma réplica antiga. Restaurar o backup inteiro descartaria mudanças
posteriores e exige um incidente controlado. Uma coluna removida também pode
persistir fisicamente em páginas antigas e backups até a retenção/limpeza
operacional; a verificação de schema prova apenas que novos SQLs não a leem.

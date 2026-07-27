# Cutovers manuais do banco de dados

Os arquivos deste diretório representam alterações operacionais executadas uma
única vez e cujas condições dependem do estado da implantação em produção. Eles
ficam deliberadamente fora de `supabase/migrations` e da execução normal de
`db push`.

## Processo obrigatório

1. Siga o roteiro de implantação correspondente e valide todas as pré-condições.
2. Crie um backup do banco e registre o responsável e o horário da execução.
3. Execute o cutover manualmente, na ordem documentada.
4. Rode o teste SQL correspondente em `supabase/cutovers/tests/`.
5. Registre o resultado no histórico da implantação.

## Situação do WhatsApp em 2026-07-22

Nenhum dos dois cutovers do WhatsApp está pronto para execução. A auditoria
encontrou 55 sessões ativas do Evolution Go que ainda não haviam convergido para
o endpoint de backend sem token na URL e 7.985 payloads históricos da inbox com
campos de autenticação. As constraints finais também estavam ausentes.

Repita as verificações do roteiro antes de qualquer execução. Esses números são
apenas um retrato datado do banco.

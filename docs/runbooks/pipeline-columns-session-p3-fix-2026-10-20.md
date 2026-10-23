# Colunas da Pipeline — ações pendentes após troca de sessão (P3)

Correção local de 20/10/2026 do COL-02 da auditoria das colunas. Checkout
principal; sem deploy, migração, configuração remota, reinício ou banco real.

## Falha e escopo

Criar pipeline/coluna, editar coluna, reordenar e criar automação comum não
capturavam toda a identidade do gesto antes da espera global de `onMutate`.
Depois da troca de usuário, SID ou organização, uma ação antiga ainda podia
chegar ao transporte com a identidade corrente. Sucesso/erro tardio também
podia fechar um editor novo, limpar campos ou liberar o botão de outra ação.

A correção reutiliza os helpers de intenção de Pipeline e automações, o
transporte `VimobAPIRequestIntent` e a lease do QueryProvider existentes.
O renomeio inline da coluna passa ao mesmo hook de atualização do editor.
Permissões, validações Zod, revisões CAS, SQL e handlers do backend permanecem.

## Comportamento esperado

1. Capturar organização, ator, SID e acesso ao QueryClient no gesto, antes de
   qualquer await. Copiar campos e itens da reordenação para não enviar dados
   que o chamador alterou depois de clicar em salvar.
2. Validar a intenção antes e depois do transporte. Propagar usuário/SID
   esperados e AbortSignal; desabilitar repetição automática de escrita.
3. Rejeitar resposta de organização/recurso divergente. Na reordenação os IDs
   precisam ser únicos e incluir todos os solicitados; IDs novos também são
   enviados pelo cliente e persistidos pelo backend. A resposta pode incluir
   outras colunas legítimas, como arquivadas, sem exigir cardinalidade idêntica.
4. Após logout/troca de SID/ator/organização/permissões/client, não executar
   callbacks nem invalidar cache da visita aposentada. A→B→A não revive o
   gesto antigo. Refresh normal do token com o mesmo SID preserva a intenção.
5. Após simples fechamento do editor, uma operação enviada pode precisar de
   reconciliação. Se a lease de acesso capturada continua válida, invalidar
   somente seu escopo, com `refetchType: none`, sem atualizar a interface fechada.
   Troca de seleção/recurso não é revogação de acesso ao cache.
6. Separar o lifetime da interface do acesso ao cache. Busy, abertura e seleção
   pertencem à visita/operação; ACK A não fecha, limpa ou destrava formulário B.
   Resetar somente o observer de mutation quando seu acesso muda; a mutation
   antiga continua sujeita aos guards de conclusão e reconciliação.

Abortar o navegador não desfaz commit já aceito pelo servidor. Erro de resposta
ou cancelamento não autoriza reenviar automaticamente criação/reordenação.
Resultado desconhecido requer reconciliação; não anunciar rollback fictício.

## Organização do código

- `hooks/use-stages.ts` mantém sua API pública e delega as quatro escritas ao
  módulo existente `hooks/pipelines/use-pipeline-mutations.ts`. A lógica comum
  fica nesse módulo, sem aumentar o legado acima de 800 linhas.
- `use-stage-delete-intent.ts` distingue acesso de recurso e captura a lease
  antes do gesto. Seus consumidores de exclusão/update de pipeline/round-robin
  mantêm proteção de revisão e recebem a restrição de não invalidar acesso novo.
- CREATE de automação usa o helper dedicado existente. Edição, exclusão e
  toggle mantêm suas declarações anteriores; apenas o CREATE usa o novo caminho
  de reconciliação por lease. Inatividade dedicada permanece igual.
- `use-pipeline-editor-visit.ts` protege os handlers de UI por acesso, abertura
  e recurso. Os componentes existentes mantêm JSX, classes, fontes e estilos.
- `AutomationForm` usa cleanup de layout e validação antes de callbacks de
  submit/refresh, além da checagem após await. Uma função antiga não pode capturar
  a visita nova apenas por consultar o ref corrente.

## Regressões e prova

Os recibos da rodada ficam fora do checkout e registram fontes/hashes, RED antes
da correção, GREEN e limites. As suítes novas executam hooks/API/Zod/QueryProvider
reais em Chromium isolado, com Auth e transporte sintéticos e rede bloqueada.
O transporte sintético pode ignorar abort para exercitar ACKs e erros atrasados.
Os handlers de UI também têm uma suíte de execução do código real com setters
e I/O sintéticos; o helper de visita é exercitado separadamente com React real.

Cobertura: espera global antes do envio, ACK/erro tardio, SID/ator/org/logout,
permissão/módulo, ABA, refresh do mesmo SID, unmount normal versus aposentadoria
do provider, snapshots de itens/revisões, resposta divergente, retries, callbacks
por chamada, observer antigo e operação B em andamento antes do ACK A.

Fixtures antigas recebem somente o contrato de escopo novo; os corpos/asserts
dos testes visuais existentes permanecem. No round-robin, o contrato de cinco
cenários aposentados ficou mais estrito: zero invalidação, em vez de invalidar
com refetch none. O controle de fechamento normal conserva invalidação sem GET.

Gates da rodada: testes focados e regressão, `npm run typecheck`, `npm run lint`,
`npm run audit:check` e diff/check de preservação. Consultar o resultado externo
final para contagens e avisos; não somar reexecuções ou arquivos compartilhados.

Consolidação final: 467/467 testes em 35 arquivos únicos, zero falhas/pulos,
incluindo 177 novos casos (85 CRUD, 55 automação e 37 UI/visita). Typecheck
aprovado; lint global sem erros e com sete avisos preexistentes. As evidências
RED foram preservadas, inclusive os casos que detectaram resposta com ID
divergente e callback antigo que tentava capturar a visita nova.

O inventário gerado precisou refletir as novas posições das fontes: 38 entradas
alteraram somente ID/linha nos componentes modificados. Rotas, acesso,
alcançabilidade, contagens, superfícies e gaps permaneceram iguais, comprovados
por comparação estrutural antes de copiar a prévia externa. No JSON do inventário
de Home mudaram somente os dois digests; seu Markdown e os achados permaneceram
iguais. Os quatro contratos de `audit:check` passaram após essa atualização.

## Limites e reversão

Não houve movimentação/salvamento em banco operacional, Safari físico, carga,
produção ou garantia de capacidade de usuários. As rotas e os testes Go do P2
permanecem iguais. A resposta antiga das regras operacionais (COL-03/P4) não
faz parte desta correção; seu hook permanece inalterado para a próxima etapa.

Reverter seletivamente UI, hooks e transporte desta correção juntos; remover
campos retornados pelos hooks deixando seus consumidores ativos quebra o
contrato da interface. Não restaurar arquivos completos do checkout nem desfazer
os ajustes anteriores/P2. Reverter os guards reabre o P3; não publicar esse
retorno como correção. Resultado já confirmado no servidor não é desfeito por
reversão do cliente. Nenhum passo de publicação foi autorizado nesta rodada.

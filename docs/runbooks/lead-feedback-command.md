# Registro idempotente de feedback do lead

Preparação local no checkout principal. Nenhuma migração foi aplicada no banco
operacional e nenhum serviço foi publicado nesta rodada.

`POST /v1/leads/{id}/feedback` exige sessão ativa, organização e `lead_operate`.
O detalhe aberto por Contatos e pelo Pipeline usa esse mesmo comando, conserva
o rascunho em falhas e só o reconhece após ACK na visita atual.
Dentro da transação, o servidor bloqueia o lead, consulta novamente o bolsão e
confere o escopo operacional atual. Um recibo antigo não concede acesso ao lead
após transferência, remoção de permissão, exclusão ou entrada no bolsão.

O corpo contém somente `commandId` (UUID da tentativa) e `content` (texto aparado,
entre 1 e 2.000 pontos de código Unicode). O cliente conserva essa identidade
enquanto o resultado da tentativa estiver incerto. Texto novo é um comando novo;
uma confirmação antiga não pode apagar texto digitado depois do envio.

O ACK `{data:{commandId,leadId,activityId,recordedAt}}` só é devolvido após COMMIT.
O recibo privado usa organização, ator e comando como chave; persiste um hash do
lead/conteúdo normalizado, sem copiar o texto do feedback. Mesmo comando e payload
devolvem o ACK original, sem alterar novamente `leads.feedback`, histórico ou
auditoria. Payload/lead diferente com a mesma identidade produz 409
`lead_feedback_command_conflict`.

A gravação nova atualiza o feedback atual do lead, registra a auditoria quando
o valor muda e insere uma atividade `note` com `kind=feedback` e
`origin=lead_update`, preservando os consumidores existentes do histórico. Os
triggers existentes continuam responsáveis pelos efeitos de atividade. Não há
alteração de resultado comercial nem nova notificação comercial nesta operação.
O evento `lead.updated` é publicado após ACK confirmado, inclusive em replay para
reconciliar uma resposta perdida, com o contexto atual de funil/etapa/responsável.
Repetir esse evento de invalidação não insere uma nova atividade.

O recibo não tem FK para atividade/lead nem expiração automática: exclusão ou
edição da atividade não pode apagar a proteção contra uma tentativa atrasada.
Replay após excluir o lead continua sujeito à autorização atual e retorna lead
não encontrado, sem recriar dados. Não limpar recibos como parte de uma reversão.

Tabela/schema/colunas/grants indisponíveis produzem 503
`lead_feedback_storage_unavailable`, com rollback e preservação do rascunho.
Não há fallback para `PATCH /v1/leads/{id}`. O PATCH legado continua compatível
para seus demais consumidores e não recebe uma promessa nova de idempotência.

## Publicação futura e papel de banco

O arquivo preparado é
`supabase/migrations/20261017053625_add_lead_feedback_command_receipts.sql`.
Leia o bloqueio de `supabase db push` em `supabase/README.md`; este documento não
autoriza aplicar SQL nem publicar a API.

Em um rollout autorizado, preparar primeiro o recibo privado e a API em todas as
réplicas, verificar sessão/tenant/recibo e só então publicar o consumidor novo.
API antiga retorna 404 no endpoint novo; API nova sem recibo retorna 503. A prévia
frontend ligada à API publicada pode manter o rascunho e informar indisponibilidade
até esse rollout. Isso não comprova funcionamento com a API Go local preparada.

A migração mantém owner `postgres`, RLS habilitada e retira grants de `PUBLIC`,
`anon`, `authenticated` e `service_role`, como os recibos privados existentes.
Não cria função `SECURITY DEFINER` nem acesso direto pela Data API. O pool Go usa
o papel de sua conexão configurada; este trabalho não leu configuração real e não
verificou o papel implantado. Uma validação futura precisa conferir, usando a
conexão de runtime autorizada, USAGE no schema privado, SELECT/INSERT/UPDATE no
recibo e permissão efetiva de execução sob RLS. Não conceder acesso ao navegador
para contornar uma falha de runtime.

Reverter consumidores/API de forma coordenada, preservando recibos e atividades.
Durante indisponibilidade, manter o feedback sem confirmação e o rascunho intacto;
não repetir a tentativa por uma rota legada sem identidade.

## Verificação local

Os testes Go `TestLeadFeedback*` usam o kernel transacional, autorização e scans
reais com transporte pgx sintético. Cobrem commit incerto, replay, conteúdo novo,
conflitos, duas organizações/atores, atividade excluída, acesso revogado e rollback.
Os testes de rotas usam JWT/tenant sintéticos e `httptest.NewRecorder`, sem servidor.

`node scripts/supabase/test-lead-feedback-command-postgres.mjs <porta>` requer um
servidor de loopback descartável previamente autorizado, porta entre 20000 e
65535 e roles de fixture `anon`, `authenticated` e `service_role` já existentes.
Não inicia serviço, não cria roles e não lê `.env` ou DSN. Cria/remove um banco
aleatório próprio; aplica apenas a migração nova e os seis SQLs de mutação/recibo
extraídos das fontes Go. É prova de schema/SQL sintético, complementar aos testes
de autorização e transação, sem certificar contas, grants ou dados operacionais.

# WhatsApp: fechamento local do isolamento e lateral compacta

Data: 14/10/2026. Checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`. Nenhuma publicação, push, migração, alteração de configuração de produção ou replay de evento real. Alterações locais anteriores foram preservadas.

## Comportamento

- O claim pode selecionar uma conversa independente quando outra cabeça está bloqueada por lock, em processamento ou aguardando retry. O predecessor exato da mesma conversa continua obrigatório nas duas lanes.
- Claimants atuais usam uma reserva curta por org/SID e uma segunda instrução READ COMMITTED. O lock compartilhado permite captura nativa em outra conversa, mas conserva a exclusão do claimant antigo e do cutover.
- Callbacks comprovadamente de status são persistidos como efeitos por alvo, até 128, todos na mesma transação. Conhecidos avançam monotonicamente; ausentes/estrangeiros aguardam em sua identidade, sem fabricar mensagem, outcome ou conclusão de outro alvo.
- A chave original e as chaves derivadas preservam o replay. Colisão entre versões antigas e novas falha fechada e faz rollback sem deixar partes órfãs.
- Callbacks mistos conservam o conteúdo e entram em retry antes do executor nativo ou Edge. Entradas profundas não viram controles ignorados por falta de inspeção.
- Um panic não expõe seu valor ou payload, nem derruba o executor. A liberação usa o owner/epoch e o fence Edge existentes, com contexto limitado. Falha de uma rota comprovada não interrompe as outras rotas comprovadas já claimed da mesma sessão.
- Captura suportada de mídia permanece atômica com seu job. Um download que falha pode ficar em recuperação enquanto o texto seguinte é processado, depois da captura obrigatória.
- Retenção conserva efeitos mortos e a família enquanto um irmão está pendente ou não expirou. Famílias concluídas são removidas atomicamente, sem cortar a chave original no limite do lote. O lote normal do worker é 10.000; um limite de teste menor que uma família adia essa família.
- Reconciliação de notificações reutiliza `public.evolution_go_reconcile_notification_receipt` com org/SID. A migração existente `20261012214157_reconcile_agenda_notification_edge_receipts.sql` e seus grants são dependência do candidato. Não há fallback sem SID.
- O outbox de envio não foi reescrito. A ordem por conversa e as proteções contra duplicação e resultado remoto desconhecido continuam obrigatórias.

Não há âncora genérica para conteúdo desconhecido. Dependentes da mesma rota só avançam após os efeitos reais exigidos; controles de escopo desconhecido conservam o fence de sessão. Um efeito com tentativas esgotadas permanece guardado para recuperação controlada, sem promessa de reabertura automática.

Contagem de linhas do inbox passa a refletir também os efeitos por alvo, não a quantidade de mensagens visíveis. A operação deve separar event_type, status, lane, idade e parent antes de classificar backlog ou recuperar uma cadeia. O timeout nativo continua 45 s, a conclusão usa contexto próprio de 5 s, e o backoff/limite de tentativas existentes não foram ampliados.

## Ajustes adicionais da interface

- Documentação usa os mesmos 11 px/peso 400 de Dados e Agenda. A linha tem 32 px e Anexar tem 24 px, com 4 px livres acima/abaixo, sem texto vazio. O estilo explícito impede que a regra global de h3 aumente o título para 14 px.
- Agenda conserva Agendar, com laranja 50% e hover laranja sólido. Sem eventos, o bloco branco de lista vazia desaparece; loading, erro e compromissos reais continuam disponíveis.
- Feedback usa campo menor, de 64 px, com fonte compacta e leve.
- O botão de descer compartilhado por conversa/balão usa fundo branco, seta laranja e nenhuma borda; hover laranja com seta branca.
- Os blocos correspondentes de Ver lead receberam o mesmo ajuste de apresentação, sem mudar mutações, permissões ou regras da Agenda.

## Validação final

Go completo: **672 testes de topo PASS, 0 FAIL, 2 SKIP**, em 403,193 s. Os dois pulos são `TestLocalEdgeExecutionFenceAndCutover` e `TestLocalUnlinkedStorageGC`, que exigem serviços Edge/Storage reais ausentes. Os **38 testes novos** desta rodada passaram, sem pulos. As **248 fontes Go** tiveram hashes iguais antes e depois da execução. Evidências em `D:/Vimob/tmp/whatsapp-queue-isolation-20261014/root`, com runner exclusivo para o cluster descartável `127.0.0.1:57922`, sistema `7696313589555176164`. O banco temporário foi parado ao fim da validação; não havia outro cliente conectado. Os testes usam somente fixtures sintéticas e serviços HTTP de loopback.

A execução final inclui ordem de outbox entre texto/mídia, cabeças locked nas duas lanes, captura compartilhada, oito corridas com quatro claimants, epoch/cutover, cadeia de predecessores, cancelamento/rollback, família de receipts e retenção parcial, colisões entre réplicas e isolamento de notificação por SID. O caso misto foi exercido antes dos executores native e Edge, com zero chamadas ao executor e conteúdo durável em retry.

O plano sintético de 1.000 rotas consumiu 1,529 ms de execução na reserva e 7,003 ms no claim, além de 7,423/7,851 ms de planejamento. A transação de EXPLAIN foi revertida e conservou 1.000 pending/zero processing. Esses números descrevem somente a fixture local; não são latência de produção ou teste de 6.000 usuários.

Interface: **62 testes PASS, zero falhas/pulos** (17 painel, 41 balão, 3 fronteira da Agenda, 1 layout do lead). Tipagem global e lint focal passaram após a última correção. Quatro combinações de 320/1440 px e claro/escuro mediram Documentação em 11 px/peso 400, Anexar em 24 px de altura e folgas verticais de 4 px. As capturas finais foram inspecionadas. Fontes, resultados e métricas estão no manifesto `D:/Vimob/tmp/whatsapp-sidebar-compact-20261014/proof.json`; seus sete hashes de fontes foram conferidos pelo root. Os harnesses usam componentes/CSS reais, hooks/dados sintéticos e rede externa bloqueada; não carregam `next/font` nem cobrem o fluxo autenticado completo de Ver lead.

Edge: **9 testes em memória PASS**, sem chamadas externas; não substituem o serviço Edge real. Revisão independente somente leitura não encontrou P1/P2 concreto restante nos deltas examinados de fila. O manifesto consolidado deste fechamento é `D:/Vimob/tmp/whatsapp-queue-isolation-20261014/root/closure-proof.json`.

REDs já confirmados: código anterior ocultava a rota vizinha nos casos de cabeça locked e captura nativa compartilhada; limpeza anterior removia o efeito morto e a chave original da família ainda pendente. Os testes exigem efeitos/outcomes reais, sem marcações de sucesso para liberar a fila.

O arquivo legado `webhook_worker.go` teve extração do seletor e da limpeza em módulos menores; seus demais contratos foram preservados. `webhook_native_processor.go` recebeu somente os guards e a reconciliação escopada desta rodada, além dos deltas locais anteriores. Uma divisão completa desse legado não faz parte deste fechamento.

## Limites e próxima publicação

- Não se verificou comportamento ponta a ponta em aparelho ou em produção.
- Nenhum evento antigo de Ana Beatriz foi repetido, descartado, reclassificado ou recuperado.
- Receipts antigos em fence de sessão exigem classificação e recuperação próprias; a mudança de ingresso vale para callbacks novos elegíveis.
- O frontend local já aberto continua ligado à API publicada antiga. Ele não comprova o comportamento do worker candidato.
- A release posterior precisa conferir o conjunto compatível de API, SQL e Edge, grants, epoch/allowlist e rollback. Um rollback pode conservar efeitos já divididos; não deve repetir o callback original nem apagar seus irmãos.
- O checkout segue com trabalho local anterior. Este relatório não declara uma release limpa ou publicada.

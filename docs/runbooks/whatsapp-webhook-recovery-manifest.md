# Preparação da revisão de recuperação por cadeia

O [modelo JSON](whatsapp-webhook-recovery-manifest.example.json) prepara uma
revisão. Não executa retry, não é consumido pelo worker e não autoriza operação
remota. `cases` começa vazio; `case_template` descreve os campos de um caso e
não é um caso real. Nenhum ID, hash ou outcome foi preenchido.

O manifesto real depende de novo inventário somente leitura e da versão e do
schema efetivamente presentes no alvo. Contagens históricas, incluindo as 17
caudas observadas em 11/10/2026, não são uma allowlist. O inventário pode mudar
enquanto chegam callbacks ou mudam sessões e responsáveis.

1. Registre identidade do banco, versão implantada, compatibilidade do schema,
   horário e referência da leitura. Verifique os campos de execução Edge sem
   presumir que existam. Coluna ou função ausente bloqueia a revisão.
2. Para cada raiz distinta, copie `case_template` para `cases` e preencha IDs
   internos reais, cabeças afetadas e ordem da cadeia. Prove organization,
   session, epoch ativo, rota, identidade de cada predecessor, cronologia e
   ausência de ciclo, profundidade excedida ou predecessor ausente. O
   diagnóstico SQL limita a leitura a 200 cabeças e profundidade 32; essa
   limitação não transforma uma cadeia incompleta em elegível.
3. Registre estado e fingerprints da inbox e de cada snapshot imutável. Declare
   o método de hash e use a mesma representação nas comparações. Exporte
   somente metadados necessários: não inclua payload, conteúdo de mensagens,
   telefone, JID, token, chave de mídia ou ciphertext. Eventos e identificadores
   do provedor podem ser comparados no alvo e representados por hashes no
   manifesto. `per_node_evidence` deve cobrir cada ID da cadeia.
4. Verifique locks, lease e possível conclusão tardia de worker ou Edge. Um
   timeout HTTP não prova que a execução remota terminou. Preserve os fences
   existentes e confirme a disponibilidade da sessão.
5. Reconcilie outcomes e efeitos duráveis: mensagens/captura, mídia, intake e
   lead, attendance, notificações/deliveries e outbox. Ausência em listas vazias
   ainda não prova ausência no banco; exija `all_effects_checked`. Resultado do
   provedor desconhecido exige reconciliação antes de qualquer proposta de
   novo envio. Verifique o suporte do parser na versão implantada para a classe
   exata de formato; controle técnico exige classificação específica.
6. Registre a decisão, o revisor e a evidência. `hold` é o padrão. Uma proposta
   de retry deve listar somente raízes exatas revisadas; os descendentes seguem
   o processamento e a ordenação normais. Não resetar tentativas em massa,
   reinterpretar epochs antigos, reescrever snapshots ou marcar `processed`/
   fabricar outcomes para destravar a fila.

Decisões conservadoras de revisão:

- `hold`: evidência ausente, schema incompatível, execução possivelmente ativa,
  cadeia inválida, sessão indisponível ou estado divergente.
- `reconcile_existing_effects`: efeitos já presentes ou resultado incerto;
  investigar a conclusão existente antes de propor processamento adicional.
- `review_retry_exact_root`: formato suportado, cadeia/proveniência válidas,
  fences encerrados e idempotência comprovada; ainda depende de operação
  separada e autorização explícita.
- `review_technical_control`: classificar o controle e sua conclusão permitida
  pela implementação, sem inventar mensagem, conteúdo decifrado ou outcome.

Mantenha `execution_authorized: false` neste artefato de preparação. Uma futura
operação deverá apresentar sua allowlist e autorização separadamente e reler
estado, hashes, snapshots, leases e efeitos imediatamente antes de agir. Este
modelo não contém SQL de mutação nem script de requeue.

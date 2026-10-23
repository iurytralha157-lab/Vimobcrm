# Contrato de movimentação da Pipeline

## Contrato e ordem de publicação

A interface atual envia `expectedUpdatedAt` com a revisão original do lead,
inclusive microssegundos. APIs anteriores que não declaram esse campo e usam
`DisallowUnknownFields` rejeitam a escrita com `400 invalid_json` antes de mover.
Retirar a revisão para contornar o erro não é uma estratégia de compatibilidade.

A API compatível oferece `GET /v1/leads/capabilities/move-stage` e responde
`{ "data": { "contract": "revision-v1" } }`. A rota exige organização, sessão
ativa e `LeadOperate`, usa `Cache-Control: private, no-store` e não consulta o
banco de leads no handler. As verificações normais de sessão/tenant do middleware
continuam. Ela informa suporte de protocolo; não concede acesso ao lead. O POST
mantém suas verificações de autorização, revisão e regras comerciais.

O segmento adicional da rota é intencional. `/v1/leads/move-stage-capabilities`
seria interpretado como `/v1/leads/{id}` em APIs antigas. O caminho atual recebe
404/405 no roteador antigo sem executar os handlers de leitura ou movimentação.

Publicação futura requer todas as réplicas da API compatíveis antes do frontend.
Uma resposta de capacidades ou `/healthz` de uma réplica não comprova as demais.
Esta entrega não tem migration, variável de ambiente ou alteração de destino da
API. Não autoriza deploy, troca de configuração ou uso do banco operacional.

## Cliente e falhas

- A consulta é antecipada por React Query, sem retry de transporte e sem cache
  HTTP. A chave inclui API configurada, organização, ator e SID.
- A prova positiva emitida pelo transporte tem validade máxima de 30 segundos.
  `structuralSharing: false` mantém sua identidade; objetos fabricados/clonados
  e provas invalidadas não são aceitos.
- O quadro e o seletor do popup verificam a prova antes da alteração otimista.
  Com prova preparada, o quadro continua atualizando a posição sincronamente.
  Consulta pendente ou incompatível conserva a posição original.
- Após uma espera, a operação capturada precisa continuar atual. Fechamento,
  troca de seleção, organização, ator ou SID não reativam callbacks antigos.
  A verificação do popup também é executada imediatamente antes do envio, após
  eventual resolução assíncrona do token.
- A prova expirada/inválida é rejeitada antes do POST. A revisão original não é
  substituída por uma leitura nova para aceitar uma intenção antiga.
- Uma resposta negativa de capacidades invalida a prova positiva anterior.
  Esse erro não remove os sensores de arraste dos cards autorizados: pegar,
  navegar pelo teclado e cancelar continuam disponíveis. A preparação em
  `executeLeadMove` impede alteração otimista e POST sem contrato compatível.
  A consulta de compatibilidade permanece interna, sem faixa técnica ou botão
  de diagnóstico na interface. Uma tentativa incompatível recebe somente uma
  mensagem simples para tentar novamente. Permissões do ator, acesso ao card,
  fila sem responsável e a regra mobile mantêm seus bloqueios.
- Réplicas mistas ainda podem aceitar o GET e rejeitar o POST. `400 invalid_json`
  e 404 de rota no POST invalidam a prova e recebem a mesma mensagem simples.
  O código interno do erro e o request ID continuam disponíveis para diagnóstico.
  Não há repetição automática nem fallback sem revisão. 403, 409 de concorrência,
  429, lead ausente e erros comerciais mantêm suas classificações.
- A prova identifica a API configurada; não atesta qual réplica ou candidato do
  fallback local do transporte respondeu. A segurança depende também do POST.
- Uma escrita já enviada pode concluir no servidor após fechar o popup. A
  guarda antes do envio não promete cancelar um commit já iniciado.

## Homologação e reversão

Usar dados sintéticos para a matriz frontend/API anterior e atual, revisões com
microssegundos, duas organizações, permissões e sessões, respostas perdidas e
trocas A→B→A. Testar arraste, seletor do popup, motivo de perda, Ganho/Perdido/
Reabrir e imóvel/reserva sem retirar seus guards existentes.

Uma prévia de frontend que continua apontando para uma API antiga permanece
inapta a confirmar a nova movimentação. A verificação interna impede a escrita
incompatível; remover a faixa técnica não atualiza a API publicada nem deve
impedir pegar/cancelar um card.
A homologação integrada requer versões
compatíveis em ambiente de teste e conferência em aparelho físico.

Regressão de 17/10: associar `query.isError` a `isDragDisabled` retirava os
listeners de todos os cards depois de 404/405, timeout ou outro erro da leitura.
O teste `pipeline-pickup-contract.runtime.test.mjs` extrai a expressão e o
binding reais do Screen e exercita Board/Card/sensores reais em Chromium,
com props de contrato e dados sintéticos. Ele cobre mouse, teclado, cancelamento,
novo gesto e os bloqueios de autorização/fila; não monta o Screen completo nem
comprova persistência na API publicada.

O cancelamento por Escape também preserva a intenção de não abrir o lead.
O adapter mantém uma ref por card após o arraste e consome somente o clique
residual do ponteiro. Um novo pointerdown primário limpa a ref; clique intencional,
Enter e ações rápidas continuam disponíveis. O guard de captura permanece mesmo
se a permissão mudar durante o gesto. Não há timer, listener global adicional ou
mudança na persistência. O teste espera 100ms entre Escape e mouseup porque a
supressão de click do sensor é removida pelo vendor após 50ms; esperar esse
intervalo reproduzia a abertura indevida antes da correção.

Reverter somente os hunks desta entrega usando os checkpoints externos. Não
restaurar arquivos inteiros num checkout compartilhado. A rota de capacidades
é aditiva e pode permanecer ao reverter o frontend; não remover o CAS nem
restaurar um cliente antigo sem revisar novamente os riscos de concorrência.

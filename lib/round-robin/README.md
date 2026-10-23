# Horário da fila e bolsão privado

`operating-schedule.ts` cria somente um rascunho: nenhum fuso, dia ou horário é escolhido automaticamente. O editor exige uma escala explícita para filas novas. Filas existentes sem `settings.operating_schedule` continuam legadas até uma alteração explícita. Uma semana inteira fechada é válida após definir o fuso; a captura continua ativa e os leads aguardam no bolsão.

O contrato de `operating_schedule` v1 é validado em `lib/validation/queue-runtime.ts`: fuso IANA, sete dias únicos de 0 a 6, horários `HH:MM`, dia inteiro com horários nulos e turnos que podem atravessar a meia-noite. A disponibilidade efetiva, o fechamento/reabertura e as permissões são decisões do servidor. `settings.pool_notifications.enabled` é opt-in, desligado no rascunho novo e preservado sem valor nas filas legadas. O editor não envia mensagens.

Prazos de redistribuição de 1 a 5 minutos são permitidos com aviso prévio zero. Para prazos maiores, o aviso é opcional e precisa ser anterior ao vencimento. A normalização do editor e o Zod aplicam a mesma regra.

## Assumir um lead

`lib/queue-pool.ts` normaliza `queuePool` da API para `queue_pool` e exige dono explicitamente nulo, metadados válidos e `can_claim` concedido pelo servidor. `QueuePoolClaimButton` não transforma leads genéricos sem responsável em leads de bolsão. Leads de bolsão ficam somente para leitura até serem assumidos.

`useClaimQueuePool` captura organização, ator, sessão e geração de acesso antes do pedido. O POST usa revisão/episódio/fila e um `Idempotency-Key` estável para repetir a mesma intenção após resposta incerta. Mudança de sessão, vínculo, fila ou permissões descarta capacidades em cache e impede resposta tardia de repovoar a interface. O servidor deve repetir a autorização e resolver a concorrência; a interface não substitui essa barreira.

Os testes de agenda, cache e claim executam funções de produção e MutationObserver em memória, sem banco ou servidor. `contexts/queue-pool-realtime.runtime.test.mjs` verifica a reconciliação por eventos sem identificadores privados. Eles não comprovam implantação ou funcionamento ponta a ponta em produção.

## Alterar e excluir uma fila

Filas gerenciadas aceitam redistribuição com zero ou um corretor elegível: o servidor aguarda alternativa ou mantém o lead no bolsão, sem repetir o responsável dentro da mesma janela. A exigência de dois corretores continua no regime legado. O editor usa a mesma regra na etapa, no botão e no envio.

Alterações operacionais, de participantes, disponibilidade ou acesso registram um epoch privado e durável da fila. O worker reavalia os episódios ativos em páginas limitadas, na ordem fila → lead → runtime; os writers não bloqueiam milhares de leads. Cursores retornam aos registros ocupados, e uma parte do lote permanece reservada ao processamento normal. Se o lote tiver uma única vaga, um cursor durável alterna as duas vias entre chamadas. Contadores e horários de atribuição não geram epochs. Essa revisão não recalcula o orçamento nem o prazo já capturados no episódio; proteção manual/humana e quarentena continuam preservadas. A latência depende do worker e da drenagem do lote, não de uma chamada síncrona do editor.

A API e o banco recusam excluir fila com rotação automática, bolsão (inclusive limite esgotado) ou job pendente, com `409 round_robin_distribution_pending`. Resolva essas pendências antes de excluir. A barreira SQL também reconhece o cleanup de jobs feito pela API anterior na mesma transação, sem deixar marcadores após o commit.

O histórico de uma fila excluída permanece consultável por gestores com acesso organizacional à distribuição. Isso não permite GET operacional, edição ou reativação da tombstone. Perfis de atores/participantes só são hidratados se pertencerem ao tenant, inclusive vínculos históricos, ou se forem superadministradores da plataforma; os IDs auditados são preservados sem expor nomes de outro tenant.

`scripts/supabase/queue-configuration-lifecycle-cases.mjs` exporta cenários para o harness integral descartável: alterações com próximo processamento distante, disponibilidade/vínculo, prefixo de 51 leads bloqueados, exclusão pendente/rollback, histórico em dois tenants e grants privados. O módulo não cria serviços nem roda por importação. Esses cenários precisam ser executados pelo responsável pelo PostgreSQL local; não são prova de produção.

## Formulário de distribuição

As rotas de filas, critérios, participantes e opções exigem sessão ativa além de JWT, tenant e `distribution_manage`, usando o mesmo checker do histórico. Os gates de administrador, liderança e organização continuam no servidor. A resposta a sessão revogada/ausente é anterior ao repositório; indisponibilidade do checker falha fechada.

Na criação, a tentativa pendente e o payload enviado permanecem congelados também ao navegar por links. Editar um rascunho visual ou cancelar navegação não libera outra chave de idempotência; iniciar novo pedido exige revisão/descarte explícito. `pending-draft.ts` aplica essa política e informa falha de storage.

`editor-visit.ts` e `use-distribution-editor-visit.ts` vinculam cada save/reload à visita do editor, organização, ator, fila e SID. Fechar, desmontar ou substituir esse escopo invalida seus efeitos locais: conclusão antiga não remove o rascunho de uma nova visita. Isso não desfaz uma gravação já aceita pelo servidor; a recuperação de resultado incerto continua necessária. Gestos repetidos compartilham a mesma operação em andamento.

Um reload explícito só substitui o formulário após sucesso: `data` em cache junto de `isError/error` não é versão atual. Os hooks voltam a consultar filas invalidadas ao montar; o detalhe verifica a versão em cada entrada. O Screen aguarda essa primeira atualização antes de montar o editor com cache, mas atualizações posteriores não reidratam um rascunho alterado: apresentam o conflito de revisão para revisão explícita.

Destinos novos ou alterados exigem pipeline e etapa ativos da organização, com vínculo entre eles. A API mantém locks compartilhados sem esperar em ordem inversa aos writers de pipeline; destino ocupado retorna conflito recuperável, preservando o rascunho. Repetir exatamente o destino legado já salvo não força sua troca durante uma renomeação. A UI identifica essa referência indisponível e não a oferece como nova alternativa.

Controles de critérios são botões com seleção acessível; campos e buscas têm nomes e IDs por instância. Os limites de menus são locais aos componentes de distribuição, derivados do espaço disponível no Radix. A geometria aprovada do assistente e as primitivas globais permanecem preservadas. Cancelar o descarte restaura foco ao elemento anterior conectado; confirmar não força retorno a uma tela encerrada. O componente compartilhado também é consumido pelo editor de equipes.

Mensagem automática usa até 4.000 pontos de código Unicode no contador, validação do editor, Zod e Go. O textarea não trunca mensagens legadas por unidades UTF-16; texto acima do limite permanece visível com erro para revisão. Outros limites de texto não foram alterados.

As regressões `editor-recovery.test.ts`, `hooks/round-robin/distribution-cache.runtime.test.mjs`, `whatsapp-auto-reply-unicode.test.ts` e os testes runtime de controles/foco usam dados sintéticos, produção de componentes/hooks reais e dependências controladas. As provas HTTP usam JWT/checker/tenant sintéticos e o mux real. Não são E2E com banco, execução de migrations, carga, implantação ou prova de produção.

O editor permanece um legado acima do limite de tamanho atual. Esta rodada isola somente o ciclo da visita e o resultado de reload em módulos pequenos, para corrigir as corridas sem refatorar validações e hidratação simultaneamente. Uma futura divisão dessas responsabilidades deve conservar os snapshots e essas regressões.

## Operações pendentes, validação e navegação do formulário

Enquanto save ou reload substitui o snapshot, o editor desabilita o grupo de campos e as ações de recuperação. Os callbacks de edição também verificam o bloqueio síncrono da visita: restaurar um rascunho ou digitar durante uma operação não pode criar uma versão local que a conclusão apagaria. Hidratação e resposta confirmada continuam usando o setter interno; isso não cancela uma gravação já aceita no servidor. Os guards entre visitas e a tentativa congelada de criação permanecem necessários.

Alertas e recuperação ficam dentro do conteúdo rolável, preservando área útil em janelas baixas sem alterar a geometria aprovada do diálogo. `FormWizardLayout` reinicia o scroller efetivo de mobile e desktop ao trocar etapa. O foco do rodapé para o novo painel é opt-in com `focusContentOnStepChange`, usado pela Distribuição; abas e consumidores com foco próprio mantêm sua política.

`whatsapp-auto-reply-validation.ts` compartilha o resultado de validade entre envio, prontidão e avanço da etapa. Mensagem inválida permanece editável, mas não anuncia conclusão. `queue-name.ts` conta de 2 a 120 pontos de código após o trim já existente, em acordo com Go. O nome no rascunho pode ficar temporariamente inválido para revisão, sob o limite total de 1 MB e TTL existentes; salvar/restaurar não trunca nem renomeia esse texto. UI e schema de transporte continuam impedindo seu envio até a correção.

As mutações avançadas capturam por execução a visita válida do QueryClient. Trocar organização, ator ou SID impede novos envios e efeitos tardios de cache/toast daquele acesso; fechar somente o popup no mesmo provider conserva a invalidação normal. Isso não desfaz a operação original nem autoriza sua repetição.

Regressões adicionais: `distribution-editor-regressions.runtime.test.mjs`, `form-wizard-step-navigation.runtime.test.mjs`, `queue-mutation-access.runtime.test.mjs`, `queue-name.test.ts`, `queue-name.runtime.test.mjs` e `whatsapp-auto-reply-validation.test.ts`. O harness de editor em `scripts/tests/distribution-editor-runtime-harness.mjs` usa componentes/CSS reais, fronteiras de auth/query/mutação sintéticas, arquivos temporários e tráfego interceptado. Essas provas não são E2E com API ou banco, validação de SQL/locks, aparelhos nativos ou comprovação de produção. As alterações no editor legado foram limitadas à integração desses guards/validadores; uma divisão futura deve preservar a política de draft e as camadas de validação.

## Digitação, feedback e acesso nas ações da listagem

O critério de cidades mantém espaços e separadores ainda incompletos no campo e no rascunho. A sanitização de envio continua retirando espaços externos e itens vazios; digitar, colar, editar no meio do texto e restaurar um rascunho usam o mesmo valor. Renomear uma fila sem alterar o critério continua preservando seu snapshot legado.

As ações de atualizar e excluir da listagem capturam a geração de acesso do QueryClient por execução. Pedidos iniciados com acesso encerrado são recusados, e respostas ou erros antigos deixam de alterar cache ou exibir toast. Isso inclui troca de organização, ator, SID e retorno ao mesmo SID após uma troca. A operação já recebida pelo servidor continua sujeita à autorização do servidor; o guard local não a desfaz. As mutações avançadas conservam sua implementação anterior.

Cada falha atual de save ou reload recebe uma ocorrência própria, mesmo com mensagem idêntica. O editor revela o alerta no conteúdo rolável e atualiza apenas seu texto; o botão de recuperação permanece montado e o foco não é movido. Guardas da visita continuam descartando conclusões antigas. A fala de leitores de tela precisa ser validada com tecnologia assistiva real.

`input-text.ts` conta pontos de código após o trim JavaScript já aplicado ao payload e o conjunto Unicode White_Space usado pelo trim do servidor Go, nessa ordem. Nome, resposta automática, navegação, prontidão, contador e schema usam essa contagem sem normalizar o campo, rascunho ou payload além da política já existente. Isso cobre NEL e a ordem de FEFF, preservando mensagens válidas no limite sem substituí-las pelo texto padrão.

Regressões: `distribution-queue-city-entry.runtime.test.mjs`, `queue-list-mutation-access.runtime.test.mjs`, `distribution-editor-feedback.runtime.test.mjs`, `distribution-input-normalization.runtime.test.mjs` e `input-text.test.ts`. Os testes de navegador usam dados sintéticos e componentes reais; não acessam banco ou serviços do CRM. As integrações pontuais no editor legado evitam combinar estas correções com uma refatoração ampla de hidratação e validação.

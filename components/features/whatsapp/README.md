# Conversas WhatsApp

O cabeçalho da lista reúne WhatsApp, Período e Filtros. Sem período selecionado, a lista inclui todas as datas. O período filtra por `wc.last_message_at` antes da paginação e também no contador de não lidas.

Os filtros de pipeline, equipe, responsável, origem, tags, status, página Meta e campanhas são enviados à API de Conversas. Campanhas usam parâmetros `campaignIds` repetidos para preservar nomes que contêm vírgulas. O botão de campanhas permite selecionar várias opções. A lista e o contador usam as mesmas escolhas e o mesmo escopo de organização, sessões e visibilidade do usuário.

As opções vêm exclusivamente de `/v1/whatsapp/conversations/filter-options`, limitado às conversas visíveis e às sessões acessíveis. O componente compartilhado recebe equipes e usuários desse endpoint e não consulta os catálogos gerais nesta tela. A busca de opções acompanha conta, período, arquivadas e página Meta. Ao marcar **Sem lead**, os filtros de dados do lead são limpos; ao escolher qualquer filtro de lead, **Sem lead** é desmarcado. Grupos permanecem ocultos (`hideGroups=true`) sem controle na interface.

**Sem resposta** mostra conversas cuja última mensagem relevante é de entrada, inclusive depois de marcada como lida. Mensagens suprimidas e reações não definem essa condição. O contador continua somando apenas mensagens não lidas das conversas filtradas. Os filtros da lista não alteram histórico de mensagens, atribuições ou dados do lead.

A busca dos seletores de tags do painel e do menu dos cards filtra o catálogo já autorizado, ignorando acentos e maiúsculas. Digitar não altera vínculos; seleção, remoção e permissões mantêm os mesmos fluxos.

A prévia recebe texto, direção, status, `last_message_id` e `last_message_sent_at` da mesma mensagem visível. Os dois últimos campos são opcionais para compatibilidade. Mensagens recebidas não reservam espaço para recibos. O envio local projeta imediatamente texto, horário e status em Conversas e no balão, sem inserir ou reordenar cards nem alterar o cache canônico. Essa projeção é isolada por QueryClient, organização, usuário, acesso, conversa, sessão e lead; expira em 120 segundos, com até 64 cards e 32 envios predecessores por card. Respostas atrasadas não transferem confirmações entre mensagens. Estados canônicos do mesmo ID resolvem incertezas locais; enviada, entregue e lida não regridem.

A API atualizada entrega esses dados junto à lista. Apenas em desenvolvimento, em loopback ou rede privada, cards legados visíveis podem usar a recuperação limitada a quatro leituras simultâneas, sem URLs de mídia. Essa compatibilidade não substitui a atualização da API. O painel reutiliza a foto do GET já autorizado do mesmo lead e organização, após confirmação dessa leitura, preservando os candidatos anteriores como fallback. Não consulta contatos adicionais para preencher avatares.

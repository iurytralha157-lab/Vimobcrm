# WhatsApp: fechamento local de interface, dados e validação

Checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`. Foram preservadas as alterações locais anteriores. Não houve publicação, aplicação de SQL em produção, envio real, replay, descarte de mensagens ou mudança de vínculos no ambiente publicado. A investigação autorizada da Ana usou somente leitura no Supabase aberto no navegador; o Studio salvou um snippet privado de consultas separado do anterior.

## Fechamento das duas auditorias posteriores

Esta seção descreve a rodada atual. As contagens e provas seguintes são históricas e não são reaproveitadas como testes das fontes que mudaram. Principal em `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com as alterações anteriores preservadas. Não houve acesso a banco, SQL aplicada, provedor real, túnel de produção, envio, replay, deploy ou push nesta rodada.

| Problema levantado | Resultado no código local |
| --- | --- |
| Verificar arquivo incerto podia deixar seleção presa e permitir novo CID | A seleção recebe a resolução real da intenção original. Verificar faz somente GET: não ingressa no atendimento, não comprime, não converte base64, não envia e não limpa uma citação nova. Mesmo após outra superfície resolver/evictar a referência, verificação não vira POST. |
| Gravar feedback A apagava texto B durante a requisição | Limpa somente o texto realmente submetido. Novo texto, lead, organização ou visita não recebem a conclusão antiga. |
| Fotos existiam em Pipeline/Contatos e faltavam em Conversas | A projeção de conversas lê também o caminho privado armazenado. Assina em lote após autorização, com validação org/lead, prazo2s, cache/TTL e seis slots próprios. Não assina em leituras internas de envio/outbox. SQL compatível com coluna ausente via `to_jsonb`. |
| Áudio de outro corretor mostrava inicial/foto incorreta | Um lote autorizado de usuários do histórico alimenta as mensagens por `sender_user_id`. Outro remetente não recebe a foto do espectador/responsável atual. Falha401/403 retira o resultado antigo. |
| URL inválida/falha temporária mascarava foto válida | URLs verificadas, fallback da própria conversa após erro e uma recuperação limitada. Troca de origem/contexto aposenta callbacks; áudio enviado nunca empresta foto do lead. |
| Foto nova do usuário ficava no cache | Upload publica evento sem foto/URL nas memberships ativas. Invalidação exata inclui usuários, resumos, avatares e DTOs da conversa; preserva mensagens, recibos, unread e outbox. O próprio perfil é renovado quando corresponde ao alvo. Upload local também invalida organizações conhecidas, sem depender do SSE. |
| Faixa laranja desaparecia em prévia somente leitura/erro de sessões | Página e balão exibem o mesmo aviso informativo compacto. Não oferecem iniciar/conectar quando bloqueados. Rota autorizada mantém compositor; outra rota com número próprio oferece iniciar; sem número próprio oferece conectar. |
| Recibos pulavam ao selecionar/voltar | Seleção pausa a leitura auxiliar sem remover binding/snapshot autorizado. A lista usa os DTOs brutos mais ID pausado; head selecionado prevalece sobre snapshot antigo. Revogação, SID e mudança de vínculo continuam aposentando o cache. |
| Mídia alterava altura e deixava leitor longe do fim | Página observa viewport e conteúdo, segue instantaneamente quando já no fim e conserva mensagem/offset quando lendo acima. Voltar ao fim restaura seguimento. Indicador usa o mesmo estado de leitura. |
| Mídia pronta mostrava indisponível antes da URL | Espera enquanto a leitura ainda não começou/está pausada. Falha real ou durável continua explícita; retry depende de gesto. Spinners respeitam redução de movimento. |
| Balão buscava URLs/mídia de modo diferente | Mesma página50/URLs sob demanda. Prefetch perto da área visível, URL aceita preservada fora da visão e renovação explícita por GET. Quatro leituras globais até a promessa encerrar, inclusive se transporte ignorar abort. |
| Busca mostrava vazio antes do debounce | Estado pendente em ambas as listas; não declara ausência durante preparação. Refetch comum não acrescenta aviso de busca ou apaga cards. |
| Escape na busca fechava conversa inteira | Fecha só a busca e restaura foco no acionador da página/balão. Navegação respeita redução de movimento e aguarda commit do histórico antes de avançar. |
| Catálogo de tags sumia ao atualizar/falhar | Opções carregadas permanecem; loading/erro/retry separados. Adicionar/remover conserva chip compacto com área mínima24px. |
| Automação só podia iniciar no balão | Página/balão reutilizam ação com estados consultar, indisponível, iniciar e parar. Módulo/permissão obrigatórios. |
| Erro de mensagens anteriores era diferente | Ambas preservam histórico e oferecem retry específico, sem anunciar atualização concluída enquanto pendente. |
| Agenda mostrava zero falso/documentos paravam em quatro | Loading/erro próprios e retry; cache válido pode permanecer. Documentos expandem/recolhem e novo lead começa recolhido. |
| Fontes, cores, raios divergiam | Menus/filtros/picker fixos12/300, contexto compacto, controles6px/chips4px, foco neutro de busca, redução de movimento e galeria sem sobreposição em320px. Inventário completo atualizado. |
| Agrupamento atravessava a primeira não lida | Quebra no marcador; espaçamento8px e divisor equivalente. Horário/checks de mídia continuam no overlay pedido. |

O [inventário de tipografia](../audits/whatsapp-typography-inventory-2026-10-14.md) lista tamanho, peso, cores, raios e exceções por campo. Nenhuma família/token global foi trocado; primitivas de `components/ui` não foram editadas nesta rodada.

### Validação desta rodada

Provas agregadas: `D:/Vimob/tmp/whatsapp-audit-fixes-20261014/root/closure-proof.json`. Cada grupo identifica fonte/hash/escopo. Capturas usam Chromium fechado, CSS real e dados sintéticos; não são sessão móvel autenticada ou aparelho. A rodada inicial teve falhas de mock/contrato antigo e corrida de commit; logs iniciais permanecem, e gates finais são identificados no manifesto.

- P1 de arquivo:112 casos verdes. Autoria/visibilidade:16. Loading/slots/cache:55. Atualização de foto via cache/SSE:7. Radix/player e visual ficam nos manifests, sem soma duplicada.
- Integração página/balão:84 regressões verdes; preview antes da seleção:5; scroll de conteúdo da página:4. Fontes/menus/cards/galeria/mobile/painel/automação/notice e navegação têm logs finais próprios no manifesto.
- Go WhatsApp/Leads:1048 testes de topo passaram;139 integrações opt-in omitidas. Settings:72 passaram,2 integrações opt-in omitidas. Não são prova de banco real nesta rodada. O banco descartável e conjunto SQL anterior permanecem evidências históricas, sem execução nova aqui.
- **388 regressões distintas de frontend/modelos/hooks/Chromium passaram, zero falhas/skips**:112+16+55+7+79+84+5+4+26. Os7 casos de Radix/player são contados uma única vez dentro dos79. O complemento de4 placeholders também está incluído nesses79. Navegação26 inclui espera de commit, cancelamento e teto de páginas.
- **Tipagem global exit0; lint global exit0, zero erros e três avisos preexistentes**, restritos a dois testes de imóveis em Supabase. Logs `typecheck-last-media.log` e `lint-last-media.log`. A tipagem usa a mesma configuração estrita, com cache incremental salvo só no TMP; nenhuma regra foi afrouxada.
- A prévia Next própria foi pausada temporariamente após conferir PID/início/caminho, pois consumia cerca de5,8GB e atrasava compilação. Foi restabelecida pelo helper existente com `-ReadOnly`, em execução supervisionada, sem iniciar API Go ou processos de produção. Nenhum outro serviço foi encerrado.

### Limites que continuam exigindo ambiente

A interface pode ser homologada com a API correspondente. A prévia existente usa API publicada anterior; publicar só Web não valida projeção privada nova, recibos oficiais ou evento de perfil. Recibos oficiais vêm com a mensagem no DTO novo; aquecimento de compatibilidade é apenas para desenvolvimento local com API antiga.

Não foi medida latência real de3–4s, capacidade de5–6mil usuários, aparelho/citações, push com PWA fechada, Storage real ou EvolutionGo. Prefetch/cache reduzem trabalho concorrente, sem prometer tempo não medido. Virtualização/polling não foram reescritos sem perfil real que justificasse a mudança.

Ana permanece com diagnóstico/plano local: publicar não reabre automaticamente raiz `dead`. Recuperação publicada precisa ser pontual/autorizada, preservando identidade, FIFO e idempotência. Nenhuma mensagem foi reprocessada/descartada; novos ledgers/isolamento continuam proposta separada, não implementação concluída.

## Histórico das rodadas anteriores

## Pontos solicitados e resultado

| Ponto | Resultado local |
| --- | --- |
| Aviso grande que poluía o histórico | Faixa pequena, laranja do produto a 50%, sem borda, texto branco. Com número próprio conectado oferece iniciar conversa; sem ele oferece conectar. Conversa enviável mantém o compositor. Permissão de leitura, grupo e contato sem lead não recebem promessa de envio. |
| Iniciar pelo WhatsApp próprio | Verifica telefone atual, dono, organização e atendimento; seleciona a rota física correta. Histórico não é movido para outro número para permitir envio. |
| Contato sem lead | Captura/visibilidade durável do inbox local; responder exige criar/vincular lead e entrar no atendimento, conforme a decisão do usuário. Retenção e isolamento continuam limitados pelo contrato. |
| Dados e tags nos cards | Faixa abaixo do avatar usa a largura do card. Responsável e tags reais, sem repetir o nome do espectador. Tags mantêm a cor configurada. |
| Status da última mensagem | Mesmo `MessageStatus` do balão: relógio, um check, dois checks, dois azuis; falha tem alerta. Só aparece para saída canônica. Mensagem recebida, rascunho, presença e API antiga sem direção/status não recebem check inventado. |
| API da prévia | Texto, direção e status vêm da mesma mensagem visível e autorizada. Sem reaproveitar texto antigo após mudança de vínculo. A API publicada observada ainda não entrega os dois campos novos. |
| Tags com erro | Catálogo restrito de leitura, DTO compatível, erro/retry e operações existentes preservados. Leitura não exige permissão de gerenciar tags; escrever continua exigindo autorização. |
| Arquivar | Exige confirmação do servidor, impede sobreposição e reconcilia lista/detalhe/snapshot. Resposta tardia não fecha outra visita ou outro vínculo. Arquivar no CRM não altera a fila de envio. |
| Informações do lead | Abrem na lateral quando há espaço útil; em telas estreitas usam Sheet. Cabeçalho evita repetir nome/telefone/avatar enquanto o painel está aberto. |
| Barra superior | Ver lead → opções → buscar → recolher. Ações cinza do produto; X também cinza. Alterar visualização permanece nas opções. |
| Pipeline/etapa | Pipeline laranja suave; etapa com cor real da coluna, texto branco e compacto. |
| Nomes de pessoas | Maiúscula no início de cada parte do nome, apresentação apenas. Inclui lead, responsável, picker, autor e entrada no atendimento. Grupos, identificadores, e-mail, telefone, arquivos e conteúdo/cópia de mensagens preservados. |
| Fonte, peso e campos | Mensagem 12px/200 fixa; controles menores e leves; dados de contato 12px/300; responsável 11px/300; nome do card 12px/300. Inventário completo ligado abaixo. Sem trocar a família global. |
| Arredondamento | Blocos/painéis 8px, controles 6px, microelementos/caudas 4px. Avatares e play continuam circulares. Nenhuma primitive de `components/ui` foi editada nesta frente. |
| Busca no histórico | Campo menor, 12px/300, altura 32px, sem ring/borda preta ou laranja e sem instrução redundante. Resultados, erro, navegação e região acessível permanecem. |
| Carregar anteriores/mais conversas | Laranja a 50%, texto compacto, espera e callbacks preservados. Compartilhado entre balão, página e histórico do lead. |
| Limpar filtros/WhatsApp/ligar | WhatsApp no topo laranja a 50%; limpar cinza com hover laranja; ligar também muda para laranja no hover. |
| Mais opções/copiar/dados | Menu compacto, raio 6px; Dados da mensagem 14px/400 no título e 12px/300 nos valores. Não atribui áudio de outro corretor ao usuário atual. |
| Ir para o fim e bordas pretas | Botão neutro com contraste, contador preservado; foco do card e da mensagem não cria retângulo preto. Navegação por teclado continua disponível. |
| Imagens e horário | A decisão mais recente substitui a faixa abaixo da foto: overlay no canto, fonte branca, um horário e recibo. Imagem não colapsa o relógio quando sua dimensão intrínseca é pequena. Anexação continua autorizada e usa URL segura. |
| Áudio | Recebido mantém o formato anterior. Enviado usa avatar do autor à esquerda → play → waveform → hora branca/check à direita. Foto própria depende do ID canônico; outro autor não empresta a foto do espectador. |
| Autoria das reações | Reação da conta compartilhada exibe o autor informado ou “Conta do WhatsApp”; `fromMe` sozinho não identifica o espectador como “Você”. Abrir a lista não envia reação. |
| Baixar mídia | Controle visível, neutro e sem borda; espera impede solicitação repetida. Nenhuma mídia privada é baixada para contornar autorização. |
| Legenda e visualizador de anexos | Corrigidos dois desvios restantes: legenda herdava 40px de altura e crescia para 14px no desktop; agora mede 32px e 12px/300 em 320/1440. Botões do visualizador passaram de 14px para 12px/300, raio 6, sem reduzir as áreas de toque existentes. Prévia, legenda, remover, enviar, retry e navegação mantêm suas ações. |
| Responder/citação | Ação lateral, alvo canônico e prévia autorizada; envio preserva referência e entrada resolve o alvo. Citação estrangeira/indisponível não revela conteúdo. Aparência nativa no aparelho exige teste manual. |
| Destinatário sem WhatsApp | Projeção específica de falha, separada de incerteza de envio. Não apresenta recebido/lido nem reenvia automaticamente um resultado desconhecido. Validado com fixtures; destinatário real não foi usado. |
| Compartilhamento/transferência/push | Concessão administrativa e atendimento por lead, histórico acompanhando o lead, revalidação de envio pendente e destinatário atual do push mantidos. Banco local cobre isolamento e notificação durável; entrega na PWA fechada ainda exige teste real. |
| Sessão revogada | Todas as 54 rotas JWT do WhatsApp conferem SID ativa antes do tenant/handler. Ingressos Evolution entre servidores permanecem iguais. Frontend inclui SID autenticada no escopo das leituras: aposenta URLs e callbacks antigos, inclusive em A→B→A, preservando o rascunho do mesmo usuário. A adoção do rascunho do lead sem conversa para uma conversa preparada também foi testada. |
| Assinatura de mídia | Chamadas simultâneas para o mesmo arquivo compartilham somente o trabalho de assinatura Storage. Autorização continua antes/depois por solicitante; cancelamento, TTL e limite de memória preservados. Teste demonstrou 2→1 POSTs. Não mede os 3–4 segundos reais. |
| Mobile | Wrapper da página com raio8 e clip; lista, chat, Sheet, menus, busca e mídia exercitados em larguras pequenas. Canvas fullscreen do balão preservado. |

## Fonte por fonte

[Inventário de cada campo, tamanho, peso, cor, altura e raio](../audits/whatsapp-typography-inventory-2026-10-14.md). A referência é `app/layout.tsx`, `app/globals.css` e `config/filter-ui.ts`, não um manual paralelo inventado. Família configurada: Geist; Geist Mono para código. O navegador do usuário confirmou 80 cards carregados, nome 12px/300, responsável 9px/300 e busca 12px/300 com família computada Geist/Geist Fallback.

As capturas mobile usam Chromium isolado com dados sintéticos. O override temporário no navegador do usuário não alterou a largura real e foi removido; não é usado como prova de navegação mobile autenticada. A revisão visual do cabeçalho/painel usa componentes reais, enquanto mensagens/API desses fixtures podem ser simuladas. Os balões e citações têm harness real separado.

## Verificação e integridade

A rodada final fechou **205 regressões selecionadas de frontend/hooks/modelos, todas PASS, zero FAIL/SKIP**: 61 de balões/áudio/citação/compositor, 36 de layout/cards/busca/lista/tags, 48 de SID/drafts/scroll/slots de mídia, 55 de modelos de nomes/autoria/cache/galeria e 5 adicionais de legendas/visualizador. O grupo61 foi reexecutado depois das últimas classes de mídia e da assertiva de labels de reação. Os demais grupos só são reutilizados nas fontes que não receberam nova alteração relevante. Provas e hashes: `D:/Vimob/tmp/local-whatsapp-validation-20261013/root/final-frontend-proof.json`.

**Typecheck final: exit0. Lint global: exit0, zero erros e seis avisos preexistentes em outras frentes; lint focado das últimas fontes/testes: exit0, zero erros/avisos.** Não foram corrigidos avisos alheios para ampliar essa tarefa. Logs finais: `typecheck-media-complete.log`, `lint-release-final.log`, `lint-final-complete.log`, `lint-media-complete.log`, em `D:/Vimob/tmp/whatsapp-typography-media-local-20261014`.

- Pacote Go WhatsApp final após coalescing: **623 testes de topo PASS, zero FAIL, dois SKIP**, 290,939s. Os skips são `TestLocalEdgeExecutionFenceAndCutover` e `TestLocalUnlinkedStorageGC`, por ausência de serviços reais. **229 fontes Go iguais antes/depois.** Prova: `D:/Vimob/tmp/whatsapp-signing-coalescing-20261014/proof.json`.
- Banco descartável exclusivo `127.0.0.1:57922`, identidade conferida. **31 suítes SQL/890 asserções PASS**, rollback, nenhum skip. Nenhuma SQL desta frente foi aplicada em produção; o túnel de produção não foi usado.
- API app: 59 testes de topo PASS, zero falhas, dois testes de DB opt-out. Integração adicional com JWT assinado/SID e tenant SQL reais passou em 1 teste +80 subtestes; catálogo também tem prova SQL real anterior independente. Não se misturam essas contagens com testes de aparelho.
- Cache, outbox, FIFO, epoch, isolamento entre organizações, captura e recibos permanecem sob regressões locais. Os resultados não comprovam capacidade para 5–6 mil usuários ou latência publicada.

O manifesto final `D:/Vimob/tmp/local-whatsapp-validation-20261013/root/local-closure-final.json` registra checkout/HEAD, fontes desta entrega, logs e provas independentes. O scan `closure-nul-scan.json` verifica arquivos fonte TS/TSX/MTS/MJS/Go/CSS/SQL respeitando os ignores, sem `.env`; zero NUL é uma guarda para concluir. Os 229 hashes Go e as 31 fontes SQL foram comparados à fonte atual, sem divergência. Isso não transforma o checkout sujo numa release reproduzível.

As evidências antigas permanecem históricas, inclusive reds esperados e o script textual `floating-chat-contract` com12 sentinelas antigas em desacordo. Esse script não foi reescrito/reexecutado como gate desta rodada; os200+5 testes acima são uma seleção identificada, não uma declaração de que todo script histórico do repositório passou. A recuperação anterior de arquivos também preserva sua proveniência: Go/migrations tiveram restauração byte a byte de backups, enquanto seis arquivos de frontend/config foram reconstruídos semanticamente; não se promete identidade byte a byte nesses seis.

## Ana e plano para evitar bloqueios futuros

O [diagnóstico confirmado](whatsapp-ana-inbound-readonly-2026-10-14.md) encontrou raiz `dead` de álbum em outra rota, seguida de dependências e receipts de sessão que bloqueiam a cadeia das respostas da Ana. O candidato reconhece o álbum, mas publicar não reabre a raiz `dead` automaticamente. Nenhuma recuperação foi executada.

O [plano solicitado de isolamento e recuperação](whatsapp-route-isolated-recovery-plan-2026-10-14.md) separa captura durável/enriquecimento, retry com orçamento, heads por rota, quarentena e receipts por alvo. Preserva FIFO, identidade congelada e idempotência. **Os novos ledgers/estados desse plano são proposta, não implementação concluída.** Um timeout não vira sucesso e não permite ultrapassar dependências sem comprovar os efeitos obrigatórios.

## O que ainda depende do ambiente

1. Formar um pacote reproduzível API/SQL/Edge/Web e publicar somente quando autorizado. O principal continua com alterações locais anteriores; não foi declarado uma release limpa.
2. Recuperar pontualmente a cadeia da Ana depois de validar a compatibilidade publicada. Sem replay/descarte amplo, fake outcome ou remoção cega da barreira de sessão.
3. Conferir citações no segundo aparelho, mídia/provedor real, reconexão, recebimento e push com PWA fechada usando os números e a instância de testes do usuário.
4. Medir autorização/assinatura, transferência e decode/canplay separadamente para localizar os 3–4 segundos relatados. Coalescing evita duplicação; não elimina o fanout de arquivos diferentes nem prova uma latência final.

Para o teste manual, seguir [respostas citadas](whatsapp-quoted-roundtrip-local-2026-10-13.md) e [tags/arquivamento](whatsapp-tags-archive-local-2026-10-13.md). Credenciais são preenchidas diretamente no ambiente de testes.

## Complemento: recibos antes da prévia dos cards (rodada anterior)

No pedido posterior de14/10, a prévia compartilhada foi conferida nas listas da página e do balão. O ícone aparece antes do texto e reutiliza `MessageStatus`, preservando relógio/um check/dois checks/dois azuis e o alerta de falha. Mensagem recebida, direção ausente/inválida, rascunho, digitando/gravando e Meta não recebem um recibo de saída. Quando a direção de saída é conhecida mas o status está ausente/vazio, o relógio indica estado indisponível; não se presume enviada, entregue ou lida.

Também foram adicionadas quatro linhas no helper existente `reconcileWhatsAppMessageQueries`: as reconciliações programadas após o envio passam a invalidar a lista de conversas da mesma scope, além dos caches de mensagens/atendimento/histórico. Isso cobre a lista que permanecia com status antigo quando o primeiro GET precedia um receipt posterior e o hint Realtime se perdia. As consultas ativas são refeitas; listas inativas só ficam stale. Outra organização, usuário ou SID não é invalidada/lida. Não foram criados polling adicional, N+1 de mensagens por card, alteração de fila ou novo circuito Realtime.

São20 regressões focadas:9 cards reais em Chromium,9 do coordenador e2 com QueryClient/QueryObserver reais, helpers AST do produto, dados sintéticos e callbacks4s/15s dirigidos. A medição confere posição e atualização do ícone nas duas superfícies, incluindo uma nova resposta do cliente removendo a marca. A prova do helper distingue o fallback Node sem Window de uma conexão HTTP/Realtime real. Tipagem/lint desta rodada e hashes finais são registrados separadamente em `D:/Vimob/tmp/whatsapp-typography-media-local-20261014/preview-receipts-followup-proof.json`; o manifesto205 anterior permanece histórico, sem atribuir suas fontes à nova versão deste componente/hook.

A lista continua projetando a última mensagem registrada, autorizada e canônica da API; a tentativa otimista ainda não registrada permanece no balão. `from_me` significa saída da linha WhatsApp, podendo incluir envio pelo celular, e não autoria do espectador. Para exibir os recibos na tela que consulta a API publicada, ela precisa entregar `last_message_from_me` e `last_message_status` com texto/direção/status da mesma mensagem. Não se infere direção pelo nome, prefixo ou dono da sessão. Nenhuma API, migration ou produção foi publicada nesta rodada.

As quatro linhas foram adicionadas ao helper legado para conservar o circuito e suas chaves. A divisão futura do hook grande por consultas/mutações/Realtime deve preservar as interfaces e testes desses três caminhos; essa solicitação não inclui uma refatoração incidental. Reversão deste complemento: retirar apenas a invalidação nova e o fallback de status conhecido, preservando os demais hunks do checkout.

## Complemento: recibos nos cards visíveis antes de clicar (rodada anterior)

Registro histórico. A seção seguinte substitui as políticas de retirada de snapshots, owner ligado aos filtros e intervalo de5s; as provas71 desta rodada não são atribuídas às novas fontes.

A validação no navegador local confirmou a lacuna: a API publicada retornava 80 cards sem `last_message_from_me` e `last_message_status`. Capturar o head da conversa aberta corrigia somente o card selecionado. Essa solução intermediária foi ampliada para os cards visíveis da página e do balão, sem selecionar conversas.

O novo hook de WhatsApp usa um único `IntersectionObserver`, com margem de 96px, e lê uma página atual de até 10 mensagens pela API existente, com `includeMediaUrls:false`. Compartilha no máximo quatro leases dessas leituras de cards entre as superfícies; cada lease só é liberado quando a promessa termina, inclusive quando o transporte ignora cancelamento. A leitura normal de uma conversa selecionada continua no circuito de mensagens existente e não participa desse limite adicional. A fila global limitada guarda callbacks/leases, não um cache global de mensagens. Os snapshots permanecem no hook da superfície e são retirados ao sair da área observada. A troca de owner torna o mapa anterior imediatamente inelegível para renderização; esse único mapa pode permanecer em memória até a primeira publicação do novo owner ou o unmount.

Essa compatibilidade existe **somente em desenvolvimento no navegador localhost/127.0.0.1/::1**. Em build de produção ela não cria observer nem faz essas leituras. A solução escalável para publicação continua sendo o DTO da API Go que já projeta o texto, a direção e o status na mesma leitura da lista. Não houve publicação nem SQL nesta rodada. O navegador local consulta a API publicada em somente leitura; isso não equivale a uma API Go local em execução.

O adaptador aplica a tupla completa da mensagem persistida, autorizada e vinculada à organização, usuário/SID autenticada, conversa, sessão WhatsApp e lead esperados. Os campos próprios do DTO atual, incluindo nulos, prevalecem. Grupos, histórico, Meta e contatos sem lead não entram nessa compatibilidade limitada. A conversa selecionada fica fora da fila e da projeção de warming, usando somente seu próprio hook. Não há inferência pelo texto, horário, nome ou dono da sessão; o timestamp só impede substituir uma lista mais nova por uma leitura antiga. O horário/ordem/cursor da lista são preservados.

As revisões da lista e os hints existentes solicitam atualização coalescida, com intervalo mínimo de 5s por card, sem criar um polling adicional. Erros, cancelamento, mudança de vínculo e autorização invalidam a projeção correspondente. Respostas de outra visita, organização, usuário ou SID não publicam um recibo. Mensagem recebida, rascunho ou presença não recebe um check de saída. `from_me` continua significando saída da conta WhatsApp, inclusive pelo aparelho; não identifica por si só o autor humano ou o espectador.

Na prova real de 14/10, **80 cards estavam carregados e nenhuma conversa estava selecionada**. Seis cards exibiram recibos antes do clique, incluindo Bruno De Cássio, Ana Caroline e Ana Beatriz. Durante a observação a lista continuou recebendo mensagens novas; uma resposta recebida retirou o recibo da prévia. A captura final registra outro instante dessa lista viva e seus respectivos checks. As respostas observadas não incluíram `/mark-read`, e nenhuma mensagem foi enviada por esta validação. Captura: `D:/Vimob/tmp/whatsapp-typography-media-local-20261014/checks-before-click-real.jpg`.

A rodada atual passou **71 testes focados, zero falhas/skips**: 11 de cards reais em Chromium, 2 do helper de reconciliação com QueryClient/QueryObserver, 18 do hook de head selecionado, 20 da captura/projeção pura, 15 do novo hook visível e 5 da integração de listas. O novo hook usa React real com IO/SDK controlados; os testes de integração extraem as expressões do produto e usam uma implementação sentinela do hook com cards reais. Eles não executam a página Next inteira nem o servidor publicado. A prova de interface autenticada é a observação separada no navegador do usuário.

Os negativos cobrem produção/host remoto sem observer ou GET adicional, máximo de quatro leases entre widgets mesmo com abort ignorado, retirada da tela/unmount, erro403, sessão física divergente, hints estrangeiros, retirada de autorização, organização/usuário/SID/owner em A→B→A e troca de vínculo A→B→A sem ressuscitar o snapshot anterior. O CID selecionado é excluído da fila e da projeção também quando a rota usa UUID em maiúsculas e o DTO vem em minúsculas.

**Tipagem da fonte final: exit0. Lint global: exit0, zero erros e cinco avisos preexistentes; lint focado dos novos hooks/testes/integração: zero erros/avisos.** Nenhuma fonte Go/SQL foi alterada por este complemento. Logs, hashes e provas independentes ficam no manifesto `D:/Vimob/tmp/whatsapp-typography-media-local-20261014/preview-all-visible-final-proof.json`; o pacote anterior de205 continua como evidência histórica das partes que não receberam mudanças.

## Complemento: estabilidade e atualização fluida dos recibos

O componente compartilhado da página e do balão reserva20px para o recibo em todos os estados WhatsApp. O texto não muda de posição quando um check aparece, muda de estado ou sai. Entrada, direção desconhecida, rascunho e presença continuam sem check inventado; Meta não recebe esse espaço. A medição anterior reproduziu deslocamento horizontal de20px, sem reproduzir mudança de altura do card. Fontes, cores, arredondamento e ordem/cursor da lista foram preservados.

Na compatibilidade exclusivamente local com a API antiga, sair da área observada, pausar a interface ou fechar o balão conserva o snapshot autorizado. Até128 heads ficam em um cache privado por hook, sem persistência e sem cache global de conteúdo. Trocar filtros visuais, rolar, acrescentar uma página ou receber arrays equivalentes deixa o owner estável. Os30s são idade de revalidação quando há um gatilho existente, não um prazo para apagar checks. O coalescing passou de5s para300ms, sem criar polling. Os quatro leases globais adicionais continuam ocupados até cada promessa terminar, mesmo se o transporte ignorar abort; a fila continua limitada a16.

Conservar a prévia não conserva uma autorização perdida: mudança de organização/usuário/SID/permissão, perda de módulo/acesso, vínculo A→B→A, retirada do alvo, head mais recente e campos próprios da API aposentam os snapshots incompatíveis. Isso vale também com a interface pausada ou card fora da tela. Erros de acesso, referências inválidas e erros desconhecidos retiram a projeção; apenas falhas técnicas transitórias reconhecidas conservam a tupla ainda válida. Um hint recebido durante GET mantém seu token pendente e provoca leitura seguinte; a resposta anterior não o consome indevidamente.

**52 regressões focadas PASS, zero FAIL/SKIP:**39 do hook com React/QueryClient reais e fronteiras SDK/IO controladas,13 de cards reais em Chromium. Os negativos incluem revogação, pausa, ABA, erros definitivos, abort ignorado e hint durante leitura. Um teste com o hook real da lista, extraído por AST, recebe80 DTOs canônicos em uma chamada `getConversationsPage`, com zero `getMessages`/observer adicional. Os cards canônicos têm40 recibos já no primeiro render sem seleção; reordenar preserva nós/refs e acrescentar20 monta só os20 novos. Esses dados são sintéticos, com rede externa bloqueada; não comprovam o DTO publicado nem SLA de produção.

**Tipagem final: exit0. Lint global final: exit0, zero erros, cinco avisos preexistentes.** Lint integral do hook e lint dos cards: zero erros/avisos, sem mudar regras. O aviso novo de imutabilidade foi reproduzido na fonte anterior e corrigido mantendo um Map privado, copiado para comparação e atualizado com clear/set. Revisão independente das fontes finais não encontrou P1/P2 neste delta. Não houve alteração Go/SQL/fila nesta rodada.

No navegador autenticado,80 cards da API publicada foram conferidos sem seleção. Todas as prévias medidas, com e sem check, mantiveram x162 e espaço20px. Rolagem de600px e retorno ao início preservaram o alinhamento; mensagens reais continuaram atualizando a lista durante a observação. Isso não é medida de latência inicial ou teste do provedor. Captura: `D:/Vimob/tmp/whatsapp-typography-media-local-20261014/receipt-fluidity-real-final.jpg`.

**Limitação da abertura inicial:** a API publicada antiga ainda não entrega direção/status na lista. O cache reduz releituras e mantém a apresentação estável, mas uma abertura fria ou recarga completa ainda requer a leitura adicional local. O endpoint Go candidato já projeta a tupla completa; somente sua publicação compatível entrega texto e status juntos na primeira resposta real. Nenhuma publicação foi feita. O cache não atravessa unmount nem owner aposentado.

A prévia Next local foi recuperada pelo helper existente `scripts/local/start-frontend-published-api.ps1`, acrescido do switch opcional `-ReadOnly`; o comportamento padrão do helper continua igual. Ele inicia somente o frontend, com configuração pública já existente e bloqueio local de escrita. Não iniciou Go/túnel/banco/worker, não modificou arquivos de ambiente nem configuração publicada. Os valores de credenciais não foram exibidos. Manifesto atual: `D:/Vimob/tmp/whatsapp-typography-media-local-20261014/receipt-fluidity-final-proof.json`, com hashes, logs e limites da validação.

# WhatsApp: faixa de atendimento, autoria e respostas citadas

Escopo: ajustes locais no checkout principal `D:\Vimob\workspaces\vimob-crm`,
em 13/10/2026. Não houve acesso ao banco de produção, aplicação de SQL em
produção, publicação, replay remoto, envio real ou mudança de configuração remota.
O ajuste inicial abaixo não exigiu SQL; a validação subsequente aplicou as
migrações candidatas exclusivamente no banco local descartável, conforme a
seção de fechamento ao final deste documento.
Os deltas anteriores foram preservados. Na validação subsequente foi necessário
recuperar fontes locais corrompidos de outros domínios, com a proveniência
descrita na seção de fechamento.

## Comportamento entregue

- Balão e página Conversas usam uma faixa laranja suave com texto pequeno.
  Uma conversa já enviável por uma sessão autorizada continua com o compositor.
  Histórico sem rota enviável oferece **Iniciar conversa pelo seu WhatsApp**
  quando há uma sessão própria conectada; sem essa sessão oferece
  **Conecte o WhatsApp para iniciar o atendimento deste lead**.
  Permissão apenas de leitura, sessão ainda em verificação, grupo e contato
  sem lead não recebem uma promessa de iniciar atendimento.
- Preparar pelo número pessoal lê o telefone atual do lead, verifica sessão,
  autor e organização, e seleciona uma rota física pertencente ao número
  escolhido. Não troca a sessão de uma conversa histórica para enviar nela.
  Havendo mais de um número próprio, a escolha é explícita. No histórico do
  lead, a escolha usa o mesmo fluxo de envio/entrada no atendimento existente.
- A página prepara a rota dentro dela mesma; não depende de um balão oculto.
  A mudança de rota limpa a resposta selecionada e preserva os rascunhos
  anteriores em seu escopo. Entrar no atendimento e enviar continuam ações
  separadas, com suas validações existentes.
- Histórico sem lead só é anexado após prévia e confirmação. Telefone alterado
  exige confirmação da conversa anterior e, quando necessário, do histórico
  do novo destino. Cancelamento e mudanças de lead, usuário, organização,
  permissão ou sessão invalidam o intento, inclusive A→B→A e resposta tardia.
- O servidor recebe `ownSessionOnly` opcional nos pedidos de início e vínculo.
  Quando true, exige dono atual sob os locks de sessão/conversa existentes.
  O padrão false preserva os atendimentos compartilhados autorizados.

As telas legadas acima de 800 linhas receberam integração e guardas pontuais.
A lógica nova de preparo, faixa, diálogos e escolha própria ficou em arquivos
separados do domínio, abaixo do alvo de 400 linhas. Uma divisão futura das
telas deve separar seleção, histórico e composição, preservando os testes e
intentos existentes; não foi feita refatoração incidental nesta correção.

## Autoria

`from_me` indica saída pela conta do WhatsApp; não identifica quem está olhando
o CRM. Dados da mensagem separam **Direção: Enviada/Recebida** de **Remetente**.
O nome vem da mensagem canônica. O marcador pessoal depende de igualdade entre
`sender_user_id` e o usuário atual, sem inferência pelo dono da sessão.
Sem autoria disponível, a interface usa uma identificação neutra.

O DTO principal agora inclui a coluna existente `sender_user_id`. Não foi criada
migração nesta rodada. A reconciliação entre echo canônico e mensagem pendente
preserva o nome CRM junto do autor, quando a proveniência corresponde; um echo
sem autor CRM não passa a ser atribuído ao espectador. Agrupamentos visuais
separam autores distintos mesmo quando os nomes coincidem.

O quote canônico mantém o formato anterior e seu nome real. Não acrescenta
`sender_user_id` no objeto aninhado enviado pelo servidor, para preservar a
compatibilidade com clientes anteriores que validam esse objeto estritamente.
A interface aceita esse campo opcional em citações locais otimistas.

## Respostas citadas

O fluxo local já aceita responder por texto, imagem ou áudio com o ID canônico
da mensagem. Antes do envio, a API verifica captura, lead e sessão do alvo;
responder não permite citar uma mensagem privada de outro número ou lead.
O recebimento preserva a referência também nos blocos estruturados suportados.
Go e Edge reconhecem `stanzaID` além dos aliases já existentes.

A prévia recebida é projetada de uma mensagem canônica autorizada. Corpo de
`quotedMessage` informado pelo provedor não é copiado para contornar captura
ou autorização. Alvo indisponível retorna somente referência e
`available:false`, sem nome, texto, mídia ou navegação privada.

O [contrato oficial de respostas do EvolutionGo](https://github.com/evolution-foundation/evolution-go/blob/main/docs/wiki/guias-api/api-messages.md)
usa `messageId` e `participant`. Seu
[adaptador atual](https://github.com/evolution-foundation/evolution-go/blob/main/pkg/sendMessage/service/send_service.go#L2243)
monta o contexto de resposta com corpo citado vazio. Os testes locais comprovam
a referência enviada ao adaptador; a aparência da prévia no telefone do
destinatário exige piloto com a versão realmente instalada. Não foi feito
envio real nesta rodada.

## Verificação local da etapa inicial

Esta tabela registra a execução inicial, anterior à recuperação dos arquivos
e à preparação do banco descartável. O fechamento abaixo atualiza os gates.

| Camada | Resultado |
| --- | --- |
| Decisão da faixa, autoria no agrupamento e criação de citação | 14/14 testes Node, sem skips. |
| Balão, lead, escolha própria e regressões de conversas | 125/125 testes de handlers/hooks; após o acabamento da faixa única, 37/37 casos tocados passaram novamente, sem skips. |
| Autoria e detalhes do áudio | 47/47 modelos Node; 31/31 Chromium, sem skips. |
| Preparo da página em React montado | 24/24 Chromium, sem skips; APIs sintéticas, rede externa bloqueada. |
| Transporte real com autenticação/HTTP sintéticos | 10/10 Node; flags pessoais chegam ao servidor, chamadas compartilhadas mantêm o corpo anterior, flag inválido não executa HTTP. |
| Pacote Go WhatsApp | 506 testes top-level passaram, 0 falharam; 105 testes de banco pulados por ausência de ambiente local fiel. |
| Apresentação de citações Edge | 6/6 Node; aliases de `stanzaID` e blocos estruturados camel/Pascal. A bateria Go também cobre 28 variantes. |
| TypeScript do pacote WhatsApp | Config externa herda a configuração do produto e inclui os fontes atuais e imports transitivos; exit 0. |
| ESLint dos fontes alterados | Root e grupos balão/lead/autoria: exit 0, sem avisos. |
| Gate global de tipos | `npm run typecheck` falhou com caracteres inválidos em `AgendaScreen.tsx`, `EventsList.tsx` e `hooks/use-stage-inactivity-automation.ts`; esses arquivos de outros domínios não foram editados. |

Evidências: `D:\Vimob\tmp\whatsapp-own-start-notice-20261013\root`,
`...\surfaces`, `D:\Vimob\tmp\whatsapp-message-authorship-20261013\bubble`
e `D:\Vimob\tmp\whatsapp-quoted-replies-20261013`.
O manifesto `root/candidate-final.json` reúne hashes, baselines e resultados separados por camada.
Testes SQL/integração que dependem de banco não equivalem a testes aprovados
quando pulados; os resultados Go/Edge finais estão registrados no manifesto.

## Limites e publicação

O erro da interface que identificava o espectador como autor foi reproduzido
localmente. Os dados do áudio específico em produção não foram consultados;
não se atribui seu problema a migrations pendentes sem verificar a linha real.
Histórico antigo sem autor identificável não recebe um nome inventado.

A fila FIFO, retries e ordem de cutover não foram reestruturados. No ingresso,
o delta desta rodada limita-se a apresentação da citação e reconciliação da
autoria, sem reenviar ou consumir mensagens de produção.

Antes de publicar, compor uma release reproduzível, fechar o gate global,
validar os testes com banco fiel e alinhar frontend/API/Edge. Frontend que usa
`ownSessionOnly` exige API com esse contrato; um servidor anterior pode rejeitar
esse pedido. Realizar piloto autorizado com número pessoal e compartilhado,
histórico sem lead, telefone alterado, autoria de outro corretor e citação nos
dois sentidos. A produção e a visualização completa autenticada não foram
homologadas nesta rodada.

Reversão do código deve aplicar somente os deltas desta rodada contra seus
baselines, preservando os demais trabalhos locais; não usar reset do checkout.
Uma confirmação real de vínculo exige revisão de dados própria, não se desfaz
restaurando arquivos. O plano não autoriza qualquer operação em produção.

Referências locais: [experiência de conversas anterior](whatsapp-conversation-experience-local-2026-10-12.md),
[fila e cutover](whatsapp-inbox.md).

## Fechamento local e acabamento solicitado

O balão e a página reutilizam o catálogo restrito de tags. A leitura não exige
permissão de gerenciar tags; alteração de tags mantém a autorização de operar
o lead. O GET de tags passa a validar a sessão ativa antes de resolver a
organização. A regressão de rotas usa JWT assinado e cobre 28 cenários finais
de GET/HEAD, catálogo/completo, sessão revogada, ausente, de outro usuário,
recuperação, indisponibilidade do checker e isolamento entre organizações.
O checker e a resolução de tenant desta regressão são sintéticos; a prova SQL
do catálogo e do arquivamento é separada.

O arquivamento aguarda confirmação `{ok:true}`, evita operações sobrepostas e
invalida a lista e os detalhes no escopo original. Uma conclusão antiga não
fecha uma visita nova ao chat. O fluxo não altera o arquivo no aparelho.
Os detalhes e limites estão no [registro de tags e arquivamento](whatsapp-tags-archive-local-2026-10-13.md).

Nos cards, tags e responsável ocupam a faixa abaixo do avatar. A prévia de uma
mensagem enviada mostra seu recibo real; mensagens recebidas não recebem
recibo de envio. Texto, direção e status vêm da mesma mensagem canônica,
autorizada por organização, conversa, captura e lead. Sem uma mensagem
autorizada, a prévia antiga é limpa. A pesquisa segue essa mesma projeção,
evitando pesquisar texto que deixou de estar disponível após mudar o vínculo.
A ordenação e o cursor da lista continuam no contrato anterior.

Na página, os dados do lead abrem ao selecionar a conversa quando a largura
útil permite as duas áreas. Em telas estreitas, o painel permanece disponível
por ação explícita sem cobrir automaticamente o chat. O topo conserva as
ações Ver lead, menu, dados e pesquisa; Mudar vínculo da conversa fica no menu.
Com os dados abertos, o nome, telefone e avatar duplicados saem do topo.
O funil usa laranja suave e a etapa usa a cor real da coluna. As tags do painel
também começam abaixo do avatar.

Após a correção visual solicitada, os controles do topo seguem o padrão neutro
de Agenda/Contatos, usando `FILTER_UI.trigger` e fundo cinza claro. O texto das
mensagens usa peso 200, com tamanho fixo de 12 px em telas pequenas e largas,
preservando a formatação explícita de negrito. A faixa de
início usa o laranja do produto a 50%, sem borda, com texto branco. Horário e
recibo ficam à direita nas mensagens enviadas; horário à esquerda nas
recebidas, inclusive nos estados de mídia indisponível.

O hook de rolagem cancela seus frames pendentes ao fechar ou trocar o escopo.
Uma paginação que termina depois da desmontagem não agenda uma restauração
antiga. Os 16 casos do harness de ciclo de vida passaram. A antiga suíte
estática `floating-chat-contract.test.mts` continua parcial: 16/28 passaram na
execução registrada; os demais sentinelas de fonte não foram atualizados.
Isso não equivale a uma validação completa dessa suíte ou a uma falha de
produção demonstrada.

### Banco e tipos

O cluster descartável está limitado a `127.0.0.1:57922`, com identidade, PID,
diretório e fsync conferidos pelo runner. O túnel `55432` não foi usado.
Foi carregado apenas o schema, com dados de negócio sintéticos. Recursos de
infraestrutura ausentes foram omitidos; não há equivalência de Edge/Storage
HTTP nem dos serviços do provedor. Aplicaram-se 43 migrações candidatas não
vazias posteriores ao baseline e três cutovers, somente nesse cluster.

As 31 suítes SQL passaram: 890 asserções, zero falhas e zero skips, com
rollback. Incluem captura, vínculo, FIFO, reações, retenção, push durável e
isolamento. As respostas citadas foram exercitadas em handlers Go, outbox,
inbox, worker e leitura pública, com provedor HTTP simulado em loopback.
O replay duplicado mantém o recibo e não duplica o envio ou a mensagem
recebida. A prévia no segundo aparelho permanece para o teste manual do
usuário no [roteiro de respostas citadas](whatsapp-quoted-roundtrip-local-2026-10-13.md).

O gate global de TypeScript terminou sem erros após a recuperação. O lint
global terminou com zero erros e seis avisos preexistentes. O build das
validações terminou sem diagnósticos; as 23 validações de WhatsApp passaram
com o resolver de aliases já existente no projeto.

O primeiro EXPLAIN local da nova prévia, em um cenário de uma conversa e mil
mensagens, usou o índice de timeline e mediu 0,220 ms, mas falhou na limpeza
posterior por timeout. Essa execução foi preservada. A repetição final passou
inclusive na limpeza e mediu 0,191 ms, usando o índice de timeline. Isso não
prova latência em produção ou capacidade para milhares de usuários. A busca
repete a projeção autorizada no filtro e no SELECT; seu custo em carga não foi
medido.

O pacote Go WhatsApp completo passou na rodada final: 616 testes de topo,
614 PASS, zero falhas e dois SKIP, em 399,623 segundos. Os dois skips exigem
Edge/Deno e Storage HTTP reais, ausentes no ensaio. Os hashes dos 227 fontes
Go do pacote permaneceram iguais antes e depois da execução. A prova está em
`D:/Vimob/tmp/whatsapp-db-validation-20261013/full-go-closure-proof.json`.
Uma validação adicional do catálogo de tags passou com JWT, `auth.sessions`,
checker SQL, tenant e handler reais: GET permitido sem TagManage, POST negado
e SID revogado negado antes da resolução do tenant, sem efeitos duráveis.

### Recuperação e limites

Havia arquivos locais com bytes NUL que impediam a compilação. Os fontes Go
com backup e a migração de grants da Agenda foram recuperados com evidência
de bytes. Cinco fontes de frontend/Google e um teste de stageconfig exigiram
reconstrução semântica sobre a última evidência disponível; não são declarados
idênticos byte a byte à versão perdida. As regressões de Agenda, Google,
stageconfig e propriedades foram executadas, com resultados separados nos
manifestos de recuperação. O scaffold vazio de migração Google foi preservado
fora da cadeia ativa; nunca continha SQL ou efeito no ledger.

Não foi feita navegação autenticada completa no CRM, envio real, teste de push
com PWA fechada, execução dos serviços Edge/Storage HTTP, carga de produção
ou publicação. O checkout mantém alterações locais anteriores e não foi
declarado uma release limpa. Frontend, Go e Edge compatíveis precisam compor
a mesma release antes do piloto autorizado.

### Tipografia e controles: solicitação adicional de 14/10

A referência central é `app/globals.css` (tokens em 72–83 e regras semânticas
em 418–464), com densidade de controles em `config/filter-ui.ts`. Não foi
localizado um arquivo separado chamado manual de fontes. O relatório
`docs/audits/home-design-debt.md` registra diretrizes de auditoria, mas não
substitui a cascata CSS realmente aplicada. As fontes configuradas são Geist
e Geist Mono; a família não foi alterada nesta rodada.

| Uso | Tamanho | Peso aplicado pelo padrão semântico |
| --- | --- | --- |
| Título de página | 18 px | 400 |
| Título de seção | 16 px | 300 |
| Título de card | 14 px | 300 |
| Corpo | 14 px | 300 |
| Legenda | 12 px | 300 |
| Controle compacto | 11–12 px | 300 |
| Corpo de mensagem WhatsApp | 12 px fixos | 200, exceção solicitada pelo usuário |

Títulos dentro dos diálogos usam 400 pela regra global do portal; o título
Dados da mensagem usa 14 px. Ênfases usam 400, com 500/600 reservados a
destaques raros. Controles usam raio de 6 px; blocos e popovers usam 8 px e
microelementos, 4 px.

A busca compartilhada ficou com campo de 32 px, texto 12 px/300 e foco neutro,
sem borda inferior, borda laranja ou a instrução vazia para digitar. Resultados,
carregamento e erros continuam apresentados quando existem. O botão de
mensagens anteriores foi compartilhado entre balão, página e histórico do
lead, com laranja a 50%, texto 11 px/300 e os callbacks anteriores.

O menu de mensagens usa texto 12 px/300 e controle de opções com raio 6 px.
Dados da mensagem usa título 14 px/400 e valores 12 px/300. A solicitação posterior
do usuário substituiu a faixa abaixo da foto: hora branca, recibo e anexação
voltaram ao overlay no canto da imagem. A anexação mantém o gate de permissão
e URL segura. Os estados de falha e espera mantêm um horário único. A imagem
preserva o limite de 280/300 px e não colapsa o overlay quando tem dimensão
intrínseca pequena. Áudio recebido mantém o formato anterior; áudio enviado
usa avatar do autor à esquerda, play e waveform, terminando com horário branco
e recibo à direita. Foto do espectador só é usada com o ID canônico do autor
igual ao dele. Uma divisão maior de `MessageMedia` é trabalho separado.

Na revisão da cascata, listas e textos de contato/localização estavam
herdando 300 apesar do wrapper 200. O teste reproduziu o desvio e passou após
esses textos herdarem explicitamente o peso do corpo da mensagem. Negrito
explícito e peso dos controles foram preservados. Os títulos compactos do
lead e contato usam os tokens de card, sem mudar o CSS global.

O harness real de balões passou inicialmente em 38/38, sem skips ou rede externa, incluindo
64 combinações de horário/recibo, imagem com/sem legenda, estados de mídia,
gate de anexação, menus em telas pequenas/grandes e temas claro/escuro. Os
logs e capturas estão em `D:/Vimob/tmp/whatsapp-typography-media-local-20261014`.
As execuções posteriores e a revisão final estão no relatório de fechamento
de 14/10; essa contagem histórica não é usada como resultado da versão final.
O harness mede CSS e geometria; não prova aplicação da fonte carregada no
navegador autenticado nem envio real ao aparelho.

### Investigação da Ana: leitura publicada autorizada em 14/10

A investigação posterior consultou o banco publicado no Supabase já aberto
no navegador do usuário. Todas as consultas usaram transação somente leitura,
timeout de 5 segundos, lock timeout de 1 segundo e rollback. Não houve alteração
de mensagens, vínculos, filas, migrations, replay ou publicação. O Studio
salvou automaticamente apenas o snippet privado de consultas separado do
snippet anterior do usuário.

A cadeia e seus limites estão no
[diagnóstico da Ana](whatsapp-ana-inbound-readonly-2026-10-14.md). O evento raiz
de álbum foi rejeitado pelo processador publicado e esgotou as tentativas;
dependências e barreiras antigas de sessão impedem a captura das respostas
recentes da Ana. O candidato local reconhece o formato de álbum, mas publicar
um parser compatível não recupera sozinho eventos já `dead`. A recuperação
continua pendente de operação autorizada e verificação do pacote API/SQL/Edge.

### Fechamento posterior de 14/10

O [relatório final local](whatsapp-final-local-closure-2026-10-14.md) consolida205 regressões selecionadas frontend/hooks/modelos PASS, typecheck final exit0, lint sem erros,623 testes Go PASS/2 skips de serviços reais e890 asserções SQL locais. Inclui escopo por SID com preservação de draft, áudio enviado com avatar correto, autores de reações compartilhadas e legendas/controles de mídia compactos. As contagens antigas acima documentam suas fases e não substituem a fonte final. Citação no segundo aparelho, PWA fechada, latência real e recuperação publicada da Ana continuam explicitamente pendentes.

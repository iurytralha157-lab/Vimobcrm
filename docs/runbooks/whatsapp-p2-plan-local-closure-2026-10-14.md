# WhatsApp: execução local do plano P2 e movimento reduzido

Checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`, base
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. O checkout começou com 1885
entradas de alterações locais. Esta rodada preserva esse trabalho e não faz
commit, push, publicação, configuração remota, replay ou envio real.

**Dependência confirmada pelo usuário em 15/10:** o novo trabalho de filas
continua em andamento. Seus arquivos não devem ser alterados para fechar esta
rodada. O gate integral de CI permanece pendente até estabilizar essas fontes;
diagnósticos independentes não o substituem.

## Correções de produto

| Ponto | Resultado local |
| --- | --- |
| P2: vínculo existente aparecia como ausência durante leitura auxiliar | O painel distingue carregamento, falha e vínculo fora do catálogo. `Sem responsável` e `Nenhum` exigem ausência real do ID. Nome/imóvel já resolvidos permanecem durante refetch ou erro. |
| P2: proxy legado consumia o corpo e registrava dados antes da autorização | A validação do segredo de servidor precede leitura do corpo e cliente privilegiado. Configuração ausente retorna 503; requisição não autorizada retorna 403. Logs não incluem payload, QR, mídia, telefone, instância ou erro bruto. |
| P2: sondagens e notificações legadas podiam aguardar indefinidamente | Um limite de 5 segundos cobre HTTP e leitura JSON nas chamadas corrigidas de status/saúde/notificação. Cancelamento limpa timer/listener. Uma resposta tardia não atualiza o resultado abandonado; falha de sondagem conserva estado desconhecido, sem declarar desconexão. Não há retry automático de POST com resultado incerto. |
| P3: alguns controles ignoravam movimento reduzido | Spinner do compositor e transições do acionador flutuante respeitam a preferência. Estado pendente, bloqueio de envio, clique, arraste e restauração de foco permanecem. |

O proxy continua legado e não recebeu uma reescrita de transporte de todos os
seus comandos. Os três endpoints permanecem com a situação de roteamento
anterior; ausência de consumidor encontrado no frontend/API não comprova
ausência de consumidores externos. Não foram alterados modo, allowlist,
cutover, JWT de gateway ou configuração do Supabase.

O manifesto Edge atualiza apenas os três hashes de fonte e o hash de `_shared`.
Versões, captura de deployment, lifecycle, status e demais campos permanecem
iguais. A mudança é inventário local, sem publicação de função.

## Preservação de interface

`ConversationLeadPanel.tsx` delega somente os rótulos a
`conversation-lead-panel-model.ts`. Classes, IDs, handlers e permissões foram
preservados. O componente legado diminuiu sete linhas, sem refatoração ampla.

O compositor e o acionador recebem apenas classes condicionadas a movimento
reduzido. `components/ui/message-box.tsx`, `app/globals.css` e o hook protegido
`hooks/use-whatsapp-messages-paginated.ts` permanecem com os hashes anteriores.
Família, tamanhos, pesos, cores e raios aprovados não foram trocados. O
[inventário de tipografia](../audits/whatsapp-typography-inventory-2026-10-14.md)
continua sendo a referência por campo.

As verificações visuais usam componentes/CSS reais em Chromium, com dados,
autenticação e transporte sintéticos. Incluem página e balão em 320/390/1440 px,
claro/escuro, vínculo carregando/indisponível/resolvido, refetch, leitura e
negativos de permissão. O balão conserva seu contrato próprio e não recebe
artificialmente o painel lateral da página. O harness confere tokens/tamanhos
e pesos computados, mas não carrega a fonte Geist por `next/font`.

## Gate obrigatório de regressão

O P2 de CI adiciona um alvo PostgreSQL descartável dedicado e listas explícitas
de testes. A implementação e as provas finais serão registradas no fechamento
abaixo; configuração de workflow sozinha não comprova execução no GitHub.

O destino é exclusivamente `127.0.0.1:57924/vimob_whatsapp_clone`, em uma raiz
nova chamada `vimob-whatsapp-ci`. Identidade real do cluster, diretório de dados,
nonce, banco, endereço, porta e durabilidade devem coincidir antes das fixtures.
O ramo histórico de testes locais na porta 57922 continua separado.

O bootstrap usa infraestrutura sintética para Auth/Storage/Realtime e uma
allowlist focal de DDL canônica. Não utiliza dump remoto, `.env`, banco existente,
pg_net, cron executável ou provedor. Dois trechos operacionais exatos são
omitidos com hashes de origem e execução: instalação de pg_net e agendamento
da limpeza de tickets. A definição canônica do snapshot de roteamento do B1 é
extraída separadamente; ativação, atestados e DML operacional não são executados.
Esses limites impedem tratar o ensaio como `db reset` completo ou reconciliação
do ledger de produção.

Durante a execução, outro trabalho alterou `leadscope.VisibilitySQL` para usar
`private.queue_pool_read_access`. O primeiro ensaio Go detectou dez falhas
`42883` por falta dessa dependência na fixture. O consumidor de teste passa a
usar as duas fontes canônicas de calendário e audiência de filas, com
pré-requisito exato de três colunas de tombstone. Não altera essas fontes,
o engine/claim/notificações em desenvolvimento, nem seu registro de migrações.
A suíte focal preparada inclui janela e audiência reais entre duas organizações
para evitar um verde que percorresse apenas o retorno `NULL` do pool vazio.
Ela não é contabilizada como aprovada enquanto as fontes externas mudam.

O CHECK canônico de snapshot ativo do cutover estrito de setembro também é
materializado isoladamente. Os recortes conferem fonte, assinatura/delimitador
e hash do bloco antes da execução; não executam o restante dos cutovers.

SQL executada vem de snapshot imutável materializado após conferência do hash.
As listas de testes não aceitam ausência, duplicação, falha, skip ou TODO como
aprovação. O encerramento do cluster pertence ao runner e ao passo final de CI,
com verificação do alvo mesmo após inicialização parcial.

As novas flags internas de teste e diretórios opcionais de captura estão
documentados em `.env.example` somente como comentários, com consumidor e
padrão desligado. O runner injeta a configuração sintética; nenhum arquivo
de ambiente real é alterado ou usado para descobrir um banco.

No ensaio Windows, `initdb --no-sync` pode omitir somente a sincronização inicial
da instalação descartável; isso fica identificado na prova. O servidor mantém
`fsync=on` e `synchronous_commit=on`. O job Ubuntu usa a inicialização normal.
Nenhum dos dois cenários constitui teste de queda de energia ou durabilidade
do armazenamento físico.

## Evidências e limites

As provas desta rodada ficam em
`D:/Vimob/tmp/whatsapp-p2-implementation-20261014/`, divididas em `panel/`,
`edge/`, `ci/` e `root/`. Snapshots anteriores, REDs, correções de fixture,
últimos GREENs, hashes e limites ficam identificados; tentativas intermediárias
não são somadas à contagem final.

| Verificação final independente | Resultado |
| --- | --- |
| Seis arquivos de runtime: lista, página/balão, presença, painel e movimento reduzido | 133/133 casos, zero falhas/skips/TODO. |
| Contratos de parser, processo, workflow e recortes aprovados | 32 casos aprovados. Os dois testes de pins externos permanecem pendentes/falhando por drift; não entram no total verde. |
| Edge legado e compatibilidade | 31/31: 27 casos novos e quatro regressões existentes; zero falhas/skips. Deno offline e lint focal aprovados. |
| Seis arquivos SQL originais em banco descartável novo | 137 assertions pgTAP + suíte transacional de respostas rápidas, sem skips. Diagnóstico `sql-baseline`, com `sharedQueuePending: true`. |
| Compilação local da API | `go build -trimpath` aprovado; executável não foi iniciado. |
| Build frontend isolado | Webpack e TypeScript aprovados, 85/85 páginas; 1577 fontes monitoradas sem mudança durante a segunda tentativa. |

Os 15 casos novos do painel, 17 regressões de fechamento e 15 casos de movimento
reduzido estão incluídos nos 133; não são somados novamente. O grupo Edge reúne
`whatsapp-legacy-edge-hardening`, `evolution-proxy-webhook-secret` e
`message-worker-gateway-config`; este último continua no gate de release já
existente, sem duplicação na contagem desta prova.

O build usou ambiente sintético, bloqueou dotenv e backend, permitiu apenas
fontes públicas do Google e preservou `.next`/`.next-wa-e2e`. Os deltas gerados
em `tsconfig.json`/`next-env.d.ts` foram restaurados somente após conferir os
hashes próprios. A primeira tentativa compilou, mas atingiu o limite reservado
de 1536 MB no TypeScript; a segunda passou com 3072 MB. Não houve supressão de
tipagem. Esta prova cobre webpack, não o bundler padrão Turbopack ou uma imagem
de release configurada para produção.

O ensaio Go anterior executou os 20 casos selecionados e revelou dez falhas
por falta da função compartilhada de filas na fixture. O gate integral atual,
os dois pins e o sétimo SQL de audiência continuam pendentes do trabalho
externo; não foram convertidos em sucesso. O job do GitHub não foi executado.

A tipagem global passou, e o lint global terminou sem erros e com três avisos
preexistentes em dois testes de propriedades. O inventário geral foi
regenerado uma vez; alterações externas posteriores voltaram a deixá-lo
desatualizado. O verificador global de migrações encontrou novas fontes de
filas ainda fora do source lock. Esses gates não devem ser apresentados como
aprovados nem corrigidos mediante alteração do trabalho paralelo.

O manifesto `root/source-proof.json` delimita 34 caminhos desta rodada:
oito de implementação, um manifesto Edge, vinte de testes/infraestrutura de
teste, um workflow, três documentos/inventários e um exemplo de configuração.
Essa contagem não representa todo o domínio WhatsApp. Os legados maiores não
receberam refatoração ampla; a pequena admissão de CI no teste Go existente
reutiliza o guard novo, mantendo o destino histórico separado.

A prévia local foi restaurada em `http://127.0.0.1:3000`, no mesmo modo de
somente leitura com API publicada que existia antes desta rodada. Ela não
executa a API Go candidata. A prova final dessa restauração fica em
`root/preview-restored.json`; o fechamento dos resultados independentes e
das pendências externas fica em `root/closure-proof.json`.

Permanecem fora desta prova: Safari/aparelho/PWA reais, latência do provedor,
capacidade de 5–6 mil usuários, ledger/flags montadas no destino, consumidores
externos dos endpoints legados e recuperação das mensagens históricas da Ana.
Publicar código não reabre automaticamente uma raiz `dead`. Piloto e recuperação
exigem a operação pontual autorizada e a identidade/ordem/idempotência conferidas.

## Reversão

Para desfazer esta rodada, reverta somente seu delta de produto, testes,
workflow e hashes do manifesto usando os snapshots desta execução. Não use
reset/clean sobre o checkout compartilhado. Não há migração nova de produto
nem alteração publicada para desfazer; o banco sintético é encerrado pelo
helper após conferir sua identidade.

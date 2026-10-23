# WhatsApp: conversa e balões — ajustes locais

Escopo autorizado: checkout principal `D:\Vimob\workspaces\vimob-crm`,
branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
As alterações locais anteriores foram preservadas. Este pacote não é um SHA
de release; há trabalho de outros domínios no mesmo checkout.

Nenhum deploy, push, migration remota, replay, envio real ao provedor ou
alteração de produção ocorreu nesta rodada. FIFO, outbox, inbox, CID e a
autorização vigente continuam nos caminhos existentes.

## Comportamento resultante

| Área | Implementação |
| --- | --- |
| Blocos de conversa | Balões consecutivos agrupados visualmente por direção, remetente, conversa, sessão, dia e intervalo de até cinco minutos. Eventos de atendimento quebram o bloco. IDs e registros permanecem individuais. |
| Ações de mensagem | Responder e reagir ficam ao lado do balão. Ações acessíveis por hover, foco e toque; menu com copiar, responder e detalhes reais. Sem botões de operações do provedor que o backend não oferece. |
| Texto | Links e emails preservados antes da interpretação de menções. Negrito, itálico, riscado, código, listas e citação renderizados como elementos React, sem HTML fornecido pelo remetente. Prévia da lista usa o mesmo parser. |
| Mídia | Página passa tamanho da mídia ao balão; figurinha tem um único horário/status. Galeria percorre imagens e vídeos autorizados carregados; arquivo armazenado só ganha URL no GET autorizado do item escolhido. Revogação, remoção, aborto, troca de contexto e ABA descartam respostas antigas. |
| Reprodução | Áudio, vídeo e prévia da gravação compartilham coordenação para interromper o player anterior. |
| Reações | Contagem por emoji, participantes, atalhos e catálogo pesquisável. Somente alvos com capacidade explícita do servidor podem reagir. |
| Anexos | Selecionar, colar ou soltar prepara uma revisão. Legenda, remoção e seleção de até dez arquivos de no máximo 5 MB cada. Somente confirmar envia, sequencialmente pelo caminho idempotente existente. Falha ou resultado incerto interrompe o lote; verificação reaproveita a intenção original. |
| Primeiro contato pelo lead | O lote pode acompanhar exclusivamente sua própria preparação de rota nula para conversa física, com adoção explícita depois dos fences de autorização e seleção. Mudanças de conversa física, permissão, organização, sessão e ABA aposentam o lote anterior. |
| Rascunhos | Texto compartilhado por página, chat flutuante e lead; `sessionStorage` mantém no reload da mesma aba. Chaves incluem usuário, organização, escopo de acesso, conversa e lead. Limites: 24 horas, 50 rascunhos, 10 mil caracteres. Arquivos e gravações não são persistidos. |
| Histórico | Wakes preservam a reconciliação rápida do head. Páginas históricas já carregadas são revalidadas em lotes de quatro, com continuação após um segundo e ciclo de 30 segundos; DTO novo não sobrescreve uma alteração posterior ao snapshot. |
| Falha de atualização | Conteúdo já carregado permanece com aviso e retry. Negação de acesso limpa somente o escopo correspondente. Não expor erros brutos. |
| Busca e citações | Leitura das páginas autorizadas existentes, sem inserir resultados no cache do chat. Até quatro páginas por ação de busca, com continuar; navegação carrega até doze páginas por tentativa. Identidade por ID canônico ou ID do provedor único dentro da conversa/sessão, sem telefone como alias. |
| Não lidas | Marcador no trecho carregado e contador no salto ao final. Página e chat flutuante só solicitam leitura com aba visível, permissão vigente, fim do chat e head canônico pelo menos tão recente quanto o DTO da conversa. |
| Cabeçalho e painel | Identidade do contato é principal; pipeline e etapa são secundários. Painel do contato começa recolhido e pode ser aberto pelo controle existente. Fonte e tema do Vimob preservados. |

## Limites que permanecem explícitos

- A marcação de leitura atual zera um contador por conversa. O marcador local
  é uma aproximação baseada no trecho autorizado carregado; não existe um
  watermark transacional por mensagem. Uma entrada concorrente antes do POST
  pode participar do contador zerado. Histórico agregado do lead não ganhou
  um POST de leitura inventado.
- Busca profunda é progressiva, não um índice completo no servidor. Recibos,
  exclusões e mídia do histórico profundo dependem da profundidade das páginas
  e da latência da revalidação. A recuperação anterior de head sem sobreposição
  continua podendo refazer a leitura canônica completa.
- Editar, apagar para todos e encaminhar pelo provedor não têm operações
  completas no cliente/Go revisados. Não foram apresentados como controles
  funcionais. Os campos atuais da lista tampouco provam direção/status/tipo
  estruturado de toda última mensagem; não se inventa esse dado a partir do texto.
- A referência macOS orientou organização e comportamento. Testes locais não
  provam paridade visual com uma instalação atual do WhatsApp no Mac.
- Os quatro candidatos SQL da rodada anterior continuam sem aplicação nem
  validação nesta rodada. Docker/WSL local permanece um gate separado; não
  houve reinício global. Não considerar estes testes homologação de produção.

## Evidência e gates

Evidência preservada em `D:\Vimob\tmp\whatsapp-mac-experience-20261012`:
baselines, manifests por área, RED de regressões reproduzidas e logs GREEN.
Os testes de navegador executam React instalado e componentes/hooks reais
com APIs sintéticas e rede bloqueada, sem servidor CRM nem banco de produção.
Testes RAM com scheduler/DOM determinísticos são identificados separadamente.

Verificação dos módulos congelados:

| Conjunto | Resultado e alcance |
| --- | --- |
| Balões, players e galeria | 23/23 Chromium real e 35/35 Node; lint do escopo sem avisos. O harness não carrega Tailwind e não comprova geometria macOS. |
| Atualização e cache | 25/25 React/QueryClient real e 32/32 helpers. |
| Busca e navegação | 9/9 React real e 12/12 RAM. |
| Anexos, rascunhos e store | 22/22 React anexos, 9/9 React rascunhos, 5/5 store. RED confirmou callback antigo em ABA, envio de arquivo removido, legenda antiga e indicador sem atualização. |
| Float, lead, scroll e leitura | 94/94 RAM nos bytes finais; inclui 16 casos compartilhados de feedback. |
| Integração das telas | 80/80 Chromium antes dos últimos refinamentos e dos tokens finais. Os quatro casos novos de foco, revogação de citação, drop sobre histórico e legenda passaram nos bytes finais. Uma tentativa de repetir a suíte inteira não executou assertions: timeout no bootstrap de 300 s, registrado como incompleto. Não contar falha de setup como defeito do produto nem como PASS. |
| Tipagem atual do WhatsApp | PASS: config de validação externa aponta 48 fontes atuais e seus imports transitivos, herdando `tsconfig.typecheck.json`, sem alterar a config do produto. |
| Gate global | A primeira execução de `npm run typecheck` terminou com erros fora do pacote e erros nossos posteriormente corrigidos. A repetição global travou sem diagnóstico e foi encerrada apenas no processo próprio. Lint ROOT final também ficou incompleto no import da config, inclusive em tentativa com limite de 180 s. |

Tokens por identidade impedem reuso de callbacks depois de A→B→A e unmount.
O envio confirmado lê a seleção e a legenda atuais, não uma lista capturada
antes de o arquivo ser removido. A adoção explícita da preparação de conversa
continua protegida por seu próprio attempt e uma única transição autorizada.
Os indicadores de rascunho assinam a revisão do store, mesmo sem conversa
selecionada. O último refinamento também fecha leitura durante falha de
reconciliação, trata drop no histórico e coloca foco no compositor ao responder.

Não transformar o PASS de tipagem do pacote em PASS global. Os logs de setup
interrompido e os diagnósticos anteriores foram preservados; somente jobs
identificados desta tarefa foram encerrados, sem reiniciar serviços/dependências.

Antes da publicação conjunta: repetir os gates da release local, validar os
SQL em banco fiel, definir um conjunto reproduzível de alterações e executar
o piloto autorizado. Nada nesta documentação autoriza a publicação.

Referências: [contrato funcional](../whatsapp-contrato-funcional-parte-1-2026-10-08.md),
[correções anteriores](whatsapp-deep-fixes-local-2026-10-12.md),
[release local](whatsapp-local-release-2026-10-11.md).

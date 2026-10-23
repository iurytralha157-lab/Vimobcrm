# Pipeline: Agenda no histórico do lead — item 11/P5

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`.
Base: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com alterações locais anteriores preservadas.
Evidências: `D:/Vimob/outputs/pipeline-agenda-history-p5-fix-20261019-d121`.

## Problema reproduzido

A Agenda grava o nome do compromisso na descrição da timeline. O histórico
ignorava essa coluna e procurava um título em metadados que o produtor não
enviava. Criação, remarcação, conclusão e cancelamento podiam apresentar apenas
um horário ISO; não comparecimento, comentário e atualização apareciam como
“Atividade registrada”. A regra de apresentação também estava repetida entre o
builder e a bolha do histórico.

A leitura de timeline/atividades tinha ainda uma fronteira incompleta: acesso
ao lead não comprova acesso aos detalhes de um compromisso privado da Agenda.
Exibir a descrição original sem corrigir a API ampliaria essa exposição.

## Comportamento após a correção

- Os sete tipos da Agenda têm rótulos próprios: agendada, remarcada, concluída,
  não comparecimento, cancelada, comentário e atualizada. Os seis aliases
  legados de visitas/reuniões usam o mesmo presenter.
- Quando há acesso atual ao compromisso, a API fornece uma projeção explícita
  com seu título atual e o horário originalmente registrado no evento histórico.
  O título identifica o compromisso atual; não é apresentado como um snapshot
  imutável de seu nome anterior.
- A data é apresentada como `20/10/2026 às 09:00`, com o fuso da configuração
  de atendimento da organização. O fallback é `America/Sao_Paulo`.
  Datas impossíveis, formatos ambíguos e metadados com formato inválido não são
  convertidos silenciosamente em outro dia.
- Sem acesso aos detalhes, após exclusão do compromisso, vínculo com outro
  lead/organização ou referência inválida, o histórico preserva somente o fato
  genérico, seu identificador e o instante de registro. Não devolve título,
  horário agendado, descrição, comentários, responsável ou ator da Agenda.
- Comentários não passam a expor seu texto no histórico. O fato de comentar
  continua representado pelo rótulo correspondente.
- A bolha usa o rótulo/conteúdo já projetados. Não reinterpreta observações,
  arquivos ou datas brutas para reconstruir o contexto da Agenda.

A regra de detalhes reutiliza a autorização da Agenda: módulo e permissão de
leitura, participantes, administradores e escopo vigente de liderança. Ler
todos os leads ou gerenciar a Agenda não concede, por si só, detalhes privados.
Liderança não substitui participação em um compromisso privado.

As duas representações antigas de um mesmo agendamento, sem correlação
explícita entre timeline e activity, permanecem distintas. Identidade do
compromisso, título e proximidade temporal não bastam para apagar um registro
legítimo. Não houve limpeza ou reescrita do histórico armazenado.

## Escopo de implementação

- Presenter puro no domínio de histórico; builder e formatação centralizados,
  mantendo o contrato de resposta antigo e o paginado.
- Projeção SQL comum para timeline, histórico raw/paginado, hidratação de
  usuários e `/v1/activities`. Cursor e `hasOlder` continuam contando os fatos
  genéricos, sem criar buracos por filtrar depois do limite.
- Referências UUID são validadas antes do cast. A comparação mantém a chave
  indexada do compromisso sem convertê-la para texto.
- `/timeline` usava a coluna inexistente `occurred_at`; a leitura agora usa
  `event_at`/`created_at` e exige explicitamente a organização da timeline.
- A união de usuários do histórico antigo comparava texto com um parâmetro
  inferido como UUID. A comparação recebe o cast explícito correto; a execução
  em PostgreSQL sintético cobre essa consulta, além das verificações com mocks.
- Nos resumos de atividades do Dashboard e no contexto da IA, a restrição
  pontual de leitura impede que um compromisso sem acesso reapareça por outro
  caminho. Atividades de outras origens mantêm sua projeção e comportamento.
- Fontes, espaçamentos, JSX, ações, abertura/fechamento do popup, transições de
  status, cadências, financeiro e escritas da Agenda não foram redesenhados.

## Proteção da leitura direta

Foi criada pela CLI, apenas como arquivo local, a migration
`20261019230804_restrict_agenda_activity_browser_reads_to_canonical_api.sql`.
Ela adiciona uma policy SELECT restritiva para clientes `anon`/`authenticated`
nas atividades de origem Agenda. A API canônica continua responsável pela
projeção desses registros. As demais atividades conservam os acessos existentes.

O ledger anterior já restringia `content`/`metadata` ao backend. A lacuna
restante na leitura direta era a identidade do usuário/existência da atividade,
não uma nova concessão de leitura do título. A migration preserva grants,
policies anteriores, proprietário, RLS e acesso dos produtores internos.

**A migration não foi aplicada a banco algum.** O lock local registra seu
conteúdo revisado; isso não comprova instalação nem reconciliação de ledger.

## Validação

Os recibos e logs nesta pasta externa separam reprodução antes da correção,
regressões após a correção, testes principais/subtestes e casos pulados.

- Frontend/UI integrado: **1.234/1.234**, zero falhas ou skips, em 31 arquivos.
- Inclui 112 casos de Agenda/timestamps, 41 do builder com o renderer real e
  seis cenários novos do componente em Chromium: 320/390/1440 px, leitura e
  operação. Browser/API/Auth usam dados sintéticos e rede bloqueada.
- RED demonstrado antes da correção: 53 falhas no grupo inicial de 61 casos,
  30 no renderer de 41 e 16 no guard de timestamp de 51. Os grupos se sobrepõem
  em finalidade; não devem ser somados como execuções únicas da aplicação.
- Policy SQL: **47/47** cenários em PostgreSQL/PGlite descartável na memória,
  incluindo aplicação literal das migrations locais pertinentes, RLS/grants,
  leitores não Agenda, serviço interno e rollback nos preflights negativos.
- Go, nove pacotes: **1.284 testes principais e 3.590 subtestes passaram**,
  zero falhas. Foram pulados 112 principais e 86 subtestes de opt-ins/integrações,
  incluindo os que exigem banco real. Pais e filhos não são testes únicos
  somáveis. Log final: `backend-full-packages-frozen.jsonl`;
  recibo: `backend-final-receipt.json`.
- Execução independente das consultas SQL: **98/98** cenários na memória,
  com SQL extraído do código Go e seus parâmetros reais. Inclui histórico
  antigo e paginado, usuários, timeline, lista de atividades, Dashboard/IA e
  preenchimento dos limites com fatos acessíveis após atividades privadas.
- Typecheck e `audit:check`: aprovados, incluindo os quatro contratos de
  inventário. A comparação semântica dos inventários não encontrou mudanças
  de controles/telas, apenas dados derivados das fontes.
- Lint: zero erros, sete avisos anteriores em scripts/testes de outros escopos;
  arquivos desta correção passaram na conferência específica sem avisos.
- Fontes de migrations: 258 válidas. Fontes de Edge Functions verificadas sem
  alteração. Essas conferências são locais e não acessam o Supabase remoto.

O recibo `preservation-receipt.json` confere todos os arquivos monitorados
antes/depois, a lista explícita de alterações e os hashes dos ajustes anteriores.
O review por AST de `LeadUnifiedThread` comprova mudanças apenas em duas
funções de apresentação; imports, componentes e JSX permanecem iguais.

## Limites e próxima etapa

Esta correção é local. Não houve commit, push, deploy, início de serviços do CRM,
consulta a banco real, alteração de dados reais ou aplicação de migrations.
Não foi um teste com iPhone físico, provedor WhatsApp ou 300 usuários.

Na liberação futura, conferir as versões do frontend/API e as migrations
pendentes no alvo, seguindo o procedimento do repositório. Depois executar a
matriz autenticada de Agenda/histórico no ambiente de homologação/publicação.
Os testes locais não demonstram a configuração instalada em produção.

Na lista original, este fechamento corresponde ao **item 11 de 14**. Restam
os itens 12/P6 (rolagem ao atualizar o lead), 13/P6 (resposta booleana `false`
de formulários) e 14/P8 (caminhos legados sem uso), que têm escopos separados.

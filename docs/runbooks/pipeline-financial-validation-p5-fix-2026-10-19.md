# Pipeline: validação dos valores financeiros

19/10/2026. Item 10/P5 da auditoria t927. Checkout principal
`D:/Vimob/workspaces/vimob-crm`, main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Evidências locais:
`D:/Vimob/outputs/pipeline-financial-validation-p5-fix-20261019-c110`.

## Causa e contrato corrigido

O servidor usava ParseFloat sem exigir finito, sinal ou faixa. O PATCH ainda
truncava os textos antes de validá-los, podendo transformar uma entrada
inválida em outro número. O frontend recusava NaN/Infinity, mas aceitava
negativos, comissão acima de 100 e sintaxes como hexadecimal/binário. Além
disso, selecionar um imóvel substituía preço/comissão depois de validar o DTO.

O contrato de escrita agora exige:

- Valor do lead finito e não negativo; percentual entre 0 e 100, inclusive.
- Decimal canônico com ponto, sinal opcional e expoente decimal opcional.
  Hexadecimal, binário, underscore, vírgula de localização, NaN, infinito,
  NUL, overflow e não zero que desapareceria por underflow são recusados.
- Até 40 caracteres após trim nos campos recebidos, conferidos antes de
  qualquer truncamento. O texto decimal validado segue exato para PostgreSQL.
  A comparação do percentual também é exata: `100.0000000000000000001` não
  passa por arredondar para 100 em float64/Number.
- Zero, incluindo zero com sinal/expoente, é normalizado para `0`. Omissão
  continua sem alteração e null continua limpando o campo. Criação com campo
  vazio continua sem valor; PATCH vazio continua inválido, como era no Go.
  O formulário real de edição já usa null para limpar.

O cheque de float serve apenas para a faixa técnica suportada pelo transporte,
sem converter o decimal monetário armazenado nem criar teto comercial para o
preço de um lead. Valores válidos acima do limite de um lançamento podem
continuar em um lead aberto. A máscara, fontes e layout não mudaram.

## Fronteiras de escrita e valores herdados

Create/Update validam na entrada e novamente no repositório antes de acessar
o pool, cobrindo chamadas que contornem o DTO HTTP. O método real que copia
valores do imóvel valida seu resultado antes de retornar ao UPDATE. Esse
valor canônico do PostgreSQL pode ter mais precisão textual que um input de
40 caracteres; não foi aplicado a ele o limite de texto do formulário.
Visibilidade do imóvel, tenant, redação da comissão e prioridade das fontes
continuam as mesmas; desvincular e selecionar o mesmo imóvel preservam seus
contratos anteriores.

No frontend, o hook valida somente os campos financeiros antes de vincular
a operação ou publicar otimismo. O seletor de imóvel confere o snapshot antes
de alterar refs/estado/cache; shape inválido gera aviso controlado. Null, zero
e comissão ausente mantêm seus significados. O transporte já validava pelo
schema, portanto lib/api/leads.ts não precisou mudar. Schemas de leitura,
editor inline legado, contatos, histórico e ações de comunicação não foram
reescritos. Os mounts mobile/desktop usam os mesmos handlers preservados.

## Ganho, fallbacks e limite de lançamento

Entrar em Ganho usa valores já persistidos, não apenas os campos do PATCH.
Isso acontece na edição, no movimento de etapa e na finalização de uma
criação. O guard exato foi colocado no banco, atendendo os três caminhos sem
mudar snapshot, movimentação, reserva ou finalização da criação em Go.

A nova migration cria guard privado que valida os campos financeiros em
INSERT, cada campo efetivamente alterado em UPDATE e ambos em uma entrada
real em Ganho. Notas, responsável, reabertura, perda e reorder não passam a
depender de limpar um valor legado que não mudou. É possível corrigir um dos
campos sem ser bloqueado pelo outro campo legado inalterado. Não há CHECK
NOT VALID global que bloqueie toda atualização de uma linha antiga inválida.

O produtor create_commission_on_won mantém condições, atores, NOT EXISTS,
supressões de importação e a ordem de fallback: percentual do lead, imóvel,
organização e padrão 5%, com zero mantendo sua semântica legada de fallback.
Ele valida o percentual efetivamente usado somente quando vai inserir uma
comissão. A validação usa as mesmas variáveis que serão inseridas, dentro do
produtor; não é um preflight Go separado que possa ficar desatualizado.

Comissão e recebível têm amount numeric(12,2). Cada ramo confere se o valor
arredondado a duas casas cabe antes de inserir. O máximo positivo armazenável
é 9.999.999.999,99. O teste usa a expressão decimal real, incluindo a fronteira
que arredondaria para 10.000.000.000,00. O limite só se aplica ao lançamento
que será criado: existência prévia, ausência de responsável e supressão
mantêm seus caminhos próprios. Nenhuma comissão antiga é recalculada,
duplicada, cancelada ou paga por esta mudança.

Erros próprios usam constraints nomeadas e HTTP 400 com mensagem segura de
valores inválidos ou limite do lançamento. SQLSTATE/Detail, dados pessoais e
valores do registro não são expostos. Erros de outros domínios conservam o
tratamento existente. Qualquer falha reverte o lead e os efeitos da transação,
inclusive comissão inserida antes de uma falha no recebível.

## Migration, implantação futura e reversão

Migration criada pelo CLI:
`20261019224603_guard_lead_financial_values_and_generated_amounts.sql`.
Ela não repara, varre, arredonda nem apaga dados antigos. Preflight exige o
corpo canônico anterior e os atributos/WHEN esperados, incluindo as duas
supressões; divergência aborta para revisão. Owner, ACL, search_path do
produtor, grants de tabela e RLS são preservados; helpers são privados sem
EXECUTE de navegador/service_role. Lock timeout de 5s e statement timeout
de 30s limitam a instalação. O ledger já revoga DML direto do navegador em
leads; não foi afirmado um bypass de Data API instalado no alvo.

Na entrega futura, revisar o catálogo do alvo, aplicar a migration pelo
processo aprovado e atualizar todas as réplicas da API, depois o frontend.
Frontend/API sozinhos não protegem todos os valores legados/fallbacks usados
no Ganho. A migration também protege os writers anteriores durante a troca
de réplicas. O bloqueio de supabase db push do README continua vigente.

Reverter código exige selecionar os hunks contra before/, preservando o
checkout sujo. Reversão da proteção no banco exige uma migration futura
revisada; remover validação reabre a aceitação dos valores inválidos. Não
restaurar arquivos inteiros nem reescrever migrations anteriores.

Referência técnica: [tipos numeric e arredondamento no PostgreSQL](https://www.postgresql.org/docs/current/datatype-numeric.html).
Os tipos, expressão e condições efetivas foram conferidos nas fontes locais;
não foi consultado catálogo de produção.

## Verificação e limites

Os recibos em c110 registram reproduções RED, execuções GREEN, hashes,
contagens sem duplicar pais/subtestes e comparação de preservação. Testes Go
com pgx sintético e SQL em PGlite não são integração com Supabase instalado,
ensaio em iPhone físico nem carga de 300 usuários. Não houve acesso a banco
real, leitura de .env, serviço iniciado, commit, push, migration aplicada ou
deploy. O fechamento deste item é **10/14 no código local**, com os quatro
restantes tratados em lotes próprios: Agenda no histórico, scroll, respostas
booleanas de formulário e código morto.

## Fechamento verificado

- Frontend novo e regressões relacionadas: **358/358 PASS**, sem skips,
  incluindo 91 novos e 267 existentes. O corpus Go/TS de 210 vetores (79
  aceitos, 131 recusados) está dentro das verificações, sem soma adicional.
  RED anterior: 24 falhas de schema e 16 falhas dos guards, com controles
  positivos mantidos.
- Rodada conjunta com o item 09/histórico e fixtures compartilhadas:
  **1.067/1.067 PASS**, 27 arquivos distintos, zero falhas/skips. Não somar
  novamente os 358 nem as rodadas parciais. Os testes executam schemas, API,
  hooks e handlers reais com transporte/estado sintéticos.
- Go: **1.258 testes principais + 3.543 subtestes PASS**, zero falhas, em
  oito pacotes. **196 entradas SKIP**: 110 principais e 86 subtestes. Os
  opt-ins/URLs de integração foram desabilitados apenas no subprocesso;
  nenhum valor de ambiente real foi lido ou registrado. O RED por overlay
  das fontes anteriores reproduziu duas falhas principais e 154 subtestes.
- SQL: **68/68 PASS** no PGlite efêmero, usando a função anterior extraída do
  ledger e a migration nova literal. Inclui faixa/precisão/zero/fallback,
  ramos de existência de comissão/recebível, outra organização, supressões,
  validação após BEFORE, rollback de efeitos e preservação de ACL/RLS.
  Os controles de drift de corpo, atributos, WHEN e owner sem USAGE abortam
  sem alteração durável. O RED original tem 30 falhas reproduzidas; skips
  desse RED referem-se somente aos helpers inexistentes antes da migration.
- HTTP 400 e as duas mensagens públicas conferidos, sem exposição de dados
  de armazenamento. O frontend preserva essas mensagens sem novo mapeamento.
- `npm run typecheck`, `npm run lint` e `npm run audit:check` aprovados.
  Lint global: zero erros e sete avisos anteriores; fontes alteradas/novas
  com conferência focada limpa. Inventários atualizados em ordem e comparados
  sem diferenças semânticas. Source-lock verifica 257 migrations; apenas a
  nova foi acrescentada e as 256 anteriores estão idênticas. Manifesto Edge
  permanece em 41 live, 26 tombstones e 15 retired.

Preservação: **4.168 das 4.180 fontes monitoradas anteriores idênticas**,
12 existentes alteradas na allowlist e 12 novas. As 2.621 entradas locais
anteriores do Git permanecem; total final 2.633. No LeadDetailDialog, 159 dos
160 inicializadores de primeiro nível e o JSX de retorno estão literalmente
iguais; mudou somente handleSelectInterestProperty. O repositório Go mudou
somente Create, Update e o método dos valores do imóvel; types mudou somente
os dois validadores; handler mudou somente o encaminhamento de erro próprio.
Foram conferidos os hashes de 38 arquivos protegidos e os recibos das fontes
testadas, incluindo as nove correções anteriores.

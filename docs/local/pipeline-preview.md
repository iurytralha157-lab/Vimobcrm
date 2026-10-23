# Prévia local da Pipeline com salvamento

Este roteiro executa o frontend e a API Go do checkout principal
`D:/Vimob/workspaces/vimob-crm`, com autenticação GoTrue real e PostgreSQL local.
Não publica imagens, não faz deploy, não altera a API publicada e não usa o
banco operacional. A prévia de rede existente em `192.168.1.3:3000` é outro
processo e não recebe mudanças de destino por este roteiro.

## Alvo, isolamento e efeitos

| Componente | Destino |
| --- | --- |
| Interface para testar no computador | `http://localhost:3006` |
| Listener do frontend | `127.0.0.1:3006` |
| API Go local | `http://127.0.0.1:58082` |
| Supabase local atestado | `http://127.0.0.1:57421` |
| PostgreSQL local atestado | `127.0.0.1:57422`, banco `postgres` |
| Projeto descartável existente | `queue-homolog-20261015` |
| Cache próprio do Next | `.next-pipeline-local-save` no checkout principal |

A infraestrutura de QA é reutilizada; os usuários, organizações, pipelines,
etapas e leads desta prévia são novos e exclusivos de cada seed. O manifesto
privado existente deve passar pelos guards de identidade do contêiner, rede
isolada, publicação loopback, sentinela e ausência de cron ativo. Não crie um
manifesto apontando para outro banco nem afrouxe esses guards.

O seed cria duas organizações, quatro contas sintéticas, dois pipelines, dez
etapas e doze leads. As contas recebem permissões normais de administrador ou
usuário; os leads pertencem aos responsáveis definidos no fixture. Não há
sessão fabricada, JWT de usuário artificial ou bypass de autorização.

A API inicia com `API_BACKGROUND_WORKERS_ENABLED=false`, workers externos
desativados, conexões de banco limitadas e sem credenciais de provedores.
Os gatilhos normais do banco continuam ativos e podem registrar efeitos locais
nas organizações sintéticas. O frontend recebe apenas chave pública local e
destinos locais; o ambiente herdado não transporta segredos ou flags de bypass.

Use `localhost:3006` para o login na interface. Cookies não são isolados por
porta: usar `127.0.0.1:3006` pode compartilhar cookies com outras prévias de QA
nesse mesmo host. Não limpe cookies ou storage de outras origens para resolver
uma sessão desta prévia.

Esta configuração não permite testar no iPhone pela rede: frontend, API e
issuer do Auth são loopback. `127.0.0.1` no telefone aponta para o telefone.
Um teste LAN exige um roteiro separado para os três destinos; não altere os
hosts ou abra firewall como parte deste procedimento.

## Pré-condições

- Checkout, branch, HEAD e alterações locais conferidos; não restaurar arquivos
  inteiros nem misturar os ajustes das outras abas.
- Infraestrutura local do projeto acima já em execução e atestada. Este roteiro
  não cria, reinicia, migra ou limpa a stack Supabase.
- Portas `3006` e `58082` livres. O launcher recusa listeners existentes e não
  encerra processos de outras tarefas.
- Diretório exclusivo de evidências sob `D:/Vimob/outputs`, com prefixo
  `pipeline-local-save-`. Cada execução mantém seus recibos.
- Ausência de `.env`, `.env.local`, `.env.development` e
  `.env.development.local` no diretório do processo. O launcher recusa arquivos
  que poderiam introduzir configuração externa. Não renomeie ou apague um
  arquivo de configuração de outra tarefa para contornar essa recusa.
- Dependência local de fontes revisada:
  `C:/Users/andre/Documents/Codex/2026-10-14/c/work/queue-homologation/local-font-css.cjs`
  e os WOFF2 referenciados por ela. Esse mock é exclusivo da compilação de
  desenvolvimento desta prévia.

Antes de iniciar o frontend, registre cópias de `tsconfig.json`, `next-env.d.ts`
e `AGENTS.md` no diretório exclusivo de evidências. O Next pode atualizar
arquivos gerados e inclusões de tipos mesmo usando `distDir` próprio. Use as
cópias somente para comparação; a restauração deve ser seletiva e considerar
as demais prévias e formulários que estiverem em uso.

O primeiro compile do Next pode consumir bastante memória e demorar. O limite
`--max-old-space-size=1536` do launcher limita o heap JavaScript; não limita o
consumo total dos processos. Confira a memória disponível e as compilações já
ativas antes de iniciar. Não abra vários servidores ou pedidos repetidos à
mesma rota para tentar acelerar um compile lento. Readiness da API não prova
que a interface terminou de compilar.

## Execução nova

Os comandos abaixo são um roteiro de criação nova, não uma sequência para
reexecutar sobre os recibos de uma tentativa anterior. Substitua o placeholder
do manifesto por seu caminho absoluto privado; não copie seu conteúdo para
logs, documentação ou chat.

```powershell
$pipelineManifest = '<CAMINHO_ABSOLUTO_AO_MANIFESTO_LOCAL_ATESTADO.json>'
$pipelineRuntime = 'D:/Vimob/outputs/pipeline-local-save-AAAAMMDD-identificador'
$pipelineFixture = Join-Path $pipelineRuntime 'pipeline-synthetic-fixture.private.json'
$pipelineBaseline = Join-Path $pipelineRuntime 'pipeline-preexisting-baseline.json'
$pipelineSmoke = Join-Path $pipelineRuntime 'pipeline-api-smoke.json'

New-Item -ItemType Directory -Path $pipelineRuntime -ErrorAction Stop
New-Item -ItemType Directory -Path (Join-Path $pipelineRuntime 'bin') -ErrorAction Stop
```

1. Capture a baseline antes do seed. É uma leitura com hashes de linhas inteiras
   em nove tabelas públicas fixas.

```powershell
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-verify.mjs' baseline $pipelineManifest $pipelineRuntime
```

2. Crie o fixture uma única vez. O recibo privado exclusivo conserva identidades
   progressivamente, inclusive se uma etapa posterior falhar. A senha sintética
   permanece nesse arquivo e não é impressa no console. Não o compartilhe.

```powershell
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-seed.mjs' $pipelineManifest $pipelineRuntime
```

3. Compile a API a partir do código principal e registre o hash do executável.
   Falha de build interrompe a sequência; não reutilize um binário antigo sem
   conferir sua procedência.

```powershell
go -C 'D:/Vimob/workspaces/vimob-crm/apps/api' build -o (Join-Path $pipelineRuntime 'bin/vimob-api.exe') ./cmd/api
if ($LASTEXITCODE -ne 0) { throw 'Build da API local falhou.' }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $pipelineRuntime 'bin/vimob-api.exe')
```

4. Inicie a API. O launcher mantém recibo exclusivo, PID, caminhos e logs. O
   resultado `spawned_readiness_not_verified` confirma apenas o spawn.

```powershell
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-launch.mjs' api $pipelineManifest $pipelineRuntime
Invoke-WebRequest -Uri 'http://127.0.0.1:58082/healthz' -TimeoutSec 10
Invoke-WebRequest -Uri 'http://127.0.0.1:58082/readyz' -TimeoutSec 10
```

Confira a identidade do listener e os gates de workers, além dos status HTTP.
Não execute o smoke contra um listener cuja origem/configuração não foi
conferida.

5. Execute o smoke da API uma única vez, depois da conferência. Ele autentica
   sessões reais e escreve somente nos três primeiros leads da organização B.
   Compara resposta HTTP, nova leitura e persistência SQL, preserva
   microssegundos e testa reorder, revisão obsoleta, corrida entre sessões,
   responsável sem acesso e organização/etapa de outro tenant.

```powershell
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-api-smoke.mjs' $pipelineManifest $pipelineFixture $pipelineBaseline $pipelineSmoke
```

**Não reexecute automaticamente após timeout, erro ou saída incompleta.** Um
POST pode ter concluído antes da falha. Preserve todos os recibos, confira o
estado por leitura e determine quais operações já ocorreram. Não apague um
recibo para liberar outra execução. A correção de um verificador documental ou
de escopo não exige repetir as escritas que já passaram.

6. Inicie o frontend somente com recursos disponíveis para a compilação. Ele
   usa o código principal e cache próprio; não muda a prévia existente.

```powershell
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-launch.mjs' web $pipelineManifest $pipelineRuntime
```

Abra `http://localhost:3006/login` e entre pela interface com uma das contas
novas do fixture privado. Aguarde `/inicio` e navegue para `/crm/pipelines`.
Não injete tokens, substitua a autenticação ou reutilize usuários do QA antigo.

7. Para validar a interface, registre o lead e a etapa antes de arrastar;
   confira o POST compatível, a posição após a resposta, nova leitura e posição
   após recarregar a página. Compare com a prova SQL por leitura. Cubra também
   reordenação, cancelamento e conflito sem confundir atualização otimista com
   salvamento. Use apenas os leads desta execução.

```powershell
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-verify.mjs' leads $pipelineManifest $pipelineFixture
node 'D:/Vimob/workspaces/vimob-crm/scripts/local/pipeline-preview-verify.mjs' verify $pipelineManifest $pipelineFixture $pipelineBaseline
```

O verificador compara somente `organizations`, `users`, `leads`, `pipelines`,
`stages`, `organization_members`, `activities`, `audit_logs` e `notifications`.
Ele atribui explicitamente ao fixture atividades legadas sem `organization_id`
apenas quando `lead_id` pertence à lista determinística desta execução. Essas
atividades aparecem separadamente no relatório. Isso não é auditoria de todas
as tabelas, sessões Auth, esquema ou efeitos externos.

## Falhas, retomada e encerramento

Um seed parcialmente concluído pode deixar contas GoTrue novas mesmo quando a
transação do domínio foi revertida. Use o recibo para inspecionar os próprios
IDs. O seed não reaproveita nem limpa esses registros automaticamente.
API, frontend e smoke também não substituem um recibo existente. Inspecione PID,
executável, linha de comando e horário antes de qualquer encerramento; não
encerre processos por nome genérico ou todos os listeners de uma porta.

Não há comando de cleanup neste roteiro. Parar um processo próprio, remover
dados sintéticos ou liberar cache deve ser uma ação separada, com escopo
conferido. Não apague o diretório de evidências durante uma falha.

## Registro de 17/10/2026

Evidências desta rodada: `D:/Vimob/outputs/pipeline-local-save-20261017-j594`.
Foram observados 26 checks HTTP/Auth/SQL aprovados: oito POSTs, sendo três
sucessos e cinco rejeições esperadas. O fechamento somente de leitura está em
`pipeline-api-smoke-closure.json`; as tentativas anteriores estão detalhadas em
`pipeline-api-smoke-attempt-audit.json`. Não houve repetição dos POSTs depois
desse ensaio. Os recibos de falha permanecem preservados.

O trigger local preexistente gerou duas atividades sem organização ligadas a
B1/B2. A atribuição explícita desses próprios registros permitiu verificar os
nove hashes anteriores. Depois surgiu uma notificação nova fora do fixture;
sua origem não foi determinada. A comparação estrita atual permanece falhando
em `notifications`, sem exclusão ou remoção desse registro. Portanto o smoke
integral não está aprovado, embora os 26 checks de movimentação tenham passado.
Na conferência final (`final-verifier-result.json`), oito tabelas preexistentes
continuam idênticas; somente a mesma notificação fora do fixture permanece
diferente. Há 26 atividades próprias sem organização listadas explicitamente
nessa conferência, após as interações posteriores. A origem de cada atividade
adicional não foi determinada; não confundir esses registros legados com o
registro de histórico da API verificado para o movimento A1.

O primeiro POST bem-sucedido levou 9.649 ms, a reordenação 663 ms e a corrida
concorrente 512/2.622 ms. Um GET anterior excedeu 15 segundos. Não há evidência
para atribuir esses tempos exclusivamente ao banco ou à pressão de memória.

O login pela interface criou uma sessão GoTrue real do próprio administrador A,
confirmada em `ui-auth-session-observation.json`. Dois processos próprios do
Next encerraram; a segunda tentativa registrou `Failed to allocate memory`
após responder a rota da Pipeline. O Windows também registrou memória virtual
insuficiente. A primeira tentativa não tem causa de encerramento comprovada.
Após identificação pelo executável, GUID do registro e horário de início, o
usuário autorizou encerrar exclusivamente o processo de cache de miniaturas
`dllhost` PID 9772. A memória comprometida caiu de 59,82 para 38,69 GiB. Nenhum
outro processo foi encerrado. A terceira inicialização ficou pronta em 15,2 s;
a rota compilou em seis minutos, com forte paginação medida no host.

A movimentação completa pela interface foi então validada. O mouse ativou o
card A1 (`aria-pressed=true`), moveu de Base para Contactados e recebeu HTTP 200
da API local, sem abrir o popup naquele gesto. O pedido preservou exatamente
`expectedUpdatedAt=2026-10-17T14:09:43.593394Z`. O PostgreSQL confirmou a nova
coluna, revisão `2026-10-17T15:05:33.628773Z`, um audit de movimentação e um
registro de histórico da API; os doze leads sintéticos permaneceram existentes.
Depois do recarregamento completo, a API respondeu ao GET de `pipeline-board`
com 200 e o A1 permaneceu em Contactados, ausente de Base.

Evidências: `ui-mouse-move-proof.json`, `ui-save-sql-assertions.json`,
`ui-reload-proof.json` e `pipeline-after-reload.png`. O cliente adaptou a origem
loopback para `http://localhost:58082`, conforme o host da interface; essa é a
mesma API local. A ferramenta de inspeção de DOM apresentou temporariamente
um estado antigo de carregamento; a árvore de acessibilidade ao vivo, a imagem
real e as respostas de rede confirmaram a interface funcional. Nenhum defeito
de autenticação foi comprovado. O usuário confirmou que abriu o popup A1
manualmente após o teste; esse popup em uso foi preservado.

A resposta do POST da interface levou 11.451 ms até os headers, conforme o
relógio monotônico da rede do navegador. A persistência está comprovada, mas
não há base para afirmar melhoria de latência. Não foi feita a segunda
movimentação opcional da interface enquanto o usuário usava o popup.

As evidências e o cache foram preservados; a prévia na porta 3000 não foi
interrompida nem reconfigurada. Os hashes do Screen e do adaptador de arraste
permaneceram idênticos ao início. O Next adicionou duas inclusões de tipos ao
`tsconfig.json` e apontou o arquivo gerado `next-env.d.ts` para seu cache. As
inclusões chegaram a ser removidas e comparadas byte a byte com o estado
anterior; a terceira inicialização as gerou novamente. Esses arquivos gerados
devem ser revisados no encerramento futuro desta prévia, preservando alterações
de outras tarefas. Não reinicie ou restaure a configuração enquanto o usuário
mantiver um formulário aberto.
Na última conferência, `next-env.d.ts` já referenciava novamente `.next`; não
foi feita restauração forçada desse arquivo compartilhado entre prévias.

Esta prévia não comprova todas as funções do card, comportamento em iPhone ou
prontidão da produção. A prévia original que usa API publicada continua sendo
um ambiente diferente deste par frontend/API local.

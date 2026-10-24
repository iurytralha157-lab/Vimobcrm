# Homologacao isolada do Vimob CRM

Este fluxo usa a branch `homologacao`, um repositorio GitHub privado,
duas imagens por commit, uma stack separada e um projeto Supabase exclusivo.
O workflow de producao e a stack atual permanecem independentes. Estes arquivos
nao criam recursos, nao aplicam SQL e nao fazem deploy automaticamente.

## Estado em 2026-10-23

- Repositorio criado e confirmado como **privado**:
  [iurytralha157-lab/vimob-crm-homologacao](https://github.com/iurytralha157-lab/vimob-crm-homologacao).
  A branch padrao e `homologacao`; a candidata `57ea4e5f883094bcbbbccd2267a2c926c71c9a44`
  foi enviada a esse destino.
- No Supabase exclusivo `lfkfuhvjvqgwyikzcfep`, a baseline e os 20 forwards
  foram instalados. O smoke SQL de Auth, RLS, isolamento entre duas organizacoes
  e Realtime passou; as alteracoes dos dados de teste foram revertidas por
  rollback, preservando o schema instalado.
- Nao houve publicacao de imagens, deploy da aplicacao, alteracao de DNS ou
  mudanca no host. Ainda nao ha uma instancia web/API de homologacao validada
  em execucao.
- Na observacao inicial de 23/10, o login no outro Portainer estava pendente
  e o host com Caddy/gateway ainda precisava de inspecao. Esse registro
  historico foi superado pela escolha e verificacao do Portainer antigo com
  Swarm/Traefik em 24/10, descritas na secao seguinte.

## Destino confirmado em 2026-10-24

O usuario escolheu o Portainer antigo, e o acesso autenticado foi confirmado em
`https://painel.vettercompany.com.br`, ambiente `primary` (endpoint 1).
O node `vetter-app-server` esta ready/active, Linux x86_64, Docker 28.3.3,
4 CPUs e aproximadamente 8.13 GB RAM. Este e o destino de homologacao selecionado.
O outro painel com Caddy nao e o alvo deste deploy.

O Traefik v2.11.3 usa provider Docker com SwarmMode, rede overlay
`network_swarm_public` (`10.0.1.0/24`), entrypoint `websecure` e resolver
`letsencryptresolver` com HTTP challenge em `web` (80). A rede nao e attachable;
isso permite anexar servicos Swarm, sem exigir containers standalone nela.
Os detalhes publicos estao em [portainer-target.json](../deploy/staging/portainer-target.json).

A leitura de `/proc` pelo console do container Traefik mostrou cerca de 2.54 GiB
MemAvailable, swap ausente e load 0.08/0.09/0.08 naquele instante. O overlay
mostrou aproximadamente 29.5 GiB disponiveis (79% usado). E uma amostra,
nao capacidade de pico ou prova de suporte a carga sustentada.

O template futuro limita Web a 512 MiB/0.75 CPU e API a 256 MiB/0.5 CPU,
com uma replica de cada. A atualizacao usa `stop-first`, com uma interrupcao
curta aceitavel em homologacao, para limitar memoria transitoria. Conferir
consumo e readiness reais antes de ampliar os testes. Nenhum limite, servico,
proxy ou rede existente foi alterado no host; a stack ainda nao foi criada.

O indice complementar de inatividade foi aplicado apenas ao Supabase novo e
passou no gate SQL exato da API; ver
[a evidencia](../deploy/staging/cloud-inactivity-index-verification.json).
Continuam pendentes as imagens, os segredos de runtime e os testes HTTP
completos. Os dois registros A de homologacao foram criados como DNS only para
`5.161.108.48` e conferidos no nameserver autoritativo; nenhum registro anterior
foi editado. O Site URL do projeto Supabase novo e os dois redirects exatos de
reset de senha/confirmacao de e-mail foram salvos e relidos. Ver o estado em
[hosting-preparation-verification.json](../deploy/staging/hosting-preparation-verification.json).
O suplemento de ACLs tambem foi aplicado e o smoke SQL original
passou novamente; a evidencia e os limites estao em
[cloud-rpc-hardening-verification.json](../deploy/staging/cloud-rpc-hardening-verification.json).
As cinco Repository variables publicas de build foram cadastradas no GitHub
privado para `homologacao.vimobcrm.com.br` e `api-homologacao.vimobcrm.com.br`.
O preflight de build passou localmente. A suite de staging passou em 51 testes,
o lint dos quatro novos scripts RPC passou e o lock das 258 migrations atuais
foi verificado. Isso nao certifica imagens, runtime, DNS ou HTTP.

## Arquivos e limites iniciais

- `.github/workflows/staging-images.yml`: execucao manual apenas na branch
  `homologacao`, com gates e publicacao de imagens de homologacao no GHCR.
- `deploy/staging/portainer-stack.yml`: Next.js e API Go no mesmo SHA, uma
  replica de cada, rede interna propria e routers Traefik `vimob-staging-*`.
- `deploy/staging/compose.yml`: alternativa Docker Compose standalone com
  portas presas ao loopback, para proxy externo compativel com esse acesso.
- `deploy/staging/Dockerfile.api`: build Go por arquitetura para homologacao;
  o Dockerfile da API atual fixa `amd64` e nao e alterado por este fluxo.
- `deploy/staging/.env.example`: nomes das variaveis exclusivas desse ambiente.

A API usa `API_ENV=staging`, que o carregador atual trata como ambiente fora de
producao. Autorizacao, RLS e isolamento por organizacao continuam dependendo do
codigo e do projeto Supabase. A stack exige segredos exclusivos de recuperacao
e assinatura de billing, par VAPID valido, origem CORS exata, URLs HTTPS e CIDRs
restritos do proxy; o preflight de homologacao deve validar esses valores.
O segredo de recuperacao explicito evita a derivacao de chave de desenvolvimento.
O Next.js usa `NODE_ENV=production`, com build standalone real.

Ha uma diferenca remanescente no codigo: fora de `production`, o administrador
pode salvar um webhook de notificacoes com HTTP. O worker de envio e o gate
global ficam desligados e essa configuracao nao deve ser ativada na primeira
homologacao. As validacoes de startup exclusivas de producao nao sao uma prova
de seguranca desse ambiente; rever essa diferenca antes de testar integracoes.

Todos os workers conhecidos ficam desligados, inclusive o gate global
`API_BACKGROUND_WORKERS_ENABLED`. Nao ha credenciais de WhatsApp, Meta, Resend,
Asaas ou IA; o par VAPID e exclusivo de testes e o envio push fica desligado.
Fluxos que dependem desses servicos nao fazem parte da
primeira homologacao. Isso inclui envio de e-mail, onboarding completo,
recuperacao de senha, cobrancas, publicacao externa e recebimento/envio de
WhatsApp. Essa configuracao nao e um bloqueio geral de saida de rede.

## Antes da primeira publicacao

1. Confirmar o repositorio privado de destino. Revisar os arquivos que entram
   no commit, incluindo documentos, exports e fixtures; nunca adicionar `.env`,
   backup, credencial ou dados pessoais. Nao enviar o snapshot para o
   repositorio publico atual.
2. Criar e preparar um projeto Supabase exclusivo de homologacao, com Auth,
   banco, Storage e configuracao proprios. Usar usuarios e dados sinteticos.
   Nao copiar contas, sessoes, filas, tokens de integracoes ou jobs de producao.
3. Ler `supabase/README.md` antes de preparar o schema. O historico atual exige
   reconciliacao de baseline e cutovers; nao executar `supabase db push` em
   lote. Seguir tambem [o plano do banco de homologacao](staging-database.md).
   O preparo do banco e uma operacao separada deste workflow: um inventario
   offline aprovado nao instala o schema. O `ready=false` do planner e sempre
   offline; conferir a evidencia remota e os bloqueios em `cloud-verification.json`.
   A liberacao geral permanece bloqueada pela revisao de permissoes herdadas.
4. No Auth do projeto de testes, configurar a Site URL de homologacao e apenas
   os redirects necessarios desse ambiente. Conferir buckets, policies e RLS.
   Nao publicar Edge Functions nem ativar cron/jobs externos como parte do
   deploy da stack. Inicialmente, entrar com contas sinteticas ja preparadas.
5. Selecionar o host e medir sua capacidade antes de compartilhar recursos com
   producao. Confirmar rede, entrypoint, certificados e CIDRs reais do proxy.
   Um host separado tambem isola CPU, memoria e falhas administrativas.

## GitHub Actions e GHCR

No repositorio privado exclusivo de homologacao, configurar somente estas
**Repository variables** em Settings > Secrets and variables > Actions:

| Variavel | Consumidor | Valor |
| --- | --- | --- |
| `STAGING_PROJECT_REF` | Preflight build | Referencia de 20 letras do projeto exclusivo |
| `STAGING_SUPABASE_URL` | Build web | URL HTTPS do projeto exclusivo, sem barra final |
| `STAGING_SUPABASE_ANON_KEY` | Build web | Chave publica desse projeto |
| `STAGING_PUBLIC_API_URL` | Build web | Origem HTTPS da API de homologacao |
| `STAGING_PUBLIC_WEB_URL` | Build web | Origem HTTPS do app de homologacao |

Todas sao obrigatorias. O workflow recusa outra branch ou um repositorio publico.
Nao exige GitHub Environments: esse recurso em repositorios privados depende do
plano GitHub. Se o plano permitir, um Environment pode ser adotado depois sem
alterar os destinos. Nao ha fallback para variaveis ou secrets `VIMOB_*` de
producao. Nenhuma chave server-only ou senha do banco entra no build ou no
GitHub Actions. O usuario digita os segredos diretamente no destino autorizado.
O preflight compara referencia, URL e claims das chaves legadas e bloqueia o
projeto conhecido de producao. Chaves opacas ainda exigem verificacao direta
do projeto no destino; a checagem local nao autentica nem abre conexao remota.

O workflow `Staging Images` e manual. Ele precisa estar disponivel na branch
padrao do repositorio privado para aparecer na UI de execucao; a branch padrao
desse repositorio pode ser `homologacao`. Ao executar, selecionar `homologacao`.
O workflow recusa outra ref e nao faz deploy nem altera o Supabase.
Ele tambem recusa execucao a partir de repositorio publico.

Na execucao, escolher a arquitetura confirmada do host: `linux/amd64`,
`linux/arm64` ou ambas (padrao). O build web em outra arquitetura usa emulacao
e pode demorar mais. Para ambas, o GHCR publica um manifest multiarch sob o
mesmo SHA; a API e compilada para cada `TARGETARCH`. Confirmar a arquitetura
do host antes de usar uma imagem produzida para apenas uma plataforma.

Os gates de codigo, contratos, migracoes, PostgreSQL descartavel e WhatsApp
copiam os gates existentes do workflow de producao. Nao conectam ao banco
remoto. Mudancas nesses gates devem ser reconciliadas entre os dois workflows;
nenhum gate de producao e removido por este fluxo.

As duas imagens recebem o SHA completo, sem `latest`:

```text
ghcr.io/<owner>/<repo>-web-staging:<sha-completo>
ghcr.io/<owner>/<repo>-api-staging:<sha-completo>
```

Owner e repositorio sao derivados do repositorio que executa o workflow, em
minusculas. Conferir no GHCR que os pacotes estao privados e vinculados ao
repositorio correto. Repositorio privado por si so nao prova a visibilidade de
um pacote ja existente. Configurar autenticacao `read:packages` do registry no
host/Portainer antes de puxar imagens privadas; nao colocar o token no YAML.

O resumo da execucao registra referencias, digests e SHA. So usar as imagens
quando todos os gates e ambos os builds tiverem passado. Alterar URL publica,
API ou Supabase exige uma nova imagem web; mudar apenas o runtime nao atualiza
os valores `NEXT_PUBLIC_*` compilados no navegador.

## Escolha de host, proxy e stack

O destino selecionado e o Portainer antigo descrito acima, com Swarm e Traefik
confirmados. Usar o template Swarm e os valores observados, conferindo-os de novo
antes do deploy. O Compose/Caddy abaixo permanece uma alternativa para outro
desenho; nao se aplica ao host selecionado. Nao alterar o proxy existente.

Para **Docker Compose standalone e Caddy executado no host**, usar
`deploy/staging/compose.yml`, projeto Compose `vimob-staging`, e portas livres
como `STAGING_WEB_PORT=13000` e `STAGING_API_PORT=18081`. Esse arquivo nao usa
labels Traefik nem publica portas em interfaces externas. Exemplo de Caddy
para esse desenho, somente apos confirmar host e autorizar a configuracao:

```caddyfile
homologacao.example.com {
    reverse_proxy 127.0.0.1:13000
}
api-homologacao.example.com {
    reverse_proxy 127.0.0.1:18081
}
```

Um Caddy em container tem seu proprio loopback e nao alcanca automaticamente
essas portas do host. Nesse caso, confirmar a topologia e preparar a rede
compartilhada isolada ou o acesso ao host antes de qualquer deploy. Nao trocar
o gateway existente nem instalar outro proxy como parte incidental deste fluxo.
Nao executar `docker stack deploy` com o Compose standalone: no Swarm, o bind
de loopback nao oferece a mesma garantia de isolamento das portas.

Para **Swarm com Traefik confirmado**, seguir a alternativa abaixo.

Criar uma stack Swarm exclusiva chamada `vimob-staging`, usando
`deploy/staging/portainer-stack.yml`. Nao editar nem reutilizar a stack de
producao. Preencher no Portainer as variaveis de `.env.example` com os valores
de homologacao. O prefixo de imagem deve ser
`ghcr.io/<owner-em-minusculas>/<repo-em-minusculas>`; o YAML acrescenta
`-web-staging` e `-api-staging` ao prefixo e usa um unico `STAGING_RELEASE_SHA`.

Usar um unico projeto Supabase em `STAGING_SUPABASE_URL`, sua chave publica,
sua chave server-only e sua `STAGING_DATABASE_URL`. Conferir diretamente no
painel que os quatro pertencem ao projeto de testes antes do deploy.
Antes de aplicar a configuracao, executar no processo autorizado do destino,
com as variaveis de homologacao ja configuradas sem imprimir seus valores:

```text
node scripts/staging/deployment-config.mjs
```

Nao executar `.env` como script nem colar credenciais no historico do shell.
O preflight e somente leitura: bloqueia projeto de producao, URLs divergentes,
DSN fora do projeto de testes, TLS ausente, segredo invalido e CIDR amplo.
Ele nao prova que o banco esta preparado, que as credenciais sao aceitas ou que
o ambiente ja foi implantado. Seu resultado precisa passar antes de um deploy.

`DATABASE_URL` deve usar conexao direta ou pooler em modo sessao (5432), pois
existem fluxos dependentes de advisory locks de sessao. O limite inicial de
quatro conexoes e por replica da API e deve caber no orcamento medido do projeto.

Conferir tambem os segredos de recuperacao (32 a 512 bytes), assinatura de
billing (32 a 512 bytes sem espacos) e o par VAPID exclusivo de homologacao.
Mesmo sem dispatch, a API verifica o par VAPID quando ele esta configurado.
Nao usar `0.0.0.0/0` nem `::/0` em `STAGING_TRUSTED_PROXY_CIDRS`.

Os hostnames e URLs publicas devem corresponder aos do build. Exemplos de
formato: `homologacao.seudominio.com.br` e
`api-homologacao.seudominio.com.br`. DNS e certificados sao configurados apenas
apos confirmar o host e autorizar essa operacao. Nenhuma porta e publicada
diretamente pelo YAML Swarm; o acesso HTTPS passa pela rede externa do Traefik.

A rede interna recebe o prefixo da stack, sem compartilhar a rede interna
`vimob`. O web chama `vimob-staging-api`, alias presente somente nessa rede
interna; nao usa o alias generico `api` que outras stacks podem anunciar na
rede compartilhada do proxy. Os routers e servicos Traefik tem nomes exclusivos.
Depois de criar a overlay interna, conferir seu CIDR e membros exclusivos e
incluir somente essa subnet em `STAGING_TRUSTED_PROXY_CIDRS`, junto da subnet
efetiva do Traefik. O BFF Next envia `X-Forwarded-For` pela rede interna; confiar
apenas na rede do Traefik concentra rate-limit e auditoria no IP do Web nesse
caminho. Antes de aceitar signup/recovery, testar dois IPs de clientes e um
prefixo `X-Forwarded-For` forjado. Nao confiar em outra overlay compartilhada
apenas porque ela existe no host; trocar o BFF para HTTPS tambem nao prova a
preservacao do IP entre dois proxies.
O YAML atende uma stack de homologacao por proxy; para mais ambientes
simultaneos, dar nomes distintos tambem aos routers/servicos.

## Verificacao e troca de versao

Confirmar em cada servico a imagem/SHA da execucao aprovada. Verificar
`/readyz` da API e depois login, Dashboard, Pipeline, cadastro/movimentacao de
lead sintetico, Agenda, imoveis/Storage e permissoes com duas organizacoes.
`/healthz`, build verde e `/readyz` isoladamente nao comprovam esses fluxos.
Verificar tambem que workers continuam desligados e que nao existem conexoes
ou agendamentos de integracoes no projeto novo.

Para atualizar, executar novamente o workflow da branch `homologacao`, testar
o par de imagens e trocar apenas `STAGING_RELEASE_SHA` pelo SHA aprovado.
Guardar o SHA anterior e confirmar compatibilidade de schema antes de voltar
as imagens. Este fluxo nao reverte schema, Auth, Storage nem dados automaticamente.
Nao usar `scripts/qa/release-image-preflight.mjs` como prova desse ambiente:
aquele preflight verifica a release de producao alinhada com `origin/main`.

Habilitar qualquer integracao ou worker exige um plano separado com conta,
credencial, destino e canario de testes proprios. Nao reconectar contas reais
para tentar completar uma tela de homologacao.

## Dependencias da candidata

A preparacao de 2026-10-23 atualizou `next` e `eslint-config-next` de 16.3.8
para 16.4.2, com lockfile, porque o gate de dependencias bloqueou a versao antiga.
Os avisos oficiais incluem
[Image Optimization](https://github.com/advisories/GHSA-2464-fhr4-w9xw) e
[`use cache`](https://github.com/advisories/GHSA-673q-mjm6-r5xr).
Essa alteracao esta na candidata local de homologacao; nao atualiza a instalacao
em producao. O gate de auditoria existente continua obrigatorio e sem excecao
nova; sua excecao anterior para `braces` em ferramentas de desenvolvimento
continua registrada em `scripts/security/check-release-audit.mjs`.

O primeiro build manual de 24/10 foi bloqueado pelo aviso
[GHSA-mrhx-c7xc-m3w5 do Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
e por duas falhas das fixtures descartaveis de PostgreSQL. As imagens nao foram
publicadas nessa tentativa. A candidata seguinte usa Zod 4.6.7 e
`@hookform/resolvers` 5.9.2: a versao 6 teve conflito de peers com Effect 3,
entao foi mantida a linha compativel, sem `--force` ou `--legacy-peer-deps`.
O gate original de auditoria passou sem excecao nova. A compatibilidade preserva
UUIDs PostgreSQL legados, campos omitidos, defaults de criacao e PATCH sem
defaults novos; os contratos existentes e o novo teste de migracao verificam
esses comportamentos. A atualizacao e exclusiva da branch de homologacao.
Antes da nova execucao, `typecheck`, lint dos fontes alterados e `audit:check`
passaram; `validation:test` concluiu 871 testes sem falhas ou pulos. Os inventarios
gerados tiveram somente seus digests atualizados. Os 35 testes Node das fixtures
tambem passaram; a integracao completa no runner Ubuntu continua obrigatoria.

A segunda execucao (`40120738903`, commit `c94eae55`) confirmou no Ubuntu a
auditoria, os 871 contratos de validacao, a fixture de round-robin e o startup
do PostgreSQL descartavel do WhatsApp. Ela parou em uma dependencia Ajv nao
declarada, outra fixture de permissoes e uma expectativa de progresso imediato
no teste de claim concorrente. O build das imagens continuou bloqueado.
O validador de OpenAPI agora tem dependencias explicitas: Ajv 8.20.0 no dialeto
2020-12 e ajv-formats 2.1.1. A allowlist cobre apenas os metadados OpenAPI usados;
os asserts, formatos e restricoes dos schemas foram preservados. Os 64 contratos
OpenAPI passaram. As fixtures de roles receberam as colunas de geracao de
membership e os perfis/tabelas usados pelas consultas atuais, sem alterar SQL
canonico ou permissoes da aplicacao.

O ensaio de concorrencia foi corrigido depois de reproduzir a falha original e
provar o mutex em um PostgreSQL 17.11 local descartavel. A reserva e nao
bloqueante: um passe pode retornar vazio durante contencao. O teste agora mantem
as quatro replicas concorrentes e exige exatamente uma lease do root correto
apos um unico passe adicional sem contencao, com o child ainda pendente e sem
duplicidade. Uma fase deterministica mantem a reserva aberta, verifica a
exclusao e exige progresso apos rollback explicito. Nao houve sleep, loop de
retry ou alteracao da query funcional. Passaram 30 testes/subtestes focados e
todos os 52 testes Go obrigatorios da gate (122 incluindo subtestes), sem pulos.
O readback retornou zero fixtures, locks e transacoes abertas; o cluster foi
parado e a porta fechada. A execucao completa no Ubuntu continua obrigatoria.

A terceira execucao (`40122446057`, commit `935fef6d`) aprovou no Ubuntu os
checks de convite, membership e a gate completa do WhatsApp: 178 contratos Node,
52 testes Go obrigatorios (122 com subtestes), sete arquivos SQL, 15 checks de
manutencao e 444 testes de interface. Typecheck, lint, inventarios, migracoes,
OpenAPI e demais contratos estaticos tambem passaram. A ultima suite Go parou
somente no teste de TTL do cache de midia: apos a assinatura, qualquer fracao
de segundo consumida e truncada de 840 para 839. A execucao local no Windows
tinha passado; nao foi demonstrado defeito no prazo funcional.
O ensaio agora usa `testing/synctest` do Go 1.25 e transporte HTTP em memoria.
Exige TTL seguro e expiry exatos de 840s, assinatura de 900s, uma requisicao e
negacao do tenant alheio. Passaram 1.000 repeticoes focadas e 606 testes
estaticos do WhatsApp; 136 integracoes opcionais ficam puladas nesse comando,
separadamente dos 52 testes obrigatorios aprovados na gate PostgreSQL.
Nenhum codigo funcional foi alterado por essa correcao. As imagens continuaram
sem publicar; a candidata corrigida precisa de nova execucao completa.

A quarta execucao (`40123578387`) passou nos cinco gates e publicou o par do
commit `cca3b0d6cd4186d1064720b81bd183303776c790`. As paginas de ambos os pacotes
confirmaram visibilidade privada, esse mesmo SHA e `linux/amd64`. Os digests do
indice e da plataforma estao no artefato de preparacao de hospedagem. O draft
do Portainer e os arquivos locais apontam para esse par aprovado. O registro
GHCR continua pendente da credencial do usuario; os seis campos de runtime do
draft seguem vazios, sendo quatro ja gerados no arquivo privado fora do Git e
dois do Supabase ainda pendentes. Nenhum deploy foi feito. Ha uma checagem de
conectividade somente leitura preparada fora do Git, mas ela ainda nao foi
executada com os valores do usuario. A evidencia adicionada depois do build
nao altera os fontes das imagens; o SHA a implantar continua sendo `cca3b0d6`.

Na preparacao local de 24/10, os dois segredos de assinatura/recuperacao e o
par VAPID foram gerados exclusivamente para homologacao, sem exibir valores.
O arquivo de entrada permanece fora do Git com ACL restrita ao usuario Windows.
Ainda faltam nele os dois valores do projeto novo (chave server-only e URL de
conexao); a entrada de credenciais no Portainer sera concluida pelo usuario.

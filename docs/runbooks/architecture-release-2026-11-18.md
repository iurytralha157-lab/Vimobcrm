# Preparação do release de arquitetura API/Web — 18/11/2026

## Estado do pacote

**Verificações locais concluídas.** O commit final, os digests novos e o
resultado da CI são registrados no manifesto externo antes de qualquer
atualização dos serviços. Este documento prepara
a operação; não a executa. A autorização para preparar/publicar código e
imagens é distinta da autorização para atualizar os serviços de produção.

O lote parte de `05ff562c4dc4824b7b17ea2fb6c7bda1628b01fb` e contém a
organização de leitura/scanners de Leads e dos contratos de validação. As
declarações, os contratos HTTP, o SQL e as regras desses fluxos foram preservados.
O escopo e a evidência da extração estão no
[runbook de arquitetura](architecture-refactor-2026-11-18.md), com os mapas em
[ARCHITECTURE.md](../../ARCHITECTURE.md) e
[QUICK_REFERENCE.md](../../QUICK_REFERENCE.md).

Para concluir o preparo, `next` e `eslint-config-next` foram atualizados de
16.4.3 para **16.4.6**. O lockfile mudou apenas na família Next. Isso acrescenta
uma atualização do framework ao lote; não tratar o Web como binário idêntico
ao que está publicado. O registro anterior de falha por `SecurityFatalError`
em 16.4.3 permanece como histórico da etapa anterior, não como resultado do
build da versão nova.

### Evidências locais disponíveis

| Conferência | Estado desta preparação |
| --- | --- |
| Versões de Next e eslint-config-next | 16.4.6 no pacote e lock |
| Auditoria npm após a atualização | Nenhum finding de Next no relatório; `npm audit --omit=dev` sem findings; 7 moderados remanescentes no devtoolchain |
| Gate de auditoria de dependências | Passou; seu critério atual é alto/crítico |
| Inventários gerados | Passaram |
| `npm run validation:test` | 905 passaram |
| `npm run validation:auth-admin` | 307 passaram |
| Typecheck final com 16.4.6 | Passou após regeneração oficial dos tipos de rotas |
| Lint final com 16.4.6 | Passou, com 9 avisos anteriores |
| Build Web 16.4.6 | Exit 0, 88 páginas e saída standalone |
| Build local API Linux/ARM64 | Passou; o build versionado da imagem é conferido na CI |
| Smoke HTTP local do build de produção | 16/16 passou |
| Smoke no navegador com backend sintético local | 4/4 cenários passaram na repetição; cleanup confirmado |
| CI do commit final e publicação das duas imagens | Consultar a conclusão e os digests no manifesto externo |

Na primeira tentativa do smoke de navegador, a inicialização excedeu o tempo
limite, com zero cenários executados, em contexto de lentidão/espera do
filesystem. A repetição passou sem alterar timeout ou testes. O primeiro
resultado não é evidência de falha funcional; tampouco foi contado como teste
aprovado. Esse smoke local não valida a produção nem substitui o aceite vivo.

Um gate aprovado ou a ausência de finding de Next no relatório não comprova
ausência de vulnerabilidades no produto. Testes pulados continuam identificados
no runbook da extração; não convertê-los em aprovações deste release.

## Produção observada antes do release

Snapshot conferido em **18/11/2026 às 23:32 BRT**, correspondente a
**19/11/2026 às 02:32 UTC**, no host `vimob-app-prod-01`:

| Serviço Swarm | Commit observado | Réplicas saudáveis | UpdateStatus |
| --- | --- | --- | --- |
| `vimob-crm-preparado_api` | `e255df7e60150c1ccbd88fe43238ba2b9b52af53` | 2/2 | completed |
| `vimob-crm-preparado_web` | `e8a7f35c7daf24669489441234edc73557879935` | 1/1 | completed |
| `vimob-crm-preparado_bridge` | `13187c03ea7665612ce85cc141af27aeb66b4ad6` | 2/2 | completed |

As tarefas individuais apresentavam as imagens esperadas e os contêineres
estavam `healthy`. `/readyz` respondeu HTTP 200 com a release `e255df7e`;
`/login` respondeu HTTP 200 com a release `e8a7f35c` no cabeçalho do Web.

Evidências locais, fora do Git:

- `D:\Vimob\outputs\architecture-refactor-20261118\release-production-before.log`
- `D:\Vimob\outputs\architecture-refactor-20261118\release-public-health-before.json`
- `D:\Vimob\outputs\architecture-refactor-20261118\release-service-policies-before.log`

A conferência posterior das políticas encontrou `start-first`,
`parallelism=1`, `failure_action=pause` e **Monitor=5s** nos três serviços:

| Serviço | Version.Index observado | Delay configurado |
| --- | --- | --- |
| API | 3891 | 120s |
| Web | 3933 | Não explicitado no snapshot |
| Bridge | 3488 | 30s |

Preservar essas políticas. Os oito minutos de observação operacional manual
propostos abaixo não são o `Monitor` configurado no Swarm.

Esses resultados descrevem o ambiente naquele horário. Inspeção estática,
build e CI descrevem o pacote; não substituem uma conferência viva imediatamente
antes e depois da atualização. A baseline e os digests anteriores também estão
em [production-source-baseline-2026-11-18.md](production-source-baseline-2026-11-18.md).

## Manifesto externo do release

Registrar SHA, digests e resultados finais em
`D:\Vimob\outputs\architecture-refactor-20261118\release-manifest.json`,
fora do Git, depois de criar o commit final e conferir sua CI. Não inserir o
SHA do próprio release neste runbook versionado para tentar congelar a
identificação do pacote; isso mudaria o commit que as imagens devem representar.

| Campo do manifesto | Conteúdo obrigatório |
| --- | --- |
| `release_sha` | SHA aprovado completo, 40 caracteres hexadecimais |
| `ci_url` e `ci_conclusion` | Execução do mesmo SHA, concluída com `success` |
| `api_image` | Referência completa `ghcr.io/iurytralha157-lab/vimob-crm-api:SHA@sha256:DIGEST`, digest de 64 caracteres hexadecimais |
| `web_image` | Referência completa `ghcr.io/iurytralha157-lab/vimob-crm-web:SHA@sha256:DIGEST`, digest de 64 caracteres hexadecimais |
| `platform` | `linux/arm64` nas duas imagens |
| `bridge_image` | Pin antigo exato registrado abaixo |
| `bridge_version_index_before` | `.Version.Index` do serviço bridge imediatamente antes da operação; snapshot atual 3488 |
| `publication_authorization` | Referência da autorização para publicar código/imagens |
| `deployment_authorization` | Referência da autorização específica para atualizar somente API/Web; pendente até ser concedida |

Copiar o SHA aprovado da execução correspondente; não escolher um SHA só por
ser o `HEAD` atual. Confirmar checkout canônico limpo, `HEAD` e `origin/main`
no mesmo commit. Conferir os quatro gates e os dois builds/push do workflow
`docker-images.yml`, os tags imutáveis e seus digests no registro. As imagens
de `05ff562c` publicadas antes desta preparação não contêm este novo lote.

Os build-args públicos devem continuar apontando para
`https://supabase.vimobcrm.com.br`, `https://api.vimobcrm.com.br` e
`https://app.vimobcrm.com.br`. Conferir URLs e versões sem imprimir chaves,
tokens, `Env` ou a `ServiceSpec` completa. O workflow manual de staging usa
outras restrições e variáveis e não é o caminho desta publicação.

## Limites e conferência específica deste lote

- Alterar **somente a imagem** dos serviços API e Web, mantendo suas réplicas,
  configuração, redes, labels, secrets e política de atualização existentes.
- A bridge deve continuar exatamente nesta referência, antes e depois:

```text
ghcr.io/iurytralha157-lab/vimob-crm-api:13187c03ea7665612ce85cc141af27aeb66b4ad6@sha256:7e683b9a464ec0af99239a089c0ae6bf477640b5fb4ae6b55687b8210f9a6a0f
```

- Não atualizar, recriar ou reiniciar a bridge incidentalmente. Comparar sua
  imagem, réplicas e `.Version.Index` do serviço antes/depois, sem expor
  variáveis privadas ou a Spec completa.
- **Migrações esperadas: nenhuma.** O lote não inclui schema, migrations,
  cutovers, publicação de Edge Functions ou alteração de configuração remota.
  Não executar `db push`, replay/drenagem de filas ou SQL operacional.
- Manter os modos e flags de WhatsApp existentes. Não reativar a função Edge
  `notification-evolution-failover` nem o failover padrão de notificações.
- Não usar `latest`, atualizar a stack inteira, executar stack prune ou aplicar
  o YAML como uma reconstrução da stack real. A bridge manual não é descrita
  pelo `deploy/portainer-stack.yml` versionado.

O preflight existente em `scripts/qa/release-image-preflight.mjs` exige os três
serviços no mesmo SHA e a bridge exatamente igual à API nova. Ele continua
inalterado e **não representa este plano de API/Web com bridge fixa**. Não
passar uma imagem falsa de bridge, omitir sua referência ou afrouxar o guard
para obter verde.

Neste lote, a conferência específica registra o par novo de API/Web no mesmo
SHA/digests, a bridge antiga fixa, o estado Git/CI/registro e a comparação viva
dos três serviços. Só avançar com todos esses itens completos e a autorização
da tarefa para o alvo definido; esta distinção não dispensa os gates de código.

## Ordem de publicação preparada

Os comandos abaixo são modelos para o operador no host conferido. Consultar
o manifesto externo aprovado e copiar seus campos `api_image` e `web_image`
para as variáveis indicadas; não executar enquanto houver campo, verificação
ou autorização de deploy pendente. A geração/publicação de imagens no GHCR
não altera automaticamente a stack.

1. Repetir a leitura dos três serviços e dos endpoints. Se alguma imagem,
   digest, réplica ou configuração divergir do snapshot, pausar e atualizar o
   plano com a situação real antes de qualquer mutação.
2. Confirmar política existente `start-first`, uma réplica por vez,
   `failure_action=pause`, `Monitor=5s` e delays registrados acima. Não mudar
   essas políticas como parte desta operação. Após a convergência de cada
   serviço atualizado, observar sua saúde por pelo menos oito minutos; essa
   janela manual não altera o `Monitor` do Swarm.
3. Atualizar somente a API:

```sh
API_IMAGE='<PREENCHER_API_IMAGE_A_PARTIR_DO_MANIFESTO>'
docker service update --detach=false --image "$API_IMAGE" vimob-crm-preparado_api
```

4. Aguardar convergência: API 2/2, tarefas individuais com a imagem aprovada,
   contêineres saudáveis, `UpdateStatus=completed` e `/readyz` HTTP 200 com o
   SHA novo. Confirmar que a bridge permaneceu na referência e versão anteriores.
   Falha ou pausa encerra a sequência antes do Web.
5. Atualizar somente o Web:

```sh
WEB_IMAGE='<PREENCHER_WEB_IMAGE_A_PARTIR_DO_MANIFESTO>'
docker service update --detach=false --image "$WEB_IMAGE" vimob-crm-preparado_web
```

6. Aguardar Web 1/1 e `UpdateStatus=completed`. Conferir `/login` HTTP 200 com
   o SHA novo, assets referenciados pela página e navegação autenticada. Fazer
   smoke de leitura/listagem/detalhe de lead e das telas consumidoras dos
   contratos reorganizados, com conta autorizada e sem registrar dados pessoais.
7. Repetir a conferência API 2/2, Web 1/1, bridge 2/2, imagens e digests de cada
   tarefa; a bridge deve continuar em `13187c03` e com o mesmo `.Version.Index`.
   Registrar horários, resultados e eventuais limites de verificação.

Checks que escrevam dados ou enviem mensagens exigem a autorização específica
da tarefa. Esta preparação não autoriza criar leads reais, disparar WhatsApp,
reprocessar filas ou testar cobrança em produção.

## Rollback por digest

Registrar novamente o par real antes do deploy. O snapshot de 23:32 BRT contém:

```text
API_ANTERIOR=ghcr.io/iurytralha157-lab/vimob-crm-api:e255df7e60150c1ccbd88fe43238ba2b9b52af53@sha256:cae617acc923bf732e9559aa3cabc42c024e828f4df1f6ca170b284ed25f9d91
WEB_ANTERIOR=ghcr.io/iurytralha157-lab/vimob-crm-web:e8a7f35c7daf24669489441234edc73557879935@sha256:6c1d7449ca5c7f700672142094d9f8910187e0800a3abf8f162a4714ada668f7
```

Não substituir esse par por imagens apenas construídas e ainda não observadas
em execução. Conferir disponibilidade dos digests e a versão efetivamente
anterior; um rollback genérico para `PreviousSpec` pode não representar o par
registrado se houve outra atualização.

Se a API falhar antes da publicação do Web, interromper a sequência e avaliar
restaurar apenas sua imagem anterior. Se ambos já tiverem sido alterados,
restaurar o Web anterior e conferir sua convergência antes de restaurar a API:

```sh
docker service update --detach=false --image 'ghcr.io/iurytralha157-lab/vimob-crm-web:e8a7f35c7daf24669489441234edc73557879935@sha256:6c1d7449ca5c7f700672142094d9f8910187e0800a3abf8f162a4714ada668f7' vimob-crm-preparado_web
```

```sh
docker service update --detach=false --image 'ghcr.io/iurytralha157-lab/vimob-crm-api:e255df7e60150c1ccbd88fe43238ba2b9b52af53@sha256:cae617acc923bf732e9559aa3cabc42c024e828f4df1f6ca170b284ed25f9d91' vimob-crm-preparado_api
```

**Retornar ao Web anterior também retorna ao Next 16.4.3 com os alertas que
motivaram esta atualização.** Tratar isso como contingência com avaliação e
autorização explícitas, não como fallback livre de risco. Priorizar correção
na versão nova quando viável e registrar a decisão tomada.

A bridge permanece intocada também no rollback. Não há migração de banco a
reverter, nem autorização para descartar/reexecutar trabalho durável. Conferir
readiness, releases, leitura autenticada e estado das filas sem mutá-las. Se
aparecer dependência de schema ou incompatibilidade de dados não prevista,
pausar e preparar uma correção específica em vez de forçar a reversão.

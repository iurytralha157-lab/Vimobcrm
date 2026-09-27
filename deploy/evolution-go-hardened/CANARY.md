# Evolution Go: canário de chamadas e contatos

Este arquivo acompanha `canary-stack.yml`. O canário deve ser criado como **nova** stack Swarm `evogo_calls_canary` no Portainer; não atualize a stack Evolution Go em produção. A stack usa apenas uma rede Traefik externa (`public`), uma rede privada própria para o PostgreSQL, dois volumes locais novos e três Swarm secrets exclusivos. Não há porta publicada no host, webhook, AMQP, NATS ou MinIO de produção. O PostgreSQL não participa da rede `public`.

## Antes de criar a stack

1. Gere uma imagem **nova**, com as alterações de chamadas/contatos, e obtenha seu digest imutável. Não reutilize a imagem/credencial da Evo de produção. Escolha também um digest imutável da imagem oficial PostgreSQL. Ambos os valores devem terminar em `@sha256:` seguido de 64 caracteres hexadecimais. O workflow `build-evo-candidate` publica somente a Evo com tag `candidate-<commit>`; obtenha o digest publicado antes de preencher a stack.
2. Escolha um nó Swarm com CPU, memória e disco disponíveis. Ambos os serviços ficam presos ao mesmo `node.hostname`: os volumes `local` não acompanham uma tarefa reagendada para outro nó. Confirme que os nomes `evogo_calls_canary_postgres_data` e `evogo_calls_canary_recordings` ainda não existem nesse nó.
3. Reserve um hostname **exclusivo** do canário e confira todas as regras `Host(...)` existentes no Traefik/Portainer antes do deploy. Nunca use o hostname da Evo, do CRM ou da API em produção. `evogo-canary.vettercompany.com.br` era um candidato, mas **não resolvia DNS na checagem de 27/09/2026**; crie/valide o registro DNS e o TLS antes de usar esse nome. A stack tem apenas uma regra `Host(...)`, sem regra de caminho que possa disputar rotas da produção.
4. Confirme no Portainer que a rede overlay externa `public`, o entrypoint `websecure` e o certresolver `letsencryptresolver` existem. Defina uma lista restrita de IPs/CIDRs de operadores e serviços de teste **como vistos pelo Traefik**. Não use `0.0.0.0/0`; se houver proxy na frente, valide o IP de origem efetivo antes do teste.

Variáveis obrigatórias da **nova** stack no Portainer:

| Variável | Valor requerido |
| --- | --- |
| `EVOGO_CANARY_IMAGE` | Imagem Evolution Go candidata, por digest `repo@sha256:...`. |
| `EVOGO_CANARY_POSTGRES_IMAGE` | Imagem PostgreSQL, por digest `postgres@sha256:...` ou `postgres:<versão>@sha256:...`. |
| `EVOGO_CANARY_NODE_HOSTNAME` | `node.hostname` exato do nó escolhido. |
| `EVOGO_CANARY_HOST` | FQDN exclusivo que já resolve para o Traefik; somente hostname, sem `https://` ou caminho. |
| `EVOGO_CANARY_ALLOWED_CIDRS` | IP/CIDR de teste visto pelo Traefik, separados por vírgula; inclua o egress do backend de teste se ele chamar a Evo pelo hostname público. |

Crie estes **Swarm secrets externos** no Portainer antes da stack, com valores inéditos e diferentes dos usados em produção. Não coloque os valores no YAML, em variáveis da stack nem em logs:

| Nome exato do secret | Conteúdo |
| --- | --- |
| `evogo_canary_postgres_password` | Senha aleatória de 32 bytes ou mais, codificada em hexadecimal ASCII. Só caracteres `A-Z`, `a-z` ou `0-9`, pois a Evo monta uma URL PostgreSQL com ela. |
| `evogo_canary_api_key` | **Licença Evolution Go válida e exclusiva do canário**. `GLOBAL_API_KEY` é conferida pelo servidor de licenças na inicialização; uma string aleatória deixa as rotas da API bloqueadas com HTTP 503. Não reutilize a licença da produção. |
| `evogo_canary_media_hmac` | Chave HMAC aleatória de 32 bytes ou mais, codificada em hexadecimal. |

O PostgreSQL usa `POSTGRES_PASSWORD_FILE`; a Evo lê os secrets montados em `/run/secrets/` no início e exporta `POSTGRES_AUTH_DB`, `POSTGRES_USERS_DB`, `GLOBAL_API_KEY` e `EVOGO_CALL_MEDIA_HMAC_SECRET` para seu processo. Ambas as bases da Evo apontam somente para `postgres:5432/evogo_canary` na rede privada desta stack. O nome do cliente WhatsApp é fixo e próprio (`vimob-calls-canary`). As gravações ficam apenas no volume `evogo_calls_canary_recordings`, montado na Evo, com retenção inicial de 24 horas.

Variáveis opcionais: `EVOGO_CANARY_CALLS_ENABLED=false`, `EVOGO_CANARY_CALLS_INSTANCE_IDS=` (vazia), `EVOGO_CANARY_MEDIA_ORIGINS=` (vazia), `EVOGO_CANARY_CONNECT_ON_STARTUP=false` e `EVOGO_CANARY_RETENTION_HOURS=24`. A rede `public` é compartilhada com o Traefik; ela **não** oferece isolamento de tráfego lateral entre serviços conectados a ela. Esta stack não configura acesso ao serviço, banco, secrets ou volumes da Evo em produção. Se for exigido bloqueio de rede entre as duas Evos, prepare uma rede de ingresso dedicada com o Traefik antes do deploy.

### Dependências para o teste completo no CRM

Antes de testar histórico, áudio e gravações no CRM, prepare API e Web **de teste** apontando apenas para a Evo canário e um ambiente Supabase **de teste**, com organização, usuário e sessão WhatsApp exclusivos. Aplique e verifique nesse ambiente a migração `20260927115810_whatsapp_calls_contacts.sql`, inclusive o bucket privado `whatsapp-call-recordings`. Na API de teste, use `EVOLUTION_GO_API_URL=https://<EVOGO_CANARY_HOST>` (o ticket de mídia precisa gerar `wss://`, não `ws://`), `EVOLUTION_GO_API_KEY` com a licença do canário, `EVOGO_CALL_MEDIA_HMAC_SECRET` igual ao secret HMAC da Evo, `EVOLUTION_GO_IMAGE_DIGEST=sha256:<digest da imagem candidata>` e `EVOLUTION_GO_BACKEND_WEBHOOK_URL` apontando para a **API de teste**. Se `API_BACKGROUND_WORKERS_ENABLED=false`, ative `API_WHATSAPP_CALL_RECORDING_ONLY_WORKER_ENABLED=true` para o upload das gravações. Compile o Web de teste com `NEXT_PUBLIC_EVOLUTION_GO_CALL_MEDIA_HOST` igual ao hostname do canário. O workflow `build-evo-candidate` não constrói API/Web de teste. Não use a API, o Web ou o Supabase de produção para este teste ponta a ponta.

No Supabase de teste, a sessão `evolution_go` deve ter `id` (UUID da sessão CRM), `instance_id`/`instance_name` da instância canário e `advanced_settings.token` igual ao **token da instância** criado na Evo. Esse token de instância é diferente de `GLOBAL_API_KEY`. Ative `advanced_settings.whatsapp_calls_enabled` somente nessa sessão para os testes de chamadas.

## Subida e teste isolado

1. Crie a stack `evogo_calls_canary` com `canary-stack.yml`, somente depois dos pré-requisitos. Confira **uma réplica saudável** de cada serviço, `GET https://<EVOGO_CANARY_HOST>/server/ok`, o certificado TLS, as redes e os volumes esperados. `/server/ok` sozinho não comprova licença; o healthcheck da stack exige `"status":"active"` de `/license/status`. Confirme essa resposta também pelo hostname público e teste `GET /instance/all` com header `apikey` contendo a licença do canário, sem 401/503. Se o `ipallowlist` negar o teste, corrija o CIDR do canário; não abra para toda a internet.
2. Crie uma instância nova via `POST /instance/create` com header `apikey` da licença do canário e campos `instanceId`, `name` e `token` exclusivos. Configure a sessão correspondente no CRM de teste antes de conectar. `POST /instance/connect` usa header `apikey` com o **token da instância** e recebe `webhookUrl` e `subscribe` no JSON. O `webhookUrl` deve apontar exclusivamente para a API de teste, com os identificadores de roteamento, por exemplo:

   ```json
   {
     "webhookUrl": "https://<CRM_TEST_API_HOST>/v1/whatsapp/webhook/evolution-go?session_id=<CRM_TEST_SESSION_UUID>&instance_id=<CANARY_INSTANCE_ID>",
     "subscribe": ["MESSAGE", "CONNECTION"]
   }
   ```

   Não coloque licença, token da instância, `apikey` ou `webhook_token` na URL. A Evo envia `instanceToken` no corpo dos eventos; a API de teste compara esse valor a `advanced_settings.token` e exige que `session_id` e `instance_id` correspondam à sessão. A API também aceita `X-Webhook-Token` ou `X-Evolution-Webhook-Token` se presente, comparando-o a `advanced_settings.webhook_token`, mas a Evo atual **não envia header de token configurável**. Se o ambiente exigir esse header, é necessário um ingress/proxy isolado que o adicione a partir de secret; não presuma que `POST /instance/connect` configure headers. Depois de conectar, obtenha o QR via `GET /instance/qr` com o token da instância e leia-o com **um número WhatsApp de teste**, nunca com a conta de produção. Confirme `GET /instance/status` e um envio/recebimento controlado entre números de teste. `CONNECT_ON_STARTUP` começa em `false`, portanto uma atualização pode exigir reconexão manual.
3. O primeiro deploy tem `EVOGO_CALLS_ENABLED=false` e `EVOGO_CALLS_INSTANCE_IDS` vazio. Para testar chamadas, atualize **somente esta stack** com `EVOGO_CANARY_CALLS_ENABLED=true`, `EVOGO_CANARY_CALLS_INSTANCE_IDS=<UUID exato da instância de teste>`, `EVOGO_CANARY_MEDIA_ORIGINS=<origin HTTPS exata do CRM de teste>` e `EVOGO_CANARY_CONNECT_ON_STARTUP=true`. A atualização da Evo usa `stop-first` para impedir dois clientes com a mesma sessão. A lista vazia continua bloqueando chamadas mesmo se a chave geral for ligada por engano.
4. Faça uma chamada recebida e uma originada **apenas entre contas de teste consentidas**. Confira eventos, áudio bidirecional, encerramento, WAV no volume privado e histórico/gravação no CRM de teste. Teste também `POST /user/contact` e leia o contato de volta na conta de teste. A gravação e o contato no WhatsApp não demonstram, por si só, sincronização com a agenda nativa do celular. Não direcione a API ou o webhook do CRM em produção para este canário.

## Recuo

Se qualquer verificação falhar, desative `EVOGO_CANARY_CALLS_ENABLED` e esvazie `EVOGO_CANARY_CALLS_INSTANCE_IDS` **na stack canário**; se necessário, remova apenas `evogo_calls_canary` no Portainer. Preserve os volumes e secrets exclusivos até revisar logs, banco e gravações de teste. A remoção da stack não deve executar qualquer comando sobre serviço, banco, volume, QR ou sessão da Evo em produção.

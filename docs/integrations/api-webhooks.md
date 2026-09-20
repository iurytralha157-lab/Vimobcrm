# API e webhooks do Vimob

Este contrato cobre a primeira versão pública: criação de leads pela API, recebimento de leads por webhook e envio assinado de eventos de lead. Não libera os endpoints internos do CRM.

## Antes de integrar

- A organização precisa estar ativa, com acesso de cobrança válido e com o módulo `api` ou `webhooks` habilitado.
- Chaves e segredos devem ficar apenas no servidor do integrador. Nunca os publique em JavaScript do navegador, aplicativo móvel, URL ou repositório.
- Todas as requisições devem usar HTTPS em produção.
- A criação e a reentrada passam pelo caminho canônico de distribuição (`private.distribute_lead`). A integração não escolhe um corretor diretamente.

## Criar lead pela API

`POST /v1/public/api/leads`

Cabeçalhos obrigatórios:

```http
Authorization: Bearer vimob_<chave>
Idempotency-Key: lead-identificador-unico-123
Content-Type: application/json
```

Também é aceito `X-API-Key` no lugar de `Authorization`. Se os dois forem enviados, devem conter exatamente a mesma chave. Credenciais na query string não são aceitas.

Exemplo:

```bash
curl -X POST "https://api.seu-dominio/v1/public/api/leads" \
  -H "Authorization: Bearer <SUA_CHAVE>" \
  -H "Idempotency-Key: lead-seu-sistema-123" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "João Silva",
    "phone": "+55 11 99999-9999",
    "email": "joao@example.com",
    "message": "Interesse no imóvel",
    "property_id": "10000000-0000-4000-8000-000000000001",
    "source_detail": "Landing financiamento",
    "utm_source": "google",
    "utm_medium": "cpc",
    "custom_fields": {
      "faixa_de_preco": "até 800 mil"
    }
  }'
```

`name` e `phone` são obrigatórios. O telefone deve conter de 10 a 15 dígitos. O corpo aceita ainda `property_code`, dados de campanha/anúncio/formulário, UTMs, `occurred_at` em RFC 3339 e até 50 `custom_fields`. Campos desconhecidos são rejeitados.

Uma primeira criação responde `201`. Repetir a mesma chave com o mesmo corpo responde `200` e o mesmo lead, sem repetir a distribuição. Reutilizar a chave com conteúdo diferente responde `409`.

## Receber lead por webhook

Crie um webhook de **Entrada** em Configurações > Integrações > Webhook e copie a URL e o token.

`POST /v1/public/webhooks/generic`

```http
Authorization: Bearer <TOKEN_DO_WEBHOOK>
Idempotency-Key: <ID_UNICO_DA_ENTRADA>
Content-Type: application/json
```

O corpo aceita `name` como obrigatório e os campos básicos, de atribuição, UTMs e respostas personalizadas mostrados na própria tela. Para reenvios seguros, envie uma `Idempotency-Key` estável por entrada lógica. Como alternativa, o corpo pode conter `event_id`, `submission_id`, `leadgen_id` ou `external_id`; o cabeçalho tem precedência quando ambos forem enviados. A mesma chave e o mesmo corpo são idempotentes; a mesma chave com outro corpo retorna `409`.

O cabeçalho é opcional para manter compatibilidade com integrações existentes. Sem uma chave explícita, cada requisição é tratada como uma nova entrada, mesmo que o corpo seja idêntico, porque dois envios iguais podem representar reentradas legítimas do lead.

O token também pode ser enviado em `X-Webhook-Token`. Tokens na URL não são aceitos para evitar vazamento em logs e histórico.

## Enviar eventos por webhook

Crie um webhook de **Saída**, informe uma URL HTTPS pública e escolha um ou ambos os eventos:

- `lead.created`
- `lead.reentered`

Os eventos nascem do registro canônico de entrada/reentrada do lead. Portanto, a saída cobre leads originados no CRM, site, portais, Meta, WhatsApp, API e webhook genérico; não depende de um canal específico.

Cada entrega é um `POST` JSON com estes cabeçalhos:

```http
X-Vimob-Event: lead.created
X-Vimob-Delivery: <id-da-entrega>
X-Vimob-Timestamp: <unix-seconds>
X-Vimob-Signature: sha256=<hmac-hex>
Idempotency-Key: <chave-estavel-do-evento>
```

Valide a assinatura calculando HMAC-SHA256 com o segredo exibido no Vimob sobre a sequência exata `X-Vimob-Timestamp + "." + corpo_bruto`. Compare em tempo constante, rejeite timestamps antigos e deduplique por `X-Vimob-Delivery` ou `Idempotency-Key`.

Entregas `2xx` são concluídas. Falhas de rede e respostas transitórias (`408`, `425`, `429` e `5xx`) são mantidas no outbox privado e repetidas com intervalos progressivos (1 min, 5 min, 30 min, 2 h, 6 h e 12 h), até oito tentativas. Os demais `3xx`/`4xx` vão para a fila de falha definitiva. Redirecionamentos não são seguidos; endereços locais, privados, reservados e URLs sem HTTPS são bloqueados.

## Respostas e limites

- `400`: JSON ou contrato inválido.
- `401`: chave/token inválido, expirado ou inativo.
- `402`: cobrança sem acesso.
- `403`: módulo não habilitado.
- `409`: conflito de idempotência.
- `429`: limite excedido; respeite `Retry-After`.
- `5xx`: falha temporária; repita com backoff usando a mesma chave de idempotência.

A API limita cada IP a 300 requisições/minuto e cada chave a 120/minuto e 1.000/hora. O webhook de entrada limita cada IP a 300/minuto e cada combinação IP/token a 120/minuto. Os limites são compartilhados entre réplicas e falham fechados se o limitador persistente estiver indisponível.

## Cutover das rotas Edge legadas

O código local mantém os slugs antigos apenas para uma transição determinística:

- `generic-webhook` não processa mais payload, credencial ou dado de organização. Qualquer chamada, exceto o preflight `OPTIONS`, responde `410 Gone` e informa `/v1/public/webhooks/generic` como substituto;
- `public-api` responde `410 Gone` somente para `POST /leads`, antes de autenticação ou acesso ao banco, e informa `/v1/public/api/leads` como substituto;
- `GET /properties` e `GET /properties/{id}` da Edge `public-api` continuam disponíveis e somente leitura até sua migração específica.

Não há redirecionamento automático de requisições de escrita: o integrador deve trocar a URL e atender ao contrato atual de autenticação e idempotência. Essa proteção só existe no ambiente remoto depois que os dois artefatos Edge desta revisão forem publicados.

## Checklist de liberação

O código local não comprova produção. Antes de liberar clientes:

1. aplicar e reconciliar a migration do outbox no ambiente correto;
2. publicar a mesma revisão do backend e confirmar `API_BACKGROUND_WORKERS_ENABLED=true` nos workers;
3. habilitar separadamente os módulos `api` e `webhooks` nas organizações autorizadas;
4. garantir que o domínio público aponta para as rotas Go acima;
5. publicar os tombstones locais e confirmar remotamente `410` no `generic-webhook` e no `POST /leads` da Edge `public-api`, além de `200` nos `GET /properties` legados autorizados;
6. executar smoke tests com uma organização de homologação: criação, replay idempotente, conflito, distribuição, assinatura, retry e isolamento entre organizações;
7. monitorar `429`, entregas em `retry`/`dead`, latência e taxa de distribuição antes de ampliar o rollout.

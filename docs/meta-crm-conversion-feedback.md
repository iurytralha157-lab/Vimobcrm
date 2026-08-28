# Devolução de qualidade para o Meta

## Objetivo

O Vimob CRM devolve ao Meta os marcos reais do funil de vendas sem transformar o banco em um cliente da Graph API:

- `VimobInitialLead`: o formulário Meta entrou no CRM;
- `VimobQualifiedLead`: o lead entrou na coluna configurada como qualificada naquela pipeline;
- `VimobConvertedLead`: o lead foi marcado como ganho no CRM.

Os eventos são ligados ao formulário original pelo `leadgen_id`. Um ganho também garante o marco qualificado quando ele ainda não existir, mantendo o funil enviado ao Meta coerente.

## Arquitetura e segurança

1. A transação que cria ou movimenta o lead grava um fato imutável em `lead_funnel_events`.
2. A mesma transação cria uma entrega idempotente em `meta_crm_event_outbox`, quando a organização, o módulo Marketing e a integração estiverem ativos.
3. O worker do backend Go reivindica a entrega com lease e `FOR UPDATE SKIP LOCKED`.
4. Antes do envio, o backend revalida organização, módulo, Página conectada, Dataset e credencial.
5. O token do CRM Dataset é lido pelo backend no Supabase Vault e enviado à Meta no header `Authorization`. Ele não é devolvido ao navegador nem gravado em logs.
6. Falhas transitórias usam retry com backoff; erros permanentes ou eventos fora da janela de sete dias vão para dead letter.

O PostgreSQL não faz chamadas de rede. Ele oferece durabilidade e idempotência; toda comunicação com a Meta pertence ao backend.

## Pré-requisitos

- Página Meta conectada pelo fluxo OAuth já existente no Vimob;
- módulo `campaigns` (Marketing) ativo para a organização;
- permissão administrativa de integrações;
- CRM Dataset criado no Gerenciador de Eventos da Meta;
- token de acesso próprio desse Dataset;
- `META_APP_SECRET`, versão e URL da Graph API configurados no backend.

O token do CRM Dataset não é o mesmo token usado para receber leads da Página. A configuração é feita uma vez por conexão de Página e pode ser pausada sem desconectar a captação de formulários.

### O que já é automático

- Página, formulário e `leadgen_id` chegam pelo OAuth/webhook já existente;
- o Vimob registra o estágio inicial e os marcos de qualificação e conversão;
- os envios usam outbox idempotente, retry e dead letter;
- depois que o Dataset estiver configurado, ativar ou pausar não exige colar o token novamente.

### Etapa única no Meta

O Facebook Login da Página não pode gerar nem substituir a credencial da Conversions API. Um administrador do Business ainda precisa:

1. criar um **CRM Dataset** ou converter um Dataset existente no Gerenciador de Eventos;
2. compartilhar esse Dataset com as contas de anúncio corretas;
3. gerar o token da API de Conversões para esse Dataset;
4. ordenar e classificar `VimobInitialLead`, `VimobQualifiedLead` e `VimobConvertedLead` no funil do Gerenciador de Eventos.

Não use um Dataset global da Vimob para organizações diferentes. Dataset, funil, diagnóstico e permissões pertencem ao anunciante. A automação completa dessa etapa exige uma integração de plataforma aprovada pela Meta, como Facebook Business Extension/system user com compartilhamento explícito de cada ativo; o login comum da Página não concede essa autoridade.

## Configuração no Vimob

1. Acesse **Configurações > Integrações > Facebook / Meta**.
2. Em **Devolução de qualidade para o Meta**, escolha a Página conectada.
3. Informe o ID e o token do CRM Dataset, ative os novos envios e salve. Se quiser validar com a base recente, use explicitamente a opção de enviar os fatos reais dos últimos sete dias.
4. Acesse a pipeline desejada e abra as configurações da coluna.
5. Em **Resultados de Marketing**, ative **Esta é a etapa de lead qualificado**.

Cada pipeline aceita no máximo uma coluna qualificada. Ao marcar outra coluna, a configuração anterior é substituída de forma transacional. Colunas de ganho, perdido ou inativas não podem ser qualificadas. A conversão continua automática ao marcar o lead como ganho.

Ativar a integração sem solicitar o replay não envia histórico silenciosamente. A ação explícita usa `replayRecentFacts: true` e enfileira **todos os fatos reais elegíveis** ligados àquela organização, Página, integração e Dataset cuja entrada Meta ocorreu nos últimos sete dias. Ela preserva os horários originais e só inclui uma sequência contígua e válida (`initial` → `qualified` → `converted`). Repetir a mesma solicitação é idempotente.

## Leitura dos indicadores

Entrada, contato, resposta, qualificação e ganho respeitam a entrada Meta atribuída e o período selecionado. O **Valor ganho atribuído** congela o `valor_interesse` no instante do ganho, em vez de recalcular o passado quando o cadastro for editado. **Perdidos** e **Em aberto** mostram o estado atual dos leads daquela coorte de aquisição; se um lead perdido for reaberto, esses dois contadores são atualizados de propósito. Os marcos já devolvidos ao Meta permanecem fatos imutáveis e não são apagados pela reabertura do negócio.

Filtros de equipe, corretor, tag ou status não conseguem repartir com precisão o investimento entregue pela Meta. Nesses recortes, o Vimob mantém as métricas puras de mídia e os resultados filtrados do CRM, mas deixa CPL atribuído, CPQL, custo por ganho e retorno atribuído indisponíveis para não apresentar uma divisão enganosa.

## Teste local ou homologação

1. No Gerenciador de Eventos, copie o código mostrado em **Testar eventos**.
2. Com a devolução ainda pausada, use fatos reais recentes já existentes ou gere um lead artificial pelo recurso oficial de teste de Lead Ads (`POST /{FORM_ID}/test_leads`). Se quiser validar a sequência completa, mova esse lead para a coluna qualificada e depois marque-o como ganho antes da ativação.
3. Ao ativar/salvar o Dataset, solicite explicitamente o envio dos fatos reais recentes com `replayRecentFacts: true` e, somente nessa solicitação, informe o código em `testEventCode`.
4. O botão enfileira todos os fatos reais elegíveis dos últimos sete dias para aquela integração, não apenas um lead selecionado. Confira o total retornado em `recent_facts_queued`.
5. Confirme em **Testar eventos** a sequência `VimobInitialLead` → `VimobQualifiedLead` → `VimobConvertedLead`, sempre com o mesmo Lead ID e os horários originais.
6. Depois da ativação, novas entradas e transições continuam automáticas como eventos normais, sem herdar o código usado no replay.

O `testEventCode` é gravado somente nas novas entregas criadas por essa solicitação explícita; ele nunca é uma configuração global e não afeta eventos automáticos futuros. O código ajuda a localizar eventos, mas **não transforma o Gerenciador de Eventos em sandbox**: o replay envia fatos reais de todos os leads elegíveis da integração, com os horários reais.

### Teste com leads que já existem

O replay explícito pode usar leads reais recentes quando cada entrada:

- veio de formulário instantâneo Meta e preserva um `leadgen_id` válido de 15 a 17 dígitos;
- ocorreu há no máximo sete dias e pertence exatamente à Página/integração configurada;
- preserva uma linha do tempo real, sem qualificação anterior à entrada e sem conversão anterior à qualificação.

A ativação comum não reenvia silenciosamente qualificação ou ganho antigos. O replay só acontece quando `replayRecentFacts` é enviado de propósito; ele inclui todos os fatos elegíveis da integração e não permite escolher um único lead. Fatos com mais de sete dias, sequências incompletas e linhas do tempo inválidas ficam de fora. Não altere `event_time` para contornar o limite.

Não existe API pública para criar um lead real ou movimentar um cartão na Central de Leads da Meta. O endpoint `test_leads` cria somente leads artificiais de teste. Em produção, a Conversions API for CRM devolve qualificação e conversão associadas ao lead original.

## Variáveis do worker

- `META_CONVERSION_FEEDBACK_WORKER_ENABLED` — liga o consumidor da outbox;
- `META_CONVERSION_FEEDBACK_WORKER_INTERVAL` — intervalo entre ciclos;
- `META_CONVERSION_FEEDBACK_WORKER_BATCH` — quantidade máxima por ciclo;
- `META_CONVERSION_FEEDBACK_WORKER_LEASE` — prazo da posse de uma entrega;
- `META_CONVERSION_FEEDBACK_REQUEST_TIMEOUT` — timeout de cada chamada;
- `META_CONVERSION_FEEDBACK_PARTNER_AGENT` — opcional; informe somente o identificador de plataforma acordado com a Meta. Sem aprovação explícita, deixe vazio e o campo será omitido;
- `META_CONVERSION_FEEDBACK_APPSECRET_PROOF_ENABLED` — use somente quando os tokens do CRM Dataset forem emitidos pelo próprio app Vimob; tokens manuais do Gerenciador de Eventos usam `false`.

## Referências oficiais

- [Conversion Leads Integration](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration)
- [Implementing the CRM integration](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/3-implementing-the-crm-integration)
- [Payload specification](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification)
- [How to find the Lead ID](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/how-to-find-the-lead-id)
- [Configure the sales funnel](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/5-configure-your-sales-funnel)
- [Verify the integration](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/4-verify-your-data)
- [Lead Ads testing and troubleshooting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting)
- [Set up Conversions API as a platform](https://developers.facebook.com/documentation/ads-commerce/conversions-api/set-up-conversions-api-as-a-platform)

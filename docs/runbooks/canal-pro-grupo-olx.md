# Canal Pro / Grupo OLX — ativação, homologação e operação

Este runbook cobre a integração compartilhada que publica imóveis no ZAP Imóveis, Viva Real e OLX, recebe leads e recebe relatórios de importação. Os três portais usam a mesma conta e o mesmo feed do Canal Pro; a exibição em cada portal depende do plano e da grade contratados com o Grupo OLX.

## Responsabilidades

- Cliente/imobiliária: manter contrato ativo, autorizar o integrador, selecionar os imóveis no Vimob e acompanhar os relatórios do Canal Pro.
- Vimob: gerar o feed VRSync, manter os endpoints públicos, guardar a `SECRET_KEY` global do Grupo OLX e comprovar criação/distribuição dos leads.
- Grupo OLX: homologar o CRM e os endpoints, consultar o XML e entregar leads/relatórios.

Não registrar a `SECRET_KEY` em `portal_integrations.settings`, no frontend ou neste documento. Ela é um segredo global do CRM, não um segredo por imobiliária.

## O que copiar do Vimob

Em **Configurações > Integrações > Canal Pro**, salve os dados de contato e o destino padrão dos leads e ative a integração. A tela passa a mostrar:

1. `XML de imóveis`: URL HTTPS que o Canal Pro consulta. Não é necessário baixar um arquivo.
2. `Webhook de leads`: endpoint exclusivo para a entrega de contatos.
3. `Webhook de relatórios`: endpoint exclusivo para o resultado da importação do XML.

As URLs contêm tokens de identificação da organização. Copie-as por inteiro, não edite o caminho e não as publique em tickets ou documentos abertos. Regenerar um token invalida a URL anterior imediatamente.

## Cadastro no Canal Pro

1. Confirme que o contrato inclui os portais e a grade que o cliente pretende usar.
2. Acesse o Canal Pro com um usuário autorizado.
3. Vá a **Configurações da conta > Integração de anúncios**.
4. Escolha a integração por feed/CRM e cole a URL **XML de imóveis**.
5. Salve e confira a data da próxima execução no Relatório de Integração.
6. Se a conta não exibir os campos de webhook, siga o processo oficial de homologação do CRM e envie ao Grupo OLX as URLs de leads e de relatórios. Esses são endpoints diferentes.
7. O time técnico da Vimob fornece ao Grupo OLX a `SECRET_KEY` global pelo canal seguro de homologação. O cliente não precisa e não deve receber esse segredo.

O polling oficial ocorre a cada 12 horas, totalizando duas cargas por dia; o horário exato pode variar.

## Pré-validação do catálogo

Antes do primeiro envio, publique uma amostra pequena e representativa. Cada imóvel precisa, no mínimo, passar pelas regras locais de prontidão:

- código externo único de 1 a 50 caracteres;
- título, descrição, tipo de transação e taxonomia de imóvel válidos;
- preço de venda e/ou locação conforme a transação;
- UF, cidade, bairro e CEP;
- área útil ou área total, conforme o tipo;
- quartos e banheiros quando exigidos pela taxonomia;
- ao menos uma foto JPEG pública e validada no backend;
- nome e e-mail de contato da imobiliária;
- produto de publicação compatível com a grade contratada.

O Grupo OLX aceita no máximo 50 mil anúncios em um XML. O validador web oficial aceita arquivos de até 30 MB; para um feed maior, valide uma amostra e confirme a carga completa no Relatório de Integração.

## Homologação obrigatória

Uma integração só pode ser considerada liberada depois de evidenciar todos os itens:

1. URL XML de produção responde `200`, em HTTPS, sem redirecionamento para outro domínio e com XML VRSync válido.
2. Uma amostra passa no validador oficial de XML.
3. O Grupo OLX confirma o cadastro da URL e a próxima janela de leitura.
4. O endpoint de leads passa na homologação do Grupo OLX com a `SECRET_KEY` correta.
5. Um lead de teste cria ou reingressa no contato correto, vincula o imóvel por `clientListingId` e chama a distribuição canônica exatamente uma vez.
6. O reenvio do mesmo `originLeadId` não cria duplicidade.
7. O webhook de relatório responde rapidamente com `2xx`, persiste o corpo e conclui a anotação assíncrona.
8. O Canal Pro e o Vimob mostram a carga, os erros por anúncio e os horários esperados.

O Grupo OLX pode tentar entregar um lead até três vezes e mantê-lo por até 14 dias após falhas; `originLeadId` é a chave oficial contra duplicidade. Já o relatório de importação não tem retentativa automática e o provedor aguarda no máximo 30 segundos, por isso o Vimob persiste primeiro, responde `2xx` e deixa a anotação pesada para o worker.

Sem essa evidência externa, o estado correto é **código validado localmente, homologação pendente** — nunca “100% em produção”.

## Testes locais recomendados

```powershell
Set-Location D:\Vimob\workspaces\vimob-crm\apps\api
go test -count=1 ./internal/portals ./internal/grupoolx ./internal/distribution

$env:VIMOB_RUN_DB_TESTS = '1'
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres'
go test -count=1 -run TestPortalCanonicalQueriesCompileAgainstDatabase ./internal/portals
```

O segundo teste cria fixtures locais temporárias e as remove ao terminar. Não o execute contra produção.

## Diagnóstico

| Sintoma | Verificação | Ação |
| --- | --- | --- |
| XML retorna `404` | Token/URL cadastrado | Copiar novamente a URL atual; uma regeneração invalida a anterior. |
| XML retorna vazio | Estado da integração e seleção na Ficha 360 | Ativar a integração e disponibilizar imóveis válidos no canal Grupo OLX. |
| Canal Pro rejeita o XML | Relatório de Integração e validador | Corrigir os campos apontados; não trocar VRSync pelo formato ZAP depreciado. |
| Anúncio aparece duplicado | Existência de anúncio manual com o mesmo imóvel | Excluir ou reconciliar o anúncio manual no Canal Pro; o XML não o remove. |
| Webhook retorna `401` | `GRUPO_OLX_WEBHOOK_SECRET` e segredo homologado | Corrigir pelo canal seguro da operação; não colocar o segredo na URL. |
| Lead retorna `4xx` | `originLeadId` e `clientListingId` | Leads comuns exigem ambos; MCMV pode não ter `clientListingId`. |
| Lead não vinculou imóvel | `clientListingId` versus ID enviado no feed | Corrigir o ID e preservar o evento para reconciliação. |
| Relatório não aparece | URL exclusiva de relatório e worker | Confirmar cadastro, HTTP `2xx` e `GRUPO_OLX_IMPORT_REPORT_WORKER_ENABLED=true`. |
| Alteração demora a aparecer | Próxima execução no Canal Pro | Aguardar a próxima janela de 12 horas e acompanhar o relatório. |

## Referências oficiais

- [Integração de feeds](https://developers.grupozap.com/feeds/integration.html)
- [Guia de conexão e limites](https://developers.grupozap.com/feeds/connection_guideline.html)
- [Regras de integração](https://developers.grupozap.com/feeds/integration_rules.html)
- [Formato VRSync](https://developers.grupozap.com/feeds/xml-formats/)
- [Validador XML](https://developers.grupozap.com/feeds/xml_validator/)
- [Relatório de integração e caminho no Canal Pro](https://developers.grupozap.com/feeds/report_integration_error_template.html)
- [Webhook de leads](https://developers.grupozap.com/webhooks/integration_leads.html)
- [Segurança dos webhooks](https://developers.grupozap.com/webhooks/security.html)
- [Webhook de relatório de importação](https://developers.grupozap.com/webhooks/integration_report_feeds_via_webhooks.html)

Revalidar essas referências antes de cada homologação, pois contratos e regras do provedor podem mudar.

# Chaves na Mão — requisitos e bloqueadores de integração

Status em 8 de setembro de 2026: **feed XML implementado e validado localmente, mas indisponível por padrão até homologação oficial**.

Este documento registra apenas o que pode ser comprovado em fontes oficiais públicas. Ele não autoriza ativação, não substitui o contrato do cliente e não presume que uma empresa com nome semelhante em uma listagem de parceiros seja a Vimob deste projeto.

## O que já está implementado no Vimob

- canal canônico independente `chaves_na_mao`, sem alias ou reutilização do VRSync do Grupo OLX;
- gerador `Document > imoveis > imovel` com todas as tags oficiais na ordem publicada, inclusive as opcionais vazias;
- transação, finalidade, taxonomia exata de tipos, preços, privacidade do endereço, descrição em CDATA, fotos JPG/JPEG/WEBP (máximo 30), vídeo, tour, pet, troca e período de locação;
- validação por imóvel com exclusão segura dos inválidos, sem publicar parcialmente acima do limite operacional;
- seleção de imóveis, referência estável, opção de destaque, URL XML com token forte, ETag e resposta sem cache compartilhado;
- pausa por feed vazio para drenagem e telemetria de último acesso/resultado;
- rotas administrativas protegidas pelo módulo `portals` e por `settings_integrations`; leitura de imóveis também exige `property_view` ou `property_manage`, e alterações exigem `property_manage`;
- migration forward que amplia somente `portal_integrations` e `portal_listing_publications`. As tabelas de webhook e relatório continuam aceitando apenas `grupo_olx` porque não há contrato Chaves na Mão para esses fluxos;
- bloqueio fail-closed no backend: `CHAVES_NA_MAO_INTEGRATION_ENABLED=false` é o padrão, e todas as rotas administrativas e o feed público respondem indisponíveis enquanto o gate não for habilitado explicitamente em um ambiente de homologação aprovado.

Nenhuma migration foi aplicada remotamente e nenhum feed foi enviado ao portal durante esta implementação.

## O que está confirmado

- A integração imobiliária acontece depois da assinatura do contrato. O cliente recebe por e-mail as instruções para obter o link XML ou para pedir ao integrador que envie o XML ao Chaves na Mão.
- O procedimento varia por integrador. Ao trocar de integrador, o titular da conta deve informar ao atendimento o nome do novo integrador, a URL do XML e, **se houver**, o endpoint de leads.
- As integrações de imóveis entram em fila e, segundo a Central de Ajuda, são processadas duas vezes ao dia: entre 6h e 13h e entre 16h e 22h. Esse horário deve ser tratado como janela operacional do portal, não como SLA do Vimob.
- Existe uma especificação XML imobiliária pública do Chaves na Mão. Ela exige UTF-8, nomes de tags com capitalização exata e a presença de todas as tags da estrutura, mesmo quando um campo opcional fica vazio.
- A raiz publicada segue `Document > imoveis > imovel`. Entre os campos obrigatórios documentados estão `referencia`, `transacao`, `finalidade`, `destaque`, `tipo`, `valor`, `estado`, `cidade`, `bairro` e `descritivo`.
- Fotos usam URLs públicas dentro de `fotos_imovel > foto`; os formatos documentados são JPG, JPEG e WEBP, com limite de 30 fotos por imóvel.

## O que ainda não está comprovado

As fontes públicas não fornecem um contrato atual e testável para recebimento de leads imobiliários. Não foram encontrados, em documentação oficial pública, o schema do payload, autenticação ou assinatura, política de retentativa, timeout, chave de idempotência, códigos de resposta, ambiente de homologação ou exemplos de eventos.

Também precisa ser confirmado formalmente pelo Chaves na Mão:

1. que a entidade ou parceiro chamado `WIMOB` em qualquer cadastro público corresponde juridicamente a este Vimob, com CNPJ, domínio, responsável e status de homologação válidos;
2. qual versão da especificação XML é aceita no contrato atual e se há arquivo XSD ou validador oficial;
3. como a URL do feed deve ser autenticada e quais são os limites de tamanho, timeout, redirecionamento e disponibilidade;
4. a taxonomia vigente de tipos, finalidades, destaques e planos contratados;
5. o contrato completo do endpoint de leads e o fluxo de homologação;
6. como o portal apresenta rejeições por imóvel, reprocessamentos e relatórios de importação;
7. o contato técnico que autoriza a entrada em produção e os critérios de aceite.

### Sinal público que não basta para ativar

Em 7 de setembro de 2026, a consulta pública do portal por `WIMOB` retornou um registro de parceiro com `id=480`, nome `WIMOB` e segmento `REALTY`. O resultado não contém CNPJ, domínio, responsável, status de homologação nem contrato técnico. Portanto, ele é apenas uma pista para o atendimento localizar o cadastro — não prova que se trata desta Vimob nem que a integração está autorizada.

## Decisão de arquitetura

Não implementar a Chaves na Mão como alias de `grupo_olx`. Os formatos, a homologação e o contrato de leads são independentes. O feed já nasce em domínio próprio, com identificador canônico `chaves_na_mao`; inbox de leads, autenticação, idempotência e retentativas só poderão ser adicionados quando o portal fornecer o contrato oficial correspondente.

Até a homologação do feed:

- manter o catálogo como `requires-homologation`;
- manter `CHAVES_NA_MAO_INTEGRATION_ENABLED=false` em produção;
- não aplicar a migration nem gerar feed de produção sem aprovação do rollout;
- não aceitar webhooks sob um contrato inferido;
- não reutilizar formatos ou endpoints da documentação de veículos;
- não armazenar credenciais recebidas em tickets ou no frontend.

## Procedimento de homologação e ativação

1. O cliente assina o contrato e confirma com o atendimento do Chaves na Mão que o Vimob será seu integrador.
2. Em ambiente de homologação, aplicar a migration `20260908064750_enable_chaves_na_mao_portal.sql` e ler de volta os dois `CHECK`s validados.
3. Habilitar `CHAVES_NA_MAO_INTEGRATION_ENABLED=true` somente nesse ambiente e reiniciar a API.
4. Salvar a URL base HTTPS do site, selecionar os imóveis e ativar o feed.
5. Copiar a URL gerada no formato `/v1/public/integrations/portals/chaves-na-mao/feed/{token}.xml` e enviá-la ao canal oficial indicado no contrato. O token deve ser tratado como credencial.
6. Confirmar com o portal a importação, os imóveis rejeitados e a remoção de anúncios após pausa. A janela pública informada pelo portal é duas vezes ao dia; não interpretar isso como confirmação instantânea.
7. Somente depois do aceite formal, repetir o rollout controlado em produção, manter evidência do XML aceito e monitorar `last_feed_accessed_at`, `last_sync_status` e rejeições por imóvel.

Habilitar a variável de ambiente apenas abre o caminho técnico; não representa contrato, credencial nem homologação.

## Pacote mínimo para iniciar a implementação

Solicitar ao Chaves na Mão, pelo canal cadastrado do cliente:

- contrato e confirmação de que o Vimob será o integrador;
- exemplo XML aprovado, versão da especificação e regras de validação;
- URL ou procedimento de homologação do feed;
- contrato de leads com exemplo real anonimizado, autenticação e retentativas;
- credenciais de teste por canal seguro;
- conta/anunciante de homologação e contato técnico responsável;
- critérios formais para aprovação e ativação.

Com esse pacote, o aceite técnico mínimo será: XML validado pelo portal, importação de imóveis com relatório reconciliado, criação idempotente de lead, vínculo por referência do imóvel, passagem única pela distribuição canônica e reteste de falhas/reenvios.

## Referências oficiais

- [Como integrar minha base de imóveis](https://help.chavesnamao.com.br/support/solutions/articles/72000638008-como-integrar-minha-base-de-im%C3%B3veis-ao-chaves-na-m%C3%A3o-)
- [Como alterar o integrador](https://help.chavesnamao.com.br/support/solutions/articles/72000640720-quero-alterar-meu-integrador-de-im%C3%B3veis-o-que-fazer-)
- [Janelas de processamento das integrações](https://help.chavesnamao.com.br/support/solutions/articles/72000640715-quanto-tempo-leva-para-os-im%C3%B3veis-integrados-aparecerem-no-portal-)
- [Documentação XML imobiliária](https://tecnologiacnm.github.io/cnm-xml-documentation/)
- [Estrutura do XML](https://tecnologiacnm.github.io/cnm-xml-documentation/arquivo/estrutura.html)
- [Especificações das tags](https://tecnologiacnm.github.io/cnm-xml-documentation/arquivo/especificacoes/especificacoes-tags.html)
- [Especificação de fotos](https://tecnologiacnm.github.io/cnm-xml-documentation/arquivo/especificacoes/especificacoes-fotos.html)
- [Consulta pública de parceiros por WIMOB](https://api.chavesnamao.com.br/portal/partner?search=WIMOB&limit=10)

Revalidar as fontes e comparar com os documentos enviados na contratação antes de escrever código, porque o próprio portal declara que o processo depende do integrador e do contrato.

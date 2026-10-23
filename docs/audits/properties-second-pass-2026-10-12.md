# Imóveis — segunda auditoria de 12/10/2026

Encontramos **14 problemas adicionais: 7 P1 e 7 P2**. São novos achados desta revisão, não uma afirmação de que todos foram introduzidos pelas correções anteriores. Não houve correção de código nesta rodada.

Checkout auditado: `D:/Vimob/workspaces/vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. A leitura inclui mudanças locais ainda não commitadas e trabalho de outras frentes; HEAD sozinho não reproduz esse estado. Mantivemos as alterações existentes. Este relatório e provas temporárias são os únicos artefatos produzidos pela auditoria. Sem deploy, commit, push, migrations ou escrita no banco.

## Escopo, evidência e limites

Revisamos formulário/cadastro/edição, rascunhos, CEP, catálogos, proprietários, ofertas, chaves, mídia, publicação automática, API pública, IA, workers, lançamentos, hierarquia, reservas, autorização, transações e SQL local. A análise foi dividida entre quatro revisores, com consolidação para não contar a mesma causa duas vezes.

**Reprodução local** significa executar módulos reais com storage, transporte, autenticação ou estado simulados. **Constatação de código** significa rastrear uma condição e os caminhos que a utilizam. Essas evidências não comprovam ocorrência em produção nem substituem uma integração com PostgreSQL/Storage reais. Os achados abaixo têm confiança alta no mecanismo descrito; cada ponto explicita o limite da prova.

Não obtivemos uma consulta nova de Supabase/logs nesta rodada: o conector retornou `projects: []` e duas tentativas de inventário do navegador terminaram em timeout. Isso não indica ausência de projetos ou logs. Os números e logs da primeira auditoria são históricos, registrados no [relatório da primeira rodada](D:/Vimob/workspaces/vimob-crm/docs/runbooks/properties-local-hardening-2026-10-12.md), e não foram reconfirmados agora.

P1 indica autorização, privacidade, perda/corrupção de dados ou reversão de intenção comercial que merece prioridade antes de release. P2 indica inconsistência ou falha operacional relevante, geralmente condicionada a um fluxo menos comum. Não confirmamos P0. A frequência real de cada problema permanece desconhecida.

## Visão dos achados

| ID | Prioridade | Problema | Evidência principal |
| --- | --- | --- | --- |
| 01 | P1 | Comandos fora da mídia podem continuar sob outro usuário | Transporte real com autenticação/fetch simulados |
| 02 | P1 | Reservas aceitam leitura de lead onde deveriam exigir operação | Helper real por overlay e revisão dos endpoints |
| 03 | P1 | Resolver de mídia não verifica bloqueios comerciais atuais | Consulta/assinatura reais revisadas; sem banco |
| 04 | P1 | IA retorna bairro de endereço configurado como mínimo | Helpers reais com dados sintéticos |
| 05 | P1 | Follow-up de save antigo pode desfazer retirada posterior | Helper real com sequência temporal simulada |
| 06 | P1 | Área com três casas decimais aumenta mil vezes no round-trip | Hidratação, payload e Zod reais |
| 07 | P1 | Editar/cancelar imóvel remove rascunho de criação de outra aba | Storage real simulado e chamadas revisadas |
| 08 | P2 | Atualização de acesso remonta o formulário e perde edição | Provider real com mocks; sem navegador integrado |
| 09 | P2 | Vínculo/promoção/publicação contornam hierarquia encerrada | Guard real e encadeamento API/SQL; sem PostgreSQL |
| 10 | P2 | Introspecção dentro de transação pode esgotar o pool | Driver pgx real com protocolo em memória |
| 11 | P2 | Resposta perdida na criação de ativo permite duplicação | Hook/API reais com commit/resposta perdida simulados |
| 12 | P2 | Erro de edição de mídia deixa Salvar bloqueado | Componente real com state/JSX simulados |
| 13 | P2 | Formulário informa publicado após negar comercialização | Helpers reais e composição do hash revisada |
| 14 | P2 | Public API descarta aliases disponíveis aceitos por outros leitores | Helpers reais e pré-filtro SQL revisado |

## 01 — Intenção de comando pode atravessar troca de usuário

**Gatilho e impacto.** A inicia exclusão, oferta ou cadastro auxiliar. A resolução da autenticação aguarda; a sessão muda para B; a operação segue na organização original usando B. O resultado pode executar uma intenção de A e atribuí-la a B. **B precisa ter autorização própria nessa organização**: não é prova de bypass de RLS ou escalada de privilégios.

**Causa.** O transporte só fixa ator/sessão quando o chamador fornece essa intenção. As guardas adicionadas à mídia não abrangem todos os comandos do domínio. O [hook de exclusão](D:/Vimob/workspaces/vimob-crm/hooks/use-properties.ts:486) omite a intenção opcional da [API](D:/Vimob/workspaces/vimob-crm/lib/api/properties.ts:202). As [operações de ofertas/chaves/vínculos](D:/Vimob/workspaces/vimob-crm/lib/api/property-workspace.ts:77) também não propagam esse contrato. Há a mesma ausência no [hook de cidade](D:/Vimob/workspaces/vimob-crm/hooks/use-property-locations.ts:71) e na [API de localidades](D:/Vimob/workspaces/vimob-crm/lib/api/property-locations.ts:126).

**Prova.** DELETE e PUT de oferta executaram o transporte real em VM: ambos enviaram `Bearer synthetic-token-b` para `org-a`. No controle com `expectedUserId=actor-a`, não houve fetch e o resultado foi `api_request_identity_changed`. Cidade foi reproduzida com hook/API reais e transporte simulado; o callback ainda exibiu toast após a mudança. Remontar o provider não cancela uma chamada assíncrona já iniciada. Os demais caminhos citados foram constatados por leitura, sem reprodução individual.

**Ajuste mínimo recomendado.** Capturar ator, organização, recurso e sessão da ação no clique; conferir antes do fetch e dos callbacks, usando o contrato já aplicado à mídia. Compensação deve conservar o escopo original. **Regressão necessária:** trocar sessão durante autenticação e exigir zero requisições/callbacks sob o novo ator, por comando afetado.

## 02 — Operação de reserva usa autorização de leitura do lead

**Gatilho e impacto.** Um líder com `property_manage` e `lead_view_team` enxerga o lead de um corretor liderado registrado em outra equipe. A regra canônica permite visualizar, mas nega usar esse lead em mutação. A capacidade retornada à tela é `can_operate=false`; a API usa a regra mais ampla para criar/prorrogar/cancelar/converter reserva.

**Causa e referências.** [canOperateReservation](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/reservations.go:69) usa `CanUseLeadForMutation`; [requireReservationLeadVisibility](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/reservations.go:117) usa leitura. A criação verifica leitura na [linha 373](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/reservations.go:373); prorrogação e cancelamento/conversão chamam o helper nas [linhas 574](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/reservations.go:574) e [645](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/reservations.go:645). A fronteira está em [authorization/leads.go](D:/Vimob/workspaces/vimob-crm/apps/api/internal/authorization/leads.go:42).

**Prova e limite.** Testes existentes confirmam a diferença de capacidades. Um teste por overlay chamou o helper real com um lead simulado: capacidade de operação falsa, helper sem erro. Não executamos reserva nem transação no banco. Os demais requisitos do endpoint ainda precisam ser satisfeitos.

**Ajuste mínimo recomendado.** Exigir `CanUseLeadForMutation` em cada operação de reserva; manter a leitura ampla apenas para consultas. **Regressão necessária:** negativas por endpoint, incluindo acesso cruzado entre equipes e replay.

## 03 — Mídia publicada continua resolvendo após veto comercial atual

**Gatilho e impacto.** Uma versão já foi entregue e o asset continua público/inalterado. Depois, a autorização comercial é negada, o imóvel fica indisponível ou o Site/organização é desativado, sem mudar `desired_state='published'`. O endpoint de mídia permanece apto a emitir novas URLs assinadas de 60 segundos ou redirecionar a URL externa. Isso permite acessar mídia quando os leitores do anúncio já deveriam ocultá-lo.

**Causa.** [ResolvePublicMedia](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/repository.go:133) vincula organização/imóvel, versão entregue, asset público e `source_hash`, mas não consulta imóvel, autorização comercial, Site ou organização atuais. O hash é do checksum/path/URL do **asset**; alterações nos vetos comerciais não o invalidam. O [handler público](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/handler.go:152) consome essa resolução.

**Prova e limite.** Consulta SQL e emissão da assinatura revisadas; dois contratos Go relacionados passam sem testar esses vetos. Não emitimos URL real nem consultamos Storage/banco. **Retirada canônica já bloqueia novas resoluções:** `desired_state='unpublished'` é verificado. Cache de 30 segundos, URLs previamente emitidas e cópias baixadas são limites diferentes; o achado é a possibilidade de **novos GETs** enquanto a intenção permanece publicada.

**Ajuste mínimo recomendado.** Aplicar os vetos vivos de imóvel/organização e os controles específicos do canal, preservando os vínculos de versão/asset. Site ativo deve ser verificado no canal Site. **Regressão necessária:** após cada veto, um novo GET não deve receber nova assinatura/redirecionamento.

## 04 — IA expõe bairro com privacidade de endereço mínimo

**Gatilho e impacto.** Imóvel elegível pela publicação legada, sem snapshot canônico entregue, possui `address_visibility='minimo'` e bairro preenchido. A IA recebe o bairro privado e pode utilizá-lo nas respostas e resumos de regiões.

**Causa.** [legacyPublicProperty](D:/Vimob/workspaces/vimob-crm/supabase/functions/ai-agent-responder/public-property-eligibility.ts:124) copia `bairro`. A [consulta de regiões](D:/Vimob/workspaces/vimob-crm/supabase/functions/ai-agent-responder/index.ts:1410) e o [seletor de imóveis](D:/Vimob/workspaces/vimob-crm/supabase/functions/ai-agent-responder/index.ts:1689) não carregam os controles de endereço necessários para aplicar a regra.

**Prova e limite.** Com helpers reais, um imóvel sintético de endereço mínimo produziu `BAIRRO_PRIVADO_SINTETICO` para IA e bairro `null` para Public API. Não enviamos dados reais a modelo/provedor. A lacuna já existia no HEAD; é descoberta nova, não regressão atribuída ao último ajuste.

**Ajuste mínimo recomendado.** Carregar e aplicar os mesmos controles de privacidade no legado e durante a transição até a primeira entrega canônica. **Regressão necessária:** comparar projeções de API/IA nos modos mínimo/parcial/completo.

## 05 — Publicação automática antiga pode desfazer retirada mais recente

**Gatilho e impacto.** A salva em T0. B solicita e conclui retirada em T1. O follow-up automático de A consulta o overview em T2 e envia nova publicação usando as revisões de T2. A retirada mais recente pode ser revertida sem um novo clique de publicação após T1.

**Causa.** [requestAutomaticSitePublication](D:/Vimob/workspaces/vimob-crm/lib/api/property-auto-publication.ts:117) recebe o identificador da intenção, mas não a ordem/revisão comercial capturada na gravação original. Usa as revisões recém-consultadas na [linha 151](D:/Vimob/workspaces/vimob-crm/lib/api/property-auto-publication.ts:151). O formulário chama o helper na [linha 817](D:/Vimob/workspaces/vimob-crm/components/features/properties/PropertyFormScreen.tsx:817), inclusive em retomadas de cadastro/mídia. O controle de concorrência recebe revisões válidas e não identifica que o follow-up nasceu antes da retirada.

**Prova e limite.** Helper real, overview e POST simulados: `unpublished/unpublished` após T1 resultou em **um comando novo de publicação** com as revisões T2. Não executamos a corrida entre transações/worker no banco. A reprodução cobre um follow-up cujo comando ainda não havia sido aceito; não afirma que todo replay idempotente de comando já concluído cria outro job.

**Ajuste mínimo recomendado.** Vincular o follow-up à gravação/intenção comercial original e conservar retirada/pausa posterior. Distinguir atualização de conteúdo sob intenção publicada de nova intenção de publicar. **Regressão necessária:** salvar → retirar → retomar automatic/recovery, sem reabrir publicação.

## 06 — Round-trip de área altera 82.125 para 82125

**Gatilho e impacto.** Abrir imóvel com `area_util=82.125` e salvar sem alterar a área. A hidratação produz `"82.125"`; o payload envia `82125`. O mesmo mecanismo afeta outros campos numéricos que passam pelo normalizador com esse formato.

**Causa.** A [hidratação](D:/Vimob/workspaces/vimob-crm/components/features/properties/property-form/property-form-mapping.ts:83) usa `number.toString()`. O [normalizador](D:/Vimob/workspaces/vimob-crm/components/features/properties/property-form/property-form-model.ts:476) interpreta ponto seguido por exatamente três dígitos como milhares. A [montagem do payload](D:/Vimob/workspaces/vimob-crm/components/features/properties/property-form/property-form-model.ts:760) aplica essa interpretação a valores canônicos hidratados. As áreas no baseline SQL são `numeric`, sem escala limitada que elimine o caso.

**Prova e limite.** Hidratação, payload e Zod reais: `82.125 → "82.125" → 82125`, schema aprovado. Também `103.625 → 103625`. Não alteramos imóvel real nem medimos a prevalência de áreas com três casas. Não atribuímos o mesmo alcance a colunas financeiras com escala fixa sem verificar seus contratos.

**Ajuste mínimo recomendado.** Distinguir número canônico de entrada localizada; preservar a igualdade ao abrir/salvar. Casas excedentes de dinheiro precisam de tratamento explícito. **Regressão necessária:** round-trip para áreas fracionárias, ponto decimal, vírgula decimal e milhares.

## 07 — Edição/cancelamento apaga rascunho de outra aba

**Gatilho e impacto.** Na aba A, criar imóvel e aguardar autosave. Na aba B, editar outro imóvel e salvar, ou cancelar essa edição. B remove o rascunho de A. Se A recarregar antes de um novo autosave, perde o preenchimento salvo localmente.

**Causa.** A [chave](D:/Vimob/workspaces/vimob-crm/components/features/properties/property-form/property-form-model.ts:495) contém somente organização/usuário. A edição existente chama `clearDraft(draftKey)` após sucesso na [linha 1101](D:/Vimob/workspaces/vimob-crm/components/features/properties/PropertyFormScreen.tsx:1101). O cancelamento também limpa essa chave sem distinguir edição/criação na [linha 806](D:/Vimob/workspaces/vimob-crm/components/features/properties/PropertyFormScreen.tsx:806).

**Prova e limite.** Storage real substituído por memória: `"NEW PROPERTY DRAFT" → null`; chamadas do componente revisadas. Não fizemos ensaio integrado com duas abas. A aba A mantém o estado React enquanto aberta, mas o rascunho persistido deixa de existir.

**Ajuste mínimo recomendado.** Só limpar rascunho pertencente à criação/edição confirmada, com identidade de operação/recurso. **Regressão necessária:** criar A e salvar/cancelar edição B, conservando o rascunho A; verificar também dois cadastros simultâneos.

## 08 — Mudança de acesso descarta campos não salvos da edição

**Gatilho e impacto.** Durante uma edição, o contexto atualiza equipe/pipeline liderado ou outra informação que muda a assinatura de acesso. Mesmo mantendo usuário e organização, a árvore protegida remonta e o formulário perde os campos não salvos.

**Causa.** O [QueryProvider](D:/Vimob/workspaces/vimob-crm/components/providers/query-provider.tsx:61) inclui essas informações na assinatura e usa-a como `key` na [linha 82](D:/Vimob/workspaces/vimob-crm/components/providers/query-provider.tsx:82). O [autosave](D:/Vimob/workspaces/vimob-crm/components/features/properties/PropertyFormScreen.tsx:680) cobre somente criação; o guard de navegação não intercepta desmontagem por key.

**Prova e limite.** Provider real com mocks: alterar apenas `ledPipelineIds` mudou a key mantendo ator/tenant. Perda do estado na remontagem é constatada pelo encadeamento React; não foi ensaiada em navegador integrado. `File` local só está em risco quando ainda selecionado em cadastro/diálogo pendente. **Mídia já persistida pelo AssetManager permanece no backend.**

**Ajuste mínimo recomendado.** Preservar rascunho autorizado por ator/organização/imóvel e restaurá-lo após revalidar acesso. Conservar a limpeza do cache de autorização. **Regressão necessária:** atualização de equipe/pipeline com edição aberta, incluindo perda real de permissão e troca de usuário.

## 09 — Hierarquia encerrada tem entradas alternativas para carteira/publicação

**Gatilho e impacto.** Desativar planta/fase/bloco de unidade disponível, sem reserva/publicação ativa, e depois promover/vincular a unidade; ou publicar diretamente um imóvel vinculado após encerrar seus pais. Os demais requisitos comerciais ainda se aplicam, mas o fechamento da estrutura não é verificado nesses caminhos.

**Causa.** [Manutenção](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/maintenance.go:259) admite desativação nessas condições. [LinkUnitProperty](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/unit_property_link.go:127) não aplica a hierarquia aberta. [PromoteUnitProperty](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/unit_property_link.go:242) usa guard parcial; [developmentBlocksUnitPromotion](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/unit_property_link.go:993) também omite `suspended`. A regra completa já existe em [inventory_availability.go](D:/Vimob/workspaces/vimob-crm/apps/api/internal/developments/inventory_availability.go:44). [Publicação direta](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/repository.go:825) e [worker](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/worker.go:339) não carregam esses pais.

**Prova e limite.** Guard real por overlay aceitou empreendimento suspenso. Revisão de API/triggers/SQL não identificou compensação que force rascunho ao arquivar os pais. O [guard SQL local](D:/Vimob/workspaces/vimob-crm/supabase/migrations/20260908000631_harden_property_domain_invariants.sql:200) verifica unidade/modalidade/preço, sem fechamento dos pais. Não executamos o fluxo em PostgreSQL nem confirmamos quais migrations estão aplicadas.

**Ajuste mínimo recomendado.** Regra de hierarquia completa em vínculo, promoção, publicação e worker, com ordem de locks consistente para arquivar versus publicar. **Regressão necessária:** matriz por pai fechado/suspenso e teste de concorrência com banco.

## 10 — Consulta ao esquema pode prender o pool durante transação

**Gatilho e impacto.** Criar/semear catálogos ou criar condomínio enquanto todas as conexões disponíveis estão ocupadas por essas transações. Cada uma espera outra conexão para consultar uma coluna, mantendo a primeira. Requisições ficam presas até cancelamento/deadline e ocupam o pool usado por outros fluxos.

**Causa.** [Catálogo](D:/Vimob/workspaces/vimob-crm/apps/api/internal/properties/catalog.go:123) abre transação, chama introspecção na [linha 224](D:/Vimob/workspaces/vimob-crm/apps/api/internal/properties/catalog.go:224), e [tableHasColumn](D:/Vimob/workspaces/vimob-crm/apps/api/internal/properties/catalog.go:263) usa `Pool.QueryRow`, adquirindo outra conexão. [Condomínio](D:/Vimob/workspaces/vimob-crm/apps/api/internal/properties/locations.go:1216) repete o padrão. O [padrão de configuração](D:/Vimob/workspaces/vimob-crm/apps/api/internal/config/config.go:227) é 8 conexões; não verificamos a capacidade configurada em produção.

**Prova e limite.** pgxpool v5.10 real com protocolo sintético por `net.Pipe`: capacidade 1 bloqueou uma aquisição adicional; capacidade 8 bloqueou oito. Total: **9 deadlines sem consulta chegar ao protocolo**, contra **9 consultas concluídas pela própria transação**. Zero rede e PostgreSQL real. Prova o mecanismo de aquisição, não a frequência/carga de produção.

**Ajuste mínimo recomendado.** Passar a transação/queryer a `tableHasColumn` e usar a conexão já adquirida. **Regressão necessária:** operação com pool pequeno e operações concorrentes sem aquisição adicional.

## 11 — Ativo pode duplicar após commit com resposta perdida

**Gatilho e impacto.** Upload e criação do ativo concluem no backend, mas a resposta ao cliente se perde. O discard recusa apagar o arquivo já vinculado. Reabrir/reselecionar o mesmo arquivo para tentar novamente faz novo upload e cria outro ativo com path diferente.

**Causa.** O [hook](D:/Vimob/workspaces/vimob-crm/hooks/properties/use-property-workspace.ts:268) cria upload/path novo por tentativa; a [API de ativo](D:/Vimob/workspaces/vimob-crm/lib/api/property-workspace.ts:208) não carrega identidade idempotente da operação. A [recusa de discard](D:/Vimob/workspaces/vimob-crm/apps/api/internal/properties/workspace_ownership_assets.go:1297) está correta para proteger arquivo vinculado, mas o cliente não reconcilia a criação anterior. Unicidade por path não deduplica dois uploads diferentes.

**Prova e limite.** Hook/API reais com commit seguido de resposta perdida simulados: duas tentativas produziram dois ativos/paths. Não duplicamos dado real nem exercitamos índice PostgreSQL. A tentativa posterior pode exigir fechar/reabrir ou selecionar novamente, devido ao bloqueio descrito no ponto 12. É uma lacuna de ativo, distinta da idempotência já implementada no cadastro do imóvel.

**Ajuste mínimo recomendado.** Persistir identidade/path da tentativa e reconciliar antes de novo upload; ou idempotência de criação por operação. **Regressão necessária:** commit com resposta perdida seguido de retry, resultando em um ativo.

## 12 — Falha de edição deixa Salvar de mídia desabilitado

**Gatilho e impacto.** Editar ativo existente recebe HTTP500/erro de transporte. Alterar título, descrição ou URL não permite repetir o save. É necessário fechar/reabrir e perder as correções locais.

**Causa.** O [catch](D:/Vimob/workspaces/vimob-crm/components/features/properties/detail/PropertyAssetDialog.tsx:167) grava `localError`; os [campos](D:/Vimob/workspaces/vimob-crm/components/features/properties/detail/PropertyAssetDialog.tsx:273) não o limpam; o [submit](D:/Vimob/workspaces/vimob-crm/components/features/properties/detail/PropertyAssetDialog.tsx:310) é desabilitado por qualquer erro. Na edição, tipo/arquivo não podem ser trocados para destravar esse estado.

**Prova e limite.** Componente real com state/JSX simulados: habilitado → HTTP500 → desabilitado → título corrigido → ainda desabilitado. Sem navegador integrado ou requisição real.

**Ajuste mínimo recomendado.** Separar erro de transporte de validação e permitir retry; limpar erro pertinente ao mudar o campo. **Regressão necessária:** preservar edição e permitir segunda tentativa após falha transitória.

## 13 — Veto comercial recebe falso sucesso de publicação

**Gatilho e impacto.** Uma versão atual está entregue. Negar somente `autorizado_comercializacao` pode manter `is_outdated=false`. Ao salvar, a publicação automática retorna `already-published`, e o formulário informa sucesso apesar de a visibilidade estar bloqueada. Esse caminho contribui diretamente para a percepção de publicar e permanecer privado.

**Causa.** O [atalho de sucesso](D:/Vimob/workspaces/vimob-crm/lib/api/property-auto-publication.ts:83) ocorre antes dos bloqueios. A flag comercial é [carregada separadamente](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/repository.go:829), fica fora do [payload público](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/projection.go:683), e [is_outdated](D:/Vimob/workspaces/vimob-crm/apps/api/internal/publications/repository.go:682) compara somente o hash. A mensagem de sucesso está na [linha 844 do formulário](D:/Vimob/workspaces/vimob-crm/components/features/properties/PropertyFormScreen.tsx:844).

**Prova e limite.** Helper real: `already-published` junto com estado visual “Comercialização não autorizada”. A composição real da fonte/hash confirma que negar somente a flag é um cenário alcançável. **Status não foi usado como reprodução equivalente**, pois entra no payload e muda o hash. O backend negaria um POST de publicação; o atalho pula esse POST. Sem publicação real.

**Ajuste mínimo recomendado.** Avaliar os vetos vivos antes de informar sucesso ou processamento. **Regressão necessária:** consentimento true → false em versão atual, sem mensagem de publicado e com motivo coerente em todas as superfícies.

## 14 — Public API perde imóveis com aliases de disponibilidade

**Gatilho e impacto.** Imóvel público elegível possui `status='available'`, `disponivel` ou `Ativo`. Go/IA e parte dos helpers aceitam, mas a consulta Public API remove o registro antes da projeção. `Disponível` tem ainda divergência de normalização. O resultado é disponibilidade diferente conforme o consumidor.

**Causa.** A [allowlist SQL](D:/Vimob/workspaces/vimob-crm/supabase/functions/public-api/index.ts:83) contém somente `active/ativo`; os filtros exatos nas [linhas 250](D:/Vimob/workspaces/vimob-crm/supabase/functions/public-api/index.ts:250), [298](D:/Vimob/workspaces/vimob-crm/supabase/functions/public-api/index.ts:298) e [528](D:/Vimob/workspaces/vimob-crm/supabase/functions/public-api/index.ts:528) são mais restritos que a regra de elegibilidade. O [normalizador local](D:/Vimob/workspaces/vimob-crm/supabase/functions/public-api/property-public-projection.ts:128) não remove acentos como os demais leitores.

**Prova e limite.** `available`: helper aprovado, pré-filtro rejeitado, IA aprovada. `Disponível`: helper/API rejeitado, IA aprovada. Dados sintéticos; não medimos quantos registros atuais usam esses valores. Testes do helper isolado não exercitam o filtro completo da consulta.

**Ajuste mínimo recomendado.** Harmonizar candidatos e normalização entre leitores, mantendo allowlist fechada para status desconhecido. **Regressão necessária:** mesma matriz de aliases atravessando consulta e projeção em cada consumidor.

## Provas e verificações preservadas

Scripts temporários não foram adicionados à suíte nem ao código do produto. Autenticação, dados e URLs são sintéticos; transportes de prova são inertes.

| Evidência | Resultado e limite |
| --- | --- |
| [root-scope-proof.cjs](D:/Vimob/tmp/properties-audit2-20261012/root-scope-proof.cjs) | DELETE/oferta com B; controle fixado em A não envia fetch. Módulos reais, VM, sem rede. Rerun na consolidação: exit 0. |
| [form-draft-numeric-proof.mjs](D:/Vimob/tmp/properties-audit2-20261012/form-draft-numeric-proof.mjs) | Rascunho removido e área multiplicada/aceita pelo Zod; exit 0. |
| [catalog-provider-proof.cjs](D:/Vimob/tmp/properties-audit2-20261012/catalog-provider-proof.cjs) | Cidade sem guarda e mudança de key por pipeline; exit 0. |
| [asset-retry-proof.cjs](D:/Vimob/tmp/properties-audit2-20261012/asset-retry-proof.cjs) | Duas criações após resposta perdida simulada; exit 0. |
| [asset-dialog-error-proof.cjs](D:/Vimob/tmp/properties-audit2-20261012/asset-dialog-error-proof.cjs) | Retry de edição bloqueado após erro; exit 0. |
| [frontend-proof-results.json](D:/Vimob/tmp/properties-audit2-20261012/frontend-proof-results.json) | Saídas dos quatro scripts de formulário/ativos. |
| [readonly-publication-audit.mjs](D:/Vimob/tmp/properties-fixes-20261012-fb58fe98/readonly-publication-audit.mjs) | IA/endereço, aliases, falso sucesso e retirada reproduzidos; contrato de mídia constatado por fonte. Rerun nesta consolidação: exit 0. |
| [development-negative-overlay-test.go](D:/Vimob/tmp/properties-audit2-20261012/development-negative-overlay-test.go) e [overlay](D:/Vimob/tmp/properties-audit2-20261012/development-overlay.json) | Helpers reais de reserva/promoção por teste virtual. Nenhum teste físico inserido no pacote. |
| [pool-acquisition-proof.go](D:/Vimob/tmp/properties-audit2-20261012/pool-acquisition-proof.go) | 9 aquisições adicionais atingem deadline; 9 controles pela transação passam. Driver real, protocolo em memória. |
| [Saída overlay](D:/Vimob/tmp/properties-audit2-20261012/development-negative-overlay.tool-output.log) e [saída pool](D:/Vimob/tmp/properties-audit2-20261012/pool-acquisition-proof.tool-output.log) | Transcrições das saídas observadas, com comandos e exit 0; sem nova execução para gerar as notas. O terceiro teste temporal do overlay não integra os achados finais. |
| [Evidência dos testes de publicação](D:/Vimob/tmp/properties-fixes-20261012-fb58fe98/readonly-publication-test-evidence.md) | Comandos/contagens/exits reconstruídos das saídas dos tools; não é log bruto integral. Inclui a falha Google Calendar. |

Comandos reproduzíveis, a partir do checkout principal:

```powershell
node D:/Vimob/tmp/properties-audit2-20261012/root-scope-proof.cjs
node --experimental-strip-types --import D:/Vimob/workspaces/vimob-crm/scripts/tests/typescript-alias-hooks.mjs D:/Vimob/tmp/properties-audit2-20261012/form-draft-numeric-proof.mjs
node D:/Vimob/tmp/properties-audit2-20261012/catalog-provider-proof.cjs
node D:/Vimob/tmp/properties-audit2-20261012/asset-retry-proof.cjs
node D:/Vimob/tmp/properties-audit2-20261012/asset-dialog-error-proof.cjs
node --experimental-strip-types D:/Vimob/tmp/properties-fixes-20261012-fb58fe98/readonly-publication-audit.mjs
go test -overlay D:/Vimob/tmp/properties-audit2-20261012/development-overlay.json ./apps/api/internal/developments -run '^TestAudit2(ReservationWriteHelperAcceptsReadOnlyCrossTeamLead|SuspendedDevelopmentPromotionGuardAllowsNewProperty)$' -count=1 -v
go run D:/Vimob/tmp/properties-audit2-20261012/pool-acquisition-proof.go
```

O filtro restrito do overlay acima serve para reproduzir somente os dois achados. A execução observada usou `-run '^TestAudit2'` e passou nos três testes presentes, mas o caso temporal adicional ficou fora desta lista de problemas.

Os revisores também executaram **18 testes Node de publicação automática/IA**, **5 testes Edge selecionados** e **2 contratos Go de mídia/autorização**, com sucesso. Isso não cobre os negativos encontrados. A primeira execução do arquivo Edge completo falhou em contrato Google Calendar, fora do recorte de imóveis; a falha não foi investigada nem convertida em um novo achado de imóveis. Não declaramos a suíte completa aprovada.

Não repetimos TSC/lint/suítes globais. Não houve teste integrado desta rodada em Mac/iPhone, medição de latência real de CEP, carga de 5–6 mil usuários, concorrência PostgreSQL, entrega de worker em produção ou Storage real. Os testes visuais e de CEP da primeira rodada continuam sendo evidência histórica daquele estado.

## Suspeitas descartadas e limites do encerramento

- Chips selecionados no diálogo de lead e cache do histórico pareciam sobreviver à perda de acesso. No aplicativo integrado, a mudança de assinatura remonta a árvore/query client e elimina esse estado; não contamos como vazamento confirmado.
- Retirada canônica de mídia já bloqueia novas resoluções. O ponto 03 se restringe a vetos vivos sem mudança da intenção publicada.
- Não confirmamos novo defeito em lease/versão do worker, orçamento de tentativas, resolução do ator do job ou recibo de criação/remoção nesta leitura.
- CEP e guardas recentes de preparo/upload não apresentaram outro bloqueante concreto no recorte revisado. Isso não equivale a validar cada função nem todos os dispositivos.

As migrations/cutovers e verificações de produção pendentes da primeira rodada continuam pendentes; não são novos achados desta lista. Grants e policies precisam ser conferidos no ambiente e testados conjuntamente, conforme a [documentação oficial de RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). Leitura de SQL local não prova sua aplicação ou o resultado de uma requisição real.

Esta rodada encerra a **auditoria local adicional**. No momento da auditoria, os 14 pontos permaneciam abertos para correção e validação. Para tratar a recorrência de publicado/privado, os pontos 03, 05, 13 e 14 são diretamente relacionados à publicação/visibilidade; 02 e 09 afetam a coerência comercial dos lançamentos. A prioridade de segurança e integridade também inclui 01, 04, 06 e 07.

Após autorização para correção, os 14 pontos receberam ajustes no checkout principal. O [fechamento local](D:/Vimob/workspaces/vimob-crm/docs/runbooks/properties-second-pass-closure-2026-10-12.md) registra as mudanças, testes, revisão independente e limites; não houve deploy ou alteração remota. Este relatório mantém as evidências históricas da descoberta.

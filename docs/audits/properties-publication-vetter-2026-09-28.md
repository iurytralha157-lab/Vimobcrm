# Imóveis: validação de publicação na Vetter — 2026-09-28

## Verificação posterior: CA0065

- O CEP `27935-320` retornou **Rua Curitiba, Riviera Fluminense, Macaé/RJ** tanto no ViaCEP quanto no BrasilAPI. A edição do CA0065 mostrava **Maringá** no campo manual de bairro. A correção local substitui o bairro anterior pelo da consulta e remove a associação antiga de catálogo.
- A Central do CA0065 na Vetter mostrou Site **Canal indisponível**, estado desejado **Manter fora do ar**, observado **Rascunho**, nenhuma versão criada e nenhum processamento. As pendências obrigatórias exibidas eram localização e descrição pública. Portanto, o indicador **Privado** desse imóvel corresponde ao estado canônico observado; nenhuma publicação dele foi confirmada.
- O módulo Site não era verificado na mesma lista de prontidão que exibia “Site ativo”. A correção local apresenta a pendência específica do módulo quando ele impede a publicação, inclusive se o contexto de autorização e o banco divergem.
- A aba de mídia do CA0065 mostrava três cartões de metadados, sem miniaturas, apesar de haver três fotos na ficha. A apresentação local passa a usar as URLs temporárias já fornecidas pelo workspace para mostrar as fotos, mantendo os detalhes secundários.
- Esta verificação foi somente leitura no ambiente publicado. Nenhum dado do CA0065 foi alterado e nenhuma publicação, migração ou configuração de módulo foi aplicada.

## Escopo e evidência no ambiente publicado

- Organização usada: **Vetter co.** Nenhum imóvel foi criado ou alterado em outra organização.
- Imóvel técnico criado: **AP0377**, `3c18ecd6-a90d-46c5-af8a-7ec297328281`, identificado no título e nas descrições como teste. Continua **ativo e fora do site**, sem versão de publicação.
- O CEP `01001-000` preencheu Praça da Sé, Sé, São Paulo e SP na criação. Depois de salvar e reabrir a edição, CEP e logradouro permaneceram, mas bairro, cidade e UF voltaram vazios. A Central de Publicação bloqueou o imóvel por localização incompleta.
- Uma foto principal foi enviada na primeira tentativa e apareceu no card. A segunda foi gravada em Storage, mas o botão de adicionar mídia fechou a edição. As duas fotos ficaram com a mesma ordem exibida. A prévia antes da primeira publicação não mostrou nenhuma delas, apesar de a galeria da ficha mostrar duas.
- O estado de AP0377 passou por ativo, reservado, vendido e voltou a ativo. O imóvel antigo de teste **CA0063** passou por disponível, reservado, vendido e voltou a disponível. Os estados foram conferidos na interface.
- A Central marcou **Site** e **Grupo OLX** como canais indisponíveis. Grupo OLX também indicou integração e módulo não configurados. Não houve publicação real nem validação de URL pública ou feed XML.
- A tentativa de cadastrar `São Paulo/SP` pela ação **Nova** retornou erro de contrato por ausência de `updated_at`. O endpoint pode ter inserido a cidade antes de a resposta falhar; conferir a linha existente após a migração, sem repetir a criação às cegas.

## Correções locais

- Cadastro e edição usam o mesmo formulário de etapas, com abas apenas por ícones e nomes acessíveis. A consulta de CEP passa por rota própria com ViaCEP e BrasilAPI como reserva; o formulário aguarda a consulta antes de salvar.
- Migração `20260928031110_preserve_manual_property_location.sql`: preserva bairro, cidade e UF manuais quando não há IDs de catálogo e adiciona `updated_at` às cidades e bairros para satisfazer o contrato da API. Valores apagados anteriormente, como os de AP0377, não são reconstruídos pela migração.
- Prontidão do Site exige CEP válido, localização, área, modalidade com oferta/preço compatível, descrição, título, tipo, foto pública e status disponível. Grupo OLX usa o mesmo formato estrito de CEP e não aceita preço legado para reativar oferta pausada.
- Prévia antes da primeira publicação usa somente fotos canônicas públicas com URL de acesso temporária, sem passar caminhos privados para o componente de prévia ou para a versão pública. Prévia de versão já publicada continua congelada. A galeria da prévia permite percorrer as imagens.
- Inclusão de mídia na edição não submete o formulário pai. A capa é enviada antes da galeria. Ordens de novos ativos são reservadas no cliente e colisões entre abas são resolvidas pelo backend sob lock do imóvel.
- A aba de mídia e a ficha exibem miniaturas das fotos, posição e selo de principal; metadados extensos ficam recolhidos. A miniatura usa URL temporária do workspace para arquivos protegidos, sem carregar automaticamente link externo de foto interna ou confidencial.
- Ao salvar na aba Publicação, o formulário abre a Central somente depois de confirmar cadastro e mídias; a edição também relê o endereço após o PATCH. A ficha mostra fila, erro, retirada e versão publicada do Site pelo estado canônico. Lista, filtros e estatísticas projetam a versão efetivamente publicada em uma consulta, com fallback legado apenas na ausência de publicação canônica.
- A consulta pública do site reconhece os estados `available` e `disponivel`, como já fazia a prontidão. A Central agora mostra explicitamente a pendência do módulo Site quando este impede a publicação.

## Validação e limite de liberação

- Passaram: typecheck; **81 testes de UI de imóveis** no script integrado; 7 testes do cliente CEP; 20 testes de mídia; 3 testes de prévia de publicação; testes Go de `properties`, `publications` e `site`; lint dos arquivos TypeScript alterados; verificação do source lock das migrations; `git diff --check`.
- A regressão E2E de inclusão de mídia na edição foi descoberta pelo Playwright, mas não executada contra outra organização. O teste SQL pgTAP e o teste Go de integração com banco foram escritos, porém não executados por ausência de uma base QA configurada. A nova interface e a nova prévia não foram vistas no navegador, pois não houve deploy.
- **Gate de liberação:** executar a migração e o pgTAP em base QA descartável; aplicar a migração no alvo antes de liberar frontend/API; conferir listagem/criação de cidade e bairro e leitura após salvar CEP; corrigir AP0377 em edição e confirmar leitura após salvar; verificar por que o canal Site está indisponível na Vetter; fazer canário de publicação e retirada apenas quando o canal estiver habilitado, verificando foto e URL pública. Validar Grupo OLX separadamente após configurar a integração. Até esses passos, a publicação real permanece não verificada.

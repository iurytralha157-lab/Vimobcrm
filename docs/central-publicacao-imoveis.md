# Central de Publicacao de Imoveis

## Objetivo

A Central de Publicacao e a fonte de verdade operacional para distribuir um
imovel em canais externos. O site proprio e o Grupo OLX usam o mesmo contrato
canonico. No Grupo OLX, um unico feed VRSync atende OLX, ZAP e Viva Real de
acordo com o plano contratado pela imobiliaria.

Ela separa quatro conceitos que antes estavam misturados em um booleano:

- prontidao do cadastro para cada canal;
- intencao do usuario (`desired_state`);
- estado observado no canal (`observed_state`);
- versao imutavel do conteudo efetivamente publicado.

`properties.published_on_site` permanece apenas como projecao temporaria de
compatibilidade. Novas escritas de publicacao devem passar pela Central.

## Limites do dominio

```text
Ficha 360
  -> GET/POST /v1/properties/{id}/publications/...
     -> property_channel_publications       estado atual
     -> property_channel_publication_versions snapshots imutaveis
     -> property_channel_publication_jobs   fila, retry e historico
        -> worker do canal
           -> snapshot publico do site
           -> snapshot VRSync do Grupo OLX
           -> proxy seguro de midia privada
```

O snapshot e uma projecao publica explicita. Ele nunca pode conter dados de
proprietario, observacoes internas, documentos, chaves, tokens ou caminhos do
Storage.

## Estados

Estado desejado:

- `published`
- `paused`
- `unpublished`

Estado observado:

- `draft`
- `queued`
- `publishing`
- `published`
- `pausing`
- `paused`
- `unpublishing`
- `unpublished`
- `error`

Prontidao:

- `unknown`
- `ready`
- `blocked`

Jobs:

- acoes: `publish`, `update`, `unpublish`, `revalidate`;
- estados: `pending`, `processing`, `retry`, `succeeded`, `superseded`, `dead`.

## Regras obrigatorias

1. Toda mutacao exige `Idempotency-Key` e precondicao de revisao. Publicar
   compara tanto a revisao do imovel quanto a revisao da linha do canal; `null`
   significa que o operador observou o canal ainda sem linha canonica.
2. Reutilizar a chave com o mesmo payload devolve o resultado anterior.
3. Reutilizar a chave com outro payload retorna conflito.
4. Um snapshot publicado nao e alterado. Uma mudanca gera nova versao.
5. O worker reivindica jobs com `FOR UPDATE SKIP LOCKED` em transacao curta.
6. A conclusao do job exige o mesmo `lease_token`, impedindo worker antigo de
   confirmar um lease reaproveitado.
7. Job de versao ultrapassada termina como `superseded`.
8. Retirada do canal prevalece sobre limpeza de midia: primeiro o conteudo some,
   depois recursos auxiliares podem ser limpos.
9. Falhas transitorias usam backoff; falhas permanentes viram `dead` e permitem
   nova tentativa manual.
10. O backend calcula readiness e capabilities. O frontend apenas apresenta o
    resultado.

## Compatibilidade do site

Durante a migracao, o catalogo publico segue esta precedencia:

1. se existe publicacao central `site/default`, apenas o snapshot central
   atualmente publicado pode aparecer;
2. se existe registro central em qualquer outro estado, o imovel nao volta pelo
   caminho legado;
3. somente quando nao existe registro central pode haver fallback para
   `properties.published_on_site`.

Essa regra evita que um imovel retirado, bloqueado ou com erro reapareca no site.
Nao ha backfill cego na primeira migracao: cada imovel passa a ser autoritativo
na Central a partir do primeiro comando.

## Compatibilidade do Grupo OLX

O Grupo OLX usa `channel = grupo_olx`. A conta do canal e identificada pela
integracao correspondente; OLX, ZAP e Viva Real nao criam tres estados
independentes, pois recebem o mesmo feed da conta.

Durante a adocao, o XML segue esta precedencia por imovel e conta:

1. se existe uma publicacao canonica, somente a sua versao imutavel atualmente
   disponivel pode entrar no XML;
2. uma publicacao canonica retirada, bloqueada ou com erro nunca reaparece pelo
   caminho legado;
3. apenas na ausencia de qualquer registro canonico o feed usa
   `portal_listing_publications` como fallback temporario.

A tela legada de integracao nao altera mais `is_enabled`: ela permite somente
preparar ListingID/produto de uma linha ainda fora do XML. Linhas legadas ja
ativas ficam bloqueadas para edicao. Toda disponibilizacao, atualizacao e
retirada passa pelos comandos idempotentes da Ficha 360 e pela permissao
`property_manage`.

Nao existe backfill de `exported` para `published`. No legado, `exported`
significa apenas que o XML foi servido. Na Central, o estado observado
`published` do Grupo OLX significa **disponivel no XML**, e nao confirmacao de
aceite pelo portal. Rejeicoes recebidas no relatorio de importacao ficam
registradas separadamente e preservam a intencao (`desired_state`) do usuario.

Se a integracao for pausada ou desativada, um token de feed ainda valido deve
receber um XML vazio. Isso permite que o provedor retire os anuncios antigos em
vez de conservar a ultima copia conhecida.

Salvar configuracoes nunca ativa nem pausa o canal. A ativacao e a pausa usam
comandos dedicados; a pausa preserva os tokens, inicia a drenagem pelo XML vazio
e mantem os webhooks autenticados disponiveis para eventos atrasados.

O `ListingID` fica imutavel a partir da criacao da publicacao canonica. Essa
regra continua valendo depois da retirada, porque leads atrasados ainda podem
referenciar o identificador antigo. O produto comercial pode ser alterado
somente quando os estados desejado e observado estiverem integralmente
`unpublished` e nao houver versao publicada.

O feed nunca e truncado silenciosamente. Mais de 50.000 anuncios ou um XML com
mais de 30 MB retornam erro operacional explicito, preservando a ultima entrega
valida. `ETag` representa os bytes do XML e requisicoes de leitura nao mudam o
conteudo nem a revisao da publicacao.

Relatorios de importacao sao persistidos integralmente em uma caixa de entrada
duravel antes de qualquer processamento. O webhook confirma o recebimento sem
esperar a normalizacao; um worker idempotente processa cada evento com tentativas
e backoff, sem deixar um evento invalido bloquear os seguintes.

A tela da integracao lista os 100 recebimentos mais recentes, prioriza eventos
em `retry` ou `dead` e permite reprocessar uma dead letter sem substituir o
payload bruto nem a data do recebimento original. Payload autenticado com JSON
valido, mas fora do contrato esperado, e preservado e termina como `dead`; ele
nunca e promovido silenciosamente a sucesso.

Erros e avisos do provedor nao mudam prontidao, `last_error`, versao nem o
significado de `published`: a versao continua disponivel no XML. Como o relatorio
oficial identifica o anuncio pelo `ListingID`, mas nao identifica a versao do
snapshot, o retorno normalizado e apresentado separadamente como
`provider_feedback`, com `version_bound = false`, data do provedor quando valida
e data de recebimento. Relatorios atrasados permanecem no historico e nunca
podem regredir o estado editorial atual.

Leads autenticados continuam aceitos durante a janela de drenagem, inclusive
com a integracao pausada, pois o provedor pode manter anuncios em cache. Leads
`MCMV_OLX` sem `clientListingId` sao registrados sem vinculo com imovel e seguem
o destino padrao da integracao.

## Seguranca dos webhooks do Grupo OLX

A credencial Basic (`SECRET_KEY`) e unica por CRM fornecedor, e nao por
imobiliaria anunciante. Ela e configurada apenas no backend da Vimob pela
variavel `GRUPO_OLX_WEBHOOK_SECRET`; nunca e armazenada nas configuracoes do
tenant nem exibida no frontend. O token aleatorio da URL identifica a
integracao/organizacao e pode ser rotacionado sem revelar a credencial global.

## Midia publica

Fotos normalizadas continuam no bucket privado. O snapshot armazena apenas a
identidade logica do asset e uma URL estavel do BFF. Ao receber a requisicao, o
BFF confirma que:

- a intencao ainda e manter a publicacao no ar (`desired_state = published`);
- a versao solicitada foi efetivamente entregue com sucesso;
- o asset pertence ao snapshot entregue e continua com visibilidade publica.

Somente entao ele redireciona para uma URL assinada de curta duracao. O caminho
interno do objeto e URLs assinadas nunca sao persistidos ou devolvidos no
contrato administrativo.

Versoes entregues anteriormente continuam resolvendo suas fotos enquanto a
publicacao permanecer desejada no ar. Isso cobre a corrida em que o navegador
ou o portal recebe o XML/HTML v1 e busca suas imagens depois da ativacao da v2.
Uma retirada muda a intencao imediatamente e bloqueia todas as versoes.

Enquanto um asset estiver referenciado por uma versao publicada, sua
representacao (visibilidade, localizador, conteudo e checksum) e sua exclusao
fisica ficam bloqueadas. A retirada da publicacao libera a edicao e a limpeza.
Quando existem fotos normalizadas em `property_assets`, elas sao a fonte
autoritativa; URLs legadas nao sao anexadas ao feed, evitando reintroduzir uma
foto interna ou confidencial.

## Readiness inicial do site

Erros bloqueantes incluem, no minimo:

- site da organizacao inativo;
- imovel fora do estado comercial disponivel;
- titulo, tipo, finalidade ou descricao publica ausentes;
- nenhuma oferta ativa compativel com a finalidade;
- cidade, bairro ou UF ausentes;
- nenhuma foto publica utilizavel.

Avisos nao bloqueantes podem cobrir qualidade do texto, quantidade de fotos,
geolocalizacao, video, tour, responsavel e completude comercial.

O snapshot do site aplica a escolha de privacidade antes de persistir qualquer
dado publico: `minimo` inclui somente cidade/UF, `parcial` inclui
bairro/cidade/UF e `completo` pode incluir o endereco cadastrado. Uma versao em
processamento nunca remove a ultima versao boa do catalogo; a troca ocorre
somente quando o novo job conclui.

## Readiness do Grupo OLX

O preflight do Grupo OLX acontece antes de criar a versao e inclui, no minimo:

- integracao e modulo de portais ativos;
- contato da imobiliaria configurado;
- identificador externo e produto de publicacao validos;
- titulo entre 10 e 100 caracteres e descricao entre 50 e 3.000;
- descricao sem HTML cru, aceitando apenas a formatacao codificada suportada
  pelo VRSync (`br`, `b`, `i` e marcadores);
- finalidade, tipo e oferta compativeis;
- cidade, bairro, UF e CEP completos;
- area exigida pelo tipo do imovel;
- ao menos um `property_asset` publico com JPEG e tamanho de ate 7 MB
  comprovados; URL legada sem prova permanece apenas no fallback transitorio e
  nao pode criar uma publicacao canonica que desapareca do XML;
- imovel em estado comercial disponivel.

O snapshot do Grupo OLX permanece restrito ao backend e preserva os campos
necessarios para montar o VRSync. Na entrega, o adaptador aplica a visibilidade
publica do endereco e remove rua, numero, complemento e coordenadas quando a
exibicao for parcial. As URLs de midia sao versionadas; assim, uma foto alterada
gera uma URL nova sem expor o caminho interno do Storage.

A politica de endereco `minimo` da Vimob (somente cidade e UF) nao atende o
minimo exigido pelo VRSync. Por isso ela bloqueia a prontidao do Grupo OLX e
orienta o usuario a escolher exposicao parcial ou completa; o adaptador nunca
amplia a visibilidade silenciosamente com bairro ou CEP.

## Observabilidade

Cada canal deve expor na Ficha 360 o ultimo pedido, tentativa, sucesso, erro,
versoes atual e publicada, prontidao e historico recente de jobs. As metricas
minimas do worker sao jobs pendentes, idade do job mais antigo, taxa de sucesso,
retries, dead letters e duracao por acao/canal.

## Evolucao

Site e Grupo OLX validam o contrato completo. Os proximos adaptadores devem
implementar apenas readiness, projecao e entrega especificas do canal, sem criar
novos booleans em `properties`. As tabelas `portal_*` permanecem apenas como
compatibilidade e ingress de webhooks ate a conclusao da adocao do motor
canonico.

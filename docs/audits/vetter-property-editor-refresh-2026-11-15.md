# Imóvel: revisão atual ao reabrir o editor

Diagnóstico `R2-PROPERTY-EDITOR-REFRESH`, base `00d1a1ed`, Vetter co.,
15/11/2026. Delta local; a produção ainda requer reteste após release.

## Causa e correção

Após publicar e retirar AP0379, a abertura do editor reutilizou uma revisão
anterior. O Save retornou 409 e preservou o rascunho: a proteção de concorrência
funcionou. O aparente bloqueio de Recarregar era um window.confirm nativo não
exposto pela API IAB; foi resolvido pelo controle nativo e não comprova falha
do produto.

O provider define refetchOnMount=false. useProperty tinha staleTime=0, mas não
sobrescrevia essa política. Invalidar uma query inativa a torna stale sem buscar;
remontar o editor ainda reutilizava o cache sem pedir a revisão atual. Os callbacks
de publicar, retirar e tentar novamente já invalidam corretamente a chave do
imóvel. Não faltava uma invalidação nesses caminhos.

A alteração é uma linha em useProperty: refetchOnMount="always", igual à
política já usada pelo workspace/publicações. Permanecem as chaves com tenant e
assinatura de acesso, guards de módulo/permissão, CAS, restauração de rascunho e
rebase de alterações locais. Não altera o provider global ou dados persistidos.

Foram mapeados os seis consumidores: formulário, prévia, picker de imóveis,
detalhe de lead, EventSheet e ConversationLeadPanel. O último foi apenas lido
para identificar dependência; Conversas continua fora da execução. O efeito
compartilhado é uma leitura atual ao montar um consumidor autorizado.

## Verificação local

| Verificação | Resultado |
|---|---|
| Reprodução com provider/hook reais e QueryClient/QueryObserver | RED com cache inativo; controle com override passou |
| Novo runtime permanente antes/depois | RED 6 falhas/3 controles; GREEN 9/9, 0 pulos |
| npm run test:property-ui | 253/253, 0 pulos |
| npm run typecheck | exit 0 |
| npm run lint | exit 0; 0 erros e 8 avisos legados |
| npm run audit:check após escritores canônicos | 4/4 |

O runtime executa os corpos reais das declarações do provider e hook, com SDK
TanStack real. Auth e transporte são sintéticos. Também executa os callbacks
reais de publicação/retirada/retry para provar a invalidação do editor inativo.
Inclui reaberturas repetidas, resposta tardia de outro ator/tenant, chave distinta
para outro ator no mesmo tenant e negações de usuário/permissão/módulo. O gate
canônico mantém os testes existentes de hidratação, CAS e rascunhos.

O teste novo foi acrescentado ao script existente test:property-ui; não há novo
job ou dependência. Os inventários são regenerados pelos escritores existentes.
Na integração com outros deltas, regenerar os inventários sobre a união dos
arquivos, preservando os demais scripts de teste.

Não foi usado HTTP como prova de CRUD, nem executado browser/servidor/banco de
produção por este teste. Não é prova ponta a ponta da autenticação ou de todos
os consumidores; o guard de mutation é uma fronteira sintética neste harness.

## Impacto e reversão

Abrir uma query autorizada já em cache faz uma nova leitura, incluindo previews
e pickers. Isso pode acrescentar requisições nesses pontos, sem mudar a política
global. O CAS continua protegendo alterações concorrentes e o rascunho dirty
continua seguindo a política existente; não se força rebase silencioso.

Reverter a linha restaura o comportamento anterior, sem restaurar dados. Após
release, retestar publicação/retirada e reabertura do editor com revisão atual,
além de preservar rascunho/conflito em uma alteração concorrente real.

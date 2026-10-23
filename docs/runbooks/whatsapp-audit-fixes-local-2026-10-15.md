# WhatsApp: fechamento local da revisão de 15/10/2026

Escopo: checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`, base `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Correções locais sobre o estado já modificado do checkout. Sem commit, push, deploy, migração remota, envio, replay ou alteração de produção.

## Correções

| Ponto | Resultado |
| --- | --- |
| Fila de envio e mídia | Tentativa limitada a 2 minutos; fases SQL de 20 segundos, espera de lock de 2 segundos, heartbeat e conclusão de 5 segundos. Rollback independente limitado a 2 segundos. Uma fase presa deixa de renovar indefinidamente e ocupar o executor. |
| Ordem e segurança do envio | A recuperação considera o marcador durável atual e exige organização, sessão, conversa e lease corretos. Aceite do provedor segue para finalização, sem novo POST. Resultado incerto permanece para reconciliação. Não se libera outra conversa ou lease; os bloqueios de FIFO existentes continuam válidos. |
| Monitor legado | Erro HTTP, corpo inválido, estado ausente ou contraditório são observação desconhecida. Desconexão exige confirmação. Escrita condicional protege mudanças simultâneas de sessão e a deduplicação da notificação mantém o episódio original. |
| Acesso administrativo legado | Os dois monitores globais exigem também perfil ativo, além da autorização administrativa existente. Erro na consulta não concede acesso. |
| Histórico e mídia | `includeMediaUrls:false` passa do hook à API e ao histórico Go. O histórico textual não aguarda assinatura de mídias; a renovação continua autorizada separadamente. O comportamento padrão dos demais consumidores foi preservado. |
| Limpeza manual | O script legado respeita `expires_at` e não apaga integrantes das famílias de recibos. A retenção e exclusão atômica dessas famílias continuam pertencendo ao worker canônico, inclusive para marcadores parciais ou desconhecidos. |
| Balão no mobile | O balão em tela cheia mantém o foco e isola o fundo para navegação assistiva. Menus e dados da mensagem continuam acessíveis; Escape e retorno ao acionador respeitam as camadas. Desktop continua sem prender o foco. |
| Avatares | Fotos já autorizadas permanecem durante paginação de novos autores e falha temporária de rede. Troca de usuário, organização, escopo, sessão ou conversa, revogação e resposta autorizada vazia invalidam a imagem correspondente. |

Também foi corrigida uma corrida entre a conclusão de mídia e o cancelamento do próprio heartbeat. Cancelamento causado pela conclusão não é confundido com perda real de lease; perda confirmada e erro independente continuam interrompendo o trabalho.

Não foram modificados os padrões aprovados de fonte, cor, arredondamento ou dimensões. O CSS global e os componentes primitivos foram preservados. A revisão visual usou capturas sintéticas do balão em 320/390 pixels e desktop, em tema claro e escuro; os testes integrados cobrem a página e o balão. O controle de microfone isolado em algumas capturas é um sentinela do teste, não um novo controle do produto.

## Validação e evidências

Artefatos desta etapa: `D:/Vimob/tmp/whatsapp-audit-fixes-20261015/`.

Foram alterados ou adicionados 33 arquivos nesta etapa: 14 de produto, 11 de testes, sete de suporte/manifesto/CI e este relatório. O inventário com caminhos, tamanhos e hashes está em `root/owned-source-seal-final.json`; esse número não representa o total de arquivos do domínio WhatsApp nem o total de alterações preexistentes no checkout.

- TypeScript global, ESLint global e checagem Deno das três entradas Edge e seus dois helpers passaram. ESLint teve quatro avisos em arquivos fora do WhatsApp e nenhum erro.
- O manifesto local de Edge foi atualizado somente nos três hashes esperados: duas funções e o diretório compartilhado. Inventário, autenticação, configuração e hashes de implantação capturada não foram alterados.
- Os testes de manutenção executaram o SQL real em tabela temporária: 15 casos passaram. O RED fiel do predicado anterior reproduziu 10 falhas; o CLI que lê credenciais reais não foi executado.
- Os sete arquivos SQL passaram no clone descartável: 153 asserções pgTAP, além da suíte de respostas rápidas pessoais por exceções e permissões.
- As duas falhas antigas de espera de lock foram reproduzidas por overlay Go sobre snapshots, sem reverter o checkout. Os testes puros de fila passaram: 37 casos principais, 50 incluindo subcasos.
- O grupo de regressão Edge/API passou em 86 casos. Os 31 casos do hook de histórico e os 41 de avatar/modal também passaram individualmente; esses números se sobrepõem ao lote de runtime, portanto não devem ser somados novamente.
- O lote Go final passou nos 39 testes principais, 74 incluindo subcasos, sem falhas ou skips. Inclui as cinco novas integrações de fila, o histórico com mídia assíncrona, envio/transferência, reações, retenção e FIFO. As 261 fontes Go conferidas permaneceram iguais durante a execução.
- A rodada de runtime executou 205 casos: 204 passaram e um áudio recebido em 320 pixels não avançou o relógio em cinco segundos. O arquivo completo correspondente foi repetido em série, com os mesmos prazos, fontes e asserções: 38/38 passaram. Há prova aprovada para os 205 casos distintos, mas não houve uma nova execução integral das nove suítes inteiramente verde nesta etapa. O log inicial foi preservado.
- O lote Node final teve 123 casos: 121 passaram e dois falharam exclusivamente nos pins das migrações compartilhadas, sem skips/cancelamentos/TODO. Os controles novos de montagem do ledger passaram.

Os resultados estão em `root/go-admitted-proof.json`, `root/runtime-final/proof.json`, `root/runtime-audio-recheck-proof.json`, `root/runtime-reconciled-proof.json` e `root/node-after-ledger/proof.json`. Resultados intermediários e REDs foram preservados, inclusive a primeira rodada Go com 38 aprovações e uma falha de montagem da fixture.

Duas rodadas diagnósticas posteriores tiveram timeouts no primeiro ping do banco. A revisão identificou que o runner temporário fazia somente a leitura offline do manifesto antes do Go, enquanto a CI canônica faz `verifiedClient` live. A rodada final reproduziu essa admissão canônica imediatamente antes do Go e passou; a admissão levou 13.542 ms no total. Nenhum limite, asserção ou configuração de durabilidade foi afrouxado. O log do banco também mostrou I/O lento; isso não foi transformado em diagnóstico de falha do produto nem em benchmark de produção.

### Banco de testes e dependências compartilhadas

O PostgreSQL é sintético e descartável, limitado a `127.0.0.1:57924/vimob_whatsapp_clone`. Antes de DDL ou dados de teste, os guardas conferem raiz, banco, endereço, porta, diretório de dados, identificador do cluster, nonce e opções de durabilidade. Nenhum banco real foi usado.

A montagem canônica precisava também da tabela `private.whatsapp_meta_creative_event_ledger`, usada pela retenção de recibos. Foi adicionada à fixture somente a extração exata de DDL da migração canônica de 03/09: tabela, PK/check, índices, RLS, revokes e três FKs. Há hashes da fonte completa e de cada bloco, controle de deriva e testes de ordenação. Nenhuma função antiga, trigger ou backfill de Meta foi reaplicado.

As duas migrações de calendário/audiência em edição paralela foram apenas lidas e materializadas em snapshot revisado no clone para o diagnóstico. Fontes produtoras, pins compartilhados e lock global de migrações não foram alterados por esta etapa. Isso permite testar o comportamento local, mas não equivale à aprovação do comando CI `all`.

## Pendência de integração e limites

1. A CI completa continua pendente da conclusão e revisão do trabalho paralelo de calendário/audiência. Seus dois pins rejeitam as fontes atuais, como devem fazer enquanto essa revisão não foi fechada. Depois do congelamento desse trabalho, revisar os dois arquivos, atualizar os pins por evidência e executar o gate completo, incluindo as nove suítes de runtime, em banco novo. Não mascarar as falhas com skip, alteração de asserções ou atualização cega de hash.
2. Não houve homologação em Safari/iOS físico, PWA instalada, provedor real ou produção. Testes e capturas locais não comprovam latência real do WhatsApp ou entrega externa.
3. A correção não reabre mensagens históricas automaticamente. Recuperação do caso da Ana Beatriz exige diagnóstico e autorização próprios; nenhum evento real foi reenviado ou descartado nesta etapa.
4. Notificação aceita pelo provedor não pode ser desfeita se a sessão mudar durante o POST. A escrita condicional impede sobrescrever o estado novo; falha posterior de auditoria é reportada, sem simular rollback externo.
5. Falhas genuínas de lease ou resultado incerto continuam usando a reconciliação conservadora existente. Não há promessa de liberar instantaneamente todo tipo de lease ou de reenviar uma entrega incerta.

## Revisão e reversão

Esta etapa possui snapshots anteriores por responsável em `root/before/`, `queue/before/`, `security-media/before/` e `ui/before/`, diffs de fase e hashes finais. Uma reversão deve ser seletiva sobre esses deltas, conferindo alterações posteriores de outros trabalhos. Não usar reset, checkout global ou apagar arquivos não rastreados: o checkout já continha alterações de outras tarefas antes desta etapa.

Os limites adicionados são internos, sem nova variável de ambiente. Nos arquivos legados grandes, as alterações foram pontuais para evitar uma refatoração visual ou de domínio fora do escopo. O preview restaurado usa a API publicada em modo de somente leitura; ele não é prova de execução do Go candidato.

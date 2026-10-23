# WhatsApp — Parte 1: contrato funcional antes da correção

**Data:** 08/10/2026  
**Escopo:** especificação local para revisão; nenhuma regra deste documento está declarada como implantada.  
**Checkout de referência:** `D:\Vimob\workspaces\vimob-crm`, `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com alterações locais preexistentes.  
**Estado:** especificação funcional local. O §8 registra diferenças do candidato
de 08/10; o estado da implementação e as provas de 09/10 estão no
[runbook da inbox](runbooks/whatsapp-inbox.md). Publicação pendente.

Este contrato consolida as decisões dadas para conversas sem lead, histórico do lead
e WhatsApp conectado. O objetivo é corrigir captura e visibilidade sem trocar o
transporte de recebimento nem o caminho de envio do CRM. O documento não autoriza
migração, cutover, replay, limpeza, envio ou deploy.

## 1. Vocabulário e limites

- **Sessão:** o WhatsApp conectado de um usuário dentro de uma organização.
- **Conversa sem lead:** época física de uma conversa direta que tem prova positiva
  de não possuir vínculo anterior com lead. `lead_id IS NULL`, isoladamente, não é
  essa prova: um lead excluído pode deixar o campo vazio.
- **Época:** conversa física da mesma organização, sessão e identidade remota,
  com `created_at` próprio. Depois de expirar uma época sem lead, uma mensagem
  realmente nova pode abrir outra; eventos antigos continuam presos à original.
- **Histórico disponível:** conteúdo e mídia ainda preservados pelo CRM e
  atribuíveis com segurança à época. Não significa histórico completo do aparelho.
- **Vínculo:** atribuição explícita de uma conversa a um lead. **Entrar no
  atendimento** é outra ação; somente ela autoriza o envio humano pelo CRM.
- **Saída externa:** mensagem `from_me` observada no WhatsApp conectado sem
  corresponder a envio gerenciado do CRM, outbox ou automação comprovada. A
  origem é a sessão conectada; o evento não prova qual pessoa digitou no
  aparelho.

Ficam fora da nova captura temporária: grupos, identidade ambígua, quarentena,
histórico já pertencente a outro lead e rotas de campanha/intake que têm contrato
próprio. Esses casos não podem ser convertidos em “sem lead” só por terem
`lead_id` nulo no momento da leitura.

## 2. Contrato observável por estado

| Estado | Conteúdo visível e destinatário | Contador e aviso | Envio pelo CRM | Retenção e efeitos |
| --- | --- | --- | --- | --- |
| Sem lead, época válida (< 7 dias) | Entrada e saída externa aparecem em lista, busca, detalhe e chat **somente ao dono da sessão autorizada** | Nova entrada atualiza contador compartilhado, prévia e tela em tempo real; saída externa não gera não lida; sem push/desktop | Bloqueado na UI e na API | Toda a época expira em `created_at + 7 dias`; não cria lead, atendimento, automação ou gamificação |
| Lead vinculado, sem atendimento | Histórico elegível anexado e eventos novos dos dois sentidos aparecem a quem pode ver o lead | Entrada nova atualiza prévia, lista e não lidas; saída externa não incrementa não lidas; histórico anexado não cria avisos retroativos | Bloqueado até entrada válida no atendimento | Histórico atribuído ao lead permanece; observação externa não cria entrada fictícia nem efeitos comerciais de `captured` |
| Lead vinculado, com atendimento válido | Fluxo atual de mensagens recebidas e enviadas | Comportamento atual de inbox, contador e eventos de lead | Permitido apenas com acesso ao lead, sessão e entrada do vínculo atual | Preservar outbox, deduplicação, automações e efeitos legítimos do fluxo atual |
| Mensagem suprimida, vencida ou de origem incerta | Nenhum texto ou mídia dessa mensagem aparece | Nenhum aviso relativo a essa mensagem | Depende do estado da conversa e do atendimento, não dessa mensagem antiga | Não recuperar por simples vínculo ou replay; manter somente prova mínima sem conteúdo quando necessária |

O contador de não lidas **permanece por conversa**, como hoje. Abrir o chat e
marcá-lo como lido pode zerá-lo para todos que têm acesso; esta etapa não cria
estado individual de leitura. “Notificação em tempo real” significa atualização
de conversa, lista e contador. **Não** inclui push, aviso de desktop nem nova
notificação no centro de notificações.

## 3. Recebimento, envio e tempo real

1. Preservar autenticação do webhook, persistência durável no inbox, `202` após
   aceite, processamento assíncrono, ordenação por rota, retries, deduplicação e
   seleção atual de processador Go/Edge para a época legada. Após o cutover de
   uma sessão para `epoch=1`, Go processa a nova época nativamente; a cerca de
   execução impede que uma Edge atrasada da época anterior escreva depois do
   corte. `202` não significa que a mensagem já esteja visível. Os dois
   processadores devem aplicar o mesmo contrato de classificação nos eventos
   que cada época permite.
2. Preservar envio pelo CRM via lead, permissão da sessão, entrada no atendimento,
   mensagem e outbox transacionais, idempotência e reconciliação de resultado
   incerto. Um eco `from_me` de envio do CRM atualiza esse envio; não cria uma
   segunda mensagem nem outro pedido ao provedor.
3. Capturar saída externa como **observação** do evento do provedor. Ela pode
   atualizar prévia e histórico, mas não entra no outbox, não autoriza resposta
   pelo CRM e não é atribuída a um usuário humano presumido.
4. Separar captura visível de efeitos de negócio. Um novo estado de observação
   sem atendimento não deve herdar automaticamente triggers de automação,
   distribuição, gamificação, atenção, avatar ou handoff de `captured`.
   O evento **novo** de intake comprovado mantém seus efeitos atuais; histórico
   anexado e observação externa não os executam de novo.
5. Realtime envia apenas sinal privado de invalidação, **sem texto, mídia,
   telefone ou JID**. O hint da inbox pode atingir usuários autorizados ao
   módulo WhatsApp da mesma organização mesmo que não vejam aquela conversa;
   ele não carrega ID de contato ou mensagem. A API consultada depois aplica
   sessão e acesso ao lead. Tópicos específicos de lead e dados consultáveis
   obedecem ao acesso do lead. A atualização deve funcionar sem recarregar a
   página; polling de reserva não conta como prova de Realtime saudável.

**Meta de aceite para ensaio local controlado:** em um conjunto registrado de
mensagens de teste para lead e sem lead, nenhuma pode exigir refresh manual;
medir aceite do webhook, processamento, disponibilidade na API e exibição na UI.
Como alvo inicial, 95% devem aparecer em até 15 segundos após o aceite e 100% em
até 60 segundos, sob o mesmo ambiente e carga de teste. Para mídia, isso mede a
mensagem ou seu estado de carregamento; disponibilidade do arquivo é medida
separadamente. A medição de produção será um gate posterior, não uma conclusão
deste documento.

## 4. Visibilidade e autorização

| Objeto | Quem pode consultar |
| --- | --- |
| Conversa sem lead ativa | Dono da sessão com acesso vigente a ela. Administração da organização, por si só, não dá leitura universal a conversas sem lead. |
| Conversa e histórico de lead | Administrador autorizado: todos os leads da organização; líder: os leads aos quais a regra efetiva lhe dá acesso; usuário comum: leads atribuídos a ele. A origem em outro time não retira do líder o acesso a um lead atribuído a corretor do seu time. |
| Mídia, busca, prévia e contador consultáveis | Exatamente o mesmo escopo da mensagem; não pode existir atalho por URL, Data API ou ID conhecido. Hint de inbox sem conteúdo segue a regra do §3. |

Permissões devem ser validadas no servidor e, quando houver acesso direto ao
banco, por grants/RLS compatíveis. Perder acesso à sessão revoga leitura da
conversa **sem lead**, operação e envio nessa sessão. A leitura de histórico já
atribuído a um lead depende do acesso **àquele lead** e permanece possível
quando a sessão é desconectada ou excluída; perder acesso ao lead a revoga.
Não aceitar vínculo “às cegas” por ID: a pessoa precisa poder consultar a
conversa e o lead envolvidos. Telefones iguais em duas organizações ou em dois
cards nunca autorizam escolha automática de card.

## 5. Vínculo e anexação automática do histórico

1. Ao escolher a conversa e o lead, ou criar lead **a partir daquela conversa**,
   mostrar sessão, contato, intervalo e quantidade de mensagens elegíveis.
   Confirmar o vínculo informa que esse histórico ficará visível às pessoas com
   acesso ao lead. Não há caixa para escolher importar: o anexo elegível é
   **automático** após a confirmação do vínculo.
2. Autorizar organização, conversa direta, sessão exata, identidade remota
   comprovada, lead de destino acessível e `expectedPreviousLeadId` sob lock.
   Reatribuição explícita de A para B requer acesso à conversa e a ambos os
   cards, confirmação e comparação do vínculo anterior; o passado de A fica em
   A. Rejeitar concorrência, identidade ambígua e conversa sem lead vencida.
3. Na mesma transação, vincular e atribuir **cada mensagem elegível ainda
   preservada**, inclusive saída externa e mídia, ao lead. Preservar ID,
   horário, direção, origem e status; adicionar auditoria de ator, sessão,
   lead, conversa, período, quantidade anexada e origem humana/sistêmica da
   ação, sem conteúdo sensível. O ledger de vínculos atual não registra o ator
   humano; esta é uma exigência nova.
4. Atribuição antiga a outro lead é imutável. Se depois houver outro vínculo,
   o histórico do lead A não se move nem se copia ao B. Um vínculo de conversa,
   isoladamente, não deve fazer a consulta do lead inferir que mensagens com
   `lead_id` vazio são suas.
5. Entrar no atendimento pode ocorrer **agora ou depois**. Apenas vincular
   continua permitindo observar novas mensagens externas no histórico do lead,
   sem permitir envio pelo CRM. Se o primeiro envio ocorrer no fluxo do card,
   apresentar a confirmação do vínculo/histórico antes da entrada e do envio.
6. Uma consulta, abertura de histórico ou navegação não pode criar vínculo.
   Vínculos implícitos por telefone na criação/reentrada de lead e no chat
   flutuante não podem anexar histórico anterior silenciosamente. O intake
   automático comprovado continua recebendo e vinculando sua mensagem nova,
   mas o histórico sem lead anterior permanece em segmento/época separada,
   consultável pelo dono da sessão até o sétimo dia e vinculável explicitamente
   ao lead criado nesse período. Esse vínculo tardio anexa apenas o histórico:
   não reativa a época antiga como chat corrente nem troca o vínculo da nova
   época. Se não for vinculado, o segmento antigo expira normalmente.
   A nova época vinculada começa com o evento de intake e não é eliminada junto
   com a antiga. A implementação deve isolar essas épocas/dados para que o
   histórico anterior não seja exibido ao lead nem escape da limpeza por acaso.
7. Um webhook aceito **antes** do vínculo e processado **depois** integra o
   histórico anexado se o snapshot imutável provar mesma organização, sessão,
   época e ausência de vínculo anterior, e o vínculo tiver sido confirmado
   antes do corte de sete dias. A decisão usa o horário de aceite e o vínculo,
   não o atraso de processamento. Um evento ocorrido ou aceito antes da
   **entrada no atendimento** não vira `captured` só porque foi processado
   depois dela; preservar o marco temporal de atendimento. Um replay antigo
   não se apropria de época nova, não recria texto apagado e não dispara efeitos
   retroativos.

## 6. Prazo de sete dias e eliminação operacional

- O prazo é exatamente `whatsapp_conversations.created_at + interval '7 days'`
  para a época comprovadamente sem lead. Novas mensagens não renovam o relógio.
  No instante do corte, ela deixa de aparecer em lista, busca, detalhe e
  contador; a API não emite novos links de mídia. URLs assinadas emitidas
  antes do corte ainda podem funcionar até seu TTL atual de 15 minutos.
  Uma mensagem comprovadamente ocorrida após o
  corte, da mesma identidade e sessão, abre outra época física; evento antigo
  e duplicata permanecem na anterior. Horário de ocorrência ausente, futuro
  ou inconsistente exige quarentena, não uma época nova presumida. Go e Edge
  devem tomar a mesma decisão.
- Se o vínculo humano for confirmado **antes** do corte, o histórico elegível
  anexado vira histórico do lead e não sofre essa limpeza. No instante do corte
  ou depois, a época antiga não pode ser promovida nem recuperada.
- A limpeza assíncrona remove conteúdo, prévias e mídia do banco/Storage; IDs
  mínimos sem conteúdo podem permanecer como tombstones para deduplicação. Como
  meta operacional, sanear conteúdo no banco e payloads brutos vencidos em até
  24 horas após o corte, e objetos de mídia sem outra referência em até 48
  horas. Falha, atraso e fila de Storage GC em estado terminal exigem alerta e
  procedimento de remediação. Isso não declara prazo de expurgo dos backups de
  infraestrutura.
- Eventos `pending`, `retry` ou `dead` com payload bruto não podem virar um
  arquivo indefinido de mensagens sem lead vencidas. Quando a época comprovada
  vence sem vínculo, encerrar esses eventos como terminais auditáveis, sanear
  o payload pessoal e manter só identificadores mínimos para deduplicação;
  alertar se havia evento ainda não processado. Nunca aplicar essa limpeza a
  evento de lead, origem incerta ou época não comprovada.
- Histórico legado ambíguo, inclusive conversa cujo lead foi excluído, não é
  classificado nem limpo automaticamente pela mera ausência de `lead_id`.
  `suppressed` antigo e conteúdo já saneado não são restaurados pelo vínculo;
  sincronização histórica do aparelho é um projeto separado e não presumido.

## 7. Critérios de aceite da Parte 1 e da futura correção local

**Parte 1 fica especificada** com as decisões confirmadas pelo usuário e as
duas premissas conservadoras do §9. Esta matriz é a fonte de verdade para Go,
Edge, banco, API e interface na correção local. A correção posterior só poderá
ser chamada de validada após os testes abaixo:

| Cenário controlado | Resultado obrigatório |
| --- | --- |
| Duas organizações com o mesmo número; duas sessões e dois leads com telefone igual | Nenhum vazamento ou escolha de card por telefone isolado. |
| Sem lead: texto recebido, mídia e saída feita no WhatsApp conectado | Todos aparecem ao dono em tempo real e após refresh; CRM não envia; saída não aumenta não lidas nem duplica outbox. |
| Administrador, líder, atribuído, não atribuído e revogação de acesso | Lista, detalhe, mídia, histórico, busca e Realtime obedecem à mesma autorização. |
| Vínculo humano de conversa com seis dias, sem entrada no atendimento | Todo histórico elegível dos dois sentidos entra automaticamente uma vez; novas mensagens externas aparecem; envio CRM continua bloqueado. |
| Primeiro envio pelo CRM após vínculo e entrada | Usa a outbox atual e aparece uma vez; histórico antigo permanece; marcador e efeitos só surgem no momento correto. |
| Leitura de histórico, criação/reentrada automática de lead e intake comprovado | Nenhuma leitura ou match por telefone compartilha histórico antigo silenciosamente; intake atual continua funcionando. |
| Intake automático com segmento sem lead anterior | Evento novo entra no lead; segmento anterior continua visível só ao dono até vencer ou ser vinculado explicitamente; a limpeza não atinge a nova época do lead. |
| Webhook aceito antes do vínculo e processado depois; evento fora de ordem e replay | Mesma época e atribuição corretas, sem perda por corrida ou duplicação. |
| Evento ocorrido/aceito antes da entrada no atendimento e processado depois | Não recebe captura ou efeitos retroativos de atendimento. |
| `created_at + 7 dias` antes, exatamente no limite e depois; mensagem nova no dia 8 | Época antiga invisível no limite, sem renovação; nova época independente; conteúdo vencido não retorna. |
| Horário do provedor ausente, futuro ou inconsistente; paridade Go/Edge | Não cria nova época nem promove conteúdo sem prova temporal; decisão de quarentena equivalente nos dois processadores. |
| Vínculo versus scrub, mídia em processamento, Storage 404/503 e GC terminal | Resultado atômico e observável; nenhuma referência viva é apagada; falha terminal gera alerta. |
| Troca explícita A → B e lead antigo excluído | Mensagens atribuídas a A nunca passam para B. Se A for excluído, não reaparecem como sem lead; sua leitura segue a política de exclusão. Legado incerto não é promovido nem saneado como se fosse novo. |
| Realtime indisponível e retorno da conexão | Sem vazamento no sinal; fallback não perde mensagem; registrar tempo e causa sem chamar polling de Realtime. |

Usar dados sintéticos e um Supabase local descartável com Auth, Realtime,
Storage, API Go, Edge e interface apontando para o **mesmo projeto**. Os pgTAP
e testes focados já descritos no [roteiro de validação local](runbooks/whatsapp-conversas-sem-lead-validacao-local-2026-10-08.md)
não substituem essa prova de ponta a ponta; o próprio roteiro registra reset
limpo e E2E ainda pendentes. A publicação fica fora desta Parte 1.

## 8. Diferenças registradas no candidato de 08/10 (histórico)

Esta lista é um diagnóstico daquele snapshot e não deve ser usada como estado
atual do checkout. Antes de preparar release, conferir cada item no código e
nas provas locais registradas no runbook da inbox.

1. `unlinked_ephemeral` e sua promoção aceitam apenas entrada, não saída
   externa. O predicado de histórico protegido trata qualquer `from_me` como
   barreira à época/limpeza.
2. Lead sem atendimento e saída externa antes do vínculo ainda podem ser
   `suppressed`, com conteúdo descartado. O candidato não fornece observação
   futura do lead sem entrada.
3. A promoção atual ocorre no trigger de mudança de `lead_id`; os caminhos de
   vínculo implícito precisam ser separados para não revelar histórico sem
   confirmação humana.
4. O worker de retenção está desligado por padrão. Ocultar no prazo não prova
   saneamento de payload bruto, mídia ou dead letters. O inbox bruto nasce com
   expiração de 30 dias; `pending`, `retry` e mensagens `dead` exigem uma regra
   própria de terminalização/redação para cumprir o prazo deste contrato.
5. Não há prova local completa do fluxo provedor → API → banco → Realtime → UI,
   nem prova atual de produção, para este contrato ampliado.

**Referências principais:** `docs/runbooks/whatsapp-inbox.md`,
`docs/runbooks/whatsapp-conversas-sem-lead-validacao-local-2026-10-08.md`,
`apps/api/internal/whatsapp/webhook_native_processor.go`,
`apps/api/internal/whatsapp/repository.go`,
`apps/api/internal/whatsapp/message_operations.go`,
`apps/api/internal/leads/repository.go`,
`supabase/functions/evolution-go-webhook/index.ts` e
`supabase/migrations/20261008210143_whatsapp_unlinked_ephemeral_realtime.sql`.

### Pontos de código para a correção posterior

| Contrato | Evidência local a confrontar |
| --- | --- |
| Aceite durável e processamento posterior | `apps/api/internal/whatsapp/handler.go:89-110`; `webhook_ingress.go:440-615`; `webhook_worker.go:526-651` |
| Captura Go e Edge | `webhook_native_processor.go:1504-1539`; `supabase/functions/evolution-go-webhook/index.ts:4480-4517` |
| Restrição de saída externa e promoção existente | `supabase/migrations/20261008210143_whatsapp_unlinked_ephemeral_realtime.sql:169-189,314-371` |
| Envio, atendimento e outbox | `message_operations.go:189-440`; `attendance_operations.go:58-113` |
| Vínculos implícitos | `lead_matching.go:126-147`; `apps/api/internal/leads/repository.go:4504-4598`; `components/features/chat/FloatingChat.tsx:874-913` |
| Histórico atribuído ao lead | `repository.go:2343-2355`; `message_operations.go:751-759` |
| Realtime e contador compartilhado | `supabase/migrations/20260908081513_fix_whatsapp_realtime_without_lead.sql:218-301`; `repository.go:1183-1217` |
| Retenção, payload bruto e mídia | `supabase/migrations/20261008210143_whatsapp_unlinked_ephemeral_realtime.sql:1081-1284`; `webhook_worker.go:738-766`; `repository.go:23-25` |

## 9. Premissas conservadoras adotadas para o contrato local

1. **Intake automático com conversa anterior:** o histórico sem lead fica
   reservado ao dono da sessão até vínculo humano explícito. O evento novo
   de intake mantém o recebimento e a criação/vinculação do lead, mas não
   compartilha o segmento antigo por telefone. O trigger candidato ainda não
   distingue esses segmentos; isso é uma lacuna de implementação, não prova
   de comportamento já existente.
2. **Prazo de eliminação operacional:** a UI/API retira a conversa exatamente
   sete dias após sua criação; o conteúdo e payload bruto vencidos devem ser
   saneados em até 24 horas e mídia sem outra referência em até 48 horas, com
   alertas. Links de mídia já emitidos mantêm TTL de até 15 minutos. Estes
   prazos internos são metas adotadas para a especificação local, não prazos
   comprovados pelo candidato atual.

Estas duas premissas ainda não foram confirmadas pelo usuário. Elas evitam
exposição silenciosa de histórico e distinguem o corte visível da coleta física;
se forem corrigidas, atualizar este contrato **antes** de implementar.

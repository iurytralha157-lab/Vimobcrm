# Respostas citadas: roundtrip local e teste manual

Escopo: checkout principal, banco descartável local, API Go real e provedor HTTP simulado. Sem acesso, migração, publicação ou envio em produção. Os testes usam usuários, organizações, sessões e textos sintéticos. O contexto de autenticação da API é injetado pelo teste; o middleware JWT e um aparelho WhatsApp real não fazem parte dessa prova.

## Prova automatizada

- `apps/api/internal/whatsapp/local_quoted_roundtrip_integration_test.go`: `TestLocalQuotedReplyHTTPRoundtrip` passa pelo handler de envio, outbox durável, chamada `/send/text`, webhook nativo, inbox durável e GET de mensagens. Confere `quoted.messageId` e `participant`, eco com trecho vazio, resolução de `stanzaID` para a mensagem capturada, repetição sem segundo envio e referência de outra organização indisponível.
- `components/features/whatsapp/quoted-roundtrip-ui.runtime.test.mjs`: consome exclusivamente o DTO exportado pelo teste Go e renderiza o `MessageBubble` atual com o CSS do produto. Confere prévia capturada, navegação para IDs canônicos, ausência de trechos inline forjados, mensagem indisponível sem navegação e remontagem em largura móvel. A rede do navegador é bloqueada.
- Evidências: `D:/Vimob/tmp/whatsapp-quoted-roundtrip-local-20261013/`. O resultado de cada execução e seus limites ficam no manifesto desse diretório; a existência dos testes não significa que passaram.

Execução de 13/10: os três testes Go selecionados passaram, incluindo os dois subtestes de revalidação; os cinco casos da UI passaram. As capturas desktop/móvel foram inspecionadas. O primeiro fixture usava horário do provedor um segundo no futuro e foi corretamente suprimido pelo contrato de captura; somente esse horário sintético foi corrigido. Não houve alteração de código de produto nessa etapa.

A repetição final usa o frame exportado às 22:50 e o balão atual: cinco casos da UI passaram novamente, sem rede, incluindo o nome canônico da citação sem inferir `(você)` pelo nome. O replay reforçado mantém o mesmo receipt ID, drena o worker e exige duas entradas totais na inbox (um eco e uma mensagem recebida), uma linha de cada tipo com os IDs correspondentes, nenhum trabalho pendente e exatamente uma mensagem recebida no GET público. Os três testes selecionados passaram na rodada completa; o resultado do pacote completo, que teve um timeout inicial de conexão de outro fixture, e sua repetição serial ficam registrados separadamente no manifesto do banco.

Fechamento visual em 14/10: após os ajustes de apresentação do ROOT, a UI das citações passou novamente em 5/5 no log `ui-font-200-final.log`, com zero falhas, skips ou tentativas de rede. As novas capturas desktop/móvel foram inspecionadas; o frame Go foi preservado. A prova anterior de renderer, PNGs, DOM e log permanece em `pre-font-200-evidence/`. O fechamento documental não executou banco, compilador, navegador ou testes novos.

O teste Go exige o guard de identidade do cluster descartável usado pelos demais testes locais. A porta `55432` é proibida: corresponde ao túnel de produção. A execução deve usar somente o wrapper verificado do cluster dedicado `127.0.0.1:57922`, banco `vimob_whatsapp_clone`.

Para exportar o frame, o wrapper deve definir `VIMOB_WHATSAPP_QUOTE_FRAMES_DIR=D:/Vimob/tmp/whatsapp-quoted-roundtrip-local-20261013` e executar o teste Go. Depois, nesse mesmo checkout:

```powershell
node --test components/features/whatsapp/quoted-roundtrip-ui.runtime.test.mjs
```

## Teste manual com a sua instância de testes

1. No CRM local configurado para o banco isolado, conecte a sua instância de testes. Confira antes que o endereço da API, o banco, a sessão e os dois números são de teste. Digite as credenciais diretamente na configuração; não as copie para relatórios.
2. No segundo aparelho de teste, envie ao número conectado uma mensagem única, por exemplo `Citação teste 13/10 — original`. Aguarde ela aparecer e ser vinculada ao lead de teste no CRM.
3. No CRM, use a ação lateral **Responder** nessa mensagem e envie `Resposta citada do CRM`. No segundo aparelho, confira se a resposta cita a mensagem original e exibe o texto correto. Esta é a verificação que o provedor HTTP simulado não substitui.
4. No segundo aparelho, responda nativamente à mensagem `Resposta citada do CRM` e envie `Resposta citada do aparelho`. No CRM, confira o trecho `Resposta citada do CRM`, clique nele para ir à mensagem e confirme que ele permanece após atualizar a página.
5. Repita com uma imagem e um áudio de teste como mensagem original. Confira a indicação do tipo de mídia na citação, a mensagem recebida e a abertura da mídia. O roundtrip automatizado novo cobre texto; mídia depende também dos testes já existentes e desta verificação manual no aparelho.
6. Confirme que cada envio gerou um único balão e que o remetente/direção permaneceram corretos. Registre versão da instância, horário, resultado e capturas sem dados pessoais ou credenciais.

Se o aparelho não mostrar a prévia correta, registre o ID da mensagem original, o ID da resposta e a versão da instância, mantendo os tokens fora das capturas. O código fixado da EvolutionGo constrói `ContextInfo.StanzaID`/`Participant` e um `QuotedMessage.Conversation` vazio; a prévia nativa precisa ser observada nessa versão e nesse dispositivo antes de ser declarada validada.

O quote retornado pelo servidor preserva o nome real do autor e o formato anterior, sem acrescentar `sender_user_id` ao objeto aninhado. Isso mantém compatibilidade com clientes anteriores que validam esse objeto estritamente. A citação não atribui esse nome ao espectador com `(você)` sem um ID de autoria; o balão principal mantém a identificação de autoria pelo ID canônico. Esse limite já está registrado no runbook de autoria desta mesma rodada.

## Fechamento serial local

O pacote WhatsApp final passou em 399,623 s, com 614 testes de topo aprovados, zero falhas e dois skips por ausência de Edge e Storage reais (616 ao todo). Log: `D:/Vimob/tmp/whatsapp-db-validation-20261013/go-local-full-closure.jsonl`. A prova de hashes `full-go-closure-proof.json` registra 227 fontes sem alteração durante essa execução; os três testes de citações também passaram. As 31 suítes SQL passaram em 890 assertions, sem falhas ou skips.

O agente do banco executou esse fechamento sem exportar frames: o DTO ligado às capturas da UI permaneceu o mesmo. O manifesto acrescenta o fechamento e conserva a execução original do frame, os resultados anteriores e seus limites. A prévia citada no aparelho real continua dependendo da conferência manual descrita acima.

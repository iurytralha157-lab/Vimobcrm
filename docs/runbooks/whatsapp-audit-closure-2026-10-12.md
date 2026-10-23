# WhatsApp: fechamento das correções da revisão total

> Registro da rodada anterior. A revisão detalhada posterior encontrou novas
> falhas e correções; consulte o [complemento atual](whatsapp-deep-fixes-local-2026-10-12.md).
> O estado abaixo descreve somente os caminhos e testes desta rodada anterior.

Rodada de 12/10/2026 no checkout principal
`D:\Vimob\workspaces\vimob-crm`, branch `main`, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
O fechamento funcional anterior permanece documentado em
[release local de 11/10](whatsapp-local-release-2026-10-11.md) e
[interface, mídia e falhas](whatsapp-interface-hardening-2026-10-11.md).
Este complemento corrige os problemas encontrados na revisão posterior.

Estado: problemas identificados corrigidos e validação local concluída.
Revisão independente não deixou P1/P2 concreto aberto nos caminhos revistos.
Nada foi publicado. Não houve migração remota, alteração de flags, envio ao
provedor, replay ou recuperação do backlog de produção. As alterações locais
preexistentes foram preservadas; este checkout ainda não é um SHA de release.

## Problemas e comportamento resultante

| Área | Correção local e proteção |
| --- | --- |
| Proxy Evolution legado | `evolution-go-proxy` canônico retorna 410, exige JWT e consta como tombstone. Instalar a fonte canônica não restaura a antiga autorização de operações. Go usa o provedor diretamente; os consumidores legados retirados continuam retirados. |
| Integridade de mídia | Intenção idempotente consulta a mensagem antes de I/O. Objetos novos usam caminho com digest dos bytes, criação sem overwrite e reconciliação verificando conteúdo. Concorrência, resposta ambígua e repair não trocam o arquivo da intenção vencedora. |
| Exclusão de lead | A API cerca conversa, trabalho e lead; cancela somente trabalho comprovadamente intocado e impede exclusão quando envio está iniciado, aceito ou incerto. Recheca novas conversas antes de apagar. Inclui sete famílias de trabalho, sem desvincular envios vivos. |
| Organização de retry | Operações de mídia exigem a organização original do cadastro, também no servidor. Ter permissão de leitura do histórico em uma organização secundária não autoriza retry. |
| Compartilhamento | O catálogo acrescenta `home_organization_id`; o seletor inclui somente usuários da organização original correspondente. Campo ausente ou divergente falha fechado. O catálogo geral continua incluindo membros secundários para seus outros consumidores. Somente administrador compartilha. |
| Resposta e reação | O DTO calcula `can_quote`/`can_react` pela mensagem realmente capturada, contexto e permissão atual. Interface exige confirmação explícita do servidor. Mensagem histórica indisponível, temporária, reação ou envio não confirmado não vira alvo operável. A intenção válida pode solicitar entrada no atendimento antes da mutação. |
| Citação em anexos | Página e chat flutuante levam o alvo citado ao envio de arquivo e ao balão otimista. Conclusão de texto, arquivo ou áudio limpa somente a citação submetida, preservando outra escolhida durante o envio. |
| Composição de texto | Enter durante composição IME não envia texto incompleto. O envio normal por Enter permanece. |
| Automação | O diálogo e a chamada prendem organização, usuário, permissão, organização original, lead e conversa à intenção. Mudança de contexto aborta a chamada e impede efeitos tardios na interface atual. |
| Menções | O cache global permanente foi substituído pelo cache de consultas com identidade e contexto completos, expiração e cancelamento. Revogação limpa o nome exibido antes da nova consulta. Resposta antiga não repovoa outro contexto. |
| Push pendente | O destinatário atual é revalidado antes do token/configuração. Aviso intocado acompanha a transferência, inclusive quando o destinatário original perdeu o token ou não tinha dispositivo. O início é confirmado antes do HTTP; entregas iniciadas não são repetidas. |
| Retenção de reações | Reações normalizadas de contatos sem lead são limpas quando o alvo já foi efetivamente suprimido e scrubbed por expiração. Histórico capturado/promovido, outro tenant e situação ambígua continuam protegidos. |

A fila inbox/outbox existente, FIFO por cadeia, idempotência e separação de
histórico foram preservados. Contato sem lead continua com retenção limitada,
visível após reload, exigindo vínculo e entrada no atendimento antes de responder.
Histórico acompanha o lead na transferência. Push vai somente ao responsável
atual; aviso já iniciado não é convertido em nova entrega.

## Fechamentos adicionais da revisão independente

- Encaminhar uma URL de mídia interna exige mensagem canônica capturada,
  pronta, não scrubbed e visível ao ator. Prefixo de organização sozinho não
  autoriza copiar um arquivo. Origem e destino são revalidados antes do início
  do envio; I/O de Storage ocorre fora dos locks de banco.
- Mídia legada intocada sem prova de integridade não recebe uma prova inventada
  nem um novo envio automático. A falha mantém `send_failed`, acrescentando
  somente o motivo opcional allowlisted `media_integrity_unverified`. O balão
  pede para anexar novamente. Envios já aceitos seguem apenas para finalização;
  resultado desconhecido permanece incerto e não permite resend.
- O próprio helper de upload protege o namespace novo com digest, inclusive
  quando chamado pelo retry/repair antigo com `upsert=true`. Bytes divergentes
  são recusados; colisão só reconcilia bytes iguais. Arquivo privado criado por
  uma primeira intenção concorrente pode ficar órfão, mas não é apagado
  cegamente nem substitui a referência vencedora.
- O protocolo interno `|wa_push_v2` cerca todos os avisos
  `whatsapp_inbound_attendant`. A API antiga não pode reservá-los durante a troca
  de versões. Push genérico v1 continua elegível. A fila privada de avisos sem
  dispositivo reutiliza o worker existente, com recheck e seed limitados.
- A hipótese de bypass na exclusão direta foi confrontada com o catálogo atual.
  A migration `20260908033712` já revoga mutações diretas de leads e fecha RPCs
  legados para usuários. O teste de JWT/ROLE confirma o canal bloqueado;
  não foi criada uma migration redundante. Storage também conserva a política
  restritiva que exclui escrita autenticada em `whatsapp-media`.

## Validação e evidência

Os testes de banco usam exclusivamente o container
`vimob-wa-test-ready-20261011`, label `vimob.test=whatsapp-20261011`, Postgres
17.6.1.075 em tmpfs, sem mount de dados e porta `127.0.0.1:57922`, banco
`vimob_whatsapp_clone`. Schema local sem dados CRM, com fixtures sintéticas,
não é cópia fiel dos dados de produção. SQL termina em ROLLBACK; testes Go
limpam seus IDs. HTTP de provedor nos testes Go vai apenas a servidores locais.

| Gate desta rodada | Evidência |
| --- | --- |
| Next.js/Webpack | PASS, compile 5,3 min, tipos 68 s, 85 páginas; ambiente sintético e preload impedem leitura de `.env` real |
| Typecheck e ESLint | PASS |
| Validação geral | 708/708 + 3/3 + 84/84 PASS, zero skips |
| OpenAPI | 33/33 PASS |
| Inventários CRM/Home | 4/4 PASS; relatórios regenerados mantendo a dívida visual preexistente |
| Interface e mídia | 46/46 de interface, 24/24 de mídia; 14/14 de automação/menções, zero skips |
| Intenção de envio e sessão | 26/26 + 32/32; cliente/API 19/19 |
| Push atual | 20 cenários PASS, zero skips |
| Compatibilidade de push | Go antigo contra schema novo: 3/3 PASS, zero claims, HTTP ou início de tentativa; RED anterior reproduziu os três problemas |
| Retenção normalizada | 21/21 assertions PASS; RED reproduziu três reações residuais |
| Go geral | Cinco pacotes PASS, 1.715 resultados de testes aprovados; 152 integrações opcionais SKIP na execução sem DSN. As integrações reais abaixo são executadas separadamente com opt-in e alvo verificado. |
| Banco WhatsApp | 15 arquivos, 504/504 assertions PASS, zero skips, todos ROLLBACK |
| Banco, canal direto | 57/57 assertions PASS, zero skips, ROLLBACK; JWT administrativo não contorna a API Go |
| Backend com banco real | 25 testes principais/63 subcasos PASS, zero skips; repetição após A2/B1/B2 STRICT PASS, com fontes inalteradas |
| E2E final | 4/4 PASS em 46,7 s, zero skips, falhas ou retries; API Go/PostgreSQL/Auth/Realtime/Storage locais reais, callbacks sintéticos |
| Visual | 1440/900/390 px; última mensagem dentro da viewport, sem overflow horizontal; painel carregado, loading opaco e leitura após fechar painel conferidos |
| Fontes Supabase | Source lock 193; manifest Edge 41 ativos, 26 tombstones, 15 retirados |

O teste geral tinha aliases `@/` preservados pelo compilador CommonJS. O runner
agora resolve esses imports para o JS compilado, mantendo a resolução nativa
das demais dependências. Não troca imports de produção por caminhos relativos.
Falhas anteriores e snapshots foram preservados. Essa alteração é somente de
harness; não muda comportamento do CRM nem dependências/lockfile.

O dump local restaurado preservava o índice global anterior e não incluía o
preparo A2/B1/B2. A assertion de identidade por fila detectou isso; não foi
afrouxada. Os três cutovers canônicos foram ensaiados exclusivamente no clone
com contagem zero, intake/worker locais parados e alvo conferido. São marcadores
de ensaio, sem atestar deployment do HEAD sujo. A rodada final de 15 arquivos
passou sobre esse contrato STRICT. Logs anteriores foram preservados; os testes
Go de efeitos foram repetidos porque o preparo instala triggers novos.

As repetições finais também passaram: backend 25/63 e push 20 cenários, todos
sem skips e sem mudança de fonte. O E2E observou 44 frames de texto e reconexões
efetivas. Na amostra de cinco mensagens por tipo, POST→DOM teve p95 de
1.375 ms para lead e 844 ms sem lead. Um único envelope gerou três admissões
processadas, mantendo a ordem na interface, reconciliação e reload. São medidas
sintéticas locais, sem o provedor externo; não constituem SLA de produção.

Go/Next e os cinco serviços próprios foram encerrados. Cleanup confirmou 40
superfícies de efeitos zeradas, além de `waiting=0`. Permaneceram somente o
cursor de seed e o marcador de cutover concluídos, necessários ao contrato.
Postgres tmpfs próprio permaneceu saudável; nenhum serviço alheio foi parado.

Integridade final: HEAD inalterado, nenhum dos 3.437 inputs de código do
baseline removido, 3.463 inputs finais estáveis e 1.912 fontes JS/TS UTF-8
verificadas. As 72 verificações de hash dos manifestos independentes conferem.
O Web não mudou depois do build: a única diferença no conjunto conservador
de inputs Web foi o resolver do harness de testes, validado separadamente.
Isso não substitui selecionar/commitar uma release limpa nem valida todos os
outros domínios das mudanças preexistentes.

Evidências novas:
`D:\Vimob\tmp\whatsapp-local-20261012`,
`D:\Vimob\tmp\whatsapp-audit-fixes-20261012` e o manifesto
`D:\Vimob\tmp\whatsapp-ui-hardening-20261011\proxy-sharing-final.json`.
Os logs históricos de 11/10 foram preservados antes de reutilizar o runtime.
Relatório consolidado: `final-review-result.json`; browser: `final-e2e.json`;
banco: `final-sql/summary.json`; limpeza: `final-e2e-cleanup.json` e
`final-control-cleanup.json`. Capturas desta rodada estão em
`D:/Vimob/tmp/whatsapp-local-20261012/visual-final`.

Novos helpers concentram as regras de mídia, autorização de alvo e exclusão,
sem refatoração incidental dos arquivos antigos extensos. Alterações nos
arquivos grandes limitam-se a integrar esses helpers e o DTO. Divisão futura
desses arquivos requer tarefa própria e cobertura equivalente.

## Preparação da publicação

Migrations novas desta rodada, criadas pela CLI e nunca reescritas após aplicar
no clone:

1. `20261012052613_whatsapp_unlinked_normalized_reaction_retention.sql`.
2. `20261012053044_whatsapp_inbound_push_preflight_order.sql`.
3. `20261012061151_whatsapp_inbound_push_worker_protocol.sql`.

São complementos das oito migrations de 11/10 e dos cutovers anteriores,
não substituem a reconciliação do ledger. O runbook de
[push e retenção](whatsapp-push-retention-hardening-2026-10-12.md) descreve
preflight, cursor, limites, protocolo e métricas de acompanhamento.

Para uma publicação autorizada: selecionar e revisar o pacote e dependências
no checkout principal; congelar um SHA reproduzível; confrontar schema, ACL,
ledger, workers e binários efetivos em cópia fiel do alvo. Drenar ou pausar
consumidores antigos incompatíveis antes do primeiro SQL. Aplicar as três
migrations como conjunto antes de reabrir dispatch; o intervalo entre a segunda
e a terceira não é uma janela segura para o worker antigo. Atualizar API Go e
workers antes do Web; incluir o Edge 410 canônico. Campos novos são opcionais
para leitores, e sua ausência restringe operações na interface.

Reversão deve preservar banco endurecido e filas duráveis, cessar os novos
workers e usar binário previamente verificado como compatível. Não restaurar
DELETE direto, proxy permissivo, upsert dos objetos ou claims antigas de push.
Migration aplicada não é editada nem removida; correção posterior é forward-only.
Schema novo pode deixar WhatsApp push aguardando enquanto a API compatível
estiver fora, sem liberar consumo inseguro pelo binário anterior.

O piloto ainda precisa de número pessoal e compartilhado, contato sem lead,
transferência com chat aberto, reconexão, mensagens consecutivas, imagem,
áudio, reações, destinatário sem WhatsApp e push com PWA encerrada em aparelho.
Também falta medir carga real e validar a versão do provedor. URL assinada já
emitida conserva seu TTL; revogação de permissão impede nova emissão, mas não
apaga arquivo já recebido. Os 17 predecessores/10 pendentes anteriormente
observados em produção não foram recuperados nesta etapa local.

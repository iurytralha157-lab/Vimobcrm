# Fotos existentes no chat — diagnóstico e fechamento local

Rodada de 14/10/2026 no checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Fotos de Perfil, Contatos e Pipeline devem aparecer nos lugares de avatar já existentes em Conversas e no balão. Esta rodada não alterou produção, banco, provedor, credenciais, schema, fila, cores, fontes ou geometria.

## O que impedia as fotos

### Confirmado no código

1. **Foto privada do lead:** o código em HEAD de Conversas consultava a URL legada, enquanto Contatos/Pipeline já assinavam o objeto privado. A migration de enriquecimento grava `whatsapp_avatar_storage_path` e zera `whatsapp_avatar_url`. Assim, existir foto em Contatos não garantia uma URL no DTO antigo de Conversas. O checkout atual já contém a projeção privada autorizada em `conversation_avatar.go`, aplicada às leituras de conversa; ela foi preservada e testada nesta rodada.
2. **Usuário que enviou áudio:** o player em HEAD impedia imagem em saídas com `!fromMe`, e o DTO antigo das mensagens não incluía `sender_user_id`. Essas correções já estavam no candidato local. Ainda havia um descarte no frontend atual: quando o autor era o usuário conectado, a foto do resumo desse mesmo usuário era ignorada se a foto de Auth estivesse vazia, inválida ou falhasse.
3. **Consulta de autores:** o hook atual podia enviar até 1000 IDs numa chamada para uma API limitada a 100. Também exigia lead vinculado mesmo para resolver autores de uma conversa autorizada sem lead.
4. **Cobertura anterior incompleta:** a matriz integrada dos quatro pontos anteriores montava fotos ausentes e IDs sintéticos que não eram UUIDs. Sucesso com iniciais não comprovava imagem carregada. Os testes de foto isolados não substituíam essa prova das duas superfícies.

### Configuração local confirmada; ambiente remoto não verificado

`scripts/local/start-frontend-published-api.ps1` configura o frontend para consultar `https://api.vimobcrm.com.br`. Portanto, alterar arquivos da API Go no checkout não comprova que essa prévia recebe os campos novos. A versão e o payload da API publicada não foram consultados nesta rodada. A hipótese de contrato publicado antigo é compatível com o sintoma; não foi promovida a fato confirmado em produção.

## Correções desta rodada

- `MessageBubble.tsx` valida os candidatos: foto do perfil tem prioridade e o resumo autorizado do mesmo autor vira alternativa. Perfil vazio/inválido já utiliza a foto válida do resumo.
- `MessageMedia.tsx` e `MessageAudioPlayer.tsx` recebem `audioAvatarFallbackUrl` específico para saídas. Erro na imagem do perfil tenta o resumo do mesmo autor; o fallback de contato continua exclusivo das mensagens recebidas. Mudança de identidade aposenta erros antigos da imagem.
- `use-whatsapp-sender-avatars.ts` conserva o teto de 1000 autores e faz lotes de até 100, com no máximo duas requisições simultâneas por consulta. O resultado é atômico: qualquer falha cancela os outros lotes e não publica fotos parciais.
- Conversa autorizada sem lead também resolve os autores. Organização, usuário, acesso, conversa, lead, sessão e IDs continuam na identidade da consulta. Ocultar a superfície cancela somente a consulta exata inativa, preservando outro observador ativo.

Não há busca por nome/telefone, cópia de foto de outro lead ou inferência de autor a partir de `from_me`. Histórico sem `sender_user_id` continua identificado como conta/autor não identificado; o código não empresta a foto do usuário conectado ou do responsável para preencher essa lacuna. O botão do avatar durante reprodução conserva o controle de velocidade aprovado.

## Caminho dos dados

| Foto | Origem existente | Consumo no chat |
| --- | --- | --- |
| Lead | Objeto privado já associado ao lead; a API autoriza e entrega URL no campo `lead.whatsapp_avatar_url` | Card, cabeçalhos, painel e áudio recebido, com alternativa `contact_picture` da mesma conversa |
| Usuário conectado | `profile.avatar_url` e resumo autorizado de `users.avatar_url` | Áudio cujo `sender_user_id` corresponde ao usuário; resumo do mesmo ID cobre ausência/falha do perfil |
| Outro autor do CRM | Resumo autorizado por ID e organização | Somente o áudio com esse autor persistido |
| Responsável no card/picker | DTO de responsável e lista de usuários existentes | Avatar do tooltip/picker; não substitui a foto do remetente |

O caminho privado permanece no servidor e não é usado como `src` no browser. A assinatura existente foi preservada; não foram criados novos buckets, políticas ou consultas ao provedor. A necessidade de servir arquivos privados por acesso autorizado/URL assinada segue a [documentação do Storage](https://supabase.com/docs/guides/storage/serving/downloads).

## Validação atual

**150 testes distintos aprovados; zero falhas e zero skips.** Somente as últimas execuções entram na soma, sem somar REDs ou resultados históricos.

| Grupo | PASS | Artefatos em `D:/Vimob/tmp/whatsapp-avatar-reuse-20261014/` |
| --- | ---: | --- |
| Fallback próprio, autoria, áudio, balões e renovação de mídia | 95 | `users/related-final.log`, `users/proof.json` |
| Lotes de autores, erros, cancelamento e isolamento | 21 | `batch/final-green.log`, `batch/proof.json` |
| Página e balão com fotos realmente carregadas | 8 | `surfaces/surfaces-final-green.log`, `surfaces/proof.json` |
| Projeções privadas de Leads/Contatos/Pipeline/Conversas | 26 | `surfaces/avatar-go.jsonl`, `surfaces/avatar-go-summary.json` |

Os 95 incluem 10 casos novos de fallback e 29 casos de reprodução nativa, revalidando a correção anterior de links. O RED do fallback reproduziu quatro falhas anteriores; o RED do hook reproduziu limite, conversa sem lead e isolamento de lotes, mais um caso de cancelamento ao ocultar.

As oito verificações integradas usam cards, headers, painel, Bubble/Media/Audio, hook de autores, Radix Avatar e CSS reais em 320/390/1440 px. Exigem `img.src` correto e `complete && naturalWidth > 0`; não aceitam apenas a inicial. Conferem lead, usuário atual, outro corretor e responsável, além de erro da foto do lead com fallback individual. O ROOT inspecionou capturas das duas superfícies e do Sheet mobile.

Os dois testes Go novos exercitam URL legada nula com objeto privado válido: Leads, Pipeline e Contatos reutilizam uma assinatura; Conversas atual/histórica reutilizam a projeção correta e recusam organização estrangeira. Os testes rodam sem banco ou configuração remota, com Storage sintético em `httptest` local. São 26 testes de topo, sem somar subtestes novamente.

`npm run typecheck` passou na versão final. O lint global passou com zero erros e três warnings preexistentes em testes de propriedades. O lint focal final dos três grupos passou sem erros ou warnings. Os manifestos finais mantiveram os hashes das fontes testadas. As provas consolidadas ficam em `root/closure-proof.json`.

## Limites e uso da prévia

Auth, DTOs/dados, transporte de resumos e bytes das imagens são sintéticos; a rede externa do browser é interceptada/bloqueada. O shell, filtros e microfone têm sentinels identificados nos manifestos. Fotos reais do Storage, versão/payload publicados, banco/RLS, aplicação autenticada completa, Safari, PWA e aparelho físico não foram verificados. A família Geist via `next/font` não é carregada pelo harness; o CSS de tamanho/peso é real.

Este fechamento comprova o código local com os contratos atuais. Para observar esses campos numa prévia ligada à API publicada, ela precisa utilizar a versão correspondente do backend. Esta rodada não publicou nem trocou a configuração do ambiente.

## Repetição e reversão

```powershell
npm run typecheck
npm run lint
node --test --test-concurrency=1 components/features/whatsapp/message-own-avatar-fallback.runtime.test.mjs hooks/whatsapp/use-whatsapp-sender-avatars.runtime.test.mjs components/features/whatsapp/conversations/avatar-reuse-surfaces.runtime.test.mjs
```

`WHATSAPP_AVATAR_SURFACE_PROOF_DIR` é opcional; sem ela, as capturas ficam no diretório temporário contido e são removidas ao final. Fixtures de baseline servem apenas para o RED arquivado. Os testes Go e sua lista seletiva estão registrados em `surfaces/run-avatar-go.cjs`; ele remove configuração de banco/rede externa e não inicia serviços reais.

Reversão: retirar seletivamente os hunks de fallback e batching desta rodada, usando `root/baseline` como referência. Não restaurar arquivos inteiros nem usar reset no checkout com alterações preexistentes. Os dois arquivos Go novos são apenas testes; não houve mudança de servidor ou schema nesta rodada.

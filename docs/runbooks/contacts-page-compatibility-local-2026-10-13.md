# Contatos — compatibilidade da listagem paginada

Estado: correção local no checkout principal, preservando as alterações anteriores.
Nenhum deploy, aplicação de migration, mudança de produção ou gravação de contatos.

## Incidente e causa comprovada localmente

A tela mostrava `contacts.list-page: total: Required; page: Required; limit: Required`
e bloqueava a exibição de contatos válidos. A API cliente exigia o novo envelope
`{ data, total, page, limit }`. A implementação Go em HEAD, anterior às alterações
locais de paginação, devolve `{ data }`; nesse contrato legado, cada linha contém
`total_count`. Uma API anterior pode ignorar `responseMode=page` e continuar
devolvendo esse formato. A versão efetivamente usada pela captura do usuário
não foi consultada em produção; a reprodução usa a função real do cliente,
schemas reais e transporte sintético, e gerou o mesmo erro da imagem.

## Correção

- `lib/api/contact-page-response.ts` valida o envelope canônico ou, somente no
  modo compacto, o envelope legado. Exige dados válidos, contagem unânime e
  compatível com o tamanho/offset da página; não aceita uma resposta parcialmente
  paginada como se fosse legado.
- `lib/api/contacts.ts` envia página e limite explícitos, mantendo os padrões
  existentes de 1/25 quando omitidos. Conserva filtros e a intenção copiados na
  entrada. Reconstrói os metadados de leitura compacta a partir da contagem real.
- Página 1 legada vazia representa total zero. Página posterior legada vazia
  consulta apenas uma linha da página 1, com os mesmos filtros, organização,
  ator/SID explícitos e signal. A tela pode então ajustar uma página fora do
  intervalo sem fingir que toda a base está vazia. Não há repetição automática
  em loop nem busca de toda a coleção no browser.
- `ContactsScreen.tsx` apresenta uma mensagem de recuperação para falhas de
  validação; detalhes internos continuam no erro tipado. Mensagens úteis de
  autorização são preservadas.

Os modos `full` e `export` continuam exigindo o envelope canônico. Não se
fabrica `exportVersion` e a verificação de integridade da exportação continua
inalterada. `contactsAPI.list` também mantém seu contrato anterior.

O probe de contagem é uma segunda leitura, sem snapshot retido entre chamadas.
Uma mudança concorrente pode levar a tela a recarregar outra página; essa
compatibilidade compacta não é uma garantia de consistência para exportar.

## Evidência

Antes da correção, os testes de compatibilidade reproduziram a falha com os
três campos Required. Depois:

- 49/49 testes dirigidos aprovados, zero skips: cliente real/compatibilidade e
  mensagem da tela (20), schema de Contatos (3), exportação (7), negação de
  leitura/perfil/histórico (12) e modelo da tela (7).
- Revisão independente repetiu os 20 testes finais do cliente/tela, sem novo
  bloqueador. Esses 20 são subconjunto dos 49, não uma contagem adicional.
- Quatro testes Go de página, versão, fingerprint e validação passaram sem SQL;
  o backend não recebeu edição nesta correção.

Comando dos 49 testes:

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/api/contact-page-compatibility.runtime.test.mjs lib/validation/contacts-p2.test.ts lib/contact-export-integration.test.mjs hooks/leads/lead-definitive-denial.runtime.test.mjs components/features/contacts/contacts-screen/model.test.ts
```

`npm run lint` passou, zero erros e seis warnings em arquivos fora deste ajuste.
O lint dirigido aos três arquivos de produção e ao teste novo passou sem warnings.
`npm run typecheck` final encerrou com dois erros em
`components/features/whatsapp/conversations/ConversationListPreview.tsx:33–34`
(`last_message_from_me` e `last_message_status` ausentes em `ScreenConversation`).
Nenhum diagnóstico final nos arquivos de Contatos. Os arquivos WhatsApp foram
preservados; o gate geral de tipos continua reprovado por esses dois erros.
`git diff --check` dirigido passou; hashes coincidem com a revisão independente.
Logs e snapshots: `D:\Vimob\_safety\contacts-page-compat-20261013`.

## Verificação visual e limites

A aba Chrome existente em `http://127.0.0.1:3000/crm/contacts` inicialmente
apresentava `ERR_CONNECTION_RESET`; reload/HTTP local não responderam no prazo.
O processo Next compartilhado não foi reiniciado ou substituído por esta correção.
A prévia depois voltou a responder e a observação final confirmou **6.778
contatos**, linhas carregadas, **50 por página** e **136 páginas**, sem a mensagem
de contrato inválido. A evidência visual foi salva em
`D:\Vimob\_safety\contacts-page-compat-20261013\contacts-restored.png`.

Os testes usam somente dados sintéticos e transporte mock. A validação visual
usou a prévia local autenticada já aberta, em leitura, sem editar/criar/excluir
contatos nem reconfigurar seu backend. Não houve acesso direto ao banco,
deploy, aplicação de migration ou alteração de produção. Essa observação não
comprova Mac/Safari, dispositivos físicos ou integridade de exportação real.

## Reversão seletiva

Remover somente os hunks desta correção e o helper novo, comparando com
`contacts.before.ts`, `ContactsScreen.before.tsx` e `README.before.md` no diretório
de segurança acima. Não restaurar arquivos inteiros sobre outras mudanças,
alterar as validações globais nem reverter os guards de sessão/exportação.

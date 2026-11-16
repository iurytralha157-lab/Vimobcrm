# R2-ORG-LOGO-A11Y — nome acessível do botão de logo

O root observou na produção fbd (ADM082) o logo da organização seguido de um botão de
câmera sem nome acessível. O botão equivalente do avatar pessoal já tem nome
na main332. A mudança acrescenta somente
`aria-label="Alterar logo da organização"` ao botão que abre `org-logo-upload`
em `AccountTab.tsx`.

O componente é renderizado por `SettingsScreen` na aba Conta. O botão e o
input permanecem sob `isAdmin`, calculado pela função administrativa existente
ou por `settings_organization`. Handler, input, crop, autosave, API, Storage e
permissões do servidor não mudaram. Outro botão vazio observado no tooltip
financeiro está fora desta família e não foi alterado.

Uma verificação local por AST encontrou exatamente o botão dono do input,
confirmou a ausência anterior do nome e verifica que o único delta no botão é
o atributo. Não foi criado teste permanente que apenas repetisse esse literal;
o atributo é uma mudança trivial. Typecheck, lint, inventários e diffcheck são
os gates pertinentes.

- Verificação transitória por AST: um botão alvo, nome ausente na base332 e
  presente no resultado. Remover somente esse atributo torna o arquivo inteiro
  idêntico à base, incluindo o nome do avatar pessoal, handlers e guards.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, zero erros e oito avisos preexistentes.
- `npm run audit:check`: 4/4, sem falhas ou skips; inventários regenerados na
  ordem CRM → Home. `git diff --check`: exit 0.

Nenhum teste permanente, dependência, script de teste ou job de CI foi criado.

O arquivo legado já supera 800 linhas. Uma linha fica no elemento dono do
defeito, usando o mesmo padrão do avatar pessoal; não justifica extrair fluxos
de upload neste ajuste. Uma divisão futura da aba por seções deve preservar
handlers, guards e testes dos uploads, sem refatoração incidental aqui.

Não foi feita operação de produção pelo autor. O reenvio do logo original com
recorte integral, executado separadamente pelo root, não equivale ao reteste deste rótulo, que
requer release e nova consulta ao nome acessível na UI. Reverter o commit
remove o nome; não há schema, dados ou configuração remota a desfazer.

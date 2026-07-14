# Relatório de Auditoria em Produção - Continuação 35

Data: 2026-07-14
Ambiente: Produção, navegador
Escopo: autenticação pública, login, recuperação de senha, cadastro inicial e retorno de sessão ao administrador.
Restrição: nenhum cadastro real, envio válido de recuperação, troca de senha ou alteração de dados foi executado.

## Resumo

Esta rodada cobriu as rotas públicas e estados seguros de validação. Foram testados logout, tela de login, envio vazio, e-mail em formato inválido, credenciais inexistentes, recuperação de senha com vazio/formato inválido e cadastro inicial com campos vazios/dados inválidos.

A sessão terminou autenticada novamente como administrador.

Total geral de evidências após esta rodada: 322 arquivos PNG.

## Evidências válidas

- `EVID-PROD-AUTH-LOGIN-TELA-035.png`
- `EVID-PROD-AUTH-LOGIN-VAZIO-035.png`
- `EVID-PROD-AUTH-LOGIN-EMAIL-FORMATO-INVALIDO-035.png`
- `EVID-PROD-AUTH-LOGIN-CREDENCIAIS-INVALIDAS-035.png`
- `EVID-PROD-AUTH-RECUPERAR-SENHA-TELA-REDO-035.png`
- `EVID-PROD-AUTH-RECUPERAR-SENHA-VAZIO-REDO-035.png`
- `EVID-PROD-AUTH-RECUPERAR-SENHA-EMAIL-INVALIDO-REDO-035.png`
- `EVID-PROD-AUTH-CADASTRO-TELA-REDO-035.png`
- `EVID-PROD-AUTH-CADASTRO-VAZIO-035.png`
- `EVID-PROD-AUTH-CADASTRO-DADOS-INVALIDOS-REDO-035.png`
- `EVID-PROD-AUTH-LOGIN-ANTES-RETORNO-ADM-035.png`
- `EVID-PROD-AUTH-LOGIN-SUCESSO-ADM-FINAL-035.png`

## Resultado por fluxo

### Login

Campos auditados: e-mail, senha, lembrar-me, mostrar senha, entrar, esqueceu sua senha, cadastre-se, termos de uso e política de privacidade.

O login com credenciais inexistentes permaneceu na tela de login e exibiu mensagem clara de erro: e-mail ou senha inválidos. O login real do administrador foi validado no final para restaurar a sessão.

No envio vazio e no e-mail em formato inválido, a tela não apresentou validação persistente dentro da aplicação. O navegador usa validação nativa para formato de e-mail, mas isso aparece como tooltip transitório e não como mensagem de erro integrada ao layout.

### Recuperação de senha

Campos auditados: e-mail, enviar link de recuperação e voltar para login.

A tela de recuperação abre dentro da mesma URL de login, com visual próprio. O envio vazio não mostrou erro persistente na interface. O e-mail em formato inválido foi bloqueado por validação nativa do navegador, sem envio válido de recuperação.

Achado de UX: o botão de voltar para login tem texto visual "Recuperar senha" e depende do ícone de seta para comunicar retorno. Apesar de ter rótulo acessível de voltar para login, visualmente pode parecer título/ação de recuperação.

### Cadastro inicial

Campos auditados: CPF/CNPJ, nome da imobiliária, quantidade de corretores, continuar e fazer login.

O cadastro inicial não criou organização nesta rodada. O envio vazio não exibiu validação persistente dentro da aplicação. Com CPF/CNPJ inválido, o navegador bloqueou o avanço com mensagem nativa exigindo 11 números para CPF ou 14 para CNPJ. Como a primeira validação bloqueou o submit, os campos seguintes não chegaram a validar visualmente na mesma tentativa.

### Retorno de sessão

Após os testes públicos, foi feito login com administrador e a sessão retornou ao dashboard. A evidência final confirma a volta ao ambiente autenticado.

## Achados

1. Médio - Login, recuperação e cadastro dependem fortemente de validação nativa do navegador para vazio/formato inválido. Isso gera mensagens transitórias, pouco consistentes com o design e difíceis de auditar/ler em tela.
2. Médio - Cadastro inicial não exibiu erros persistentes para campos vazios antes do bloqueio nativo. O botão continuar permanece visível/habilitado mesmo sem dados.
3. Baixo - Recuperação de senha abre em estado visual próprio mantendo a URL de login, o que pode dificultar suporte e compartilhamento direto da etapa.
4. Baixo - O controle visual de voltar na recuperação pode ser confundido com título/ação principal por repetir "Recuperar senha".
5. Baixo - Logs técnicos continuam registrando inicialização de push ignorada no ambiente web e avisos de gráficos com largura/altura inválida após retorno ao dashboard.

## Limitações controladas

Não foram executados: envio de recuperação com e-mail válido, criação de organização, avanço com dados válidos no cadastro, aceite de termos, troca real de senha ou teste de bloqueio por muitas tentativas.

As primeiras evidências sem sufixo REDO no fluxo de recuperação ficaram como registro bruto de tentativa, mas as conclusões usam as evidências REDO, que miraram explicitamente o botão de envio.

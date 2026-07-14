# Relatorio de Auditoria - Producao - Continuacao 39

Data: 2026-07-14
Ambiente: producao, `https://app.vimobcrm.com.br`
Escopo: rotas publicas, legais, onboarding, convite/checkout com identificador invalido e rotas publicas de site imobiliario
Perfis/sessao: navegacao anonima apos logout; sessao final restaurada no administrador
Restricao: nenhum formulario enviado, nenhum cadastro criado, nenhum checkout executado e nenhum dado alterado.

## Resumo executivo

Foram auditadas 15 rotas publicas ou sem sessao, alem do retorno final ao administrador. A rodada gerou 16 evidencias novas, elevando o total acumulado para 406 imagens `EVID-PROD-*.png`.

Os principais achados foram:

- `/help` existe como rota publica no projeto, mas em producao redirecionou para `/login` quando acessada sem sessao.
- checkout com identificador invalido exibiu mensagem tecnica de falha ao falar com a API, em vez de um estado invalido/expirado orientado ao usuario.
- durante o logout, o console registrou falha de `signOut`/fetch antes da sessao anonima ficar disponivel para a auditoria.
- rotas publicas do site imobiliario no dominio principal retornam estado padrao de site indisponivel, sem vazamento de dados.

As capturas que continham campos de login com preenchimento visual do navegador foram redigidas nos campos de e-mail e senha antes do fechamento do relatorio.

## Rotas auditadas

| Rota solicitada | Resultado final | Status |
| --- | --- | --- |
| `/login` | Login publico carregado apos logout. | Aprovado com evidencia redigida |
| `/` | Redirecionou para `/login`. | Aprovado se o comportamento esperado for login como home do app |
| `/help` | Redirecionou para `/login`. | Falhou/parcial |
| `/termos-de-uso` | Termos de Uso carregados publicamente. | Aprovado |
| `/politica-de-privacidade` | Politica de Privacidade carregada publicamente. | Aprovado |
| `/onboarding` | Redirecionou para `/cadastro`. | Aprovado/parcial |
| `/convite/[identificador-invalido]` | Exibiu convite expirado e link para login. | Aprovado |
| `/checkout/[identificador-invalido]` | Exibiu checkout nao encontrado e toast tecnico de API. | Parcial |
| `/imoveis` | Exibiu site indisponivel. | Aprovado visual |
| `/sobre` | Exibiu site indisponivel. | Aprovado visual |
| `/contato` | Exibiu site indisponivel. | Aprovado visual |
| `/favoritos` | Exibiu site indisponivel. | Aprovado visual |
| `/imovel/codigo-invalido-auditoria-039` | Exibiu site indisponivel. | Aprovado visual |
| `/sites/auditoria-inexistente-039` | Exibiu site indisponivel. | Aprovado visual |
| `/sites/auditoria-inexistente-039/imoveis` | Exibiu site indisponivel. | Aprovado visual |

## Achados

### Medio - `/help` publico redireciona para login

ID: PUBLIC-HELP-001
URL: `/help`
Resultado esperado: a central publica de ajuda deveria carregar sem sessao, ou a rota deveria ser removida dos links publicos se for privada.
Resultado encontrado: a navegacao anonima para `/help` terminou em `/login`. As paginas legais possuem link de marca apontando para `/help`, o que leva o usuario anonimo de uma pagina publica para login.
Status: FALHOU/PARCIAL
Severidade: MEDIA
Impacto: usuarios fora do app podem nao conseguir acessar ajuda publica, e links institucionais ficam inconsistentes.
Evidencia: `EVID-PROD-PUBLIC-HELP-039.png`

### Medio - Checkout invalido exibe erro tecnico de API

ID: PUBLIC-CHECKOUT-001
URL: `/checkout/[identificador-invalido]`
Resultado esperado: mensagem orientada ao usuario, como checkout invalido, expirado ou indisponivel, sem detalhe tecnico.
Resultado encontrado: a pagina mostrou `Checkout nao encontrado` e um toast indicando erro ao falar com a API do Vimob.
Status: PARCIAL
Severidade: MEDIA
Impacto: experiencia confusa para cliente em fluxo sensivel de pagamento/contratacao; pode sugerir instabilidade da plataforma em vez de identificador invalido.
Evidencia: `EVID-PROD-PUBLIC-CHECKOUT_INVALIDO-039.png`

### Medio - Falha tecnica registrada durante logout

ID: PUBLIC-AUTH-LOGOUT-001
Fluxo: sair da sessao autenticada antes da auditoria anonima
Resultado esperado: logout sem erro tecnico no console e redirecionamento consistente para login.
Resultado encontrado: o console registrou `Failed to fetch` durante `signOut`. Apos nova tentativa pela arvore DOM, o logout foi concluido e a rota `/login` carregou.
Status: PARCIAL
Severidade: MEDIA
Impacto: falhas intermitentes de logout podem manter a sessao ativa por mais tempo que o esperado ou gerar comportamento confuso na troca de perfis.
Evidencia: logs coletados na aba da rodada 39 e `EVID-PROD-PUBLIC-LOGIN-APOS-LOGOUT-039.png`

### Baixo - Home raiz anonima cai em login sem mensagem

ID: PUBLIC-ROOT-001
URL: `/`
Resultado esperado: se a raiz for o ponto de entrada do app, o redirecionamento para login e aceitavel; se for landing publica, deveria exibir conteudo institucional.
Resultado encontrado: `/` redirecionou diretamente para `/login`, sem mensagem.
Status: APROVADO/PARCIAL
Severidade: BAIXA
Impacto: baixo se esta for a decisao de produto; documentar para evitar expectativa de landing publica.
Evidencia: `EVID-PROD-PUBLIC-ROOT-039.png`

### Baixo - Onboarding redireciona para cadastro

ID: PUBLIC-ONBOARDING-001
URL: `/onboarding`
Resultado encontrado: a rota redireciona para `/cadastro`, carregando o formulario inicial de criacao de organizacao. Nenhum envio foi realizado.
Status: APROVADO/PARCIAL
Severidade: BAIXA
Impacto: comportamento funcional, mas vale padronizar URL final se suporte ou marketing divulgar `/onboarding`.
Evidencia: `EVID-PROD-PUBLIC-ONBOARDING-039.png`

### Baixo - Rotas publicas de site retornam estado indisponivel no dominio principal

ID: PUBLIC-SITE-001
URLs: `/imoveis`, `/sobre`, `/contato`, `/favoritos`, `/imovel/*`, `/sites/*`
Resultado encontrado: todas retornaram estado `Site indisponivel`, sem dados de cliente, formulario ativo ou conteudo de imovel.
Status: APROVADO VISUAL
Severidade: BAIXA
Impacto: nao houve vazamento; se o dominio principal nao deve hospedar site imobiliario, o estado e seguro.
Evidencias:

- `EVID-PROD-PUBLIC-PUBLIC_IMOVEIS-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_SOBRE-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_CONTATO-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_FAVORITOS-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_IMOVEL_INVALIDO-039.png`
- `EVID-PROD-PUBLIC-SITES_SLUG_INVALIDO-039.png`
- `EVID-PROD-PUBLIC-SITES_SLUG_IMOVEIS_INVALIDO-039.png`

## Pontos positivos

- Termos de Uso e Politica de Privacidade carregam sem sessao e possuem botao de entrada.
- Convite invalido informa estado expirado e oferece caminho para login.
- Rotas publicas de site indisponivel nao expuseram dados de organizacao ou imoveis.
- A sessao final foi restaurada no administrador.

## Evidencias geradas

- `EVID-PROD-PUBLIC-LOGIN-APOS-LOGOUT-039.png`
- `EVID-PROD-PUBLIC-ROOT-039.png`
- `EVID-PROD-PUBLIC-HELP-039.png`
- `EVID-PROD-PUBLIC-TERMOS-039.png`
- `EVID-PROD-PUBLIC-PRIVACIDADE-039.png`
- `EVID-PROD-PUBLIC-ONBOARDING-039.png`
- `EVID-PROD-PUBLIC-CONVITE_INVALIDO-039.png`
- `EVID-PROD-PUBLIC-CHECKOUT_INVALIDO-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_IMOVEIS-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_SOBRE-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_CONTATO-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_FAVORITOS-039.png`
- `EVID-PROD-PUBLIC-PUBLIC_IMOVEL_INVALIDO-039.png`
- `EVID-PROD-PUBLIC-SITES_SLUG_INVALIDO-039.png`
- `EVID-PROD-PUBLIC-SITES_SLUG_IMOVEIS_INVALIDO-039.png`
- `EVID-PROD-ADM-PUBLIC-RETORNO-FINAL-039.png`

## Dados criados e limpeza

Dados criados: nenhum.
Dados alterados: nenhum.
Limpeza realizada: nao aplicavel.
Evidencias redigidas: campos de login em `LOGIN-APOS-LOGOUT`, `ROOT` e `HELP`.

## Recomendacoes

1. Decidir se `/help` deve ser publico; se sim, ajustar middleware/roteamento para permitir acesso anonimo.
2. Trocar a mensagem tecnica do checkout invalido por estado de negocio claro e amigavel.
3. Investigar erro intermitente de `signOut`/fetch no logout.
4. Confirmar se `/` deve continuar redirecionando diretamente para login.
5. Padronizar `/onboarding` e `/cadastro` para evitar duplicidade de rota em materiais de suporte.

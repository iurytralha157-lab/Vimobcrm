# Relatorio de Auditoria - Producao - Continuacao 40

Data: 2026-07-14
Ambiente: producao, `https://app.vimobcrm.com.br`
Escopo: rotas de suporte ao fluxo autenticado e estados invalidos seguros
Perfis: administrador, usuario padrao e anonimo
Restricao: nenhum formulario enviado, nenhuma organizacao trocada, nenhum contrato acessado por ID real e nenhum dado alterado.

## Resumo executivo

Foram auditadas rotas que ainda nao tinham evidencia dedicada: selecao de organizacao autenticada, detalhe financeiro com identificador invalido e reset de senha direto sem sessao. A rodada gerou 8 evidencias novas, elevando o total acumulado para 414 imagens `EVID-PROD-*.png`.

Principais resultados:

- O administrador acessa `/select-organization` e ve uma lista de multiplas organizacoes com papel e data de ultimo acesso. Nenhuma organizacao foi selecionada.
- O usuario padrao, ao acessar `/select-organization`, foi redirecionado para o dashboard, sem tela intermediaria.
- Em organizacao sem financeiro habilitado, o administrador recebe bloqueio claro em rota financeira.
- O usuario padrao acessando detalhe financeiro invalido recebe uma tela crua apenas com `Contrato nao encontrado`, sem layout do app, botao de retorno ou mensagem de permissao.
- A rota publica de reset de senha direto e com parametro invalido exibiu estado amigavel de link invalido/expirado, sem formulario sensivel.

## Rotas auditadas

| Rota | Perfil | Resultado | Status |
| --- | --- | --- | --- |
| `/select-organization?redirectTo=/dashboard` | Administrador | Lista multiplas organizacoes e botao Sair. | Aprovado visual |
| `/select-organization?redirectTo=/dashboard` | Usuario padrao | Redireciona para `/dashboard`. | Aprovado/parcial |
| `/financeiro/contratos/[identificador-invalido]` | Administrador | Bloqueio claro de financeiro indisponivel na organizacao atual. | Aprovado |
| `/financeiro/contratos/[identificador-invalido]` | Usuario padrao | Tela crua com `Contrato nao encontrado`. | Parcial |
| Rota publica de reset de senha | Anonimo | Estado de link invalido/expirado com botao para login. | Aprovado |
| Rota publica de reset de senha com parametro invalido | Anonimo | Remove parametro e mostra o mesmo estado de link invalido/expirado. | Aprovado |
| `/dashboard` | Usuario padrao | Confirmacao de sessao padrao antes dos testes. | Evidencia de contexto |
| `/dashboard` | Administrador | Sessao final restaurada no administrador. | Aprovado |

## Achados

### Medio - Selecao de organizacao do admin exibe muitas organizacoes e ultimo acesso

ID: SUPPORT-ADM-ORG-001
Perfil: administrador
URL: `/select-organization?redirectTo=/dashboard`
Resultado esperado: lista de organizacoes autorizadas, sem expor informacao alem do necessario para escolha.
Resultado encontrado: a tela exibiu multiplas organizacoes, papel de administrador e data/hora de ultimo acesso por organizacao.
Status: APROVADO VISUAL / REVISAR EXPOSICAO
Severidade: MEDIA
Impacto: pode ser comportamento esperado para administrador multi-organizacao, mas a exibicao de datas de ultimo acesso de varias organizacoes deve ser confirmada como intencional.
Evidencia: `EVID-PROD-ADM-SUPPORT-SELECT_ORG-040.png`

### Medio - Usuario padrao recebe tela crua em detalhe financeiro invalido

ID: SUPPORT-STD-FIN-DETAIL-001
Perfil: usuario padrao
URL: `/financeiro/contratos/[identificador-invalido]`
Resultado esperado: bloqueio por permissao, redirecionamento, ou estado de erro dentro do layout do produto com acao de retorno.
Resultado encontrado: a rota exibiu apenas `Contrato nao encontrado` em tela vazia, sem layout, menu, botao de retorno ou mensagem de permissao.
Status: PARCIAL
Severidade: MEDIA
Impacto: reforca a inconsistencia financeira ja observada na continuacao 24; o usuario padrao chega a uma rota financeira direta e recebe um estado tecnico/minimo, nao uma negativa de permissao.
Evidencia: `EVID-PROD-STD-SUPPORT-CONTRATO_INVALIDO-040.png`

### Baixo - Redirecionamento de selecao de organizacao do usuario padrao nao explica criterio

ID: SUPPORT-STD-ORG-001
Perfil: usuario padrao
URL: `/select-organization?redirectTo=/dashboard`
Resultado esperado: se houver apenas uma organizacao, redirecionar e aceitavel; se a rota for bloqueada, deveria haver uma mensagem clara.
Resultado encontrado: a rota foi diretamente para `/dashboard`, sem feedback.
Status: APROVADO/PARCIAL
Severidade: BAIXA
Impacto: baixo, mas pode confundir suporte quando o usuario recebe link de selecao de organizacao e nao entende por que voltou ao dashboard.
Evidencia: `EVID-PROD-STD-SUPPORT-SELECT_ORG-040.png`

### Baixo - Reset direto registra erro tecnico no console, mas mostra mensagem correta

ID: SUPPORT-RESET-001
Perfil: anonimo
URLs: rota publica de reset de senha, com e sem parametro invalido
Resultado esperado: link invalido/expirado sem expor formulario de senha.
Resultado encontrado: a interface mostrou mensagem correta e botao para voltar ao login. O console registrou erro de validacao de sessao PKCE ausente ao testar parametro invalido.
Status: APROVADO COM AVISO TECNICO
Severidade: BAIXA
Impacto: a experiencia visual esta correta, mas o log tecnico pode ser reduzido/tratado para nao poluir monitoramento.
Evidencias: `EVID-PROD-ANON-SUPPORT-RESET_SENHA_DIRECT-040.png`, `EVID-PROD-ANON-SUPPORT-RESET_SENHA_INVALID_CODE-040.png`

### Baixo - Avisos recorrentes de graficos continuam no dashboard

ID: SUPPORT-CONSOLE-001
Perfis: administrador e usuario padrao
Resultado encontrado: continuaram aparecendo avisos de graficos com largura/altura invalidas e logs de push ignorado no ambiente web.
Status: PARCIAL
Severidade: BAIXA
Impacto: risco de instabilidade visual em dashboards e ruido em logs.
Evidencia: logs coletados na aba da rodada 40.

## Pontos positivos

- O administrador em organizacao sem financeiro habilitado recebeu uma tela clara de financeiro indisponivel com botao de retorno.
- O reset de senha sem sessao nao expôs campos de nova senha sem validacao do link.
- A sessao final foi restaurada no administrador.

## Evidencias geradas

- `EVID-PROD-ADM-SUPPORT-SELECT_ORG-040.png`
- `EVID-PROD-ADM-SUPPORT-CONTRATO_INVALIDO-040.png`
- `EVID-PROD-STD-SUPPORT-LOGIN-DASHBOARD-040.png`
- `EVID-PROD-STD-SUPPORT-SELECT_ORG-040.png`
- `EVID-PROD-STD-SUPPORT-CONTRATO_INVALIDO-040.png`
- `EVID-PROD-ANON-SUPPORT-RESET_SENHA_DIRECT-040.png`
- `EVID-PROD-ANON-SUPPORT-RESET_SENHA_INVALID_CODE-040.png`
- `EVID-PROD-ADM-SUPPORT-RETORNO-FINAL-040.png`

## Dados criados e limpeza

Dados criados: nenhum.
Dados alterados: nenhum.
Limpeza realizada: nao aplicavel.
Organizacoes selecionadas: nenhuma.

## Recomendacoes

1. Revisar se datas de ultimo acesso devem aparecer na tela de selecao multi-organizacao.
2. Padronizar a rota de detalhe financeiro invalido para usuario padrao com bloqueio de permissao ou erro dentro do layout.
3. Adicionar feedback explicito para `/select-organization` quando usuario padrao tiver apenas uma organizacao.
4. Tratar erro PKCE ausente no reset para reduzir ruido de console mantendo a mensagem amigavel.
5. Continuar investigando os avisos recorrentes de dimensao de graficos.

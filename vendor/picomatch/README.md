# Backports de segurança do Picomatch

As cópias `2.3.2-vimob.1` e `4.0.4-vimob.1` são variantes internas das versões publicadas `2.3.2` e `4.0.4`. Elas preservam o Picomatch, seus imports e a licença MIT incluída nos pacotes. O `micromatch` carrega a série 2 e o `tinyglobby` e `fdir` carregam a série 4. Os consumidores são dependências de desenvolvimento.

O patch de parser parte do [commit f03bec2](https://github.com/micromatch/picomatch/pull/246/commits/f03bec2c02e46f063fbfdc161aae1d0f854b2565) e trata a classe descrita no [aviso GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Ele simplifica a repetição de um ramo simples de literais e asteriscos. O ajuste local detecta também curingas ativos do parser em ramos simples cuja equivalência não pode ser demonstrada e usa a proteção literal existente, inclusive no modo de captura. Essa proteção aplica-se antes da opção de desativação do limite de recursão. O patch cobre o uso de curingas explícitos nessa classe e preserva as outras regras de recursão da biblioteca.

## Verificação

Execute na raiz do repositório com Node 24 e npm 11.13.0.

```sh
npm ci
node scripts/security/check-release-audit.mjs
node scripts/security/rebuild-picomatch-backports.mjs
node scripts/security/check-picomatch-backports.mjs
```

O rebuild baixa as bases oficiais sem executar scripts, verifica a integridade, aplica o patch e compara os arquivos empacotados com os artefatos aprovados. A verificação de backports confere os pacotes instalados, consulta o npm pelo nome e pelas duas versões originais e mantém o aviso original no relatório. Um novo alerta alto ou crítico, uma mudança no aviso revisado ou uma divergência de conteúdo bloqueia o release. A auditoria integral do restante da árvore continua obrigatória.

O `Dockerfile.web` inclui os dois arquivos `.tgz` na etapa de dependências. A instalação usa o lockfile e não depende de credencial de um registro privado. Antes de trocar os backports por versões oficiais, confira a cobertura do aviso nas duas séries e atualize os overrides e as verificações na mesma revisão.

# Exportação de contatos — hotfix frontal

O diálogo prepara CSV/XLSX e mantém um link “Baixar arquivo”. O clique é direto
do usuário; repetir o download usa o arquivo já preparado, sem consultar a API
novamente. “Arquivo pronto” indica geração concluída, não confirmação de que o
navegador salvou o arquivo no dispositivo.

O Blob e sua URL existem somente na memória do diálogo. Fechar, desmontar,
trocar organização/usuário/SID, filtros, formato ou colunas descarta o arquivo.
Renovação de token com o mesmo SID mantém o contexto. Uma geração antiga não
pode recriar um arquivo depois de uma troca de acesso. O SID é lido apenas para
esse ciclo de vida; permissões e autorização continuam no servidor.

Este backport parte do Web ef1cefca e conserva a API de produção 7e490c7:
`contactsAPI.list`, `mode=export`, páginas de 500 e envelope `{data}` legado.
Não inclui wizard, paginação nova, `exportVersion`, mudanças de autenticação,
API, banco, integrações ou dependências. O caminho de exportação sem callback
continua disponível para consumidores anteriores.

Os testes focados usam dados sintéticos e rede bloqueada, sem iniciar servidor.
Não comprovam todas as políticas de download de Safari, iOS, Excel ou Numbers,
nem isolam uma causa única para todo relato de falha em produção. A publicação
precisa de imagem Web ARM64 própria, validação funcional e rollback da imagem;
não deve substituir a API nem publicar a homologação inteira.

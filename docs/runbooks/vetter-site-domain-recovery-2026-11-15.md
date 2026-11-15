# F12: recuperar o acesso público pelo domínio configurado

> Histórico encerrado. Em15/11/2026, o usuário informou que o domínio venceu,
> não é mais utilizado e pediu retirar F12 do escopo. Não executar os passos
> de recuperação abaixo; são preservados somente como registro da investigação.

## Evidência e escopo

Em 15/11/2026 às 11h37 BRT (14h37 UTC),
`virandoachaveometodo.com.br` respondeu NXDOMAIN para A, AAAA, NS e SOA nos
resolvedores Cloudflare `1.1.1.1` e Google `8.8.8.8`. Consultas NS diretas a
`a.dns.br` e `b.dns.br` também responderam NXDOMAIN. O WHOIS do Registro.br
informou `% release process: waiting`. O RDAP respondeu 200 com objeto mínimo,
sem datas, status ou nameservers que permitissem determinar uma expiração.

O impacto comprovado é o acesso público pelo domínio configurado para o site da
Vetter co. O CRM autenticado continuou acessível. A Central concluiu publicação
e retirada do imóvel técnico AP0377, mas a URL pública não resolveu. A conclusão
do job interno não comprova página externa publicada nem retirada externa.

A causa histórica específica do estado de registro não foi identificada. O
[Registro.br](https://registro.br/dominio/processo-de-liberacao) descreve motivos
diversos para liberação, incluindo não renovação, cancelamento e irregularidade
cadastral. Essa explicação geral não determina qual ocorreu neste domínio.
Recuperar registro/delegação/DNS depende do responsável pelo domínio e não se
resolve por uma alteração no código do CRM.

## Conferir o alvo antes de qualquer mudança

- Confirmar que o domínio exato acima pertence ao site pretendido da Vetter co.,
  na organização correta, e identificar o responsável autorizado pelo registro.
- Conferir no Registro.br a situação atual e as alternativas disponíveis para
  esse domínio. Não concluir que basta renovar nem que já pode ser comprado.
- Preservar o estado de registro e a zona anterior, se disponíveis ao
  responsável. Confirmar separadamente quem administra DNS e hospedagem.
- Obter o destino e os registros necessários no contrato de hospedagem vigente.
  Não adivinhar IP, CNAME ou nameserver, nem copiar registros de outro tenant.

Este roteiro não executa compra, transferência, contato com terceiros ou mudança
remota. Credenciais, dados de titular e chaves ficam fora do repositório.

## Ações do responsável pelo registro e DNS

1. Resolver a situação administrativa pelo procedimento aplicável do Registro.br,
   usando a conta e as evidências do responsável pelo domínio. Se estiver em
   processo de liberação, seguir esse processo; não atribuir uma data ou causa
   sem confirmação oficial específica.
2. Após regularizar o controle, conferir a delegação para os nameservers corretos.
   Conferir A/AAAA/CNAME e o host configurado na hospedagem. Não criar AAAA sem
   suporte IPv6 real. Revisar DNSSEC quando existir, para não deixar DS inválido.
3. Conferir resolução no autoritativo e em resolvedores públicos. Registrar
   horário, RCODE, respostas e TTL. Distinguir ausência de registro, NXDOMAIN,
   SERVFAIL e caches ainda válidos; não chamar propagação de concluída por um
   único resolvedor responder.
4. Conferir certificado TLS e vinculação do host à organização correta antes de
   expor o site. Um host resolvendo para a plataforma não basta para provar a
   associação do tenant.

Consultas de diagnóstico somente leitura, sem credenciais:

```powershell
Resolve-DnsName -Name virandoachaveometodo.com.br -Type NS -Server 1.1.1.1 -DnsOnly
Resolve-DnsName -Name virandoachaveometodo.com.br -Type A -Server 1.1.1.1 -DnsOnly
Resolve-DnsName -Name virandoachaveometodo.com.br -Type AAAA -Server 8.8.8.8 -DnsOnly
Resolve-DnsName -Name virandoachaveometodo.com.br -Type SOA -Server 8.8.8.8 -DnsOnly
```

Essas consultas devem ser repetidas para os demais pares tipo/resolvedor e para
os servidores autoritativos identificados no estado atual. A delegação pode
mudar; o resultado histórico de 15/11 não substitui essa verificação.

## Canário externo depois da delegação

1. Abrir a home em sessão pública, conferir TLS, organização, conteúdo e links.
   Não usar cookies administrativos como evidência de acesso público.
2. AP0377 terminou o ensaio anterior **Fora do site**. Conferir que sua URL
   `https://virandoachaveometodo.com.br/imovel/AP0377` não expõe a ficha retirada.
   Registrar o comportamento previsto pelo contrato público, incluindo eventual
   redirecionamento ou página de indisponibilidade.
3. Em um ensaio de publicação controlado, usar somente ficha técnica com dados
   sintéticos e marcação explícita de teste. Registrar a versão do job e conferir
   externamente a mesma versão, preço, localização, fotos e descrição; não
   confundir a prévia interna com a página pública.
4. Retirar o canário, aguardar o resultado durável e repetir a URL em sessão
   pública, considerando os TTLs/caches existentes. Conferir que a ficha deixou
   de ser exposta e que os demais imóveis da organização permaneceram íntegros.
5. Manter a ficha técnica fora do site ao encerrar e registrar qualquer diferença
   de dados em relação ao estado inicial. O ensaio anterior manteve localização
   válida em AP0377 por normalização do formulário; não alegar restauração total.

Depois desses passos, atualizar F12 com as evidências externas. Alterações DNS
não corrigem o contrato vazio de GA4 nas configurações do site (F08), que tem
correção e teste próprios.

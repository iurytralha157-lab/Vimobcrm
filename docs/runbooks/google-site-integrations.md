# Integrações Google do site público

## Escopo

Google Analytics, Google Tag Manager e Google Search Console são configurações
independentes do site público. Nenhuma delas concede acesso à conta Google nem
importa relatórios para o CRM:

- Analytics instala um ID de medição GA4 (`G-...`) após consentimento;
- Tag Manager instala um contêiner Web (`GTM-...`) após consentimento;
- Search Console publica o token de verificação na página inicial.

O site precisa estar ativo e ter uma URL pública por subdomínio ou domínio
próprio verificado. Use a URL efetivamente exibida na integração ao cadastrar a
propriedade no Google.

## Analytics e Tag Manager sem duplicidade

Escolha apenas um caminho para o GA4:

1. salvar o ID `G-...` diretamente em **Google Analytics** no Vimob; ou
2. criar e publicar a tag GA4 no contêiner salvo em **Google Tag Manager**.

Não mantenha o mesmo GA4 nos dois caminhos. Isso pode enviar `page_view` e
outros eventos duas vezes. Um ID legado `UA-...` precisa ser substituído por um
ID de fluxo GA4 atual.

Para validar o GTM, abra o site publicado no Tag Assistant e aceite os cookies
antes do teste. O comportamento esperado é não carregar o contêiner antes do
consentimento e carregá-lo depois da aceitação.

Referências oficiais:

- [Configurar o Google Analytics 4](https://support.google.com/analytics/answer/14183469?hl=pt-BR)
- [Instalar um contêiner Web do Google Tag Manager](https://support.google.com/tagmanager/answer/14847097?hl=pt-BR)

## Search Console

1. No Search Console, adicione uma propriedade do tipo **Prefixo do URL** para
   a URL pública mostrada no Vimob.
2. Escolha **Tag HTML**.
3. Cole no Vimob a meta tag completa ou somente o valor de `content`.
4. Salve e confirme que a página inicial contém
   `meta[name="google-site-verification"]`.
5. Clique em **Verificar** no Search Console.

A meta de verificação aparece somente na página inicial. Ela é um token público
de comprovação de propriedade, não uma credencial OAuth.

Referência oficial: [verificar a propriedade de um site](https://support.google.com/webmasters/answer/9008080?hl=pt-BR).

## Cache e rollout

A leitura de configuração do site no Next.js usa `revalidate: 0`. O fallback
de disponibilidade pode preservar conteúdo antigo, mas remove GA, GTM, pixels,
scripts customizados e o token do Search Console até a API canônica voltar.

O Worker novo envia HTML com `Cache-Control: no-store`; assim, salvar ou remover
uma integração não deixa uma cópia executável no cache da borda. Assets e dados
continuam seguindo os caches próprios da aplicação.

Workers que já foram copiados e publicados no Cloudflare não são atualizados
automaticamente. O rollout precisa republicar, em cada domínio, o código gerado
na tela do Vimob e depois provar em navegador real:

- HTML com `Cache-Control: no-store`;
- nenhum request para GA/GTM/Meta antes do consentimento;
- apenas o provedor escolhido depois do consentimento;
- remoção do ID refletida em uma nova navegação, sem HTML antigo na borda;
- token do Search Console presente somente na home enquanto configurado.

Não considere a alteração local nem o manifesto de Edge Functions como prova de
deploy. A Edge Function `public-site-ssr`, `get-worker-config`, a migração da
coluna de Search Console, a API e o Next.js precisam entrar no rollout
compatível e ser lidos de volta no ambiente publicado.

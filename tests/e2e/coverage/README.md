# Accounting verificável de E2E

Os manifests `*.claims.json` representam somente `planned`. O protocolo executável atual
aceita apenas `routeViewport` de rotas estáticas, com landmark de prontidão explícito.
Aliases, rotas dinâmicas, acesso por persona e superfícies (`overlay`, `form`, CTA e
controle) permanecem fora do executável até terem schemas de evidência específicos.

O helper registra `attempted` somente com attachment de tentativa. Ele só anexa a prova
depois de confirmar status 200, ausência de redirect, URL final equivalente à rota
(ignorando apenas query, hash e barra final), landmark visível durante dois frames, body
visível e não vazio e ausência de overflow horizontal.

## Prova protocolar e execução oficial

Um JSON Playwright, mesmo contendo attachments perfeitamente formados, produz no máximo
`protocolExecuted`. O campo oficial `executed` permanece zero sem um sidecar HMAC-SHA256
válido. O sidecar vincula os bytes exatos do report, SHA full40 do commit, digest
recomputado do inventário, `runId`, `issuer`, `repository`, `workflow` e `runAttempt`.

A chave `E2E_CLAIM_ATTESTATION_KEY` existe somente na etapa pós-Playwright de
assinatura/verificação. Ela não pode ser exposta ao worker, ao spec ou ao helper. O
validador de discovery remove explicitamente essa variável antes de criar o processo
Playwright.

Exemplo de etapas CI separadas:

```powershell
# Etapa 1: worker sem a chave HMAC
Remove-Item Env:E2E_CLAIM_ATTESTATION_KEY -ErrorAction SilentlyContinue
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = 'playwright-report.json'
npx playwright test --reporter=json

# Etapa 2: contexto CI + secret disponíveis somente agora
node scripts/qa/report-e2e-coverage.mjs --sign-attestation `
  --report playwright-report.json --attestation playwright-report.attestation.json

# Verificação/relatório oficial, ainda na etapa protegida
node scripts/qa/report-e2e-coverage.mjs --report playwright-report.json `
  --attestation playwright-report.attestation.json --output e2e-coverage.json
```

O CLI usa `E2E_CLAIM_COMMIT_SHA`, `E2E_CLAIM_RUN_ID`, `E2E_CLAIM_ISSUER`,
`E2E_CLAIM_REPOSITORY`, `E2E_CLAIM_WORKFLOW` e `E2E_CLAIM_RUN_ATTEMPT`, com
fallback para `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_REPOSITORY`,
`GITHUB_WORKFLOW_REF`/`GITHUB_WORKFLOW` e `GITHUB_RUN_ATTEMPT`. Em GitHub Actions, o
issuer padrão é `github-actions`.

O código revisado dos testes e o runner CI são a fronteira de confiança. A HMAC impede
que JSON arbitrário, antigo ou alterado seja promovido a execução oficial; ela não protege
contra código malicioso já aceito no repositório. A checagem AST de import e chamada
aguardada ao helper reduz bypass acidental, não substitui revisão de código.

As métricas `planned`, `attempted`, `protocolExecuted` e `executed` são publicadas por
categoria. Não existe percentual agregado entre denominadores heterogêneos.

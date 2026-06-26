# 📚 ÍNDICE - Documentação Arquitetura Vimob CRM

## 📖 Onde encontrar cada coisa

### 🎯 PRIMEIRO ACESSO? COMECE AQUI
1. **Leia**: `QUICK_REFERENCE.md` (5 min)
2. **Entenda**: `ARCHITECTURE.md` (15 min)
3. **Veja exemplos**: `CODE_EXAMPLES.md` (20 min)
4. **Consulte sempre**: `.CLAUDE_SYSTEM_PROMPT.md`

---

## 📄 ARQUIVOS DE DOCUMENTAÇÃO

### `.CLAUDE_SYSTEM_PROMPT.md` ⭐ PRINCIPAL
**Tamanho**: 10k+ palavras | **Tempo de leitura**: 60 min
**Propósito**: Prompt definitivo para todas as IAs/agentes
**Contém**:
- Contexto completo do projeto
- Arquitetura detalhada (inmutable)
- Critérios de decisão para cada tipo de arquivo
- Padrões obrigatórios
- Anti-patterns a evitar
- Roadmap das próximas fases
- Instruções finais

**Quando usar**: Enviando para nova IA/agente, resolvendo dúvidas arquiteturais

---

### `QUICK_REFERENCE.md` ⚡ CONSULTA RÁPIDA
**Tamanho**: 2k palavras | **Tempo de leitura**: 10 min
**Propósito**: Referência rápida durante desenvolvimento
**Contém**:
- Decision tree (onde colocar código)
- Template de estrutura por domínio
- Import patterns
- Segurança checklist
- Boilerplate code (copy-paste)
- Red flags (o que nunca fazer)
- Debugging tips

**Quando usar**: Desenvolvimento rápido, verificação de padrões

---

### `ARCHITECTURE.md` 🏗️ VISÃO GERAL
**Tamanho**: 5k palavras | **Tempo de leitura**: 20 min
**Propósito**: Relatório de implementação da arquitetura
**Contém**:
- O que foi implementado (Fase 1)
- Estrutura final
- Benefícios da nova arquitetura
- Comparação antes/depois
- Próximos passos recomendados

**Quando usar**: Onboarding, entender o que foi feito

---

### `COMPONENTS_REORGANIZATION.md` 📦 REORGANIZAÇÃO
**Tamanho**: 3k palavras | **Tempo de leitura**: 15 min
**Propósito**: Detalhes da reorganização de componentes
**Contém**:
- O que foi movido
- Mudanças de imports
- Estatísticas
- Estrutura final
- Próximos passos

**Quando usar**: Entender por que componentes estão em `features/`

---

### `CODE_EXAMPLES.md` 💻 EXEMPLOS REAIS
**Tamanho**: 4k palavras | **Tempo de leitura**: 30 min
**Propósito**: Exemplos completos e reutilizáveis
**Contém**:
- Feature "Leads" completa (schema, api, hooks, componentes)
- Zustand store example
- Error handling
- Server actions
- Padrões para copiar-e-colar

**Quando usar**: Criar nova feature, dúvidas de implementação

---

## 🗂️ ESTRUTURA DO PROJETO

```
vimob-crm/
├── 📖 .CLAUDE_SYSTEM_PROMPT.md    ← LEIA ISTO PRIMEIRO
├── ⚡ QUICK_REFERENCE.md           ← Consulta rápida
├── 🏗️ ARCHITECTURE.md              ← Visão geral
├── 📦 COMPONENTS_REORGANIZATION.md ← Como components/
├── 💻 CODE_EXAMPLES.md             ← Copy-paste pronto
├── 📚 README.md                    ← (Será criado)
│
├── app/                    (Rotas Next.js)
├── components/
│   ├── features/           (Organizados por domínio)
│   ├── shared/             (Reutilizáveis)
│   ├── ui/                 (Radix - nunca editar)
│   └── providers/          (Provedores globais)
├── lib/
│   ├── supabase/
│   ├── api/
│   ├── validation/
│   └── utils/
├── hooks/
├── stores/
├── config/
└── middleware.ts
```

---

## 🎯 COMO USAR ESTA DOCUMENTAÇÃO

### Cenário 1: "Sou uma IA nova, onde começo?"
1. Leia `.CLAUDE_SYSTEM_PROMPT.md` completamente
2. Consulte `QUICK_REFERENCE.md` durante trabalho
3. Copie exemplos de `CODE_EXAMPLES.md`

### Cenário 2: "Preciso criar nova feature"
1. Consulte `QUICK_REFERENCE.md` (decision tree)
2. Copie estrutura de `CODE_EXAMPLES.md`
3. Adapte para seu domínio

### Cenário 3: "Não tenho certeza sobre padrão X"
1. Busque em `QUICK_REFERENCE.md` (rápido)
2. Se não achar, busque em `.CLAUDE_SYSTEM_PROMPT.md` (detalhado)
3. Se ainda estiver com dúvida, veja exemplo em `CODE_EXAMPLES.md`

### Cenário 4: "Vou trabalhar com outra IA neste projeto"
1. Envie `.CLAUDE_SYSTEM_PROMPT.md` + `QUICK_REFERENCE.md`
2. Se ela for implementar, envie também `CODE_EXAMPLES.md`
3. Faça uma sync rápida sobre o estado do projeto

### Cenário 5: "Preciso fazer onboarding de novo dev"
1. Mande `ARCHITECTURE.md` (entender o que foi feito)
2. Mande `QUICK_REFERENCE.md` (consulta rápida)
3. Mande `CODE_EXAMPLES.md` (ver padrões em ação)
4. Aponte para `.CLAUDE_SYSTEM_PROMPT.md` como referência completa

---

## 📊 MATRIZ DE PRIORIDADE

| Documento | Novo dev | Novo IA | Implementação | Onboarding |
|-----------|----------|---------|---------------|-----------|
| .CLAUDE_SYSTEM_PROMPT | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| QUICK_REFERENCE | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| ARCHITECTURE | ⭐⭐⭐ | ⭐ | ⭐ | ⭐⭐⭐ |
| CODE_EXAMPLES | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| COMPONENTS_REORGANIZATION | ⭐ | ⭐ | ⭐ | ⭐⭐ |

**⭐⭐⭐ = Leitura obrigatória**
**⭐⭐ = Recomendado**
**⭐ = Para referência**

---

## 🔍 BUSCA RÁPIDA

### Preciso de... 📌

**"Onde colocar meu componente novo?"**
→ `QUICK_REFERENCE.md` → Seção "Decisão Rápida"

**"Como criar nova API function?"**
→ `CODE_EXAMPLES.md` → Exemplo Leads → lib/api/leads.ts

**"Qual é a regra de segurança?"**
→ `.CLAUDE_SYSTEM_PROMPT.md` → Seção "SEGURANÇA"

**"Exemplo completo de hook?"**
→ `CODE_EXAMPLES.md` → Exemplo Leads → hooks/

**"O que é anti-pattern?"**
→ `.CLAUDE_SYSTEM_PROMPT.md` → Seção "ANTI-PATTERNS"

**"Como validar dados?"**
→ `QUICK_REFERENCE.md` → Red Flags
→ `CODE_EXAMPLES.md` → leadSchema

**"Qual o padrão de import?"**
→ `QUICK_REFERENCE.md` → Import Patterns

**"Como fazer Server Action?"**
→ `CODE_EXAMPLES.md` → Exemplo 4

**"Qual é o state management?"**
→ `.CLAUDE_SYSTEM_PROMPT.md` → STATE MANAGEMENT STRATEGY

**"O que fazer em Fase 2?"**
→ `.CLAUDE_SYSTEM_PROMPT.md` → PRÓXIMAS FASES

---

## 🚀 QUICK START PARA NOVA IA

```bash
# Passo 1: Entender o projeto
cat .CLAUDE_SYSTEM_PROMPT.md

# Passo 2: Referência rápida
cat QUICK_REFERENCE.md

# Passo 3: Ver exemplos
cat CODE_EXAMPLES.md

# Passo 4: Começar a trabalhar! 🎉
```

---

## 📝 QUANDO ATUALIZAR DOCUMENTAÇÃO

### Atualizar `.CLAUDE_SYSTEM_PROMPT.md` quando:
- Mudar pattern arquitetural (raro)
- Adicionar novo padrão obrigatório
- Mudar estratégia de state management
- Cada fase do roadmap é completada

### Atualizar `QUICK_REFERENCE.md` quando:
- Novo anti-pattern descoberto
- Novo template de código criado
- Melhorias na decision tree

### Atualizar `CODE_EXAMPLES.md` quando:
- Novos padrões são estabelecidos
- Exemplos precisam de refactoring
- Novos tipos de features adicionadas

### Criar novo arquivo quando:
- Nova tecnologia integrada (ex: Redis, GraphQL)
- Novo domínio complexo estabelecido
- Troubleshooting guide precisa ser criado

---

## 🔄 VERSIONAMENTO

| Versão | Data | Mudanças |
|--------|------|----------|
| 1.0 | 2026-06-15 | Release inicial - Fase 1 completa |
| 1.1 | (Próximo) | Adicionar Fase 2 updates |
| 2.0 | (Futuro) | Revisão completa pós-Fase 3 |

---

## 📞 CONTATO/REFERÊNCIAS

**Criado por**: Claude Agent + André (User)
**Última atualização**: 2026-06-15
**Próxima review**: Após Fase 2 (Core Features)

**Manter este índice atualizado!**

---

## ✅ CHECKLIST ANTES DE COMEÇAR QUALQUER TAREFA

- [ ] Li `.CLAUDE_SYSTEM_PROMPT.md`?
- [ ] Consultei `QUICK_REFERENCE.md`?
- [ ] Verifiquei exemplo em `CODE_EXAMPLES.md`?
- [ ] Testei padrão localmente?
- [ ] Documentei mudanças?

**Se respondeu SIM em tudo → Pronto para começar! 🚀**

---

**Esta documentação é DEFINITIVA. Use como referência absoluta para consistência.**

# Grafo Líquido

> Semantic garbage collector para vaults do Obsidian — notas que param de ser usadas decaem, se desconectam e são comprimidas por IA.

[![Build & Release](https://github.com/matheusnmto/liquid-graph/actions/workflows/release.yml/badge.svg)](https://github.com/matheusnmto/liquid-graph/actions/workflows/release.yml)

---

## O que faz

O Grafo Líquido é um**daemon de manutenção semântica** para vaults do [Obsidian](https://obsidian.md). Ele identifica notas que pararam de ser consultadas e aplica um ciclo de decaimento em 3 fases:

| Fase | Nome | Trigger | Efeito |
|------|------|---------|--------|
| F1 | Estiagem | Nota inativa por ≥30 dias | Marca `decay_level: 1` no frontmatter |
| F2 | Desconexão | Inativa por ≥60 dias | Snapshot Git + quebra de wikilinks em todo o vault |
| F3 | Dissolução | Inativa por ≥90 dias | IA comprime a nota em uma frase, fossiliza o original em `/_fossilized/` |

**Ressurreição:** basta abrir a nota ou criar um novo `[[wikilink]]` apontando para ela — o decaimento é resetado automaticamente.

---

## Instalação

### Desktop (Electron)

Baixe o instalador para seu sistema em [Releases](https://github.com/matheusnmto/liquid-graph/releases):

-**macOS:** `.dmg`
-**Windows:** `.exe` (NSIS)
-**Linux:** `.AppImage`

### Linha de comando

```bash
git clone https://github.com/matheusnmto/liquid-graph.git
cd liquid-graph
npm install
cd zelador && npm install && cd..

# Executar o Zelador diretamente
npm run zelador

# Abrir o app Electron
npm start
```

---

## Modelo de API de IA

O Grafo Líquido usa inteligência artificial na**Fase 3 (Dissolução)** para comprimir notas em uma frase-resumo. Existem dois modelos de acesso:

### � Modalidade 1 — BYOK (Bring Your Own Key)*[implementada]*

O usuário fornece sua própria chave de API. A chave é armazenada**exclusivamente no keychain do sistema operacional** (via [keytar](https://github.com/nicholasrq/node-keytar)) — nunca em disco, nunca em logs, nunca em texto plano.

| Provider | Modelo | Custo estimado por nota |
|----------|--------|------------------------|
| [Anthropic](https://console.anthropic.com) | claude-haiku-4-5-20251001 | ~$0.001 |
| [Google AI](https://aistudio.google.com) | gemini-1.5-flash | ~$0.0003 |

>**� Nota de privacidade:** Na modalidade BYOK, o conteúdo das suas notas vai**diretamente do seu computador para a API** da Anthropic ou Google. Nenhum servidor do Grafo Líquido recebe, processa ou armazena suas notas. Zero intermediários.

### Modalidade 2 — Chave Centralizada / SaaS*[roadmap]*

Modelo futuro onde o usuário não precisa ter uma API key. O Grafo Líquido fornece o acesso à IA via conta + assinatura.

**Implicações:**
- Requer backend (Node.js + banco de dados para contas/billing)
- O conteúdo das notas trafegará para um servidor externo — consentimento explícito será obrigatório
- Vantagem: zero configuração para o usuário final
- Stack planejada: [Stripe](https://stripe.com) para billing, deploy na [Railway](https://railway.app)

> Este modelo**ainda não foi implementado**. Se tiver interesse em contribuir, veja a seção [Contribuindo](#contribuindo) abaixo.

---

## Estrutura do projeto

```
liquid-graph/
├── electron/              ← Main Process do Electron
│   ├── main.js            ← Janela, tray, agendamento
│   ├── preload.js         ← Bridge segura (contextBridge)
│   ├── tray.js            ← System tray com menu contextual
│   └── ipc/
│       ├── config.ipc.js  ← Configurações + keytar
│       └── zelador.ipc.js ← Execução do Zelador via fork()
├── renderer/              ← Interface do app
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── zelador/               ← Lógica core (Node.js puro)
│   ├── zelador.js         ← Entry point
│   ├── config/defaults.js ← Thresholds padrão
│   └── modules/
│       ├── scanner.js     ← Varredura do vault
│       ├── frontmatter.js ← Leitura/escrita via gray-matter
│       ├── phases.js      ← Lógica de F1/F2/F3
│       ├── git.js         ← Snapshots Git automatizados
│       ├── linkBreaker.js ← Quebra de wikilinks (6 variantes)
│       ├── aiProvider.js  ← Abstração multi-provider (BYOK)
│       ├── purgatory.js   ← Geração do PURGATORIO.md
│       └── lockFile.js    ← Previne execuções concorrentes
├── assets/                ← Ícones do app
├── electron-builder.yml   ← Config de empacotamento
└──.github/workflows/     ← CI/CD para releases
```

---

## Configuração

### `decay.config.json` (na raiz do vault)

```json
{
  "folders": {
    "evergreen": {
      "decay_immune": true
    },
    "fleeting": {
      "days_phase1": 14,
      "days_phase2": 28,
      "days_phase3": 45
    }
  }
}
```

### `.env` (na pasta `zelador/`)

```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=AIza...
```

> No app Electron, as chaves são gerenciadas pela interface e armazenadas no keychain — o `.env` é necessário apenas para uso via CLI.

---

## Contribuindo

### Rodando localmente

```bash
# 1. Clone o repositório
git clone https://github.com/matheusnmto/liquid-graph.git
cd liquid-graph

# 2. Instale as dependências
npm install
cd zelador && npm install && cd..

# 3. Rode em modo desenvolvimento
npm start
```

### Como contribuir

1.**Abra uma issue** descrevendo o bug ou feature request
2.**Fork** o repositório
3. Crie uma**branch** descritiva: `git checkout -b feat/resurrection-module`
4. Faça suas alterações e**commite** com mensagens claras
5. Abra um**Pull Request** apontando para `main`

### Convenções

-**Commits:** mensagens em inglês, formato `tipo: descrição` (ex: `feat: add resurrection module`)
-**Código:** `'use strict'` em todos os módulos, JSDoc nas funções públicas
-**Testes:** crie notas de teste com `touch -t` para simular inatividade
-**Segurança:** chaves de API**nunca** devem aparecer em logs ou commits

---

## Roadmap

- [x]**F1 — Estiagem:** marca notas inativas com `decay_level: 1`
- [x]**F2 — Desconexão:** snapshot Git + quebra de wikilinks
- [ ]**F3 — Dissolução:** compressão via IA + fossilização
- [ ]**Ressurreição:** reset automático ao referenciar nota decaída
- [ ]**SaaS:** modalidade de IA centralizada com billing
- [ ]**Plugin Obsidian:** integração nativa como community plugin

---

## Licença

MIT © 2026

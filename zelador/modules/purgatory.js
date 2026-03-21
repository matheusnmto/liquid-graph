'use strict';

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const matter = require('gray-matter');
const {
  PURGATORY_FILE,
  PURGATORY_WARN_DAYS,
  PURGATORY_URGENT_DAYS,
  MS_PER_DAY,
  IGNORED_DIRS,
} = require('../config/defaults');

// ─────────────────────────────────────────────────────────────────────────────
// Logger interno
// ─────────────────────────────────────────────────────────────────────────────
function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] [purgatory] ${msg}`);
}

/**
 * Formata uma data ISO como YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function toISODate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Calcula a data de dissolução (Fase 3) de uma nota.
 *
 * @param {Date} mtime - Última modificação
 * @param {number} phase3Days - Threshold de dias para F3
 * @returns {Date}
 */
function calcDissolutionDate(mtime, phase3Days) {
  return new Date(mtime.getTime() + phase3Days * MS_PER_DAY);
}

// ─────────────────────────────────────────────────────────────────────────────
// buildPurgatoryList
// Varre o vault e identifica notas que atingirão a Fase 3 dentro de
// PURGATORY_WARN_DAYS dias. Retorna lista ordenada por proximidade.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} vaultPath
 * @param {object} config - Configuração completa { global, folders }
 * @param {function} resolveConfigFn - Função resolveConfig(relativePath, config) do zelador.js
 * @returns {Promise<Array<{filePath, noteName, folder, dissolutionDate, daysRemaining}>>}
 */
async function buildPurgatoryList(vaultPath, config, resolveConfigFn) {
  const now = Date.now();
  const ignorePatterns = IGNORED_DIRS.map(dir => `**/${dir}/**`);

  const files = await glob('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
  });

  const candidates = [];

  for (const filePath of files) {
    // Ignora o próprio PURGATORIO.md
    if (path.basename(filePath) === PURGATORY_FILE) continue;

    let stat, content;
    try {
      stat = fs.statSync(filePath);
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }

    const parsed = matter(content);
    const data = parsed.data || {};

    // Pula imunes
    if (data.decay_immune === true) continue;
    // Pula fossilizadas
    if (data.status === 'fossilized' || data.decay_level === 3) continue;

    const relativePath = '/' + path.relative(vaultPath, filePath);
    const effectiveConfig = resolveConfigFn(relativePath, config);

    // Pasta imune via config
    if (effectiveConfig.decay_immune === true) continue;

    const dissolutionDate = calcDissolutionDate(stat.mtime, effectiveConfig.phase3_days);
    const msRemaining = dissolutionDate.getTime() - now;
    const daysRemaining = Math.ceil(msRemaining / MS_PER_DAY);

    // Só lista notas que vão dissolver nos próximos PURGATORY_WARN_DAYS
    if (daysRemaining <= PURGATORY_WARN_DAYS) {
      const folder = path.dirname(relativePath) === '/' ? '/' : path.dirname(relativePath);
      candidates.push({
        filePath,
        noteName: path.basename(filePath, '.md'),
        folder,
        dissolutionDate,
        daysRemaining,
      });
    }
  }

  // Ordena por proximidade (mais urgente primeiro)
  candidates.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// generatePurgatory
// Gera (ou atualiza) PURGATORIO.md na raiz do vault.
// O arquivo tem decay_immune: true para nunca ser processado pelo Zelador.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} vaultPath
 * @param {object} config
 * @param {function} resolveConfigFn
 * @returns {Promise<{ written: boolean, items: number }>}
 */
async function generatePurgatory(vaultPath, config, resolveConfigFn) {
  const candidates = await buildPurgatoryList(vaultPath, config, resolveConfigFn);
  const purgatoryPath = path.join(vaultPath, PURGATORY_FILE);
  const now = new Date();

  // Divide em "próximos 7 dias" e "próximos 30 dias"
  const urgent = candidates.filter(c => c.daysRemaining <= PURGATORY_URGENT_DAYS);
  const upcoming = candidates.filter(c => c.daysRemaining > PURGATORY_URGENT_DAYS);

  // ── Gera a tabela markdown ──
  const tableHeader = `| Nota | Pasta | Data de dissolução | Dias restantes |\n|------|-------|-------------------|----------------|`;

  function toRow(item) {
    return `| [[${item.noteName}]] | ${item.folder} | ${toISODate(item.dissolutionDate)} | ${item.daysRemaining} dia(s) |`;
  }

  const urgentSection = urgent.length > 0
    ? `## 🔴 Próximos ${PURGATORY_URGENT_DAYS} dias\n\n${tableHeader}\n${urgent.map(toRow).join('\n')}`
    : `## 🔴 Próximos ${PURGATORY_URGENT_DAYS} dias\n\n*Nenhuma nota urgente. ✅*`;

  const upcomingSection = upcoming.length > 0
    ? `## 🟡 Próximos ${PURGATORY_WARN_DAYS} dias\n\n${tableHeader}\n${upcoming.map(toRow).join('\n')}`
    : `## 🟡 Próximos ${PURGATORY_WARN_DAYS} dias\n\n*Nenhuma nota programada para este período.*`;

  const content = `---
tags: [zelador, sistema]
decay_immune: true
---

# 🔥 Purgatório — Notas condenadas à dissolução

> **Atenção:** Estas notas serão comprimidas pelo Zelador nas datas indicadas.
> Abra qualquer uma delas para resetar o decaimento automaticamente.
> Última atualização: ${toISODate(now)} ${now.toTimeString().slice(0, 5)}

---

${urgentSection}

---

${upcomingSection}

---

*Gerado automaticamente pelo Zelador. Não edite este arquivo manualmente.*
`;

  fs.writeFileSync(purgatoryPath, content, 'utf8');
  log(`PURGATORIO.md atualizado: ${candidates.length} nota(s) listada(s) (${urgent.length} urgente(s)).`);

  return { written: true, items: candidates.length };
}

module.exports = {
  generatePurgatory,
  buildPurgatoryList, // exportada para facilitar testes
  calcDissolutionDate,
};

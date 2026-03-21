'use strict';

const { writeFrontmatter } = require('./frontmatter');
const { MS_PER_DAY } = require('../config/defaults');

/**
 * Formata uma data em string ISO simples (YYYY-MM-DD).
 * @param {Date} date
 * @returns {string}
 */
function toISODate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 — Estiagem (inatividade > phase1_days)
// ─────────────────────────────────────────────────────────────────────────────
// REGRA CRÍTICA: A Fase 1 NUNCA modifica o corpo da nota.
// Apenas injeta/atualiza chaves no bloco YAML.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica a Fase 1 a uma nota: injeta decay_level: 1 e decay_since no frontmatter.
 * Não altera o corpo da nota. Não requer Git backup.
 *
 * @param {string} filePath
 * @param {object} currentData - Frontmatter atual já parseado
 * @returns {boolean} true se a fase foi aplicada (nota não estava já em F1+)
 */
function applyPhase1(filePath, currentData) {
  // Se já está em uma fase igual ou superior, não faz nada
  if ((currentData.decay_level ?? 0) >= 1) {
    return false;
  }

  const today = toISODate();

  writeFrontmatter(filePath, {
    decay_level: 1,
    decay_since: today,
  });

  log(`🌵 [F1] Estiagem iniciada: ${filePath} | decay_since: ${today}`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 — Desconexão (inatividade > phase2_days)
// Implementada na Etapa 3 junto com git.js e linkBreaker.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @placeholder - será implementado na Etapa 3
 */
async function applyPhase2(_filePath, _currentData, _vaultPath) {
  throw new Error('Fase 2 ainda não implementada — aguarda Etapa 3');
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — Dissolução (inatividade > phase3_days)
// Implementada na Etapa 4 junto com aiCompressor.js e fossilizer.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @placeholder - será implementado na Etapa 4
 */
async function applyPhase3(_filePath, _currentData, _vaultPath) {
  throw new Error('Fase 3 ainda não implementada — aguarda Etapa 4');
}

/**
 * Determina qual fase deve ser aplicada a uma nota com base na inatividade.
 * Respeita skip_phases da configuração por pasta.
 *
 * @param {number} inactivityMs - Milissegundos de inatividade
 * @param {object} config - Configuração efetiva para esta nota { phase1_days, phase2_days, phase3_days, skip_phases? }
 * @returns {number|null} Fase a aplicar (1, 2 ou 3) ou null se nenhuma
 */
function determinePhase(inactivityMs, config) {
  const skipPhases = config.skip_phases || [];

  const p3 = config.phase3_days * MS_PER_DAY;
  const p2 = config.phase2_days * MS_PER_DAY;
  const p1 = config.phase1_days * MS_PER_DAY;

  if (inactivityMs >= p3 && !skipPhases.includes(3)) return 3;
  if (inactivityMs >= p2 && !skipPhases.includes(2)) return 2;
  if (inactivityMs >= p1 && !skipPhases.includes(1)) return 1;
  return null;
}

module.exports = {
  applyPhase1,
  applyPhase2,
  applyPhase3,
  determinePhase,
  toISODate,
};

'use strict';

// Carrega variáveis de ambiente do .env (necessário apenas para Etapa 4)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const { acquireLock, registerExitHandlers } = require('./modules/lockFile');
const { scanVault, getRelativePath, getNoteTitle } = require('./modules/scanner');
const { readFrontmatter, isDecayImmune, getDecayLevel } = require('./modules/frontmatter');
const { determinePhase, applyPhase1 } = require('./modules/phases');
const { DEFAULTS, DECAY_CONFIG_FILE } = require('./config/defaults');

// ─────────────────────────────────────────────────
// Caminho do vault: diretório pai do zelador/
// zelador/ fica dentro do vault, então o vault é um nível acima
// ─────────────────────────────────────────────────
const VAULT_PATH = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────
// Logger com timestamp ISO
// ─────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─────────────────────────────────────────────────
// Carrega configuração por pasta (decay.config.json)
// Implementação completa vem na Etapa 2
// Por ora, retorna apenas os defaults globais
// ─────────────────────────────────────────────────
function loadConfig() {
  const fs = require('fs');
  const configPath = path.join(VAULT_PATH, DECAY_CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return { global: DEFAULTS, folders: {} };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️  Erro ao ler decay.config.json: ${err.message}. Usando defaults.`);
    return { global: DEFAULTS, folders: {} };
  }
}

/**
 * Resolve a configuração efetiva para um arquivo,
 * percorrendo a hierarquia de pastas do mais específico ao mais geral.
 *
 * Exemplo: /fleeting/ideias/nota.md
 *   1. verifica config de /fleeting/ideias
 *   2. verifica config de /fleeting
 *   3. usa global
 *
 * @param {string} relativePath - ex: "/fleeting/ideias/nota.md"
 * @param {object} config - objeto completo do decay.config.json
 * @returns {object} config efetiva com phase1_days, phase2_days, phase3_days
 */
function resolveConfig(relativePath, config) {
  // Monta todos os prefixos de pasta em ordem do mais específico ao mais geral
  const segments = relativePath.split('/').slice(0, -1); // remove o nome do arquivo
  const prefixes = [];

  for (let i = segments.length; i > 0; i--) {
    prefixes.push(segments.slice(0, i).join('/') || '/');
  }

  for (const prefix of prefixes) {
    const folderConfig = config.folders && config.folders[prefix];
    if (folderConfig) {
      // decay_immune: true na pasta = tratar como imune
      if (folderConfig.decay_immune === true) {
        return { ...config.global, decay_immune: true };
      }
      // Mescla: config da pasta sobrescreve o global
      return { ...config.global, ...folderConfig };
    }
  }

  return { ...config.global };
}

// ─────────────────────────────────────────────────
// MAIN — Ponto de entrada
// ─────────────────────────────────────────────────
async function main() {
  log('🌊 Zelador iniciando...');
  log(`📁 Vault: ${VAULT_PATH}`);

  // 1. Registra handlers de saída e adquire lock
  registerExitHandlers();
  acquireLock();

  // 2. Carrega configuração
  const config = loadConfig();
  log(`⚙️  Configuração carregada. Pastas configuradas: ${Object.keys(config.folders || {}).length}`);

  // 3. Varre o vault
  log('🔍 Varrendo vault...');
  const files = await scanVault(VAULT_PATH);
  log(`📝 ${files.length} arquivo(s) .md encontrado(s) para avaliação.`);

  // Contadores para o relatório final
  const stats = { phase1: 0, skipped_immune: 0, skipped_already: 0, skipped_below_threshold: 0 };

  // 4. Processa cada arquivo
  for (const { filePath, inactivityMs } of files) {
    const relativePath = getRelativePath(VAULT_PATH, filePath);
    const noteTitle = getNoteTitle(filePath);

    // Lê frontmatter
    let frontmatterData;
    try {
      const parsed = readFrontmatter(filePath);
      frontmatterData = parsed.data;
    } catch (err) {
      log(`⚠️  Erro ao ler frontmatter de ${relativePath}: ${err.message}`);
      continue;
    }

    // ── Verificação de imunidade (ANTES do mtime) ──
    if (isDecayImmune(frontmatterData)) {
      stats.skipped_immune++;
      continue;
    }

    // ── Resolve config efetiva para esta pasta ──
    const effectiveConfig = resolveConfig(relativePath, config);

    // ── Imunidade por pasta no decay.config.json ──
    if (effectiveConfig.decay_immune === true) {
      stats.skipped_immune++;
      continue;
    }

    // ── Determina qual fase aplicar ──
    const phase = determinePhase(inactivityMs, effectiveConfig);

    if (phase === null) {
      stats.skipped_below_threshold++;
      continue;
    }

    const currentLevel = getDecayLevel(frontmatterData);

    // ── Aplica a fase correspondente ──
    try {
      if (phase === 1) {
        const applied = applyPhase1(filePath, frontmatterData);
        if (applied) stats.phase1++;
        else stats.skipped_already++;
      } else if (phase === 2) {
        if (currentLevel < 2) {
          // F2 ainda não implementada — loga e pula
          log(`⏳ [F2 pendente] ${noteTitle} — Etapa 3 necessária`);
        } else {
          stats.skipped_already++;
        }
      } else if (phase === 3) {
        if (currentLevel < 3) {
          // F3 ainda não implementada — loga e pula
          log(`⏳ [F3 pendente] ${noteTitle} — Etapa 4 necessária`);
        } else {
          stats.skipped_already++;
        }
      }
    } catch (err) {
      log(`❌ Erro ao processar ${relativePath}: ${err.message}`);
    }
  }

  // 5. Relatório final
  log('');
  log('─────────────────────────────────');
  log('📊 RELATÓRIO DE EXECUÇÃO');
  log(`   ✅ Fase 1 aplicada:       ${stats.phase1}`);
  log(`   🛡️  Imunes (puladas):      ${stats.skipped_immune}`);
  log(`   ↩️  Já processadas:        ${stats.skipped_already}`);
  log(`   💤 Abaixo do threshold:   ${stats.skipped_below_threshold}`);
  log('─────────────────────────────────');
  log('✅ Zelador finalizado.');
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] 💥 Erro fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

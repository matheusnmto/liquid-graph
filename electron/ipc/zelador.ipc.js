'use strict';

const { fork } = require('child_process');
const path = require('path');
const os = require('os');

// ─────────────────────────────────────────────────────────────────────────────
// zelador.ipc.js — Handlers IPC para operações do Zelador
//
// O Zelador é executado em processo filho separado (fork) para não bloquear
// a UI do Electron. Os logs são coletados e disponibilizados para o renderer.
// ─────────────────────────────────────────────────────────────────────────────

const ZELADOR_SCRIPT = path.join(__dirname, '..', '..', 'zelador', 'zelador.js');
const MAX_LOG_LINES = 500;

// Buffer de logs compartilhado
const logBuffer = [];
let activeProcess = null;

/**
* Adiciona uma linha ao buffer de logs, limitando ao tamanho máximo.
* @param {string} line
*/
function addLog(line) {
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }
}

/**
* Executa o zelador.js em processo filho separado.
* Coleta stdout/stderr no buffer de logs.
*
* @param {string} vaultPath - Caminho do vault (sobrescreve o padrão do zelador.js)
* @returns {Promise<void>} Resolve quando o processo termina com sucesso
*/
function runZeladorProcess(vaultPath) {
  return new Promise((resolve, reject) => {
    if (activeProcess) {
      const msg = '[zelador.ipc] Zelador já está em execução. Aguarde.';
      addLog(msg);
      return reject(new Error(msg));
    }

    addLog(`[${new Date().toISOString()}] Iniciando Zelador...`);

    const env = {
     ...process.env,
      ZELADOR_VAULT_OVERRIDE: vaultPath || '',
    };

    activeProcess = fork(ZELADOR_SCRIPT, [], {
      env,
      silent: true, // captura stdout/stderr via eventos
    });

    activeProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(addLog);
    });

    activeProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(l => addLog(`[ERR] ${l}`));
    });

    activeProcess.on('close', (code) => {
      activeProcess = null;
      if (code === 0) {
        addLog(`[${new Date().toISOString()}] Zelador finalizado com sucesso.`);
        resolve();
      } else {
        const msg = `[${new Date().toISOString()}] Zelador encerrou com código ${code}.`;
        addLog(msg);
        reject(new Error(msg));
      }
    });

    activeProcess.on('error', (err) => {
      activeProcess = null;
      const msg = `[zelador.ipc] Erro ao iniciar processo: ${err.message}`;
      addLog(msg);
      reject(new Error(msg));
    });
  });
}

/**
* Registra os handlers IPC do Zelador no ipcMain.
*
* @param {Electron.IpcMain} ipcMain
* @param {function} getStatusFn - Retorna { status, lastRunAt, nextRunAt }
* @param {function} runNowFn    - Dispara execução manual
*/
function register(ipcMain, getStatusFn, runNowFn) {
  ipcMain.handle('zelador:run-now', async () => {
    await runNowFn();
  });

  ipcMain.handle('zelador:get-status', () => {
    return getStatusFn();
  });

  ipcMain.handle('zelador:get-logs', () => {
    return [...logBuffer]; // cópia defensiva
  });

  ipcMain.handle('zelador:kill', () => {
    if (activeProcess) {
      activeProcess.kill('SIGTERM');
      activeProcess = null;
      addLog(`[${new Date().toISOString()}] � Zelador interrompido manualmente.`);
    }
  });
}

module.exports = { register, runZeladorProcess };

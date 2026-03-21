'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// aiProvider.js — Abstração multi-provider para chamadas de IA (BYOK)
//
// Suporta:
//   - Anthropic Claude Haiku  (@anthropic-ai/sdk)
//   - Google Gemini Flash      (@google/generative-ai)
//
// SEGURANÇA: As chaves de API NUNCA são logadas, nem parcialmente.
//            Sempre recebidas via parâmetro — jamais hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Erros customizados ──────────────────────────────────────────────────────

class InvalidKeyError extends Error {
  constructor(provider, detail = '') {
    super(`Chave de API inválida para ${provider}.${detail ? ' ' + detail : ''}`);
    this.name = 'InvalidKeyError';
    this.provider = provider;
  }
}

class RateLimitError extends Error {
  constructor(provider) {
    super(`Rate limit atingido para ${provider}. Nota será tentada novamente na próxima execução.`);
    this.name = 'RateLimitError';
    this.provider = provider;
  }
}

class ProviderUnavailableError extends Error {
  constructor(provider, detail = '') {
    super(`Provider ${provider} indisponível.${detail ? ' ' + detail : ''} Nota será processada na próxima execução.`);
    this.name = 'ProviderUnavailableError';
    this.provider = provider;
  }
}

class TimeoutError extends Error {
  constructor(provider) {
    super(`Timeout de 30s ao chamar ${provider}. Nota será processada na próxima execução.`);
    this.name = 'TimeoutError';
    this.provider = provider;
  }
}

// ─── Logger ──────────────────────────────────────────────────────────────────

function log(msg) {
  const t = new Date().toISOString().slice(11, 19); // HH:MM:SS
  console.log(`[${t}] [ai] ${msg}`);
}

// ─── Catálogo de providers ────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude Haiku',
    model: 'claude-haiku-4-5-20251001',
    costPer1kTokens: 0.00025, // $0.25 / 1M input tokens
  },
  {
    id: 'google',
    name: 'Google Gemini Flash',
    model: 'gemini-1.5-flash',
    costPer1kTokens: 0.000075, // $0.075 / 1M input tokens
  },
];

// ─── System prompt compartilhado ─────────────────────────────────────────────

const SYSTEM_PROMPT =
  'Você é um sistema de compressão de conhecimento efêmero. ' +
  'Resuma a nota em exatamente uma frase objetiva em português brasileiro, ' +
  'preservando a ideia central. ' +
  'Retorne APENAS a frase, sem prefixos, sem markdown.';

// ─── Timeout wrapper ─────────────────────────────────────────────────────────

/**
 * Envolve uma Promise com um timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} provider
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, provider) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new TimeoutError(provider)), ms)
  );
  return Promise.race([promise, timer]);
}

/**
 * Aguarda N milissegundos.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Implementação Anthropic ─────────────────────────────────────────────────

/**
 * Chama a API Anthropic com retry em caso de rate limit.
 * @param {string} content - Conteúdo completo da nota
 * @param {string} apiKey  - Chave Anthropic do usuário
 * @param {boolean} [isRetry=false]
 * @returns {Promise<string>} Resumo de uma frase
 */
async function callAnthropic(content, apiKey, isRetry = false) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
      30000,
      'anthropic'
    );

    const resumo = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    return resumo;

  } catch (err) {
    if (err instanceof TimeoutError) throw err;

    const status = err.status ?? err.statusCode ?? 0;

    // Autenticação inválida
    if (status === 401) {
      throw new InvalidKeyError('anthropic', 'Verifique sua chave em console.anthropic.com.');
    }

    // Rate limit — aguarda 60s e tenta uma vez
    if (status === 429) {
      if (isRetry) throw new RateLimitError('anthropic');
      log('Rate limit Anthropic. Aguardando 60s antes de nova tentativa...');
      await sleep(60000);
      return callAnthropic(content, apiKey, true);
    }

    // Erros 5xx = serviço indisponível
    if (status >= 500) {
      throw new ProviderUnavailableError('anthropic', `HTTP ${status}`);
    }

    // Outros erros inesperados
    throw new ProviderUnavailableError('anthropic', err.message);
  }
}

// ─── Implementação Google Gemini ─────────────────────────────────────────────

/**
 * Chama a API Google Gemini com retry em caso de rate limit.
 * @param {string} content - Conteúdo completo da nota
 * @param {string} apiKey  - Chave Google AI do usuário
 * @param {boolean} [isRetry=false]
 * @returns {Promise<string>} Resumo de uma frase
 */
async function callGoogle(content, apiKey, isRetry = false) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  try {
    const prompt = `${SYSTEM_PROMPT}\n\nNota:\n${content}`;

    const result = await withTimeout(
      model.generateContent(prompt),
      30000,
      'google'
    );

    const resumo = result.response.text().trim();
    return resumo;

  } catch (err) {
    if (err instanceof TimeoutError) throw err;

    const message = err.message || '';
    const status = err.status ?? err.statusCode ?? 0;

    // API key inválida
    if (
      status === 400 && message.includes('API_KEY') ||
      status === 403 ||
      message.toLowerCase().includes('api key not valid') ||
      message.toLowerCase().includes('invalid api key')
    ) {
      throw new InvalidKeyError('google', 'Verifique sua chave em aistudio.google.com.');
    }

    // Rate limit (429 ou RESOURCE_EXHAUSTED)
    if (status === 429 || message.includes('RESOURCE_EXHAUSTED')) {
      if (isRetry) throw new RateLimitError('google');
      log('Rate limit Google. Aguardando 60s antes de nova tentativa...');
      await sleep(60000);
      return callGoogle(content, apiKey, true);
    }

    // Serviço indisponível
    if (status >= 500 || message.includes('UNAVAILABLE') || message.includes('SERVICE_UNAVAILABLE')) {
      throw new ProviderUnavailableError('google', `HTTP ${status || message}`);
    }

    throw new ProviderUnavailableError('google', message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista os providers de IA disponíveis com metadados de custo e modelo.
 *
 * @returns {Array<{ id: string, name: string, model: string, costPer1kTokens: number }>}
 */
function listProviders() {
  return PROVIDERS.map(p => ({ ...p })); // cópia defensiva
}

/**
 * Valida uma chave de API fazendo uma chamada mínima ao provider.
 *
 * @param {'anthropic'|'google'} provider
 * @param {string} apiKey
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
async function validateKey(provider, apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return { valid: false, error: 'Chave não pode ser vazia.' };
  }

  const testContent = 'Teste de validação de chave.';

  try {
    if (provider === 'anthropic') {
      await callAnthropic(testContent, apiKey);
    } else if (provider === 'google') {
      await callGoogle(testContent, apiKey);
    } else {
      return { valid: false, error: `Provider desconhecido: ${provider}` };
    }
    log(`Chave ${provider} validada com sucesso.`);
    return { valid: true };
  } catch (err) {
    if (err instanceof InvalidKeyError) {
      return { valid: false, error: err.message };
    }
    // Rate limit ou indisponibilidade não significa chave inválida
    return { valid: true, error: `Aviso: ${err.message}` };
  }
}

/**
 * Comprime o conteúdo de uma nota em uma única frase usando o provider configurado.
 *
 * @param {string} content - Conteúdo completo da nota (sem frontmatter)
 * @param {{ provider: 'anthropic'|'google', apiKey: string }} providerConfig
 * @returns {Promise<string>} Resumo de uma frase em português
 * @throws {InvalidKeyError} Chave inválida
 * @throws {RateLimitError} Rate limit após retry
 * @throws {ProviderUnavailableError} Serviço indisponível
 * @throws {TimeoutError} Timeout de 30s
 */
async function compress(content, providerConfig) {
  const { provider, apiKey } = providerConfig;

  if (!provider || !apiKey) {
    throw new TypeError('compress: providerConfig deve conter { provider, apiKey }');
  }

  log(`Comprimindo nota via ${provider}...`);

  let resumo;
  if (provider === 'anthropic') {
    resumo = await callAnthropic(content, apiKey);
  } else if (provider === 'google') {
    resumo = await callGoogle(content, apiKey);
  } else {
    throw new ProviderUnavailableError(provider, 'Provider não reconhecido. Use "anthropic" ou "google".');
  }

  // Sanitiza: garante que seja uma string não-vazia
  if (!resumo || typeof resumo !== 'string' || resumo.trim() === '') {
    throw new ProviderUnavailableError(provider, 'Resposta vazia — provider retornou conteúdo inválido.');
  }

  log(`Compressão concluída (${resumo.length} chars).`);
  return resumo.trim();
}

module.exports = {
  compress,
  validateKey,
  listProviders,
  // Erros exportados para que o chamador possa fazer instanceof
  InvalidKeyError,
  RateLimitError,
  ProviderUnavailableError,
  TimeoutError,
};

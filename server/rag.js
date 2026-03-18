const db = require('./db');

const OPENAI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';

function safeParseEmbedding(x) {
  if (!x) return null;
  try {
    const arr = typeof x === 'string' ? JSON.parse(x) : x;
    if (!Array.isArray(arr) || arr.length < 8) return null;
    return arr.map(n => Number(n)).filter(n => Number.isFinite(n));
  } catch (_) {
    return null;
  }
}

function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedText(text) {
  if (!OPENAI_API_KEY) return null;
  const input = String(text || '').trim().slice(0, 2000);
  if (!input) return null;
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const emb = data.data?.[0]?.embedding;
    return safeParseEmbedding(emb);
  } catch (_) {
    return null;
  }
}

/**
 * 检索某 persona 的相似历史片段
 * @param {string} personaName - persona 英文名（如 Cheng）
 * @param {string} queryText - 当前要回复的语境（一般是最近群聊/最后一句真人话）
 * @param {object} options
 * @param {number} options.k - 返回条数（默认 8）
 * @param {number} options.candidateLimit - 参与相似度计算的候选数（默认 1500）
 */
async function retrieveSimilarHistory(personaName, queryText, options = {}) {
  const name = String(personaName || '').trim();
  if (!name) return [];
  const k = Math.max(1, Math.min(10, Number(options.k) || 8));
  const candidateLimit = Math.max(50, Math.min(5000, Number(options.candidateLimit) || 1500));
  const qEmb = await embedText(queryText);
  if (!qEmb) return [];

  const candidates = db.personaVectorsLoadByPersona(name, candidateLimit);
  if (!candidates.length) return [];

  const scored = [];
  for (const c of candidates) {
    const emb = safeParseEmbedding(c.embedding);
    if (!emb) continue;
    const s = cosineSimilarity(qEmb, emb);
    if (s <= 0) continue;
    scored.push({ ...c, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports = {
  embedText,
  retrieveSimilarHistory,
  safeParseEmbedding
};


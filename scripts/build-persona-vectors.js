/**
 * 为每个群友构建独立（按 persona_name 过滤）的向量库，用于 RAG 检索相似历史。
 *
 * 用法：
 * 1) 配置 AI_API_KEY（同 OPENAI_API_KEY 兼容）与可选 AI_BASE_URL
 * 2) node scripts/build-persona-vectors.js
 *
 * 默认从 chat_history + collected_chat 两个表导入（原始导入 + 用户自主输入，不含 AI 代发言）。
 * 如需也把「群聊里真人消息」纳入，可设置 INCLUDE_MESSAGES=1（仅 is_human=1，不含 AI）。
 */
require('dotenv').config();

const db = require('../server/db');
const { embedText } = require('../server/rag');
const { filterAndNormalizeLearningMessages } = require('../server/personas');

function rowsWithNormalizedSenders(rawRows) {
  return rawRows.flatMap((r) => {
    const n = filterAndNormalizeLearningMessages([{ sender: r.sender, text: r.text, time: r.time }]);
    return n.length ? [{ id: r.id, sender: n[0].sender, text: n[0].text, time: n[0].time }] : [];
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normText(t) {
  const s = String(t || '').trim().replace(/\s+/g, ' ');
  return s.slice(0, 2000);
}

function buildDialogueDoc(rows, i, personaName, windowBefore = 2) {
  const cur = rows[i];
  if (!cur) return '';
  const parts = [];
  const start = Math.max(0, i - windowBefore);
  for (let j = start; j < i; j++) {
    const r = rows[j];
    const sender = String(r.sender || '').trim();
    const text = normText(r.text);
    if (!sender || !text) continue;
    parts.push(`${sender}: ${text}`);
  }
  const selfText = normText(cur.text);
  if (!selfText) return '';
  parts.push(`${personaName}: ${selfText}`);
  return parts.join('\n').slice(0, 2000);
}

async function buildFromRows(rows, source, getPersonaName) {
  let nOk = 0;
  let nSkip = 0;
  const batch = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const personaName = getPersonaName(r);
    const text = buildDialogueDoc(rows, i, personaName, 2) || normText(r.text);
    if (!personaName || !text || text.length < 2) {
      nSkip++;
      continue;
    }
    const emb = await embedText(text);
    if (!emb) {
      nSkip++;
      continue;
    }
    batch.push({
      personaName,
      source,
      sourceId: r.id,
      text,
      time: r.time || null,
      embedding: emb,
      updatedAt: new Date().toISOString()
    });
    nOk++;

    if (batch.length >= 50) {
      db.personaVectorsUpsertMany(batch.splice(0, batch.length));
      await sleep(120); // 简单限速，避免打爆 embedding 接口
      process.stdout.write(`\r${source}: 已写入 ${nOk} 条，跳过 ${nSkip} 条...`);
    }
  }

  if (batch.length) {
    db.personaVectorsUpsertMany(batch);
  }
  process.stdout.write(`\r${source}: 已写入 ${nOk} 条，跳过 ${nSkip} 条。           \n`);
  return { ok: nOk, skip: nSkip };
}

async function main() {
  db.initDb();

  console.log('开始构建 persona_vectors（RAG 向量库）...');

  // chat_history：导入的原始聊天记录（sender 规范为成员英文名）
  {
    const raw = db.getDb().prepare('SELECT id, sender, text, time FROM chat_history ORDER BY id').all();
    const rows = rowsWithNormalizedSenders(raw);
    await buildFromRows(rows, 'chat_history', (r) => String(r.sender || '').trim());
  }

  // collected_chat：采集语气 + 群聊真人发言（不含 AI）
  {
    const raw = db.getDb().prepare('SELECT id, sender, text, time FROM collected_chat ORDER BY id').all();
    const rows = rowsWithNormalizedSenders(raw);
    await buildFromRows(rows, 'collected_chat', (r) => String(r.sender || '').trim());
  }

  if (process.env.INCLUDE_MESSAGES === '1') {
    const { getMemberById } = require('../server/members');
    const raw = db.messagesGetHumanOnlyOrdered();
    const rows = raw.map((r) => {
      const m = getMemberById(String(r.memberId || '').trim());
      return { id: r.id, sender: (m && m.name) ? m.name : '', text: r.text, time: r.time };
    }).filter((r) => r.sender);
    await buildFromRows(rows, 'messages', (r) => String(r.sender || '').trim());
  }

  console.log('完成。你可以在运行时使用 RAG 检索相似历史片段。');
}

main().catch(e => {
  console.error('构建向量库失败：', e && e.message ? e.message : e);
  process.exit(1);
});


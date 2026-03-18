/**
 * 为每个群友构建独立（按 persona_name 过滤）的向量库，用于 RAG 检索相似历史。
 *
 * 用法：
 * 1) 配置 AI_API_KEY（同 OPENAI_API_KEY 兼容）与可选 AI_BASE_URL
 * 2) node scripts/build-persona-vectors.js
 *
 * 默认从 chat_history + collected_chat 两个表导入（更贴近“真实群聊语料”）。
 * 如需也把实时 messages 纳入，可设置 INCLUDE_MESSAGES=1
 */
require('dotenv').config();

const db = require('../server/db');
const { embedText } = require('../server/rag');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normText(t) {
  const s = String(t || '').trim().replace(/\s+/g, ' ');
  return s.slice(0, 2000);
}

async function buildFromRows(rows, source, getPersonaName) {
  let nOk = 0;
  let nSkip = 0;
  const batch = [];

  for (const r of rows) {
    const personaName = getPersonaName(r);
    const text = normText(r.text);
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

  // chat_history: sender 就是 persona 英文名（如 Cheng）
  {
    const rows = db.getDb().prepare('SELECT id, sender, text, time FROM chat_history ORDER BY id').all();
    await buildFromRows(rows, 'chat_history', (r) => String(r.sender || '').trim());
  }

  // collected_chat: sender 就是 persona 英文名（如 Cheng）
  {
    const rows = db.getDb().prepare('SELECT id, sender, text, time FROM collected_chat ORDER BY id').all();
    await buildFromRows(rows, 'collected_chat', (r) => String(r.sender || '').trim());
  }

  if (process.env.INCLUDE_MESSAGES === '1') {
    // messages: member_id 是 member_x，需要映射到英文名
    const { getMemberById } = require('../server/members');
    const rows = db.getDb().prepare('SELECT id, member_id AS memberId, text, time FROM messages ORDER BY id').all();
    await buildFromRows(rows, 'messages', (r) => {
      const m = getMemberById(String(r.memberId || '').trim());
      return m && m.name ? m.name : '';
    });
  }

  console.log('完成。你可以在运行时使用 RAG 检索相似历史片段。');
}

main().catch(e => {
  console.error('构建向量库失败：', e && e.message ? e.message : e);
  process.exit(1);
});


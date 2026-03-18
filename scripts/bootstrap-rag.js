/**
 * 一次性初始化（可重复运行但会自动跳过）：
 * - 构建每个角色的向量库 persona_vectors（RAG）
 * - 构建每个角色的 personaSummary（可选但建议）
 *
 * 设计目标：适合 Render 这种平台把它放进 Start Command：
 *   node scripts/bootstrap-rag.js && node server/index.js
 *
 * 行为：
 * - 若 persona_vectors 表已有数据，则默认认为已初始化，直接跳过（避免重复付费 embedding）
 * - 若设置 FORCE_RAG_BOOTSTRAP=1，则强制重新跑（仍是 upsert，但 embedding 会重新请求）
 */
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (_) {}

const { spawnSync } = require('child_process');
const db = require('../server/db');

function runNodeScript(scriptPath, extraEnv = {}) {
  const res = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
  if (res.status !== 0) {
    throw new Error(`脚本执行失败：${scriptPath}（exit ${res.status}）`);
  }
}

function hasAnyVectors() {
  try {
    const row = db.getDb().prepare('SELECT COUNT(*) AS n FROM persona_vectors').get();
    return row && row.n && row.n > 0;
  } catch (_) {
    return false;
  }
}

async function main() {
  db.initDb();

  const force = process.env.FORCE_RAG_BOOTSTRAP === '1';
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('未设置 AI_API_KEY，跳过 RAG/persona 初始化。');
    return;
  }

  if (!force && hasAnyVectors()) {
    console.log('检测到 persona_vectors 已有数据，跳过初始化（如需重建请设置 FORCE_RAG_BOOTSTRAP=1）。');
    return;
  }

  console.log('开始初始化 RAG 向量库（persona_vectors）...');
  runNodeScript(require('path').join(__dirname, 'build-persona-vectors.js'), {
    // 默认也把实时 messages 纳入向量库（可在 Render 上更贴近“现在的群聊”）
    INCLUDE_MESSAGES: process.env.INCLUDE_MESSAGES || '1'
  });

  console.log('开始生成 personaSummary（每人约 1 次 API 调用）...');
  runNodeScript(require('path').join(__dirname, 'build-persona-summaries.js'));

  console.log('初始化完成。');
}

main().catch(e => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});


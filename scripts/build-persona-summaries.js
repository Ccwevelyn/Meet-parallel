#!/usr/bin/env node
/**
 * 人设总结训练：用大模型根据每人全部发言样本，提炼性格与说话风格，写入 personaSummary
 * 生成后，群聊 AI 会优先依据该总结发言，减少复读、更贴合人设。运行时间较长（每人一次 API 调用）。
 * 用法：node scripts/build-persona-summaries.js  或  node -r dotenv/config scripts/build-persona-summaries.js
 * 需配置 AI_API_KEY（及可选 AI_BASE_URL、AI_MODEL），可写在项目根目录 .env 中
 */
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (_) {}
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');
const personas = require(path.join(PROJECT_ROOT, 'server', 'personas.js'));
const { getAllMembers } = require(path.join(PROJECT_ROOT, 'server', 'members.js'));

const { generatePersonaSummary } = require(path.join(PROJECT_ROOT, 'server', 'persona-summary.js'));

async function main() {
  const memberNames = new Set(getAllMembers().map(m => m.name));
  const all = personas.loadPersonas();
  const toTrain = Object.entries(all).filter(([name, p]) => memberNames.has(name) && p.sampleMessages && p.sampleMessages.length > 0);
  if (!toTrain.length) {
    console.log('没有需要训练的人设（需先运行 learn-from-csv 或采集语气）');
    return;
  }
  const OPENAI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.log('请设置 AI_API_KEY 后重试');
    process.exit(1);
  }
  console.log('开始为人设生成详细角色总结（多而详细，每人约 1 次 API 调用），共', toTrain.length, '人');
  for (const [name, p] of toTrain) {
    const displayName = getAllMembers().find(m => m.name === name)?.displayName || name;
    process.stdout.write(displayName + ' ... ');
    const summary = await generatePersonaSummary(displayName, name, p.sampleMessages || [], p.replyHabits || '', p.replyToWhom || {});
    if (summary) {
      p.personaSummary = summary;
      p.updatedAt = new Date().toISOString();
      all[name] = p;
      console.log('已写入');
    } else {
      console.log('跳过');
    }
  }
  personas.savePersonas(all);
  console.log('人设总结训练完成，已保存到数据库');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

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

const OPENAI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

const MAX_SAMPLES_FOR_SUMMARY = 150;
const SUMMARY_MAX_TOKENS = 350;

async function summarizePersona(displayName, name, samples) {
  if (!OPENAI_API_KEY) {
    console.warn('未设置 AI_API_KEY，跳过调用');
    return null;
  }
  const text = samples.slice(-MAX_SAMPLES_FOR_SUMMARY).join('\n');
  const system = '你是一个人设分析助手。根据该人在群聊中的真实发言，总结其性格、说话习惯、常用词、口头禅、语气（150–300 字）。不要列举原句，只输出总结段落，便于后续 AI 以该身份对话时参考。';
  const user = `群昵称：${displayName}（英文名 ${name}）。\n\n其真实发言样本：\n${text}\n\n请输出上述总结（只输出总结，不要其他）。`;

  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_tokens: SUMMARY_MAX_TOKENS,
        temperature: 0.3
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('LLM 请求失败', res.status, err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    return summary ? summary.slice(0, 2000) : null;
  } catch (e) {
    console.warn('LLM 调用失败', e.message);
    return null;
  }
}

async function main() {
  const memberNames = new Set(getAllMembers().map(m => m.name));
  const all = personas.loadPersonas();
  const toTrain = Object.entries(all).filter(([name, p]) => memberNames.has(name) && p.sampleMessages && p.sampleMessages.length > 0);
  if (!toTrain.length) {
    console.log('没有需要训练的人设（需先运行 learn-from-csv 或采集语气）');
    return;
  }
  if (!OPENAI_API_KEY) {
    console.log('请设置 AI_API_KEY 后重试');
    process.exit(1);
  }
  console.log('开始为人设生成性格总结（每人约 1 次 API 调用），共', toTrain.length, '人');
  for (const [name, p] of toTrain) {
    const displayName = getAllMembers().find(m => m.name === name)?.displayName || name;
    process.stdout.write(displayName + ' ... ');
    const summary = await summarizePersona(displayName, name, p.sampleMessages || []);
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

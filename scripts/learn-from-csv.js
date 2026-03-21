#!/usr/bin/env node
/**
 * 从群聊 CSV（成员,时间,内容）学习各人物：语气样本、活跃时段、回复习惯
 * 用法：node scripts/learn-from-csv.js [CSV路径]
 * 默认 CSV：项目根目录下 CS小分队_聊群记录.csv
 * 会写入 data/chat-history.json、data/personas.json（与现有人设合并）
 */
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_CSV = path.join(PROJECT_ROOT, 'CS小分队_聊群记录.csv');

// 从项目根加载 server 模块（保证 DATA_DIR 一致）
const dataPath = require(path.join(PROJECT_ROOT, 'server', 'data-path.js'));
const db = require(path.join(PROJECT_ROOT, 'server', 'db.js'));
const personas = require(path.join(PROJECT_ROOT, 'server', 'personas.js'));
const { getAllMembers, normalizeSenderToMemberName } = require(path.join(PROJECT_ROOT, 'server', 'members.js'));

const SAMPLE_SIZE = 0; // 0 = 取该成员全部消息作为语气样本
const REPLY_WINDOW_MS = 2 * 60 * 1000; // 2 分钟内接上一条他人消息视为「回复」

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  const skipHeader = /成员|用户|user|time|时间|内容|语句|text|message/.test(header);
  const start = skipHeader ? 1 : 0;
  const messages = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const parts = [];
    let inQuote = false;
    let cur = '';
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') inQuote = !inQuote;
      else if ((c === ',' && !inQuote) || (c === '，' && !inQuote)) {
        parts.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    parts.push(cur.trim());
    const member = (parts[0] || '').trim();
    const timeStr = (parts[1] || '').trim();
    const text = parts.slice(2).join(',').trim();
    if (!member || !text) continue;
    let time = timeStr;
    if (timeStr && /^\d{4}-\d{2}-\d{2}[\sT]\d{1,2}:\d{2}(:\d{2})?/.test(timeStr)) {
      const normalized = timeStr.replace(/\s+/, 'T');
      const d = new Date(normalized.includes('+') || normalized.endsWith('Z') ? normalized : normalized + '+08:00');
      if (!isNaN(d.getTime())) time = d.toISOString();
    }
    messages.push({ sender: member, time, text });
  }
  return messages;
}

function computeReplyRates(messages) {
  const sorted = messages.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const bySender = {};
  for (const m of sorted) {
    const name = (m.sender || '').trim();
    if (!name) continue;
    if (!bySender[name]) bySender[name] = { total: 0, replies: 0 };
    bySender[name].total += 1;
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevT = new Date(prev.time).getTime();
    const curT = new Date(cur.time).getTime();
    if (isNaN(prevT) || isNaN(curT)) continue;
    if (cur.sender !== prev.sender && (curT - prevT) <= REPLY_WINDOW_MS) {
      const name = (cur.sender || '').trim();
      if (bySender[name]) bySender[name].replies += 1;
    }
  }
  const rates = {};
  for (const [name, data] of Object.entries(bySender)) {
    rates[name] = data.total > 0 ? data.replies / data.total : 0;
  }
  return rates;
}

/** 统计谁经常回复谁：replyToWhom[回复人][被回复人] = 次数 */
function computeReplyToWhom(messages) {
  const sorted = messages.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const replyToWhom = {};
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevT = new Date(prev.time).getTime();
    const curT = new Date(cur.time).getTime();
    if (isNaN(prevT) || isNaN(curT)) continue;
    if (cur.sender !== prev.sender && (curT - prevT) <= REPLY_WINDOW_MS) {
      const replier = (cur.sender || '').trim();
      const toWhom = (prev.sender || '').trim();
      if (!replier || !toWhom) continue;
      if (!replyToWhom[replier]) replyToWhom[replier] = {};
      replyToWhom[replier][toWhom] = (replyToWhom[replier][toWhom] || 0) + 1;
    }
  }
  return replyToWhom;
}

function replyHabitsSummary(replyRate) {
  if (replyRate >= 0.45) return '经常在他人发言后回复，参与接话较多。';
  if (replyRate >= 0.25) return '有时会回复他人消息，也会独立发言。';
  if (replyRate >= 0.1) return '较少接话，多独立发言。';
  return '多独立发言，较少回复他人。';
}

function main() {
  const dataDir = dataPath.getDataDir();
  console.log('数据将写入（与服务器同一目录，持久化取决于该路径是否在持久化磁盘上）:', dataDir);
  if (process.env.DATA_DIR) console.log('已设置 DATA_DIR，写入即持久保留（如 Render 挂载盘）');

  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error('CSV 文件不存在:', csvPath);
    process.exit(1);
  }
  console.log('读取 CSV:', csvPath);
  console.log('开始学习人设：解析消息 → 统计活跃时段与回复习惯 → 写入人设');
  const messages = parseCSV(csvPath);
  const memberNames = new Set(getAllMembers().map(m => m.name));
  for (const m of messages) {
    const canon = normalizeSenderToMemberName(m.sender) || (memberNames.has(String(m.sender || '').trim()) ? String(m.sender).trim() : null);
    if (canon) m.sender = canon;
  }
  console.log('解析到消息数:', messages.length);
  if (!messages.length) {
    console.error('没有有效消息，请检查 CSV 格式（成员,时间,内容）');
    process.exit(1);
  }

  const replyRates = computeReplyRates(messages);
  const replyToWhom = computeReplyToWhom(messages);
  const replyDelays = personas.computeReplyDelays(messages);
  const messageShares = personas.computeMessageShares(messages);
  const built = personas.buildPersonas(messages, { sampleSize: SAMPLE_SIZE });

  for (const [name, p] of Object.entries(built)) {
    p.replyHabits = (p.replyHabits && p.replyHabits.trim()) || replyHabitsSummary(replyRates[name] || 0);
    p.replyRate = replyRates[name] != null ? replyRates[name] : 0;
    p.replyToWhom = replyToWhom[name] || {};
    p.averageReplyDelayMs = replyDelays[name] != null ? replyDelays[name] : null;
    p.messageShare = messageShares[name] != null ? messageShares[name] : null;
    if (!p.activeHours || !p.activeHours.length) p.activeHours = [];
  }

  const existing = personas.loadPersonas();
  const merged = { ...existing };
  for (const [name, p] of Object.entries(built)) {
    if (!memberNames.has(name)) continue;
    merged[name] = {
      ...(merged[name] || {}),
      name: p.name,
      messageCount: p.messageCount,
      sampleMessages: p.sampleMessages,
      activeHours: p.activeHours,
      replyHabits: p.replyHabits,
      replyRate: p.replyRate,
      replyToWhom: p.replyToWhom || {},
      averageReplyDelayMs: p.averageReplyDelayMs,
      messageShare: p.messageShare,
      personaSummary: (existing[name] && existing[name].personaSummary) || '',
      updatedAt: new Date().toISOString()
    };
    if (merged[name].replyHabits === undefined) merged[name].replyHabits = p.replyHabits;
  }

  db.chatHistorySave(messages.map(m => ({ sender: m.sender, text: m.text, time: m.time })));
  console.log('已写入数据库 chat_history（与 personas 同库，持久化）');

  personas.savePersonas(merged);
  const kept = Object.keys(built).filter(n => memberNames.has(n));
  console.log('已合并人设:', kept.length, '人（仅 members 中成员）');
  console.log('数据目录:', dataPath.getDataDir());
  const unknown = Object.keys(built).filter(n => !memberNames.has(n));
  if (unknown.length) console.log('CSV 中未在 members 的昵称（已忽略）:', unknown.join(', '));
}

main();

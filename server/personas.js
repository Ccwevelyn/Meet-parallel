const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHAT_FILE = path.join(DATA_DIR, 'chat-history.json');
const PERSONAS_FILE = path.join(DATA_DIR, 'personas.json');
const COLLECTED_FILE = path.join(DATA_DIR, 'collected-chat.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 读取已导入的聊天记录（可与采集对话合并做人设）
 */
function loadChatHistory() {
  try {
    if (fs.existsSync(CHAT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
      return data.messages || [];
    }
  } catch (e) {
    console.warn('读取 chat-history.json 失败', e.message);
  }
  return [];
}

/**
 * 按发送人分组，并计算每人发言时段分布、最近 N 条作为样本
 */
function buildPersonas(messages, options = {}) {
  const { sampleSize = 50 } = options;
  const bySender = {};
  for (const m of messages) {
    const name = (m.sender || '').trim();
    if (!name) continue;
    if (!bySender[name]) bySender[name] = { messages: [], hours: {} };
    bySender[name].messages.push({ text: m.text, time: m.time });
    if (m.time) {
      try {
        const h = new Date(m.time).getUTCHours();
        const key = (h + 8) % 24;
        bySender[name].hours[key] = (bySender[name].hours[key] || 0) + 1;
      } catch (_) {}
    }
  }

  const personas = {};
  for (const [name, data] of Object.entries(bySender)) {
    const sorted = data.messages.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const samples = sorted.slice(-sampleSize).map(m => m.text).filter(Boolean);
    const hourCounts = data.hours;
    const total = Object.values(hourCounts).reduce((a, b) => a + b, 0);
    const activeHours = total > 0
      ? Object.entries(hourCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([h]) => parseInt(h, 10))
      : [];

    personas[name] = {
      name,
      messageCount: data.messages.length,
      sampleMessages: samples,
      activeHours,
      updatedAt: new Date().toISOString()
    };
  }

  return personas;
}

/**
 * 保存人设并写入 data/personas.json
 */
function savePersonas(personas) {
  ensureDataDir();
  fs.writeFileSync(PERSONAS_FILE, JSON.stringify(personas, null, 2), 'utf8');
  return Object.keys(personas).length;
}

/**
 * 读取已训练的人设
 */
function loadPersonas() {
  try {
    if (fs.existsSync(PERSONAS_FILE)) {
      return JSON.parse(fs.readFileSync(PERSONAS_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('读取 personas.json 失败', e.message);
  }
  return {};
}

/**
 * 读取「和 AI 对话采集」保存的用户消息（用于与人设合并）
 * 格式：{ messages: [ { sender (成员 name), text, time } ] }
 */
function loadCollectedChat() {
  try {
    if (fs.existsSync(COLLECTED_FILE)) {
      const data = JSON.parse(fs.readFileSync(COLLECTED_FILE, 'utf8'));
      const list = data.messages || data.entries || [];
      return Array.isArray(list) ? list : [];
    }
  } catch (e) {
    console.warn('读取 collected-chat.json 失败', e.message);
  }
  return [];
}

/**
 * 追加一条采集到的用户消息
 */
function appendCollectedMessage(entry) {
  ensureDataDir();
  const list = loadCollectedChat();
  list.push(entry);
  fs.writeFileSync(COLLECTED_FILE, JSON.stringify({ messages: list, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

/**
 * 合并「导入的聊天记录」+「采集对话」，重新生成人设
 */
function mergeCollectedIntoPersonas(options = {}) {
  const history = loadChatHistory();
  const collected = loadCollectedChat();
  const merged = history.concat(collected);
  const personas = buildPersonas(merged, { sampleSize: options.sampleSize || 80 });
  savePersonas(personas);
  return Object.keys(personas).length;
}

/**
 * 管理员微调：更新某人设的 activeHours、sampleMessages 等
 */
function updatePersona(name, patch) {
  const personas = loadPersonas();
  if (!personas[name]) {
    personas[name] = { name, messageCount: 0, sampleMessages: [], activeHours: [], replyHabits: '', updatedAt: new Date().toISOString() };
  }
  if (Array.isArray(patch.activeHours)) {
    personas[name].activeHours = patch.activeHours.filter(h => Number.isInteger(h) && h >= 0 && h <= 23);
  }
  if (Array.isArray(patch.sampleMessages)) {
    personas[name].sampleMessages = patch.sampleMessages.filter(t => typeof t === 'string').slice(0, 200);
  }
  if (patch.replyHabits !== undefined) {
    personas[name].replyHabits = String(patch.replyHabits).trim().slice(0, 500);
  }
  if (patch.messageCount != null && Number.isInteger(patch.messageCount)) {
    personas[name].messageCount = Math.max(0, patch.messageCount);
  }
  personas[name].updatedAt = new Date().toISOString();
  savePersonas(personas);
  return personas[name];
}

module.exports = {
  loadChatHistory,
  buildPersonas,
  savePersonas,
  loadPersonas,
  updatePersona,
  loadCollectedChat,
  appendCollectedMessage,
  mergeCollectedIntoPersonas,
  DATA_DIR
};

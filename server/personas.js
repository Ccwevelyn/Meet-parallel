const { getMemberById } = require('./members');
const db = require('./db');

/**
 * 读取已导入的聊天记录（可与采集对话合并做人设）
 */
function loadChatHistory() {
  return db.chatHistoryLoad();
}

/**
 * 按发送人分组，并计算每人发言时段分布、取 N 条作为样本（sampleSize 为 0 时取全部）
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
    const take = sampleSize > 0 ? sorted.slice(-sampleSize) : sorted;
    const samples = take.map(m => m.text).filter(Boolean);
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

function savePersonas(personas) {
  db.personasSaveAll(personas);
  return Object.keys(personas).length;
}

function loadPersonas() {
  return db.personasLoadAll();
}

function loadCollectedChat() {
  return db.collectedChatLoad();
}

function appendCollectedMessage(entry) {
  db.collectedChatAppend(entry);
}

function mergeCollectedIntoPersonas(options = {}) {
  const history = loadChatHistory();
  const collected = loadCollectedChat();
  const merged = history.concat(collected);
  const personas = buildPersonas(merged, { sampleSize: options.sampleSize || 80 });
  savePersonas(personas);
  return Object.keys(personas).length;
}

const MAX_SAMPLE_MESSAGES = 200;

function appendChatMessageToPersona(memberId, text, time) {
  if (!memberId || memberId === 'admin' || !text || typeof text !== 'string') return;
  const member = getMemberById(memberId);
  if (!member || !member.name) return;
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return;
  const isoTime = time || new Date().toISOString();
  try {
    appendCollectedMessage({ sender: member.name, text: trimmed, time: isoTime });
    const personas = loadPersonas();
    if (!personas[member.name]) {
      personas[member.name] = { name: member.name, messageCount: 0, sampleMessages: [], activeHours: [], replyHabits: '', updatedAt: new Date().toISOString() };
    }
    const list = personas[member.name].sampleMessages || [];
    list.push(trimmed);
    personas[member.name].sampleMessages = list.slice(-MAX_SAMPLE_MESSAGES);
    personas[member.name].messageCount = (personas[member.name].messageCount || 0) + 1;
    personas[member.name].updatedAt = new Date().toISOString();
    savePersonas(personas);
  } catch (e) {
    console.warn('追加群聊发言到人设失败', e.message);
  }
}

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
  appendChatMessageToPersona,
  mergeCollectedIntoPersonas,
  chatHistorySave: db.chatHistorySave
};

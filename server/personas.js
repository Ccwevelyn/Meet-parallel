const { getMemberById, getAllMembers, normalizeSenderToMemberName } = require('./members');
const db = require('./db');

const REPLY_WINDOW_MS = 2 * 60 * 1000;

/**
 * 读取已导入的聊天记录（可与采集对话合并做人设）
 */
function loadChatHistory() {
  return db.chatHistoryLoad();
}

/** 从消息列表统计每人「在他人发言后 2 分钟内接话」的比例 */
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

/** 每人「回复他人时」的平均延迟（毫秒），用于模拟回复快慢 */
function computeReplyDelays(messages) {
  const sorted = messages.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const delaysBySender = {};
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.sender === prev.sender) continue;
    const prevT = new Date(prev.time).getTime();
    const curT = new Date(cur.time).getTime();
    if (isNaN(prevT) || isNaN(curT)) continue;
    const delay = curT - prevT;
    if (delay < 0 || delay > 24 * 60 * 60 * 1000) continue;
    const name = (cur.sender || '').trim();
    if (!name) continue;
    if (!delaysBySender[name]) delaysBySender[name] = [];
    delaysBySender[name].push(delay);
  }
  const out = {};
  for (const [name, arr] of Object.entries(delaysBySender)) {
    if (arr.length < 1) continue;
    out[name] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  return out;
}

/** 每人消息数占比（0~1），用于模拟「不爱说话」vs「话多」 */
function computeMessageShares(messages) {
  const total = messages.length;
  if (total === 0) return {};
  const bySender = {};
  for (const m of messages) {
    const name = (m.sender || '').trim();
    if (!name) continue;
    bySender[name] = (bySender[name] || 0) + 1;
  }
  const out = {};
  for (const [name, count] of Object.entries(bySender)) {
    out[name] = Math.round((count / total) * 1000) / 1000;
  }
  return out;
}

/**
 * 按发送人分组，并计算每人发言时段分布、取 N 条作为样本（sampleSize 为 0 时取全部，不设上限）
 */
function buildPersonas(messages, options = {}) {
  const { sampleSize = 0 } = options;
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

/** 人设学习用：只保留 roster 内成员，sender 统一为英文名（与导入 CSV、用户输入对齐） */
function filterAndNormalizeLearningMessages(list) {
  const allowed = new Set(getAllMembers().map(m => m.name));
  const out = [];
  for (const m of list) {
    const canon = normalizeSenderToMemberName(m.sender || '') || (allowed.has(String(m.sender || '').trim()) ? String(m.sender).trim() : null);
    if (!canon || !allowed.has(canon)) continue;
    out.push({ sender: canon, text: m.text, time: m.time });
  }
  return out;
}

function appendCollectedMessage(entry) {
  db.collectedChatAppend(entry);
}

/**
 * 合并「导入的聊天记录」+「采集对话」+「群聊里真人发言」为人设；
 * 仅使用：① 原始导入（chat_history，如 CSV）② 用户自主输入（采集语气里用户打的字、群聊里真人登录后发的话，均写入 collected_chat）。
 * 不包含 AI 在群聊里代发的内容（messages 表里 is_human=0 从不写入此处）。
 * sender 会规范为成员英文名，无法识别为 roster 内成员的条目丢弃，避免杂名污染样本。
 */
function mergeCollectedIntoPersonas(options = {}) {
  const history = loadChatHistory();
  const collected = loadCollectedChat();
  const merged = filterAndNormalizeLearningMessages(history.concat(collected));
  const built = buildPersonas(merged, { sampleSize: options.sampleSize ?? 0 });
  const rates = computeReplyRates(merged);
  const toWhom = computeReplyToWhom(merged);
  const delays = computeReplyDelays(merged);
  const shares = computeMessageShares(merged);
  const existing = loadPersonas();
  const result = { ...existing };
  for (const name of Object.keys(built)) {
    result[name] = {
      ...built[name],
      replyHabits: replyHabitsSummary(rates[name] ?? 0),
      replyRate: rates[name] ?? 0,
      replyToWhom: toWhom[name] || {},
      averageReplyDelayMs: delays[name] != null ? delays[name] : null,
      messageShare: shares[name] != null ? shares[name] : null,
      personaSummary: (existing[name] && existing[name].personaSummary) || '',
      updatedAt: new Date().toISOString()
    };
  }
  savePersonas(result);
  return Object.keys(result).length;
}

/** 仅真人登录后在群聊发送时调用；写入 collected_chat 并追加 sampleMessages。AI 代发言不会走此函数。 */
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
      personas[member.name] = { name: member.name, messageCount: 0, sampleMessages: [], activeHours: [], replyHabits: '', replyToWhom: {}, replyRate: 0, averageReplyDelayMs: null, messageShare: null, personaSummary: '', updatedAt: new Date().toISOString() };
    }
    const list = personas[member.name].sampleMessages || [];
    list.push(trimmed);
    personas[member.name].sampleMessages = list;
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
    personas[name] = { name, messageCount: 0, sampleMessages: [], activeHours: [], replyHabits: '', replyToWhom: {}, replyRate: 0, averageReplyDelayMs: null, messageShare: null, personaSummary: '', updatedAt: new Date().toISOString() };
  }
  if (Array.isArray(patch.activeHours)) {
    personas[name].activeHours = patch.activeHours.filter(h => Number.isInteger(h) && h >= 0 && h <= 23);
  }
  if (Array.isArray(patch.sampleMessages)) {
    personas[name].sampleMessages = patch.sampleMessages.filter(t => typeof t === 'string');
  }
  if (patch.replyHabits !== undefined) {
    personas[name].replyHabits = String(patch.replyHabits).trim().slice(0, 500);
  }
  if (patch.messageCount != null && Number.isInteger(patch.messageCount)) {
    personas[name].messageCount = Math.max(0, patch.messageCount);
  }
  if (patch.personaSummary !== undefined) {
    personas[name].personaSummary = String(patch.personaSummary).trim().slice(0, 6000);
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
  filterAndNormalizeLearningMessages,
  computeReplyDelays,
  computeMessageShares,
  chatHistorySave: db.chatHistorySave
};

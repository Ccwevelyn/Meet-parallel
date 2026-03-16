const path = require('path');
const fs = require('fs');
const express = require('express');
const { requireAuth } = require('./auth');
const { getDisplayName } = require('./members');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '..', 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

let messages = [];
let nextId = 1;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
      const list = Array.isArray(data.messages) ? data.messages : [];
      const maxId = list.length ? Math.max(...list.map(m => m.id || 0)) : 0;
      messages = list;
      nextId = maxId + 1;
    }
  } catch (e) {
    console.warn('读取 messages.json 失败', e.message);
  }
}

function saveMessages() {
  try {
    ensureDataDir();
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ messages, nextId, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) {
    console.warn('保存 messages.json 失败', e.message);
  }
}

loadMessages();

function withDisplayNames(list) {
  return list.map(m => ({ ...m, memberName: getDisplayName(m.memberId) || m.memberName || '' }));
}

function getDateStr(isoTime) {
  if (!isoTime) return '';
  const d = new Date(isoTime);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

router.get('/dates', (req, res) => {
  const set = new Set();
  messages.forEach(m => {
    const d = getDateStr(m.time);
    if (d) set.add(d);
  });
  const dates = Array.from(set).sort().reverse();
  res.json({ dates });
});

router.get('/', (req, res) => {
  const sinceId = parseInt(req.query.sinceId, 10);
  const date = (req.query.date || '').trim();
  let list = messages;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    list = list.filter(m => getDateStr(m.time) === date);
  } else if (sinceId) {
    list = list.filter(m => m.id > sinceId);
  }
  res.json({ messages: withDisplayNames(list) });
});

// 改模式：发送消息（需登录，以当前身份发送）。始终用成员表的 displayName 作为展示名
router.post('/', requireAuth, (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '消息内容不能为空' });
  }
  const displayName = getDisplayName(req.user.memberId) || req.user.displayName || req.user.name;
  const msg = {
    id: nextId++,
    memberId: req.user.memberId,
    memberName: displayName,
    text: text.trim().slice(0, 2000),
    time: new Date().toISOString(),
    isHuman: true
  };
  messages.push(msg);
  saveMessages();
  res.json({ message: msg });
});

function addAIMessage(memberId, text) {
  const msg = {
    id: nextId++,
    memberId,
    memberName: getDisplayName(memberId) || '未知',
    text,
    time: new Date().toISOString(),
    isHuman: false
  };
  messages.push(msg);
  saveMessages();
  return msg;
}

function getRecentMessages(limit = 20) {
  return messages.slice(-limit);
}

// 传入 addAIMessage 与 getRecentMessages，由 ai-simulation 根据人设/训练结果生成回复
const { scheduleAISimulation } = require('./ai-simulation');
scheduleAISimulation(addAIMessage, getRecentMessages);

module.exports = { messagesRouter: router };

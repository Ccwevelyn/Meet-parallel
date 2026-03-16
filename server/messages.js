const express = require('express');
const { requireAuth } = require('./auth');
const { getDisplayName } = require('./members');
const { appendChatMessageToPersona } = require('./personas');
const db = require('./db');

const router = express.Router();

function withDisplayNames(list) {
  return list.map(m => ({ ...m, memberName: getDisplayName(m.memberId) || m.memberName || '' }));
}

router.get('/dates', (req, res) => {
  const dates = db.messagesGetDates();
  res.json({ dates });
});

router.get('/', (req, res) => {
  const sinceId = parseInt(req.query.sinceId, 10);
  const date = (req.query.date || '').trim();
  const memberId = (req.query.memberId || '').trim();
  const list = db.messagesQuery({ date: date || undefined, memberId: memberId || undefined, sinceId: (date || memberId) ? undefined : (isNaN(sinceId) ? undefined : sinceId) });
  res.json({ messages: withDisplayNames(list) });
});

// 改模式：发送消息（需登录，以当前身份发送）
router.post('/', requireAuth, (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '消息内容不能为空' });
  }
  const displayName = getDisplayName(req.user.memberId) || req.user.displayName || req.user.name;
  const msg = {
    id: null,
    memberId: req.user.memberId,
    memberName: displayName,
    text: text.trim().slice(0, 2000),
    time: new Date().toISOString(),
    isHuman: true
  };
  msg.id = db.messagesAdd(msg);
  appendChatMessageToPersona(req.user.memberId, msg.text, msg.time);
  res.json({ message: msg });
});

function addAIMessage(memberId, text) {
  const msg = {
    id: null,
    memberId,
    memberName: getDisplayName(memberId) || '未知',
    text,
    time: new Date().toISOString(),
    isHuman: false
  };
  msg.id = db.messagesAdd(msg);
  return msg;
}

function getRecentMessages(limit = 20) {
  return db.messagesGetRecent(limit);
}

const { scheduleAISimulation } = require('./ai-simulation');
const { getOccupiedMemberIds } = require('./presence');
scheduleAISimulation(addAIMessage, getRecentMessages, getOccupiedMemberIds);

module.exports = { messagesRouter: router };

const express = require('express');
const { requireAuth } = require('./auth');
const { getMemberById, getDisplayName, getAllMembers } = require('./members');

const router = express.Router();

// 内存存储消息（部署可改为数据库）。AI 回复时机与内容由后续训练/接口决定
let messages = [];
let nextId = 1;

function withDisplayNames(list) {
  return list.map(m => ({ ...m, memberName: getDisplayName(m.memberId) || m.memberName || '' }));
}

router.get('/', (req, res) => {
  const sinceId = parseInt(req.query.sinceId, 10);
  const list = sinceId
    ? messages.filter(m => m.id > sinceId)
    : messages;
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
  return msg;
}

function getRecentMessages(limit = 20) {
  return messages.slice(-limit);
}

// 传入 addAIMessage 与 getRecentMessages，由 ai-simulation 根据人设/训练结果生成回复
const { scheduleAISimulation } = require('./ai-simulation');
scheduleAISimulation(addAIMessage, getRecentMessages);

module.exports = { messagesRouter: router };

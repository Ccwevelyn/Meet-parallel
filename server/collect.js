/**
 * 对话采集：登录用户与 AI 聊约 10 分钟，采集到的回复会合并进人设（与聊天记录一起）
 */
const express = require('express');
const { requireAuth } = require('./auth');
const { getMemberById } = require('./members');
const { appendCollectedMessage, mergeCollectedIntoPersonas } = require('./personas');

const router = express.Router();
const DURATION_MS = 10 * 60 * 1000; // 10 分钟

// 采集时 AI 的提问（轮流使用，让用户多说话）
const QUESTIONS = [
  '最近怎么样？',
  '今天忙什么了？',
  '有什么开心的事想分享一下吗？',
  '你平时喜欢做什么？',
  '最近有在看什么剧或书吗？',
  '周末一般怎么过？',
  '对最近天气有什么想说的？',
  '有什么想吐槽的？',
  '最近和朋友们聊得多吗？',
  '你觉得自己是个什么样的人？',
  '有什么小目标最近在做的？',
  '喜欢吃什么？',
  '无聊的时候会干嘛？',
  '有什么话想对大家说的？',
  '回忆一下最近一次笑得很开心是什么时候？',
  '用一句话形容一下现在的自己。',
  '如果明天不用上班/上学你会干嘛？',
  '最近单曲循环过什么歌吗？'
];

const sessions = new Map();

function getSession(memberId) {
  return sessions.get(memberId);
}

function startSession(memberId, memberName) {
  const startedAt = Date.now();
  const session = {
    startedAt,
    messageIndex: 0,
    messages: []
  };
  sessions.set(memberId, session);
  return session;
}

function getNextReply(session) {
  const idx = session.messageIndex % QUESTIONS.length;
  session.messageIndex += 1;
  return QUESTIONS[idx];
}

router.post('/start', requireAuth, (req, res) => {
  const { memberId, displayName } = req.user;
  startSession(memberId, displayName);
  const session = getSession(memberId);
  const firstReply = getNextReply(session);
  return res.json({
    ok: true,
    reply: firstReply,
    durationMs: DURATION_MS,
    remainingMs: DURATION_MS
  });
});

router.post('/', requireAuth, (req, res) => {
  const { text } = req.body || {};
  const msg = (text || '').trim().slice(0, 2000);
  if (!msg) return res.status(400).json({ error: '消息不能为空' });

  const { memberId } = req.user;
  const member = getMemberById(memberId);
  const session = getSession(memberId);

  if (!session) {
    return res.status(400).json({ error: '请先开始采集', code: 'NOT_STARTED' });
  }

  const now = new Date().toISOString();
  const elapsed = Date.now() - session.startedAt;
  if (elapsed >= DURATION_MS) {
    sessions.delete(memberId);
    return res.status(400).json({ error: '采集时间已到', code: 'TIME_UP', remainingMs: 0 });
  }

  session.messages.push({ role: 'user', text: msg, time: now });
  appendCollectedMessage({ sender: member ? member.name : req.user.name, text: msg, time: now });

  const reply = getNextReply(session);
  const remainingMs = Math.max(0, DURATION_MS - (Date.now() - session.startedAt));

  return res.json({
    reply,
    remainingMs,
    messageCount: session.messages.length
  });
});

router.get('/status', requireAuth, (req, res) => {
  const { memberId } = req.user;
  const session = getSession(memberId);
  if (!session) {
    return res.json({ active: false, remainingMs: 0, messageCount: 0 });
  }
  const remainingMs = Math.max(0, DURATION_MS - (Date.now() - session.startedAt));
  return res.json({
    active: true,
    remainingMs,
    messageCount: session.messages.length
  });
});

router.post('/end', requireAuth, (req, res) => {
  const { memberId } = req.user;
  sessions.delete(memberId);
  try {
    const count = mergeCollectedIntoPersonas();
    return res.json({ ok: true, personasCount: count });
  } catch (e) {
    console.warn('合并人设失败', e.message);
    return res.json({ ok: true, personasCount: 0 });
  }
});

module.exports = { collectRouter: router };

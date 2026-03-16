const express = require('express');
const { requireAuth } = require('./auth');

const router = express.Router();

// memberId -> 最后上报时间
const lastSeen = Object.create(null);
const PRESENCE_TTL_MS = 5 * 60 * 1000; // 5 分钟内有过上报视为「该成员被真人占用」

function getOccupiedMemberIds() {
  const now = Date.now();
  return Object.keys(lastSeen).filter(id => (now - lastSeen[id]) < PRESENCE_TTL_MS);
}

// 成员登录后上报：我正在以该身份在线，AI 不要替我发言
router.post('/', requireAuth, (req, res) => {
  const { memberId, role } = req.user || {};
  if (role === 'admin' || !memberId || memberId === 'admin') {
    return res.json({ ok: true });
  }
  lastSeen[memberId] = Date.now();
  res.json({ ok: true });
});

// 退出登录或关闭前调用，释放该成员
router.delete('/', requireAuth, (req, res) => {
  const { memberId } = req.user || {};
  if (memberId && memberId !== 'admin') delete lastSeen[memberId];
  res.json({ ok: true });
});

module.exports = { presenceRouter: router, getOccupiedMemberIds };

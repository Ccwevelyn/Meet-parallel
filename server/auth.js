const express = require('express');
const { getMemberByName, getAllMembers } = require('./members');
const { checkPassword, updatePassword } = require('./credentials');

const router = express.Router();

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    if (payload.exp && Date.now() > payload.exp) {
      return res.status(401).json({ error: '登录已过期' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: '无效凭证' });
  }
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Cc921';
const TOKEN_EXP_MS = 7 * 24 * 60 * 60 * 1000;

function createToken(payload) {
  return Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_EXP_MS })).toString('base64');
}

router.post('/login', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const uname = String(body.username || '').trim();
    const password = body.password;
    if (!uname || !password) return res.status(400).json({ error: '请填写用户名与密码' });

    if (uname.toLowerCase() === 'admin') {
      if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: '密码错误' });
      const token = createToken({ memberId: 'admin', name: 'admin', displayName: '管理员', role: 'admin' });
      return res.json({ token, member: { id: 'admin', name: 'admin', displayName: '管理员' }, role: 'admin' });
    }

    const member = getMemberByName(uname);
    if (!member) return res.status(401).json({ error: '该用户名不是群成员身份' });
    if (!checkPassword(member.name, password)) return res.status(401).json({ error: '密码错误' });
    const token = createToken({ memberId: member.id, name: member.name, displayName: member.displayName });
    return res.json({ token, member: { id: member.id, name: member.name, displayName: member.displayName } });
  } catch (err) {
    console.error('登录异常', err);
    return res.status(500).json({ error: '登录失败，请重试' });
  }
});

router.get('/members', (req, res) => {
  res.json(getAllMembers());
});

router.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: '请提供当前密码，且新密码不少于 6 位' });
  }
  const name = req.user.name;
  if (!checkPassword(name, oldPassword)) {
    return res.status(401).json({ error: '当前密码错误' });
  }
  if (!updatePassword(name, newPassword)) {
    return res.status(500).json({ error: '修改失败' });
  }
  return res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: '需要管理员权限' });
}

module.exports = { authRouter: router, requireAuth, requireAdmin };

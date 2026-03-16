/**
 * 管理员 API：微调人设（发消息时间 activeHours、样本 sampleMessages 等）
 */
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const { getAllMembers } = require('./members');
const { loadPersonas, updatePersona } = require('./personas');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// GET 所有人设（含成员列表，便于前端展示）
router.get('/personas', (req, res) => {
  const members = getAllMembers();
  const personas = loadPersonas();
  const list = members.map(m => ({
    name: m.name,
    displayName: m.displayName,
    ...(personas[m.name] || { name: m.name, messageCount: 0, sampleMessages: [], activeHours: [], updatedAt: null })
  }));
  return res.json({ personas: list });
});

// PUT 更新某人设（body: { name, activeHours?, sampleMessages?, replyHabits? }）
router.put('/personas', (req, res) => {
  const { name, activeHours, sampleMessages, messageCount, replyHabits } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: '请提供 name（成员英文名）' });
  }
  const patch = {};
  if (Array.isArray(activeHours)) patch.activeHours = activeHours;
  if (Array.isArray(sampleMessages)) patch.sampleMessages = sampleMessages;
  if (replyHabits !== undefined) patch.replyHabits = replyHabits;
  if (messageCount != null) patch.messageCount = messageCount;
  try {
    const updated = updatePersona(name.trim(), patch);
    return res.json({ ok: true, persona: updated });
  } catch (e) {
    return res.status(500).json({ error: e.message || '更新失败' });
  }
});

module.exports = { adminRouter: router };

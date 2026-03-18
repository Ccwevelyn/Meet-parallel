/**
 * 管理员 API：微调人设（发消息时间 activeHours、样本 sampleMessages 等）
 */
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const { getAllMembers } = require('./members');
const { loadPersonas, updatePersona, mergeCollectedIntoPersonas } = require('./personas');
const { messagesClearAll } = require('./db');
const { isAIPaused, setAIPaused } = require('./ai-simulation');
const { generatePersonaSummary } = require('./persona-summary');

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

// PUT 更新某人设（body: { name, activeHours?, sampleMessages?, replyHabits?, personaSummary? }）
router.put('/personas', (req, res) => {
  const { name, activeHours, sampleMessages, messageCount, replyHabits, personaSummary } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: '请提供 name（成员英文名）' });
  }
  const patch = {};
  if (Array.isArray(activeHours)) patch.activeHours = activeHours;
  if (Array.isArray(sampleMessages)) patch.sampleMessages = sampleMessages;
  if (replyHabits !== undefined) patch.replyHabits = replyHabits;
  if (messageCount != null) patch.messageCount = messageCount;
  if (personaSummary !== undefined) patch.personaSummary = personaSummary;
  try {
    const updated = updatePersona(name.trim(), patch);
    return res.json({ ok: true, persona: updated });
  } catch (e) {
    return res.status(500).json({ error: e.message || '更新失败' });
  }
});

// POST 一键清空所有聊天记录（仅 messages 表，人设/采集等不动）
router.post('/messages/clear', (req, res) => {
  try {
    const deleted = messagesClearAll();
    return res.json({ ok: true, deleted });
  } catch (e) {
    return res.status(500).json({ error: e.message || '清空失败' });
  }
});

// POST 从现有数据重新合并人设（chat_history + 采集），不设样本条数上限，用于解除之前的 80 条限制
router.post('/personas/rebuild', (req, res) => {
  try {
    const count = mergeCollectedIntoPersonas({ sampleSize: 0 });
    return res.json({ ok: true, count });
  } catch (e) {
    return res.status(500).json({ error: e.message || '重新合并失败' });
  }
});

// POST 为所有人设生成/更新「角色总结」（多而详细），写入后可在管理页「角色总结」中查看与编辑
router.post('/personas/rebuild-summaries', async (req, res) => {
  try {
    const members = getAllMembers();
    const memberNames = new Set(members.map(m => m.name));
    const all = loadPersonas();
    let updated = 0;
    for (const [name, p] of Object.entries(all)) {
      if (!memberNames.has(name)) continue;
      const samples = Array.isArray(p.sampleMessages) ? p.sampleMessages : [];
      if (samples.length < 3) continue;
      const displayName = members.find(m => m.name === name)?.displayName || name;
      const summary = await generatePersonaSummary(displayName, name, samples, p.replyHabits || '', p.replyToWhom || {});
      if (summary) {
        all[name] = { ...p, personaSummary: summary, updatedAt: new Date().toISOString() };
        updated++;
      }
    }
    const { savePersonas } = require('./personas');
    savePersonas(all);
    return res.json({ ok: true, updated });
  } catch (e) {
    return res.status(500).json({ error: e.message || '生成角色总结失败' });
  }
});

// GET 当前 AI 是否暂停
router.get('/ai-paused', (req, res) => {
  return res.json({ paused: isAIPaused() });
});

// POST 一键开启/关闭 AI（body: { paused: true|false }），关闭后所有 AI 不发言，再次开启恢复上次对话
router.post('/ai-paused', (req, res) => {
  const paused = req.body && req.body.paused;
  if (typeof paused !== 'boolean') {
    return res.status(400).json({ error: '请提供 paused: true 或 false' });
  }
  setAIPaused(paused);
  return res.json({ ok: true, paused: isAIPaused() });
});

module.exports = { adminRouter: router };

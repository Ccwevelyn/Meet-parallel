const { getAllMembers } = require('./members');
const { loadPersonas } = require('./personas');

/** 管理员一键暂停：为 true 时所有 AI 不发言（自发 + 回复真人），再次关闭后恢复 */
let _aiPaused = false;
function isAIPaused() {
  return _aiPaused;
}
function setAIPaused(paused) {
  _aiPaused = !!paused;
}

// 通用名 AI_*（DeepSeek/智谱等），兼容旧名 OPENAI_*
const OPENAI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

/**
 * 用大模型按人设生成一条回复（仅对有人设样本的成员调用；无样本则不发言）
 * options.replyToHuman 为 true 时，强调最近一条是真人发言，请对其做出回应或接话
 */
async function generateWithLLM(member, recentMessages, personas, options = {}) {
  if (!OPENAI_API_KEY) return null;
  const persona = personas[member.name];
  if (!persona || !persona.sampleMessages || persona.sampleMessages.length === 0) return null;
  const displayName = member.displayName || member.name;
  const samples = persona.sampleMessages.slice(-30).join('\n');
  const systemParts = [
    '你是一个群聊里的成员，正在用「自己的口吻」回复。',
    '规则：只输出一条简短的口语消息（一行），不要加引号、不要解释、不要写「我说：」等前缀。',
    `身份：你在群里的称呼是「${displayName}」（英文名 ${member.name}）。必须用这个人独有的语气和用词来回复。`,
    '重要：不要复读、照搬或改写前面别人刚说过的话。你要基于自己的性格说出新的、符合你人设的内容，可以接话、吐槽、提问、发表看法，但不要重复他人原句。',
    '语气：像真人一样自然参与，不必每条都接话、不必一直刷屏，有话想说就说一句，没话就少说。'
  ];
  if (persona.personaSummary && persona.personaSummary.trim()) {
    systemParts.push('该角色的性格与说话风格（已从群聊学习）：\n' + persona.personaSummary.trim());
  }
  systemParts.push('下面是你平时在群里的真实发言，请严格模仿这种说话方式（用词、语气、长度）：\n' + samples);
  if (persona.replyHabits && persona.replyHabits.trim()) {
    systemParts.push('回复习惯（请自然融入）：' + persona.replyHabits.trim());
  }
  const recent = recentMessages
    .slice(-14)
    .map(m => `${m.memberName}: ${m.text}`)
    .join('\n');
  let userContent;
  if (recent) {
    if (options.replyToHuman) {
      userContent = `最近群聊：\n${recent}\n\n上一条是真人（群友）发的，请以「${displayName}」的身份对其做出回应或接话，自然参与对话（不要复读对方原句；只输出这一条）。`;
    } else {
      userContent = `最近群聊：\n${recent}\n\n请以「${displayName}」的身份回复一条新消息（必须是新内容，不要复读上面任何人说过的话；只输出这一条）。`;
    }
  } else {
    userContent = `请用「${displayName}」的口吻发一句开场白（只输出这一句）。`;
  }

  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemParts.join('\n\n') },
          { role: 'user', content: userContent }
        ],
        max_tokens: 120,
        temperature: 0.85
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('LLM 请求失败', res.status, err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    let text = data.choices?.[0]?.message?.content?.trim();
    if (text) {
      text = text.replace(/^["「『]|["」』]$/g, '').trim();
      if (text.length > 500) text = text.slice(0, 500);
    }
    return text || null;
  } catch (e) {
    console.warn('LLM 调用失败', e.message);
    return null;
  }
}

/**
 * 选人发言：按活跃时段、谁在群里回复多（replyRate）、以及「谁常回复当前发言人」（replyToMemberName）加权。
 * 排除当前被真人占用的成员。
 * options.onlyActiveHours === true 时：仅考虑当前在其常见在线时段内的成员（非该时段不发言）；回复真人时不限。
 */
function pickMember(members, personas, getOccupiedMemberIds, options = {}) {
  const occupied = Array.isArray(getOccupiedMemberIds) ? getOccupiedMemberIds : (typeof getOccupiedMemberIds === 'function' ? getOccupiedMemberIds() : []);
  let trained = members.filter(m => {
    if (occupied.indexOf(m.id) !== -1) return false;
    const p = personas[m.name];
    return p && Array.isArray(p.sampleMessages) && p.sampleMessages.length > 0;
  });

  const now = new Date();
  const hour = (now.getHours() + 8) % 24;
  const replyToMemberName = options.replyToMemberName || null;

  if (options.onlyActiveHours && !replyToMemberName) {
    trained = trained.filter(m => {
      const p = personas[m.name];
      if (!p || !p.activeHours || p.activeHours.length === 0) return true;
      return p.activeHours.includes(hour) || p.activeHours.some(h => Math.abs(h - hour) <= 1);
    });
  }
  if (!trained.length) return null;

  const withWeight = trained.map(m => {
    const p = personas[m.name];
    let w = 1;
    if (p && p.activeHours && p.activeHours.length > 0) {
      if (p.activeHours.includes(hour)) w = 3;
      else if (p.activeHours.some(h => Math.abs(h - hour) <= 2)) w = 2;
    }
    if (p && (p.replyRate != null && p.replyRate > 0)) {
      w *= (1 + p.replyRate);
    }
    if (replyToMemberName && p && p.replyToWhom && typeof p.replyToWhom === 'object') {
      const count = p.replyToWhom[replyToMemberName];
      if (count != null && count > 0) w += count;
    }
    return { member: m, weight: Math.max(0.1, w) };
  });

  const total = withWeight.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const { member, weight } of withWeight) {
    r -= weight;
    if (r <= 0) return member;
  }
  return withWeight[withWeight.length - 1].member;
}

/**
 * 生成一条回复：仅通过大模型按人设生成
 * options.replyToHuman 为 true 时，提示模型「对真人接话」
 */
async function generateReply(member, recentMessages, personas, options = {}) {
  if (!OPENAI_API_KEY) return null;
  return await generateWithLLM(member, recentMessages, personas, options);
}

/** 真人回复窗口：10 秒内必须有人接话，失败则重试 */
const HUMAN_REPLY_DEADLINE_MS = 10000;
const HUMAN_REPLY_FIRST_DELAY_MS = 2000 + Math.random() * 3000;
const HUMAN_REPLY_RETRY_MS = 2500;

/**
 * 真人发言后 10 秒内安排一名 AI 成员对其回复；若首次未成功则重试，保证真人必有回复
 */
function scheduleOneReplySoon(addAIMessage, getRecentMessages, getOccupiedMemberIds) {
  const startTime = Date.now();

  async function attempt() {
    if (isAIPaused()) return false;
    const members = getAllMembers();
    if (!members.length) return false;
    const recent = typeof getRecentMessages === 'function' ? getRecentMessages(24) : [];
    const lastMsg = recent.length ? recent[recent.length - 1] : null;
    let replyToMemberName = null;
    if (lastMsg && lastMsg.memberId) {
      const { getMemberById } = require('./members');
      const m = getMemberById(lastMsg.memberId);
      if (m && m.name) replyToMemberName = m.name;
    }
    let personas = {};
    try {
      personas = loadPersonas();
    } catch (_) {}
    const occupied = typeof getOccupiedMemberIds === 'function' ? getOccupiedMemberIds() : [];
    const member = pickMember(members, personas, occupied, { replyToMemberName });
    if (!member) return false;
    const text = await generateReply(member, recent, personas, { replyToHuman: true });
    if (text) {
      addAIMessage(member.id, text);
      return true;
    }
    return false;
  }

  function schedule() {
    if (Date.now() - startTime > HUMAN_REPLY_DEADLINE_MS) return;
    attempt().then(sent => {
      if (!sent) setTimeout(schedule, HUMAN_REPLY_RETRY_MS);
    });
  }
  setTimeout(schedule, HUMAN_REPLY_FIRST_DELAY_MS);
}

function scheduleAISimulation(addAIMessage, getRecentMessages, getOccupiedMemberIds) {
  const members = getAllMembers();
  if (!members.length) return;

  if (!OPENAI_API_KEY) {
    console.log('未设置 AI_API_KEY，群聊不会自动发言。请先做「采集语气」或管理页维护人设样本，并配置 API。');
  } else {
    console.log('已接入 AI，仅经过语气训练（有人设样本）的成员会在群聊中自动发言（模型: ' + OPENAI_MODEL + '）；已登录成员由真人发言，AI 不代发。');
  }

  // 自发发言：有时跳过本轮，避免「一直刷屏」；间隔拉长，像真人偶尔聊
  const SKIP_CHANCE = 0.4;
  const MIN_INTERVAL_MS = 45000;
  const MAX_INTERVAL_MS = 120000;

  async function sendOne() {
    if (isAIPaused()) return;
    if (Math.random() < SKIP_CHANCE) return;
    let personas = {};
    try {
      personas = loadPersonas();
    } catch (_) {}
    const occupied = typeof getOccupiedMemberIds === 'function' ? getOccupiedMemberIds() : [];
    const member = pickMember(members, personas, occupied, { onlyActiveHours: true });
    if (!member) return;
    const recent = typeof getRecentMessages === 'function' ? getRecentMessages(24) : [];
    const text = await generateReply(member, recent, personas);
    if (text) addAIMessage(member.id, text);
  }

  function scheduleNext() {
    const intervalMs = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
    setTimeout(() => {
      sendOne();
      scheduleNext();
    }, intervalMs);
  }

  const firstDelay = 15000 + Math.random() * 25000;
  setTimeout(() => {
    sendOne();
    scheduleNext();
  }, firstDelay);
}

module.exports = { scheduleAISimulation, scheduleOneReplySoon, isAIPaused, setAIPaused };

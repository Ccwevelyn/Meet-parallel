const { getAllMembers } = require('./members');
const { loadPersonas } = require('./personas');

// 通用名 AI_*（DeepSeek/智谱等），兼容旧名 OPENAI_*
const OPENAI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

/**
 * 用大模型按人设生成一条回复（仅对有人设样本的成员调用；无样本则不发言）
 */
async function generateWithLLM(member, recentMessages, personas) {
  if (!OPENAI_API_KEY) return null;
  const persona = personas[member.name];
  if (!persona || !persona.sampleMessages || persona.sampleMessages.length === 0) return null;
  const displayName = member.displayName || member.name;
  const samples = persona.sampleMessages.slice(-20).join('\n');
  const systemParts = [
    '你是一个群聊里的成员，正在用「自己的口吻」回复。',
    '规则：只输出一条简短的口语消息（一行），不要加引号、不要解释、不要写「我说：」等前缀。',
    `身份：你在群里的称呼是「${displayName}」（英文名 ${member.name}）。请用这个人的语气和用词习惯来回复。`,
    '下面是你平时在群里的真实发言，请严格模仿这种说话方式（用词、语气、长度）：\n' + samples
  ];
  if (persona.replyHabits && persona.replyHabits.trim()) {
    systemParts.push('回复习惯（请自然融入）：' + persona.replyHabits.trim());
  }
  const recent = recentMessages
    .slice(-14)
    .map(m => `${m.memberName}: ${m.text}`)
    .join('\n');
  const userContent = recent
    ? `最近群聊：\n${recent}\n\n请用「${displayName}」的口吻回复一条消息（只输出这一条，不要其他内容）。`
    : `请用「${displayName}」的口吻发一句开场白（只输出这一句）。`;

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
        max_tokens: 100,
        temperature: 0.75
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
 * 只从「经过语气训练」的成员里选人（人设里至少有一条样本消息），有人设时按活跃时段加权。
 * 排除当前被真人占用的成员（已登录用户在代该成员发言，不共存）。
 */
function pickMember(members, personas, getOccupiedMemberIds) {
  const occupied = Array.isArray(getOccupiedMemberIds) ? getOccupiedMemberIds : (typeof getOccupiedMemberIds === 'function' ? getOccupiedMemberIds() : []);
  const trained = members.filter(m => {
    if (occupied.indexOf(m.id) !== -1) return false;
    const p = personas[m.name];
    return p && Array.isArray(p.sampleMessages) && p.sampleMessages.length > 0;
  });
  if (!trained.length) return null;

  const now = new Date();
  const hour = (now.getHours() + 8) % 24;
  const withWeight = trained.map(m => {
    const p = personas[m.name];
    let w = 1;
    if (p && p.activeHours && p.activeHours.length > 0) {
      if (p.activeHours.includes(hour)) w = 3;
      else if (p.activeHours.some(h => Math.abs(h - hour) <= 2)) w = 2;
    }
    return { member: m, weight: w };
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
 * 生成一条回复：仅通过大模型按人设生成，不随机选已有/占位句（人设与特征由 admin 管理页维护）
 */
async function generateReply(member, recentMessages, personas) {
  if (!OPENAI_API_KEY) return null;
  return await generateWithLLM(member, recentMessages, personas);
}

function scheduleAISimulation(addAIMessage, getRecentMessages, getOccupiedMemberIds) {
  const members = getAllMembers();
  if (!members.length) return;

  if (!OPENAI_API_KEY) {
    console.log('未设置 AI_API_KEY，群聊不会自动发言。请先做「采集语气」或管理页维护人设样本，并配置 API。');
  } else {
    console.log('已接入 AI，仅经过语气训练（有人设样本）的成员会在群聊中自动发言（模型: ' + OPENAI_MODEL + '）；已登录成员由真人发言，AI 不代发。');
  }

  async function sendOne() {
    let personas = {};
    try {
      personas = loadPersonas();
    } catch (_) {}
    const occupied = typeof getOccupiedMemberIds === 'function' ? getOccupiedMemberIds() : [];
    const member = pickMember(members, personas, occupied);
    if (!member) return;
    const recent = typeof getRecentMessages === 'function' ? getRecentMessages(24) : [];
    const text = await generateReply(member, recent, personas);
    if (text) addAIMessage(member.id, text);
  }

  const firstDelay = 4000 + Math.random() * 6000;
  const intervalMs = 8000 + Math.random() * 12000;
  setTimeout(() => {
    sendOne();
    setInterval(sendOne, intervalMs);
  }, firstDelay);
}

module.exports = { scheduleAISimulation };

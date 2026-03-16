const { getAllMembers } = require('./members');
const { loadPersonas } = require('./personas');

// 未配置 API 或无人设样本时使用的占位回复
const PLACEHOLDER_REPLIES = [
  '嗯，有道理。',
  '今天天气不错。',
  '大家最近还好吗？',
  '想起以前的事。',
  '……',
  '哈哈，是啊。',
  '时间过得真快。',
  '在的。',
  '怎么了？',
  '好。',
  '改天再聊。',
  '嗯嗯。',
  '好吧。'
];

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

/**
 * 用大模型按人设生成一条回复（学习该成员的说话方式，只输出一句）
 */
async function generateWithLLM(member, recentMessages, personas) {
  if (!OPENAI_API_KEY) return null;
  const persona = personas[member.name];
  const displayName = member.displayName || member.name;
  const systemParts = [
    '你是一个群聊里的成员，正在用「自己的口吻」回复。',
    '规则：只输出一条简短的口语消息（一行），不要加引号、不要解释、不要写「我说：」等前缀。',
    `身份：你在群里的称呼是「${displayName}」（英文名 ${member.name}）。请用这个人的语气和用词习惯来回复。`
  ];
  if (persona && persona.sampleMessages && persona.sampleMessages.length > 0) {
    const samples = persona.sampleMessages.slice(-20).join('\n');
    systemParts.push('下面是你平时在群里的真实发言，请严格模仿这种说话方式（用词、语气、长度）：\n' + samples);
  } else {
    systemParts.push('暂无历史发言样本，请用自然、简短的口语回复。');
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
 * 选择本次发言的成员：有人设时可按活跃时段加权
 */
function pickMember(members, personas) {
  const now = new Date();
  const hour = (now.getHours() + 8) % 24;

  const withWeight = members.map(m => {
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
 * 生成一条回复：有 API 则用大模型学人设说话，否则用人设样本随机或占位
 */
async function generateReply(member, recentMessages, personas) {
  if (OPENAI_API_KEY) {
    const generated = await generateWithLLM(member, recentMessages, personas);
    if (generated) return generated;
  }
  const p = personas[member.name];
  if (p && p.sampleMessages && p.sampleMessages.length > 0) {
    return p.sampleMessages[Math.floor(Math.random() * p.sampleMessages.length)];
  }
  return PLACEHOLDER_REPLIES[Math.floor(Math.random() * PLACEHOLDER_REPLIES.length)];
}

function scheduleAISimulation(addAIMessage, getRecentMessages) {
  const members = getAllMembers();
  if (!members.length) return;

  if (!OPENAI_API_KEY) {
    console.log('未设置 OPENAI_API_KEY，群聊将用人设样本/占位句回复。设置后 AI 会按各成员说话方式自主聊天。');
  } else {
    console.log('已接入 AI，群聊将按人设自主发言（模型: ' + OPENAI_MODEL + '）');
  }

  async function sendOne() {
    let personas = {};
    try {
      personas = loadPersonas();
    } catch (_) {}
    const member = pickMember(members, personas);
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

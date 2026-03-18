const { getAllMembers } = require('./members');
const { loadPersonas } = require('./personas');
const { getTrendsContext } = require('./serper');
const { retrieveSimilarHistory } = require('./rag');

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

/** 若最近几条消息里有多条以相同开头（≥6 字），返回该开头，用于提示模型禁止再跟风 */
function getRepeatedPrefix(texts) {
  if (!texts || texts.length < 2) return '';
  const minLen = 6;
  const maxLen = 24;
  for (let len = maxLen; len >= minLen; len--) {
    const counts = {};
    for (const t of texts) {
      if (t.length < len) continue;
      const p = t.slice(0, len);
      counts[p] = (counts[p] || 0) + 1;
    }
    const found = Object.entries(counts).find(([, n]) => n >= 2);
    if (found) return found[0];
  }
  return '';
}
const OPENAI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

/**
 * 用大模型按人设生成一条回复（仅对有人设样本的成员调用；无样本则不发言）
 * options.replyToHuman 为 true 时，强调最近一条是真人发言，请对其做出回应或接话
 */
async function generateWithLLM(member, recentMessages, personas, options = {}) {
  if (!OPENAI_API_KEY) return null;
  const persona = personas[member.name];
  const samplesArr = (persona && Array.isArray(persona.sampleMessages)) ? persona.sampleMessages : [];
  const hasPersona = !!persona;
  // 允许在“真人必回”场景下使用通用提示兜底（即便该成员暂无人设）
  if (!hasPersona && !options.replyToHuman) return null;
  // 允许仅有 personaSummary 的成员参与（样本为空时仍可发言，但会更依赖总结 + RAG）
  if (hasPersona && samplesArr.length === 0 && !(persona.personaSummary && String(persona.personaSummary).trim())) return null;
  const displayName = member.displayName || member.name;
  const samples = samplesArr.slice(-30).join('\n');
  const systemParts = [
    '你是一个群聊里的成员，正在用「自己的口吻」回复。',
    '规则：只输出一条简短的口语消息（一行），不要加引号、不要解释、不要写「我说：」等前缀。',
    `身份：你在群里的称呼是「${displayName}」（英文名 ${member.name}）。必须用这个人独有的语气和用词来回复。`,
    '语境与话题：回复必须贴合当前对话的语境和正在讨论的话题，不要突然扯到毫不相关的事情。注意当前日期、星期、时间、季节等，可自然提及与当下相关的内容（如周末、节日、天气、饭点等）。',
    '外部信息：可以适当引用外部资源（热点、新闻、趣闻、冷知识等）参与讨论，但仅在与当前话题或氛围相符时自然带入，不要生硬插入或强行换题。',
    '衔接性：你的回复必须与「最近群聊的最后一条消息」形成明确的衔接（回应/追问/补充/反驳/共鸣均可）。至少抓住对方话里的 1 个信息点（名词/事件/情绪/观点/数字/时间等）来展开；如果信息不足，就用你的人设语气问一句澄清。',
    '重要：不要复读、照搬或改写前面别人刚说过的话。你要基于自己的性格说出新的、符合你人设的内容，可以接话、吐槽、提问、发表看法，但不要重复他人原句。',
    '严禁跟风同一句式或梗：若上面已有多条消息用了相同/相似的开头或句式（例如「程哥的午饭能帮我...」），你绝对不能再用该句式，必须换一个完全不同的话题、说法或角度，像真人一样自然换话。',
    '语气：像真人一样自然参与，不必每条都接话、不必一直刷屏，有话想说就说一句，没话就少说。'
  ];
  if (hasPersona && persona.personaSummary && persona.personaSummary.trim()) {
    systemParts.push('该角色的性格与说话风格（已从群聊学习）：\n' + persona.personaSummary.trim());
  }
  if (samples) {
    systemParts.push('下面是你平时在群里的真实发言，请严格模仿这种说话方式（用词、语气、长度）：\n' + samples);
  }
  if (hasPersona && persona.replyHabits && persona.replyHabits.trim()) {
    systemParts.push('回复习惯（请自然融入）：' + persona.replyHabits.trim());
  }
  const recent = recentMessages
    .slice(-14)
    .map(m => `${m.memberName}: ${m.text}`)
    .join('\n');
  const recentTexts = (recentMessages.slice(-6) || []).map(m => (m.text || '').trim()).filter(Boolean);
  const repeatedPrefix = getRepeatedPrefix(recentTexts);
  const lastMessageText = (recentMessages && recentMessages.length)
    ? String(recentMessages[recentMessages.length - 1].text || '').trim()
    : '';

  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const now = new Date();
  const timeContext = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  // RAG：检索该角色相似历史片段（5~10 条），用于更贴合语境和角色差异
  let ragText = '';
  try {
    // 如果接近 deadline，跳过 RAG（RAG 需要额外的 embedding API 调用，容易拖慢“必回”）
    const deadlineAtMs = options.deadlineAtMs ? Number(options.deadlineAtMs) : 0;
    const timeLeft = deadlineAtMs ? (deadlineAtMs - Date.now()) : 999999;
    if (timeLeft > 2800 && hasPersona) {
      const query = (lastMessageText || recentTexts.join(' ')).slice(0, 800);
      const hits = await retrieveSimilarHistory(member.name, query, { k: options.ragK || 8, candidateLimit: 2500 });
      if (hits && hits.length) {
        const lines = hits.map((h, i) => {
          const t = String(h.text || '').trim().replace(/\s+/g, ' ');
          const when = h.time ? String(h.time).slice(0, 19).replace('T', ' ') : '';
          const meta = when ? `（${when}）` : '';
          return `${i + 1}. ${t}${meta}`;
        });
        ragText = '你过去在相似语境下的对话片段（包含上下文；仅供模仿语气与接话方式，不要照抄原句）：\n' + lines.join('\n');
      }
    }
  } catch (_) {}

  let userContent;
  if (recent) {
    userContent = `当前时间：${timeContext}\n\n最近群聊：\n${recent}\n\n`;
    if (ragText) userContent += ragText + '\n\n';
    if (options.replyToHuman) {
      userContent += `上一条是真人（群友）发的，请以「${displayName}」的身份对其做出回应或接话，贴合当前话题与语境，自然参与对话（不要复读对方原句；只输出这一条）。`;
    } else {
      userContent += `请以「${displayName}」的身份回复一条新消息，紧扣当前对话话题与语境（必须是新内容，不要复读上面任何人说过的话；只输出这一条）。`;
    }
    if (repeatedPrefix) {
      userContent += `\n\n【必守】上面已有多人用了类似「${repeatedPrefix}...」的句式，你本次回复严禁再使用该开头或句式，必须换完全不同的说法或话题。`;
    }
  } else {
    userContent = `当前时间：${timeContext}\n\n` + (ragText ? (ragText + '\n\n') : '') + `请用「${displayName}」的口吻发一句贴合当下时间、自然的开场白（只输出这一句）。`;
  }

  // 接近 deadline 时不拉热点（避免额外等待）
  try {
    const deadlineAtMs = options.deadlineAtMs ? Number(options.deadlineAtMs) : 0;
    const timeLeft = deadlineAtMs ? (deadlineAtMs - Date.now()) : 999999;
    if (timeLeft > 2500) {
      const trends = await getTrendsContext();
      if (trends) {
        userContent += '\n\n以下为可选外部参考（仅在与当前话题或氛围相关时可自然提及，不必强行使用）：\n' + trends;
      }
    }
  } catch (_) {}

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
        temperature: 0.7,
        presence_penalty: 0.15,
        frequency_penalty: 0.2
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
 * 选人发言：按活跃时段、谁在群里回复多（replyRate）、「谁常回复当前发言人」（replyToMemberName）、
 * 以及「消息里是否提到该角色」（mentionKeywords）加权。排除当前被真人占用的成员。
 * options.onlyActiveHours === true 时：仅考虑当前在其常见在线时段内的成员（非该时段不发言）；回复真人时不限。
 * options.lastMessageText：最近一条消息正文，若包含某成员的 mentionKeywords 则提高该成员被选中的概率（可不回复）。
 */
function pickMember(members, personas, getOccupiedMemberIds, options = {}) {
  const occupied = Array.isArray(getOccupiedMemberIds) ? getOccupiedMemberIds : (typeof getOccupiedMemberIds === 'function' ? getOccupiedMemberIds() : []);
  let trained = members.filter(m => {
    if (occupied.indexOf(m.id) !== -1) return false;
    const p = personas[m.name];
    return p && (
      (Array.isArray(p.sampleMessages) && p.sampleMessages.length > 0) ||
      (p.personaSummary && String(p.personaSummary).trim())
    );
  });

  const now = new Date();
  const hour = (now.getHours() + 8) % 24;
  const replyToMemberName = options.replyToMemberName || null;
  const lastMessageText = (options.lastMessageText || '').trim();

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
    if (p && p.messageShare != null && p.messageShare >= 0) {
      w *= Math.max(0.3, 0.4 + p.messageShare);
    }
    if (lastMessageText && m.mentionKeywords && Array.isArray(m.mentionKeywords)) {
      const mentioned = m.mentionKeywords.some(kw => kw && lastMessageText.includes(kw));
      if (mentioned) w *= 2.2;
    }
    // 回复真人时倾向选择更快回复的人（但不强制；主要由 deadline 约束兜底）
    if (options.replyToHuman && p && p.averageReplyDelayMs != null && p.averageReplyDelayMs > 0) {
      const d = Math.min(60000, Number(p.averageReplyDelayMs) || 0);
      if (d > 0) w *= Math.max(0.35, 1 - d / 45000);
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
const HUMAN_REPLY_BASE_DELAY_MS = 2000 + Math.random() * 3000;
const HUMAN_REPLY_RETRY_MS = 2500;
const HUMAN_REPLY_MAX_PERSON_DELAY_MS = 25000;

/**
 * 真人发言后 10 秒内安排一名 AI 成员对其回复；若首次未成功则重试，保证真人必有回复。
 * 首次尝试延迟 = 基础 2–5 秒 + 该成员学习到的平均回复延迟（上限 25 秒），习惯慢回的人会稍晚再发。
 */
function scheduleOneReplySoon(addAIMessage, getRecentMessages, getOccupiedMemberIds) {
  const startTime = Date.now();
  const SAFETY_MARGIN_MS = 250;
  const deadlineAtMs = startTime + HUMAN_REPLY_DEADLINE_MS;

  function addFallback(memberId, recent) {
    const last = recent && recent.length ? String(recent[recent.length - 1].text || '').trim() : '';
    const t = last ? last.slice(0, 60) : '';
    const text = t ? `收到，我先看下你说的「${t}」这个点，等我回你。` : '收到，我先看下，等我回你。';
    addAIMessage(memberId, text);
    return true;
  }

  async function doGenerateAndSend(member, personas) {
    const recent = typeof getRecentMessages === 'function' ? getRecentMessages(24) : [];
    const text = await generateReply(member, recent, personas, { replyToHuman: true, deadlineAtMs });
    if (text) {
      addAIMessage(member.id, text);
      return true;
    }
    // 兜底：模型失败时至少回一句（避免“根本不回”）
    const timeLeft = deadlineAtMs - Date.now();
    if (timeLeft > 0) return addFallback(member.id, recent);
    return false;
  }

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
    const lastMessageText = (lastMsg && lastMsg.text) ? String(lastMsg.text).trim() : '';
    const member = pickMember(members, personas, occupied, { replyToMemberName, lastMessageText, replyToHuman: true });
    if (!member) return false;
    const elapsed = Date.now() - startTime;
    const remaining = HUMAN_REPLY_DEADLINE_MS - elapsed - SAFETY_MARGIN_MS;
    if (remaining <= 0) return false;
    // 必回约束：个体慢回只能在 deadline 内体现，不能把“必回”拖到超时
    const persona = personas[member.name];
    const learnedDelay = (persona && persona.averageReplyDelayMs != null ? persona.averageReplyDelayMs : 0) | 0;
    // 预留至少 4 秒给网络/模型生成，避免“等完才来不及发”
    const maxDelay = Math.max(0, Math.min(HUMAN_REPLY_MAX_PERSON_DELAY_MS, remaining - 4000));
    const personDelayMs = Math.max(0, Math.min(learnedDelay, maxDelay));
    if (personDelayMs > 0) {
      return new Promise((resolve) => {
        setTimeout(() => {
          doGenerateAndSend(member, personas).then(resolve);
        }, personDelayMs);
      });
    }
    return doGenerateAndSend(member, personas);
  }

  function schedule() {
    if (Date.now() - startTime > HUMAN_REPLY_DEADLINE_MS) return;
    attempt().then(sent => {
      if (!sent) setTimeout(schedule, HUMAN_REPLY_RETRY_MS);
    });
  }
  setTimeout(schedule, HUMAN_REPLY_BASE_DELAY_MS);
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

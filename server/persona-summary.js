/**
 * 角色总结生成：根据发言样本 + 回复习惯等，生成多而详细的 personaSummary，供 admin 展示与 AI 发言参考。
 * 要求：多、详细；分点覆盖性格、说话习惯、常用词、口头禅、语气、常聊话题、对谁常接话等。
 */
const OPENAI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

const MAX_SAMPLES_FOR_SUMMARY = 200;
const SUMMARY_MAX_TOKENS = 1200;
const SUMMARY_MAX_CHARS = 6000;

/**
 * 生成该角色的详细人设总结（多、详细），写入后可在 admin 的「角色总结」中查看与编辑。
 * @param {string} displayName - 群昵称
 * @param {string} name - 英文名
 * @param {string[]} samples - 发言样本
 * @param {string} [replyHabits] - 回复习惯描述
 * @param {object} [replyToWhom] - 对谁常接话 { [name]: count }
 * @returns {Promise<string|null>} 总结正文，失败返回 null
 */
async function generatePersonaSummary(displayName, name, samples, replyHabits = '', replyToWhom = {}) {
  if (!OPENAI_API_KEY) return null;
  const text = (Array.isArray(samples) ? samples : []).slice(-MAX_SAMPLES_FOR_SUMMARY).join('\n');
  if (!text || text.trim().length < 10) return null;

  const system = `你是一个人设分析助手。请根据该人在群聊中的真实发言，写一份**多而详细**的角色总结，供管理员查看和后续 AI 以该身份对话时参考。

数据来源说明：下列发言样本仅来自「原始导入的聊天记录」与「用户自主输入」（采集语气、真人登录后在群内发送的消息）；不包含 AI 在群内代发的内容。

要求：
1. 字数尽量多、内容详细（建议 500–1000 字，可更长），不要敷衍。
2. 必须分点或分段覆盖以下方面（每方面都要有实质内容）：
   - 性格与气质：整体给人什么感觉、处事风格。
   - 说话习惯：句式长短、是否爱用梗、网络用语、表情/语气词使用情况。
   - 常用词与口头禅：常出现的词、短语、开头或结尾习惯。
   - 语气与态度：调侃/认真/吐槽/接话/主动带话题等倾向。
   - 常聊话题：学习、工作、吃喝、游戏、二次元、日常等哪些出现多。
   - 与谁互动多：更常回复谁、和谁接话多（若已知）。
3. 不要大段列举原句，用概括性描述；可少量摘典型短句说明。
4. 只输出总结正文，不要标题、不要「总结：」等前缀。`;

  let user = `群昵称：${displayName}（英文名 ${name}）。\n\n`;
  if (replyHabits && String(replyHabits).trim()) {
    user += `已知回复习惯：${String(replyHabits).trim()}\n\n`;
  }
  if (replyToWhom && typeof replyToWhom === 'object' && Object.keys(replyToWhom).length) {
    const whom = Object.entries(replyToWhom)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 5)
      .map(([n, c]) => `${n}(${c}次)`).join('、');
    user += `统计上更常回复的人：${whom}\n\n`;
  }
  user += `其真实发言样本：\n${text}\n\n请按上述要求输出详细角色总结（只输出总结，不要其他）。`;

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
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_tokens: SUMMARY_MAX_TOKENS,
        temperature: 0.3
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('LLM 人设总结请求失败', res.status, err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    return summary ? summary.slice(0, SUMMARY_MAX_CHARS) : null;
  } catch (e) {
    console.warn('LLM 人设总结调用失败', e.message);
    return null;
  }
}

module.exports = {
  generatePersonaSummary,
  SUMMARY_MAX_CHARS
};

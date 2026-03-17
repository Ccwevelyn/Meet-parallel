/**
 * Serper 搜索：可选注入网络热点/时事到 AI 发言上下文
 * 需配置环境变量 SERPER_API_KEY，不配置则不请求
 */
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_URL = 'https://google.serper.dev/search';

/**
 * 执行一次搜索，返回摘要文本（最多约 500 字），失败或未配置 key 返回 null
 * @param {string} query - 搜索词，如 "今日热点" "二次元 新番"
 * @param {number} num - 结果条数，默认 5
 */
async function getSearchContext(query, num = 5) {
  if (!SERPER_API_KEY || !query || typeof query !== 'string') return null;
  const q = query.trim().slice(0, 100);
  if (!q) return null;
  try {
    const res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': SERPER_API_KEY
      },
      body: JSON.stringify({ q, num })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = data.organic || [];
    const lines = list.slice(0, num).map((o, i) => `${i + 1}. ${(o.title || '').trim()} ${(o.snippet || '').trim()}`).filter(Boolean);
    const text = lines.join('\n').slice(0, 500);
    return text || null;
  } catch (e) {
    return null;
  }
}

const TRENDS_CACHE_MS = 10 * 60 * 1000;
let _trendsCache = { text: null, at: 0 };

/**
 * 获取可注入到发言上下文的「热点/兴趣」摘要（今日热点 + 二次元/游戏），带 10 分钟缓存
 */
async function getTrendsContext() {
  if (Date.now() - _trendsCache.at < TRENDS_CACHE_MS && _trendsCache.text) return _trendsCache.text;
  const [hot, acg] = await Promise.all([
    getSearchContext('今日热点 微博 热搜', 3),
    getSearchContext('二次元 动漫 新番 游戏', 3)
  ]);
  const parts = [];
  if (hot) parts.push('【今日热点】\n' + hot);
  if (acg) parts.push('【二次元/游戏】\n' + acg);
  const text = parts.length ? parts.join('\n\n') : null;
  _trendsCache = { text, at: Date.now() };
  return text;
}

module.exports = { getSearchContext, getTrendsContext };

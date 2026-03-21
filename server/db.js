/**
 * SQLite 数据库：所有持久数据存于 DATA_DIR/app.db，部署时挂载磁盘即可持久化
 */
const Database = require('better-sqlite3');
const { getDataPath, ensureDataDir } = require('./data-path');

let db = null;

function getDb() {
  if (db) return db;
  ensureDataDir();
  const dbPath = getDataPath('app.db');
  if (process.env.DATA_DIR) {
    const path = require('path');
    const fs = require('fs');
    const seedPath = path.join(__dirname, '..', 'data', 'app.db');
    const needSeed = !fs.existsSync(dbPath) || (fs.statSync(dbPath).size === 0);
    if (needSeed && fs.existsSync(seedPath) && fs.statSync(seedPath).size > 0) {
      fs.copyFileSync(seedPath, dbPath);
      console.log('已用仓库内 data/app.db 作为种子，写入持久化目录');
    }
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const d = db;
  d.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      member_name TEXT,
      text TEXT NOT NULL,
      time TEXT,
      is_human INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS personas (
      name TEXT PRIMARY KEY,
      message_count INTEGER DEFAULT 0,
      sample_messages TEXT,
      active_hours TEXT,
      reply_habits TEXT,
      persona_summary TEXT,
      reply_to_whom TEXT,
      reply_rate REAL,
      updated_at TEXT
    );
  `);
  try { d.exec('ALTER TABLE personas ADD COLUMN persona_summary TEXT'); } catch (_) {}
  try { d.exec('ALTER TABLE personas ADD COLUMN reply_to_whom TEXT'); } catch (_) {}
  try { d.exec('ALTER TABLE personas ADD COLUMN reply_rate REAL'); } catch (_) {}
  try { d.exec('ALTER TABLE personas ADD COLUMN average_reply_delay_ms REAL'); } catch (_) {}
  try { d.exec('ALTER TABLE personas ADD COLUMN message_share REAL'); } catch (_) {}
  d.exec(`
    CREATE TABLE IF NOT EXISTS persona_vectors (
      persona_name TEXT NOT NULL,
      source TEXT NOT NULL,           -- chat_history | messages | collected_chat
      source_id INTEGER NOT NULL,     -- 对应源表的 id
      text TEXT NOT NULL,
      time TEXT,
      embedding TEXT NOT NULL,        -- JSON 数组
      updated_at TEXT,
      PRIMARY KEY (persona_name, source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_persona_vectors_persona ON persona_vectors(persona_name);
    CREATE INDEX IF NOT EXISTS idx_persona_vectors_updated ON persona_vectors(updated_at);

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      time TEXT
    );
    CREATE TABLE IF NOT EXISTS collected_chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      time TEXT
    );
    CREATE TABLE IF NOT EXISTS profiles (
      member_id TEXT PRIMARY KEY,
      bio TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS passwords (
      name TEXT PRIMARY KEY,
      password TEXT NOT NULL
    );
  `);
  migrateFromJsonIfNeeded();
  return db;
}

function initDb() {
  getDb();
}

function migrateFromJsonIfNeeded() {
  const fs = require('fs');
  const d = db;
  const count = d.prepare('SELECT COUNT(*) AS n FROM messages').get();
  if (count && count.n === 0) {
    const msgPath = getDataPath('messages.json');
    if (fs.existsSync(msgPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
        const list = Array.isArray(data.messages) ? data.messages : [];
        const stmt = d.prepare('INSERT INTO messages (member_id, member_name, text, time, is_human) VALUES (?, ?, ?, ?, ?)');
        const run = d.transaction(() => { for (const m of list) stmt.run(m.memberId || '', m.memberName || '', m.text || '', m.time || null, m.isHuman ? 1 : 0); });
        run();
        console.log('已从 messages.json 迁移', list.length, '条消息到数据库');
      } catch (e) {
        console.warn('迁移 messages.json 失败', e.message);
      }
    }
  }
  const personaCount = d.prepare('SELECT COUNT(*) AS n FROM personas').get();
  if (personaCount && personaCount.n === 0) {
    const pPath = getDataPath('personas.json');
    if (fs.existsSync(pPath)) {
      try {
        const personas = JSON.parse(fs.readFileSync(pPath, 'utf8'));
        if (personas && typeof personas === 'object') {
          const stmt = d.prepare('INSERT OR REPLACE INTO personas (name, message_count, sample_messages, active_hours, reply_habits, persona_summary, reply_to_whom, reply_rate, average_reply_delay_ms, message_share, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          const run = d.transaction(() => {
            for (const [name, p] of Object.entries(personas)) {
              stmt.run(name, p.messageCount ?? 0, JSON.stringify(p.sampleMessages || []), JSON.stringify(p.activeHours || []), (p.replyHabits || '').slice(0, 500), (p.personaSummary || '').slice(0, 6000), JSON.stringify(p.replyToWhom || {}), p.replyRate != null ? p.replyRate : 0, p.averageReplyDelayMs != null ? p.averageReplyDelayMs : null, p.messageShare != null ? p.messageShare : null, p.updatedAt || null);
            }
          });
          run();
          console.log('已从 personas.json 迁移', Object.keys(personas).length, '个人设到数据库');
        }
      } catch (e) {
        console.warn('迁移 personas.json 失败', e.message);
      }
    }
  }
}

// ---------- messages ----------
function messagesGetAll() {
  const rows = getDb().prepare('SELECT id, member_id AS memberId, member_name AS memberName, text, time, is_human AS isHuman FROM messages ORDER BY id').all();
  return rows.map(r => ({ ...r, isHuman: !!r.isHuman }));
}

function messagesAdd(msg) {
  const id = getDb().prepare(
    'INSERT INTO messages (member_id, member_name, text, time, is_human) VALUES (?, ?, ?, ?, ?)'
  ).run(msg.memberId, msg.memberName || '', msg.text, msg.time || null, msg.isHuman ? 1 : 0);
  return id.lastInsertRowid;
}

function messagesGetRecent(limit = 20) {
  const rows = getDb().prepare(
    'SELECT id, member_id AS memberId, member_name AS memberName, text, time, is_human AS isHuman FROM messages ORDER BY id DESC LIMIT ?'
  ).all(limit);
  return rows.reverse().map(r => ({ ...r, isHuman: !!r.isHuman }));
}

/** 仅真人发言（is_human=1），用于 RAG 等：不把 AI 代发言量混入「学人设」语料 */
function messagesGetHumanOnlyOrdered() {
  const rows = getDb().prepare(
    'SELECT id, member_id AS memberId, text, time FROM messages WHERE is_human = 1 ORDER BY id'
  ).all();
  return rows;
}

function messagesGetDates() {
  const rows = getDb().prepare(
    "SELECT DISTINCT substr(time, 1, 10) AS d FROM messages WHERE time IS NOT NULL AND time != '' AND length(time) >= 10 ORDER BY d DESC"
  ).all();
  return rows.map(r => r.d).filter(Boolean);
}

function messagesQuery(options = {}) {
  const { date, memberId, sinceId } = options;
  let sql = 'SELECT id, member_id AS memberId, member_name AS memberName, text, time, is_human AS isHuman FROM messages WHERE 1=1';
  const params = [];
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sql += ' AND time LIKE ?';
    params.push(date + '%');
  }
  if (memberId) {
    sql += ' AND member_id = ?';
    params.push(memberId);
  }
  if (sinceId) {
    sql += ' AND id > ?';
    params.push(sinceId);
  }
  sql += ' ORDER BY id';
  const rows = params.length ? getDb().prepare(sql).all(...params) : getDb().prepare(sql).all();
  return rows.map(r => ({ ...r, isHuman: !!r.isHuman }));
}

function messagesClearAll() {
  const info = getDb().prepare('DELETE FROM messages').run();
  return info.changes;
}

// ---------- persona_vectors (RAG 向量库，按 persona_name 逻辑分区) ----------
function personaVectorsUpsertMany(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const stmt = getDb().prepare(
    'INSERT OR REPLACE INTO persona_vectors (persona_name, source, source_id, text, time, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const run = getDb().transaction(() => {
    for (const r of rows) {
      if (!r || !r.personaName || !r.source || r.sourceId == null || !r.text || !r.embedding) continue;
      stmt.run(
        String(r.personaName),
        String(r.source),
        Number(r.sourceId),
        String(r.text).slice(0, 2000),
        r.time || null,
        typeof r.embedding === 'string' ? r.embedding : JSON.stringify(r.embedding),
        r.updatedAt || new Date().toISOString()
      );
    }
  });
  run();
  return rows.length;
}

function personaVectorsLoadByPersona(personaName, limit = 2000) {
  const name = String(personaName || '').trim();
  if (!name) return [];
  const lim = Math.max(1, Math.min(5000, Number(limit) || 2000));
  return getDb().prepare(
    'SELECT persona_name AS personaName, source, source_id AS sourceId, text, time, embedding FROM persona_vectors WHERE persona_name = ? ORDER BY source_id DESC LIMIT ?'
  ).all(name, lim);
}

function personaVectorsCount(personaName) {
  const name = String(personaName || '').trim();
  if (!name) return 0;
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM persona_vectors WHERE persona_name = ?').get(name);
  return row ? (row.n || 0) : 0;
}

// ---------- personas ----------
function personasLoadAll() {
  const rows = getDb().prepare('SELECT name, message_count AS messageCount, sample_messages AS sampleMessages, active_hours AS activeHours, reply_habits AS replyHabits, persona_summary AS personaSummary, reply_to_whom AS replyToWhom, reply_rate AS replyRate, average_reply_delay_ms AS averageReplyDelayMs, message_share AS messageShare, updated_at AS updatedAt FROM personas').all();
  const out = {};
  for (const r of rows) {
    out[r.name] = {
      name: r.name,
      messageCount: r.messageCount || 0,
      sampleMessages: r.sampleMessages ? JSON.parse(r.sampleMessages) : [],
      activeHours: r.activeHours ? JSON.parse(r.activeHours) : [],
      replyHabits: r.replyHabits || '',
      personaSummary: r.personaSummary || '',
      replyToWhom: r.replyToWhom ? (typeof r.replyToWhom === 'string' ? JSON.parse(r.replyToWhom) : r.replyToWhom) : {},
      replyRate: r.replyRate != null ? Number(r.replyRate) : 0,
      averageReplyDelayMs: r.averageReplyDelayMs != null ? Number(r.averageReplyDelayMs) : null,
      messageShare: r.messageShare != null ? Number(r.messageShare) : null,
      updatedAt: r.updatedAt || null
    };
  }
  return out;
}

function personasSaveAll(personas) {
  const stmt = getDb().prepare(
    'INSERT OR REPLACE INTO personas (name, message_count, sample_messages, active_hours, reply_habits, persona_summary, reply_to_whom, reply_rate, average_reply_delay_ms, message_share, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const run = getDb().transaction(() => {
    for (const [name, p] of Object.entries(personas)) {
      stmt.run(
        name,
        p.messageCount ?? 0,
        JSON.stringify(p.sampleMessages || []),
        JSON.stringify(p.activeHours || []),
        (p.replyHabits || '').slice(0, 500),
        (p.personaSummary || '').slice(0, 6000),
        JSON.stringify(p.replyToWhom || {}),
        p.replyRate != null ? p.replyRate : 0,
        p.averageReplyDelayMs != null ? p.averageReplyDelayMs : null,
        p.messageShare != null ? p.messageShare : null,
        p.updatedAt || new Date().toISOString()
      );
    }
  });
  run();
}

function personasSaveOne(name, p) {
  getDb().prepare(
    'INSERT OR REPLACE INTO personas (name, message_count, sample_messages, active_hours, reply_habits, persona_summary, reply_to_whom, reply_rate, average_reply_delay_ms, message_share, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    name,
    p.messageCount ?? 0,
    JSON.stringify(p.sampleMessages || []),
    JSON.stringify(p.activeHours || []),
    (p.replyHabits || '').slice(0, 500),
    (p.personaSummary || '').slice(0, 6000),
    JSON.stringify(p.replyToWhom || {}),
    p.replyRate != null ? p.replyRate : 0,
    p.averageReplyDelayMs != null ? p.averageReplyDelayMs : null,
    p.messageShare != null ? p.messageShare : null,
    p.updatedAt || new Date().toISOString()
  );
}

// ---------- chat_history (导入的群聊记录) ----------
function chatHistoryLoad() {
  const rows = getDb().prepare('SELECT sender, text, time FROM chat_history ORDER BY id').all();
  return rows;
}

function chatHistorySave(messages) {
  const stmt = getDb().prepare('INSERT INTO chat_history (sender, text, time) VALUES (?, ?, ?)');
  getDb().exec('DELETE FROM chat_history');
  const run = getDb().transaction(() => {
    for (const m of messages) {
      stmt.run(m.sender || '', m.text || '', m.time || null);
    }
  });
  run();
}

// ---------- collected_chat ----------
function collectedChatLoad() {
  const rows = getDb().prepare('SELECT sender, text, time FROM collected_chat ORDER BY id').all();
  return rows;
}

function collectedChatAppend(entry) {
  getDb().prepare('INSERT INTO collected_chat (sender, text, time) VALUES (?, ?, ?)').run(
    entry.sender || '',
    entry.text || '',
    entry.time || null
  );
}

// ---------- profiles ----------
function profilesLoadAll() {
  const rows = getDb().prepare('SELECT member_id AS memberId, bio, updated_at AS updatedAt FROM profiles').all();
  const out = {};
  for (const r of rows) {
    out[r.memberId] = { bio: r.bio || '', updatedAt: r.updatedAt };
  }
  return out;
}

function profileGet(memberId) {
  const row = getDb().prepare('SELECT bio FROM profiles WHERE member_id = ?').get(memberId);
  return row ? row.bio : '';
}

function profileSet(memberId, bio) {
  getDb().prepare('INSERT OR REPLACE INTO profiles (member_id, bio, updated_at) VALUES (?, ?, ?)').run(
    memberId,
    (bio || '').slice(0, 2000),
    new Date().toISOString()
  );
}

// ---------- passwords (用户修改的密码覆盖) ----------
function passwordsLoadAll() {
  const rows = getDb().prepare('SELECT name, password FROM passwords').all();
  const out = {};
  for (const r of rows) out[r.name] = r.password;
  return out;
}

function passwordSet(name, password) {
  getDb().prepare('INSERT OR REPLACE INTO passwords (name, password) VALUES (?, ?)').run(name, (password || '').slice(0, 200));
}

module.exports = {
  getDb,
  initDb,
  messagesGetAll,
  messagesAdd,
  messagesGetRecent,
  messagesGetHumanOnlyOrdered,
  messagesGetDates,
  messagesQuery,
  messagesClearAll,
  personaVectorsUpsertMany,
  personaVectorsLoadByPersona,
  personaVectorsCount,
  personasLoadAll,
  personasSaveAll,
  personasSaveOne,
  chatHistoryLoad,
  chatHistorySave,
  collectedChatLoad,
  collectedChatAppend,
  profilesLoadAll,
  profileGet,
  profileSet,
  passwordsLoadAll,
  passwordSet
};

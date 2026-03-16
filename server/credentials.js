const path = require('path');
const fs = require('fs');
const { getAllMembers } = require('./members');
const { getDataPath, ensureDataDir } = require('./data-path');

const PASSWORDS_FILE = getDataPath('passwords.json');
const DEFAULT_PASSWORD = '123456';

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn('读取失败:', filePath, e.message);
  }
  return null;
}

function loadCredentials() {
  const fromEnv = process.env.LOGIN_CREDENTIALS;
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv);
    } catch (_) {
      console.warn('LOGIN_CREDENTIALS 格式无效');
    }
  }
  const fromFile = loadJson(path.join(__dirname, 'credentials.json'))
    || loadJson(path.join(__dirname, '..', 'credentials.json'));
  if (fromFile && typeof fromFile === 'object') return fromFile;
  return null;
}

function loadPasswordOverrides() {
  const data = loadJson(PASSWORDS_FILE);
  return (data && typeof data === 'object') ? data : {};
}

let baseCredentials;
let singlePassword;
try {
  baseCredentials = loadCredentials();
  singlePassword = process.env.LOGIN_PASSWORD;
} catch (e) {
  console.warn('credentials 初始化', e.message);
  baseCredentials = null;
  singlePassword = null;
}

/** 未配置 credentials 时使用全体成员默认密码 123456，无需单独配置文件 */
function getCredentials() {
  let overrides = {};
  try {
    overrides = loadPasswordOverrides();
  } catch (e) {
    console.warn('getCredentials overrides', e.message);
  }
  if (baseCredentials && typeof baseCredentials === 'object') {
    return { ...baseCredentials, ...overrides };
  }
  try {
    const members = getAllMembers();
    if (!Array.isArray(members) || !members.length) return { ...overrides };
    if (singlePassword) {
      const byName = {};
      members.forEach(m => { byName[m.name] = singlePassword; });
      return { ...byName, ...overrides };
    }
    const defaultCreds = {};
    members.forEach(m => { defaultCreds[m.name] = DEFAULT_PASSWORD; });
    return { ...defaultCreds, ...overrides };
  } catch (e) {
    console.warn('getCredentials', e.message);
    return { ...overrides };
  }
}

function checkPassword(username, password) {
  return getCredentials()[username] === password;
}

function updatePassword(name, newPassword) {
  if (!name || typeof newPassword !== 'string' || newPassword.length < 1) return false;
  ensureDataDir();
  const current = loadPasswordOverrides();
  current[name] = newPassword.slice(0, 200);
  fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(current, null, 2), 'utf8');
  return true;
}

module.exports = { checkPassword, updatePassword };

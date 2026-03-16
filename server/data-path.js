const path = require('path');
const fs = require('fs');

/**
 * 数据目录：优先使用环境变量 DATA_DIR（便于 Render 等挂载持久化磁盘），否则用项目下 data/
 * 这样部署时把 DATA_DIR 设为挂载点（如 /data），人设、聊天记录、密码等会持久保留
 */
function getDataDir() {
  const fromEnv = process.env.DATA_DIR;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return path.join(__dirname, '..', 'data');
}

function getDataPath(relativePath) {
  return path.join(getDataDir(), relativePath);
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { getDataDir, getDataPath, ensureDataDir };

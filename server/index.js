try { require('dotenv').config(); } catch (_) {}
const path = require('path');
const express = require('express');
const { getDataDir } = require('./data-path');
const { authRouter } = require('./auth');
const { messagesRouter } = require('./messages');
const { avatarRouter } = require('./avatar');
const { profileRouter } = require('./profile');
const { collectRouter } = require('./collect');
const { adminRouter } = require('./admin');
const { presenceRouter } = require('./presence');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

// 健康检查：确认后端已启动（返回 503 时先访问此接口排查）
app.get('/api/health', (req, res) => res.json({ ok: true, message: '服务运行中' }));

// API 优先，避免被 static 或后续 * 拦截
app.use('/api/auth', authRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/avatar', avatarRouter);
app.use('/api/profile', profileRouter);
app.use('/api/collect', collectRouter);
app.use('/api/admin', adminRouter);
app.use('/api/presence', presenceRouter);
// 未匹配的 /api 请求统一返回 JSON 404，避免前端收到 HTML 导致「响应格式错误」
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('请求错误', err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器错误，请重试' });
});

const server = app.listen(PORT, () => {
  console.log(`在平行时空再见 · 运行于 http://localhost:${PORT}`);
  const dataDir = getDataDir();
  if (process.env.DATA_DIR) {
    console.log('数据目录（持久化）:', dataDir);
  } else if (process.env.PORT) {
    console.warn('未设置 DATA_DIR，当前为临时磁盘，重启/重新部署后数据会丢失。部署后要持久存储请添加 Disk 并设置环境变量 DATA_DIR（如 /data）。');
  }
});
server.on('error', (err) => {
  console.error('服务启动错误', err.message || err);
  if (err.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用，可设置环境变量 PORT=其他端口 或关闭占用进程`);
});

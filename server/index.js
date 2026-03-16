try { require('dotenv').config(); } catch (_) {}
const path = require('path');
const express = require('express');
const { authRouter } = require('./auth');
const { messagesRouter } = require('./messages');
const { avatarRouter } = require('./avatar');
const { profileRouter } = require('./profile');
const { collectRouter } = require('./collect');
const { adminRouter } = require('./admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
// API 优先，避免被 static 或后续 * 拦截
app.use('/api/auth', authRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/avatar', avatarRouter);
app.use('/api/profile', profileRouter);
app.use('/api/collect', collectRouter);
app.use('/api/admin', adminRouter);

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
});
server.on('error', (err) => {
  console.error('服务启动错误', err.message || err);
  if (err.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用，可设置环境变量 PORT=其他端口 或关闭占用进程`);
});

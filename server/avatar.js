const path = require('path');
const fs = require('fs');
const express = require('express');
const { getMemberByIdOrName } = require('./members');

const router = express.Router();
// 支持两种路径：相对 server 目录、相对当前工作目录（避免启动目录不同导致读不到）
const AVATARS_DIR = path.resolve(__dirname, '..', 'public', 'avatars');
const AVATARS_DIR_CWD = path.resolve(process.cwd(), 'public', 'avatars');

if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function findAvatarPath(id) {
  for (const e of EXT) {
    const p1 = path.join(AVATARS_DIR, id + e);
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(AVATARS_DIR_CWD, id + e);
    if (fs.existsSync(p2)) return p2;
  }
  return null;
}

router.get('/:memberId', (req, res) => {
  const member = getMemberByIdOrName((req.params.memberId || '').trim());
  if (!member) return res.status(404).end();
  const filePath = findAvatarPath(member.id);
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : (ext === '.svg' ? 'svg+xml' : ext.slice(1));
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.type('image/' + mime).sendFile(filePath, { maxAge: 300 });
  }
  // 无头像时返回 404，前端 onerror 会显示占位（灰圈/首字）
  return res.status(404).end();
});

module.exports = { avatarRouter: router };

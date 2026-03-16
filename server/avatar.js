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
const DEFAULT_AVATAR = 'default.svg';

function findAvatarPath(id) {
  for (const e of EXT) {
    const p1 = path.join(AVATARS_DIR, id + e);
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(AVATARS_DIR_CWD, id + e);
    if (fs.existsSync(p2)) return p2;
  }
  return null;
}

function getDefaultAvatarPath() {
  const p1 = path.join(AVATARS_DIR, DEFAULT_AVATAR);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(AVATARS_DIR_CWD, DEFAULT_AVATAR);
  return fs.existsSync(p2) ? p2 : null;
}

// Tree(member_12) 与 烟火(member_13) 头像文件若放反，在此互换显示
const AVATAR_SWAP = { member_12: 'member_13', member_13: 'member_12' };

function resolveAvatarId(id) {
  return AVATAR_SWAP[id] || id;
}

function hasAvatarFile(id) {
  return !!findAvatarPath(resolveAvatarId(id));
}

router.get('/:memberId', (req, res) => {
  const member = getMemberByIdOrName((req.params.memberId || '').trim());
  if (!member) return res.status(404).end();
  const fileId = resolveAvatarId(member.id);
  let filePath = findAvatarPath(fileId);
  if (!filePath) filePath = getDefaultAvatarPath();
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : (ext === '.svg' ? 'svg+xml' : ext.slice(1));
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.type('image/' + mime).sendFile(filePath, { maxAge: 300 });
  }
  const EMPTY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.type('image/gif').send(EMPTY_GIF);
});

module.exports = { avatarRouter: router, hasAvatarFile };

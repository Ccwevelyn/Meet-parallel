const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('./auth');
const { getMemberById, getMemberByIdOrName } = require('./members');
const { hasAvatarFile } = require('./avatar');

const router = express.Router();
const db = require('./db');
const AVATARS_DIR = path.join(__dirname, '..', 'public', 'avatars');

if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATARS_DIR),
  filename: (req, file, cb) => {
    const id = (req.user && req.user.memberId || '').replace(/[^a-z0-9_]/gi, '') || 'tmp';
    const ext = (path.extname(file.originalname) || '').toLowerCase() || '.jpg';
    const safe = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, id + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype));
  }
});

// GET /api/profile/:memberId — 支持 id（member_1）或英文名（Cheng），任何人可读
router.get('/:memberId', (req, res) => {
  const raw = (req.params.memberId || '').trim();
  const member = getMemberByIdOrName(raw);
  if (!member) return res.status(404).json({ error: '成员不存在' });
  const id = member.id;
  const bio = db.profileGet(id);
  res.json({
    memberId: id,
    displayName: member.displayName || member.name,
    bio,
    avatarUrl: '/api/avatar/' + id,
    hasAvatar: hasAvatarFile(id)
  });
});

// POST /api/profile — 登录后更新自己的头像和/或人物小传
router.post('/', requireAuth, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '图片不能超过 2MB' });
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    const id = (req.user.memberId || '').replace(/[^a-z0-9_]/gi, '');
    if (typeof req.body.bio === 'string') db.profileSet(id, req.body.bio.trim().slice(0, 2000));
    if (req.file) {
      const currentName = req.file.filename || '';
      ['.jpg', '.jpeg', '.png', '.gif', '.webp'].forEach(e => {
        const p = path.join(AVATARS_DIR, id + e);
        if ((id + e) !== currentName) {
          try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
        }
      });
    }
    const bio = db.profileGet(id);
    res.json({ ok: true, bio: bio || '', avatarUrl: '/api/avatar/' + id });
  });
});

module.exports = { profileRouter: router };

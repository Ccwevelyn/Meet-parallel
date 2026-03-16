#!/usr/bin/env node
/**
 * 从数据库 messages 表中删除包含指定无意义关键词的消息。
 * 用于清理 Render 磁盘（或本地 data）里之前测试产生的废话。
 *
 * 用法：
 *   本地：node scripts/cleanup-messages.js
 *   Render 磁盘：DATA_DIR=/data node scripts/cleanup-messages.js
 *   或指定目录：node scripts/cleanup-messages.js /data
 */
const path = require('path');

// 第一个参数可覆盖 DATA_DIR
if (process.argv[2]) {
  process.env.DATA_DIR = path.resolve(process.argv[2]);
}

const { getDb } = require('../server/db');

// 仅删除内容包含以下关键词的消息；可按需增删
const MEANINGLESS_PHRASES = [
  '男的哥们',
  '啊啊啊',
  '呃呃',
  '在吗',
  '在不在',
  '有人吗',
  '测试',
  'test',
  '111',
  '222',
  '666',
  '888'
];

function main() {
  const db = getDb();
  const likeConditions = MEANINGLESS_PHRASES.map(() => 'text LIKE ?').join(' OR ');
  const params = MEANINGLESS_PHRASES.map(p => `%${p}%`);

  // 先查数量
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${likeConditions}`);
  const { n } = countStmt.get(...params);

  if (n === 0) {
    console.log('没有匹配到需要删除的消息。');
    return;
  }

  const deleteStmt = db.prepare(`DELETE FROM messages WHERE ${likeConditions}`);
  const info = deleteStmt.run(...params);
  console.log('已删除', info.changes, '条无意义消息。');
}

main();

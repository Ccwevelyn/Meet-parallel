#!/usr/bin/env node
/**
 * 删除 personas 表中第 14、15 条无效记录（误导入的「2. 输入法」「3. gcc&gdb&Makefile&Cmake」）
 * 用法：node scripts/remove-junk-personas.js [DATA_DIR]
 */
const path = require('path');
if (process.argv[2]) process.env.DATA_DIR = path.resolve(process.argv[2]);

const db = require('../server/db');

const JUNK_NAMES = ['2. 输入法', '3. gcc&gdb&Makefile&Cmake'];

function main() {
  const d = db.getDb();
  let deleted = 0;
  for (const name of JUNK_NAMES) {
    const info = d.prepare('DELETE FROM personas WHERE name = ?').run(name);
    if (info.changes > 0) {
      deleted += info.changes;
      console.log('已删除 persona:', name);
    }
  }
  console.log('共删除', deleted, '条无效 persona 记录');
}

main();

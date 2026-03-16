#!/usr/bin/env node
/**
 * 将 server 目录下的 JS 混淆后输出到 dist/server/，使源码难以直接阅读。
 * 运行：npm run build:secure  启动混淆版：npm run start:secure（需先 build，且 DATA_DIR 指向项目 data 或持久化目录）
 */
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const OUT_DIR = path.join(__dirname, '..', 'dist', 'server');

const NODE_RESERVED = [
  'require', 'module', 'exports', '__dirname', '__filename',
  'process', 'Buffer', 'global', 'console', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'JSON', 'Array', 'Object', 'Function',
  'String', 'Number', 'Boolean', 'Math', 'Date', 'Error', 'RegExp',
  'Symbol', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect'
];

const obfuscatorOptions = {
  target: 'node',
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  reservedNames: NODE_RESERVED,
  reservedStrings: [],
  rotateStringArray: false,
  selfDefending: false,
  stringArray: false,
  stringArrayEncoding: [],
  stringArrayWrappersCount: 0,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
};

if (!fs.existsSync(SERVER_DIR)) {
  console.error('server 目录不存在');
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const files = fs.readdirSync(SERVER_DIR).filter(f => f.endsWith('.js'));
let ok = 0;
for (const file of files) {
  const srcPath = path.join(SERVER_DIR, file);
  const code = fs.readFileSync(srcPath, 'utf8');
  try {
    const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions).getObfuscatedCode();
    fs.writeFileSync(path.join(OUT_DIR, file), obfuscated, 'utf8');
    ok++;
    console.log('混淆:', file);
  } catch (e) {
    console.error('混淆失败:', file, e.message);
  }
}

console.log('完成:', ok, '/', files.length, '个文件 → dist/server/');
console.log('启动混淆版: npm run start:secure（请设置 DATA_DIR 指向 data 目录，如 ./data）');

/**
 * 启动包装：WorkBuddy 云部署专用
 * 从同目录 .runtime-env.json 读取运行环境（该文件不入 git、只存在于部署目录），
 * 然后加载 server.js。平台注入的 PORT 优先，保证监听 0.0.0.0。
 */
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '.runtime-env.json');
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  console.error('start.js: 缺少或无法读取 .runtime-env.json（含运行环境配置，不随 git 分发）');
  process.exit(1);
}

process.env.NODE_ENV = cfg.NODE_ENV || 'production';
process.env.DATA_DIR = path.resolve(__dirname, cfg.DATA_DIR || 'data');
if (cfg.TEAM_USER) process.env.TEAM_USER = cfg.TEAM_USER;
if (cfg.TEAM_PASSWORD) process.env.TEAM_PASSWORD = cfg.TEAM_PASSWORD;
if (cfg.TEAM_GATEWAY === '1') process.env.TEAM_GATEWAY = '1';
// PORT 不覆盖：优先使用发布平台注入的 PORT，其次用配置里的端口，最后默认 3000
if (!process.env.PORT && cfg.PORT) process.env.PORT = String(cfg.PORT);

require('./server.js');

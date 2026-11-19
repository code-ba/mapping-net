const fs = require('fs');
const path = require('path');
const Configstore = require('configstore').default;
const log = require('npmlog');

// 日志收集目录：configstore 持久化（logDir），未设置则取当前执行目录
const configStore = new Configstore('mapping-net');
const logDir = configStore.get('logDir') || process.cwd();

// 日志角色：client / server，用于区分日志文件
let logRole = '';
const setLogRole = (role) => {
  logRole = role;
};

// 清理 ANSI 颜色码，保证日志文件内容干净
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(ESC + '\\[\\d+m', 'g');
const stripAnsi = (str) => String(str).replace(ANSI_RE, '');

// 按天追加日志：YYYY-MM/YYYY-MM-DD[-client|-server].txt
log.on('log', (m) => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = `${month}-${String(now.getDate()).padStart(2, '0')}`;
  const monthDir = path.join(logDir, month);
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':');
  const roleSuffix = logRole ? `-${logRole}` : '';
  const line = `[${time}] [${m.level}] ${stripAnsi(m.prefix || '-')} ${stripAnsi(m.message)}\n`;
  try {
    fs.mkdirSync(monthDir, { recursive: true });
    fs.appendFileSync(path.join(monthDir, `${day}${roleSuffix}.txt`), line);
  } catch (error) {
    // 日志写文件失败不影响正常运行
  }
});

module.exports = { setLogRole };

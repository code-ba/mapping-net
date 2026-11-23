const { Spinner } = require('cli-spinner');
const log = require('npmlog');

// 多任务复用同一个 spinner，避免多个定时器交叉写终端；仅 TTY 输出动画，非 TTY 静默
let sharedSpinner;
let spinnerTaskId = 0;
const spinnerTasks = new Map();
const syncSpinner = () => {
  const texts = Array.from(spinnerTasks.values());
  const text = texts[texts.length - 1];
  if (!text) {
    if (sharedSpinner && sharedSpinner.isSpinning()) sharedSpinner.stop(true);
    sharedSpinner = null;
    return;
  }
  if (!sharedSpinner) {
    sharedSpinner = new Spinner({ stream: process.stderr });
    sharedSpinner.setSpinnerString('|/-\\');
  }
  sharedSpinner.setSpinnerTitle(`${text} %s`);
  if (process.stderr.isTTY === true && !sharedSpinner.isSpinning()) sharedSpinner.start();
};
const withSpinner = async (text, task) => {
  const id = ++spinnerTaskId;
  spinnerTasks.set(id, text);
  syncSpinner();
  try {
    return await task();
  } finally {
    spinnerTasks.delete(id);
    syncSpinner();
  }
};

// npmlog 的 log 事件先于实际写流触发：写日志前停止动画并显式换行，保证日志另起一行，不与动画文字同行
log.on('log', () => {
  if (sharedSpinner && sharedSpinner.isSpinning()) {
    sharedSpinner.stop();
    log.stream.write('\n');
  }
});

module.exports = { withSpinner };

#! /usr/bin/env node
const importLocal = require('import-local');
if (importLocal(__filename)) {
  require('npmlog').info('正在使用本地版本');
} else {
  try {
    require('../lib')(process.argv.slice(2));
  } catch (error) {
    // 配置文件错误等加载期异常：只输出错误信息，不打印堆栈
    require('npmlog').error(error.message);
  }
}

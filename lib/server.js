const net = require('net');
const { execFile } = require('child_process');
const { Spinner } = require('cli-spinner');
require('colors');
const log = require('npmlog');
const { setLogRole } = require('./log-file');
const path = require('path');
const { existsSync, readFileSync } = require('fs');
const { parse } = require('yaml');
// 配置：config-server.yml 不一定存在，不存在则用内置默认值
const configPath = path.resolve('.', 'config-server.yml');
const CONFIG = {
  ip: '0.0.0.0', // 公网服务监听地址；回环地址无法通过公网预检
  port: 10000, //服务端端口
  token: 'sk-123456', //连接令牌
  ...(existsSync(configPath) ? parse(readFileSync(configPath, 'utf8')) : {}),
};

// 配置转 yml 文本（带注释、代码块包裹）
const formatConfigYml = () => {
  return [
    'config-server.yml',
    '```yaml',
    `ip: '${CONFIG.ip}'         # 公网服务一般使用 0.0.0.0；回环地址无法通过公网预检`,
    `port: ${CONFIG.port}           # 非必填，服务端端口，客户端和服务端必须保持一致`,
    `token: '${CONFIG.token}'           # 非必填，连接令牌，客户端和服务端必须保持一致`,
    '```',
  ].join('\n');
};

const CHECK_OPTIONS = { timeout: 2000, windowsHide: true };

// 多客户端可能同时注册，复用同一个 spinner，避免多个定时器交叉写终端
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

// 返回 UFW 中第一条匹配控制端口的规则；UFW 按规则顺序匹配，不能把后置 ALLOW 误判为已放行
const findUfwTcpRule = (output, port) => {
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line
      .trim()
      .match(
        /^(\d+(?::\d+)?)(?:\/(tcp|udp))?(?:\s+\(v6\))?\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+IN)?\s+/i
      );
    if (!match || (match[2] && match[2].toLowerCase() !== 'tcp')) continue;
    const [start, end] = match[1].split(':').map(Number);
    if (port >= start && port <= (end || start)) return match[3].toUpperCase();
  }
  return null;
};

const formatCommandError = (tool, error) => {
  if (error && error.code === 'ENOENT') return `${tool} 不可用`;
  if (error && error.killed) return `${tool} 查询超时`;
  return `${tool} 查询失败：${error ? error.message : '返回内容无法识别'}`;
};

const checkFirewalld = () => {
  return new Promise((resolve, reject) => {
    execFile(
      'firewall-cmd',
      [`--query-port=${CONFIG.port}/tcp`],
      CHECK_OPTIONS,
      (error, stdout) => {
        const result = String(stdout || '')
          .trim()
          .toLowerCase();
        if (!error && result === 'yes') {
          resolve(`firewalld 已放行入站 TCP ${CONFIG.port}`);
          return;
        }
        if (result === 'no' || (error && error.code === 1)) {
          reject(new Error(`firewalld 未放行入站 TCP ${CONFIG.port}`));
          return;
        }
        reject(new Error(formatCommandError('firewalld', error)));
      }
    );
  });
};

const checkServerFirewall = () => {
  if (CONFIG.ip === '127.0.0.1' || CONFIG.ip === '::1') {
    return Promise.reject(
      new Error(`当前仅监听回环地址 ${CONFIG.ip}，外网客户端无法连接；请使用 0.0.0.0 或 ::`)
    );
  }
  if (process.platform !== 'linux') {
    return Promise.reject(new Error(`当前系统 ${process.platform} 不支持自动防火墙校验`));
  }
  return new Promise((resolve, reject) => {
    execFile('ufw', ['status'], CHECK_OPTIONS, (error, stdout) => {
      if (error) {
        if (error.code === 'ENOENT') {
          checkFirewalld().then(resolve, reject);
          return;
        }
        reject(new Error(formatCommandError('UFW', error)));
        return;
      }
      const status = String(stdout || '');
      if (/Status:\s+inactive/i.test(status)) {
        resolve('UFW 当前未启用，不拦截本机入站连接');
        return;
      }
      if (!/Status:\s+active/i.test(status)) {
        reject(new Error('无法识别 UFW 状态'));
        return;
      }
      const rule = findUfwTcpRule(status, CONFIG.port);
      if (rule === 'ALLOW' || rule === 'LIMIT') {
        resolve(`UFW 已放行入站 TCP ${CONFIG.port}（${rule}）`);
        return;
      }
      const ruleText = rule ? `命中 ${rule} 规则` : '未发现对应 ALLOW 规则';
      reject(new Error(`UFW 已启用，TCP ${CONFIG.port} ${ruleText}`));
    });
  });
};

const validateServerConfig = () => {
  if (typeof CONFIG.ip !== 'string' || net.isIP(CONFIG.ip) === 0) {
    log.error('服务端配置错误', `ip 必须是有效 IP 地址，当前值：${CONFIG.ip}`);
    process.exitCode = 1;
    return false;
  }
  const port = Number(CONFIG.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    log.error('服务端配置错误', `port 必须是 1-65535 的整数，当前值：${CONFIG.port}`);
    process.exitCode = 1;
    return false;
  }
  CONFIG.port = port;
  return true;
};

const getPublicIp = () => {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      [
        '--connect-timeout',
        '2',
        '--max-time',
        '3',
        '--silent',
        '--show-error',
        'https://ip.cxvh.com/',
      ],
      { timeout: 4000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(new Error(`公网 IP 查询失败或超时：${error.message}`));
          return;
        }
        const publicIp = String(stdout || '').trim();
        if (net.isIP(publicIp) === 0) {
          reject(new Error(`公网 IP 查询返回无效内容：${publicIp || '<空>'}`));
          return;
        }
        resolve(publicIp);
      }
    );
  });
};

const checkPublicConnection = (publicIp) => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: publicIp, port: CONFIG.port });
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`连接 ${publicIp}:${CONFIG.port} 超时（3000ms）`));
    }, 3000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        socket.destroy();
        reject(error);
        return;
      }
      socket.end();
      resolve();
    };
    socket.once('connect', () => finish());
    socket.on('error', (error) => {
      finish(new Error(`无法连接 ${publicIp}:${CONFIG.port}：${error.message}`));
    });
  });
};

const printClientExamples = (publicIp) => {
  log.info(
    '转发示例：',
    `本地地址(http://127.0.0.1:8080) ------> 公网地址(http://${publicIp}:8080)`.cyan
  );
  log.info(
    '客户端完整指令：',
    `mapping client --server "${publicIp}:${CONFIG.port}@${CONFIG.token}" --ports "127.0.0.1:8080:8080"`
      .cyan
  );
  log.info(
    '客户端指令简写：',
    `mapping client --server "${publicIp}:${CONFIG.port}@${CONFIG.token}" --ports "8080:8080"`.cyan
      .bold.underline
  );
};

// 客户端连接集
let linkClients = {};
// 客户端绑定的应用
let clientBings = {};
// 连接记录
let socketRecords = {};
// 成对关闭访问端和转发端；记录先删除，避免 close 事件重复清理
const closeSocketRecord = (id) => {
  const record = socketRecords[id];
  if (!record) return;
  delete socketRecords[id];
  if (record.client && !record.client.destroyed) record.client.end();
  if (record.bind && !record.bind.destroyed) record.bind.end();
};
// 删除控制连接、转发监听及关联的访问连接
const removeInfo = function (id) {
  if (linkClients[id]) {
    linkClients[id] = null;
    delete linkClients[id];
  }
  for (let k in clientBings) {
    let d = clientBings[k];
    if (id == d.linkId) {
      if (d.forwardServer) d.forwardServer.close();
      clientBings[k] = null;
      delete clientBings[k];
    }
  }
  for (const recordId in socketRecords) {
    if (socketRecords[recordId].linkId === id) closeSocketRecord(recordId);
  }
};
// 端口转发服务 用于开放访问
function createForwardServer(conf) {
  const remotePort = Number(conf.remote_port);
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535) {
    log.error(conf.name, `远程端口无效：${conf.remote_port}，本次注册将失败`);
    return null;
  }
  let forwardServer = net.createServer((socket) => {
    // 判断客户是否在线
    if (!linkClients[conf.linkId]) return socket.end();
    let id = [socket.remoteAddress, socket.remoteFamily, socket.remotePort].join('_');
    if (!socketRecords[id]) {
      socketRecords[id] = { bind: socket, client: null, linkId: conf.linkId, name: conf.name };
    }
    socket.on('error', (err) => {
      log.error(conf.name, `访问连接异常 ${id}：${err.message}`);
      socket.destroy();
    });
    socket.on('end', () => log.info(conf.name, `访问连接断开 ${id}`));
    // 无论访问端是否已建立转发通道，关闭时都必须成对清理
    socket.once('close', () => closeSocketRecord(id));
    if (conf.linkSocket.destroyed) {
      closeSocketRecord(id);
      return;
    }
    // 通知客户端建立本次访问的转发通道
    conf.linkSocket.write(JSON.stringify({ key: id, name: conf.name, code: conf.code }));
  });
  forwardServer.on('error', (err) => {
    const message =
      err.code === 'EADDRINUSE'
        ? `远程端口 ${remotePort} 已被占用，本次注册将回滚`
        : `转发服务异常，远程端口 ${remotePort}：${err.message}`;
    log.error(conf.name, message);
    // 先移除出错绑定；注册结果汇总后会统一回滚本次注册的其他监听
    if (conf.bindKey) delete clientBings[conf.bindKey];
  });
  forwardServer.listen(remotePort, () => {
    log.info(conf.name, `转发服务开启 ${conf.local_port}<===>${conf.remote_port}`);
  });
  return forwardServer;
}
// 等待真实监听结果，register 必须在端口检查完成后才能响应客户端
const waitForForwardServer = (forwardServer) => {
  if (!forwardServer) return Promise.resolve(new Error('远程端口无效'));
  if (forwardServer.listening) return Promise.resolve(null);
  return new Promise((resolve) => {
    const cleanup = () => {
      forwardServer.off('listening', onListening);
      forwardServer.off('error', onError);
    };
    const onListening = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error) => {
      cleanup();
      resolve(error);
    };
    forwardServer.once('listening', onListening);
    forwardServer.once('error', onError);
  });
};
// 远程监听访问 用于穿透
const listenServer = net.createServer((socket) => {
  let id = [socket.remoteAddress, socket.remoteFamily, socket.remotePort].join('_');
  let registered = false;
  // TCP 建连不代表认证或注册成功，详细信息仅写入 verbose 日志
  log.verbose('客户端 TCP 连接', `${socket.remoteAddress}:${socket.remotePort}`);
  if (!linkClients[id]) {
    // 保存连接
    linkClients[id] = socket;
    socket.on('data', async (data) => {
      try {
        try {
          data = JSON.parse(data);
        } catch (error) {
          return;
        }
        let [token, type, code, binds] = [data.token, data.type, data.code, data.binds];
        // 校验连接令牌，与服务端配置不一致时断开；日志不记录令牌内容
        if (token != CONFIG.token) {
          log.warn('客户端认证失败', `${socket.remoteAddress}:${socket.remotePort} token 不匹配`);
          return socket.end();
        }
        if (type == 'register') {
          // 先启动本次全部转发并等待监听结果，任一端口失败则回滚，不向客户端报告成功
          const registrations = [];
          for (let k in binds) {
            let d = binds[k];
            // 存储键带上连接 id：多客户端的同名绑定（如各自的 bind-0）互不冲突
            const bindKey = `${id}_${k}`;
            if (!clientBings[bindKey]) {
              [d.code, d.name, d.linkSocket, d.linkId] = [data.code, k, socket, id];
              d.bindKey = bindKey;
              d.forwardServer = createForwardServer(d); //绑定客户端App对应服务端开放的端口服务
              if (d.forwardServer) clientBings[bindKey] = d;
            } else {
              d = clientBings[bindKey];
            }
            registrations.push({
              name: k,
              remote_port: d.remote_port,
              forwardServer: d.forwardServer || null,
            });
          }
          const results = await withSpinner('正在注册端口映射', () =>
            Promise.all(
              registrations.map(async (registration) => ({
                ...registration,
                error: await waitForForwardServer(registration.forwardServer),
              }))
            )
          );
          const errors = results
            .filter((result) => result.error)
            .map((result) => ({
              name: result.name,
              remote_port: result.remote_port,
              message:
                result.error.code === 'EADDRINUSE'
                  ? `远程端口 ${result.remote_port} 已被占用`
                  : `远程端口 ${result.remote_port} 监听失败：${result.error.message}`,
            }));
          if (errors.length > 0) {
            removeInfo(id);
            if (socket.destroyed) return;
            return socket.write(JSON.stringify({ code, type, id, success: false, errors }), () =>
              socket.end()
            );
          }
          if (socket.destroyed) return removeInfo(id);
          registered = true;
          log.info(
            '客户端注册成功',
            `${socket.remoteAddress}:${socket.remotePort}，绑定 ${registrations.length} 项`
          );
          return socket.write(JSON.stringify({ code, type, id, success: true }));
        } else if (type == 'connect') {
          // 客户端连接
          let id = data.key;
          let socketRecord = socketRecords[id];
          if (socketRecord && socketRecord.bind && !socketRecord.client) {
            socketRecord.client = socket;
            const recordName = socketRecord.name || '数据转发';
            log.verbose(recordName, `数据转发通道建立 ${id}`);
            // 数据转发
            socket.pipe(socketRecord.bind);
            socketRecord.bind.pipe(socket);
            socketRecord.bind.on('end', () => {
              log.info(recordName, `数据转发结束 ${id}`);
              socket.end();
            });
            socketRecord.bind.on('error', (err) => {
              log.error(recordName, `数据转发异常 ${id}：${err.message}`);
              socket.end();
            });
            // 转发通道先断开时，也要关闭对应访问端，避免悬挂连接
            socket.once('close', () => {
              const record = socketRecords[id];
              if (record && record.client === socket) closeSocketRecord(id);
            });
            return;
          }
        }
      } catch (error) {
        log.error('客户端消息处理异常', error.message);
        removeInfo(id);
      }
      socket.end();
    });
    socket.on('error', (err) => {
      log.error('客户端连接异常', err.message);
      removeInfo(id);
    });
    // close 覆盖正常断开和异常重置，确保资源最终回收
    socket.once('close', () => {
      if (registered) log.info('客户端已断开', `${socket.remoteAddress}:${socket.remotePort}`);
      else log.verbose('客户端 TCP 连接关闭', id);
      removeInfo(id);
    });
  }
});
// 控制端口监听失败时给出明确提示，避免未处理的 error 事件导致进程异常崩溃
listenServer.on('error', (err) => {
  const address = `${CONFIG.ip}:${CONFIG.port}`;
  if (err.code === 'EADDRINUSE') {
    log.error('服务端启动失败', `端口 ${address} 已被占用，请更换 --port 或释放该端口`);
  } else if (err.code === 'EACCES') {
    log.error('服务端启动失败', `没有权限监听 ${address}，请更换端口或提升权限`);
  } else {
    log.error('服务端监听异常', `${address}：${err.message}`);
  }
  process.exitCode = 1;
});
const stopServerOnPreflightFailure = (step, error) => {
  const detail = error && error.message ? error.message : String(error);
  log.error('服务端启动预检失败', `${step}：${detail}，服务停止`);
  process.exitCode = 1;
  for (const id in linkClients) {
    const socket = linkClients[id];
    if (socket && !socket.destroyed) socket.destroy();
  }
  const forceExit = setTimeout(() => process.exit(1), 1000);
  listenServer.close(() => {
    clearTimeout(forceExit);
    process.exit(1);
  });
};

const runStartupChecks = async () => {
  try {
    const result = await withSpinner('[1/3] 正在检测防火墙', checkServerFirewall);
    log.info('服务端启动预检', `[1/3] ${result}`);
  } catch (error) {
    stopServerOnPreflightFailure('防火墙检测', error);
    return;
  }

  let publicIp;
  try {
    publicIp = await withSpinner('[2/3] 正在获取公网 IP', getPublicIp);
    log.info('服务端启动预检', `[2/3] 公网 IP：${publicIp}`);
  } catch (error) {
    stopServerOnPreflightFailure('公网 IP 检测', error);
    return;
  }

  try {
    await withSpinner(`[3/3] 正在检测 ${publicIp}:${CONFIG.port} 的 TCP 连接`, () =>
      checkPublicConnection(publicIp)
    );
    log.info('服务端启动预检', '[3/3] 公网 TCP 连接正常');
  } catch (error) {
    stopServerOnPreflightFailure('公网连接检测', error);
    return;
  }

  log.info('服务端启动预检', '三项检查全部通过');
  printClientExamples(publicIp);
};

function listenServe(cmdObj) {
  setLogRole('server');
  if (cmdObj) {
    CONFIG.ip = cmdObj.ip || CONFIG.ip;
    CONFIG.port = cmdObj.port || CONFIG.port;
    CONFIG.token = cmdObj.token || CONFIG.token;
  }
  if (!validateServerConfig()) return;
  log.info(`服务端配置文件：\n${formatConfigYml().cyan}`);
  // 启动服务端监听
  listenServer.listen(CONFIG.port, CONFIG.ip, () => {
    log.info('服务端已启动', `监听 ${CONFIG.ip}:${CONFIG.port}`.green);
    if (CONFIG.token === 'sk-123456') {
      log.warn('当前 token 为默认值', '存在安全风险，请修改'.yellow);
    }
    runStartupChecks();
  });
}

module.exports = listenServe;

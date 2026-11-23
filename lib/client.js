const net = require('net');
require('colors');
const log = require('npmlog');
const { setLogRole } = require('./log-file');
const path = require('path');
const { existsSync, readFileSync } = require('fs');
const { parse } = require('yaml');
// 配置：config-client.yml 不一定存在，不存在则用 DEFAULTS 常量
const configPath = path.resolve('.', 'config-client.yml');
const CONFIG = existsSync(configPath) ? parse(readFileSync(configPath, 'utf8')) : {};

// 客户端指定项默认值：未配置时取这里的值
const DEFAULTS = {
  port: 10000,
  token: 'sk-123456',
  timeout: 3000,
  interval: 5000,
  host: '127.0.0.1',
};

const isValidPort = (value) => {
  const port = Number(value);
  return /^\d+$/.test(String(value)) && Number.isInteger(port) && port > 0 && port <= 65535;
};
// 解析 ports 值（--ports 参数与 binds 配置共用，格式 ip:本地端口:服务端端口 或 本地端口:服务端端口）
const parsePorts = (ports) => {
  const parts = String(ports)
    .split(':')
    .map((p) => p.trim());
  const invalid = `ports 配置格式错误：${ports}，应为 'ip:本地端口:服务端端口' 或 '本地端口:服务端端口'，端口范围为 1-65535`;
  if (parts.length === 3) {
    const [host, local_port, remote_port] = parts;
    if (!host || !isValidPort(remote_port) || !isValidPort(local_port)) throw new Error(invalid);
    return { host, remote_port: Number(remote_port), local_port: Number(local_port) };
  }
  if (parts.length === 2) {
    const [local_port, remote_port] = parts;
    if (!isValidPort(remote_port) || !isValidPort(local_port)) throw new Error(invalid);
    return { remote_port: Number(remote_port), local_port: Number(local_port) };
  }
  throw new Error(invalid);
};
// 解析 --server 值（格式 ip:port@token）
const parseServer = (server) => {
  const atIndex = server.indexOf('@');
  if (atIndex === -1) {
    throw new Error(`--server 格式错误：${server}，应为 'ip:port@token'`);
  }
  const token = server.slice(atIndex + 1);
  const [ip, port] = server.slice(0, atIndex).split(':');
  if (!ip || !isValidPort(port) || !token) {
    throw new Error(`--server 格式错误：${server}，应为 'ip:port@token'，端口范围为 1-65535`);
  }
  return { ip, port: Number(port), token };
};
// binds 配置：数组形式更简单，按下标生成名称（bind-0、bind-1...）转成对象，供注册与转发使用
// 模块加载时只保存原始值；解析与校验延迟到实际使用时（getBinds），纯终端参数运行不受配置文件 binds 错误影响
const bindsRaw = Array.isArray(CONFIG.binds) ? CONFIG.binds : null;
const bindsInvalid = !!CONFIG.binds && !Array.isArray(CONFIG.binds);
let bindsCache;
const getBinds = () => {
  if (bindsCache) return bindsCache;
  if (bindsInvalid) {
    throw new Error('binds 配置格式错误，应为数组（- host: ... / ports: ...）');
  }
  bindsCache = (bindsRaw || []).reduce((binds, bind, index) => {
    if (!bind || !bind.ports) {
      throw new Error(
        `binds[${index}] 缺少 ports 配置，格式 'ip:本地端口:服务端端口' 或 '本地端口:服务端端口'`
      );
    }
    const parsed = parsePorts(bind.ports);
    binds[`bind-${index}`] = {
      host: parsed.host || bind.host || DEFAULTS.host,
      remote_port: parsed.remote_port,
      local_port: parsed.local_port,
    };
    return binds;
  }, {});
  return bindsCache;
};

// 配置转 yml 文本（带注释、代码块包裹）
const formatConfigYml = () => {
  const bindLines = Object.entries(CONFIG.binds || {}).map(([name, b]) =>
    [
      `  # ${name}`,
      `  - host: '${b.host}' # 非必填，当前内网被转发的ip`,
      `    ports: '${b.local_port}:${b.remote_port}' # 必填，本地端口:服务端映射端口`,
    ].join('\n')
  );
  return [
    '```yaml',
    `ip: '${CONFIG.ip}' # 必填，服务端地址`,
    `port: ${CONFIG.port} # 必填，服务端端口，客户端和服务端必须保持一致`,
    `token: '${CONFIG.token}' # 必填，连接令牌，客户端和服务端必须保持一致`,
    `timeout: ${CONFIG.timeout} # 非必填，TCP 建连超时时间（毫秒）`,
    `interval: ${CONFIG.interval} # 非必填，异常重试间隔（毫秒）`,
    'binds:',
    ...bindLines,
    '```',
  ].join('\n');
};

// 客户端配置示例（缺少必需配置时提示用）
const CLIENT_EXAMPLE_YML = [
  '# 直接执行 mapping client，需要在执行目录创建 config-client.yml 文件',
  '```yaml',
  `ip: '166.66.66.66'         # 必填，服务端地址，纯IP，必须改`,
  `port: 10000           # 必填，服务端端口，客户端和服务端必须保持一致`,
  `token: 'sk-123456'           # 必填，连接令牌，客户端和服务端必须保持一致`,
  `timeout: 3000           # 非必填，TCP 建连超时时间（毫秒）`,
  `interval: 5000           # 非必填，异常重试间隔（毫秒）`,
  `binds:`,
  `  - host: '127.0.0.1'           # 非必填，当前内网被转发的ip`,
  `    ports: '8080:8080'           # 必填，本地端口:服务端映射端口`,
  '```',
].join('\n');

// 用于校验请求的code
let CODE;
let linkClient;
let runClient = false;
function listenClient(cmdObj) {
  setLogRole('client');
  // 终端没有任何参数且配置文件不存在：提示创建配置文件或直接用终端参数后退出
  // （runClient 为 true 说明是异常重试的内部调用，沿用已有配置，不在此拦截）
  const noArgs = !cmdObj || Object.keys(cmdObj).length === 0;
  if (noArgs && runClient === false && !existsSync(configPath)) {
    log.warn('需要配置文件', '请在执行目录创建 config-client.yml，或通过终端参数直接运行'.cyan);
    log.info(
      '转发示例：',
      '本地地址(http://127.0.0.1:8080) ------> 公网地址(http://166.66.66.66:8080)'.cyan
    );
    log.info(
      '指令示例：',
      'mapping client --server "166.66.66.66:10000@sk-123456" --ports "127.0.0.1:8080:8080" # 简写可去掉(127.0.0.1:)'
        .cyan
    );
    log.info(`配置示例：\n${CLIENT_EXAMPLE_YML.cyan}`);
    return;
  }
  if (cmdObj) {
    // --server 值格式 ip:port@token，终端参数优先；timeout/interval 走 终端参数+终端配置+默认值常量
    if (cmdObj.server) {
      const parsed = parseServer(cmdObj.server);
      CONFIG.ip = parsed.ip;
      CONFIG.port = parsed.port;
      CONFIG.token = parsed.token;
    }
    CONFIG.timeout = cmdObj.timeout || CONFIG.timeout || DEFAULTS.timeout;
    CONFIG.interval = cmdObj.interval || CONFIG.interval || DEFAULTS.interval;
    const missing = ['ip', 'port', 'token'].filter((k) => !CONFIG[k]);
    if (missing.length > 0) {
      log.error(`缺少必需配置：${missing.join('、')}，请通过指令或配置文件提供`);
      process.exitCode = 1;
      return;
    }
  }
  // 绑定来源：终端传 --ports 只用终端这一组（内部固定名 default），配置文件的 binds 错误不影响终端参数运行；
  // 未传 --ports 时解析并校验配置文件的 binds（解析一次后缓存，异常重试沿用）
  if (cmdObj && cmdObj.ports) {
    const parsed = parsePorts(cmdObj.ports);
    CONFIG.binds = {
      default: {
        host: parsed.host || DEFAULTS.host,
        local_port: parsed.local_port,
        remote_port: parsed.remote_port,
      },
    };
  } else if (runClient === false) {
    CONFIG.binds = getBinds();
  }
  CONFIG.port = Number(CONFIG.port);
  CONFIG.timeout = Number(CONFIG.timeout);
  CONFIG.interval = Number(CONFIG.interval);
  if (!isValidPort(CONFIG.port)) throw new Error('port 必须是 1-65535 的整数');
  if (!Number.isInteger(CONFIG.timeout) || CONFIG.timeout <= 0) {
    throw new Error('timeout 必须是正整数（毫秒）');
  }
  if (!Number.isInteger(CONFIG.interval) || CONFIG.interval <= 0) {
    throw new Error('interval 必须是正整数（毫秒）');
  }
  // 配置来源标注：有终端参数时标为从终端解析，否则为读取到的配置；异常重试沿用已解析配置
  const configSource =
    cmdObj && Object.keys(cmdObj).length > 0 ? '从终端解析的配置' : '读取到的配置';
  log.info(`${configSource}：\n${formatConfigYml()}`);
  if (runClient === false) {
    runClient = true;
    tryError();
  }
  // 创建用于连接校验服务端的客户端连接
  log.info('正在尝试连接', `${CONFIG.ip}:${CONFIG.port}`);
  linkClient = net.createConnection({ port: CONFIG.port, host: CONFIG.ip }, () => {
    // 超时仅用于建连；已注册的控制长连接不按空闲时间断开
    linkClient.setTimeout(0);
    // 创建用于校验请求的code
    CODE = +new Date();
    // 发送数据校验
    linkClient.write(
      JSON.stringify({
        token: CONFIG.token,
        code: CODE,
        type: 'register',
        binds: CONFIG.binds,
        timeout: CONFIG.timeout,
      })
    );
  });
  linkClient.setTimeout(CONFIG.timeout, () => {
    log.error('连接异常', `连接 ${CONFIG.ip}:${CONFIG.port} 超时（${CONFIG.timeout}ms）`);
    linkClient.destroy();
  });
  linkClient.on('data', (data) => {
    try {
      data = JSON.parse(data);
      // 校验请求
      if (data.code == CODE) {
        if (data.type == 'register') {
          if (data.success === false) {
            const reasons = Array.isArray(data.errors)
              ? data.errors
                  .map((error) => `${error.name}（${error.remote_port}）：${error.message}`)
                  .join('；')
              : '';
            log.error('端口映射注册失败', reasons || '服务端端口检查未通过');
            return linkClient.end();
          }
          log.info('已连接到服务器', `${CONFIG.ip}:${CONFIG.port}`);
          // 注册成功后按绑定逐条打印映射：外网访问地址 → 本地服务地址（公网 IP 由服务端预检提供，缺失时回退到连接地址）
          const publicIp = data.publicIp || CONFIG.ip;
          const bindLines = Object.entries(CONFIG.binds).map(
            ([name, bind]) =>
              `  ${name}  http://${publicIp}:${bind.remote_port}  →  http://${bind.host}:${bind.local_port}`
          );
          if (bindLines.length > 0) {
            log.info(`端口映射已生效（外网访问地址 → 本地服务地址）：\n${bindLines.join('\n')}`);
          }
        } else {
          // 请求标识
          let key = data.key;
          // 应用名称
          let name = data.name;
          // 本地的应用
          let localApp = CONFIG.binds[name];
          if (!localApp) {
            log.error('端口映射异常', `服务端请求了未配置的绑定：${name}`);
            return linkClient.end();
          }
          // 创建服务端用的Socket
          let serverClient = new net.Socket();
          // 创建局域网内的Socket
          let localClient = new net.Socket();
          serverClient.setTimeout(CONFIG.timeout, () => {
            log.error('访问服务器异常', `连接 ${CONFIG.ip}:${CONFIG.port} 超时`);
            serverClient.destroy();
            localClient.end();
          });
          localClient.setTimeout(CONFIG.timeout, () => {
            log.error('局域网访问异常', `连接 ${localApp.host}:${localApp.local_port} 超时`);
            localClient.destroy();
            serverClient.end();
          });

          // 连接服务端
          serverClient.connect(CONFIG.port, CONFIG.ip, function () {
            serverClient.setTimeout(0);
            serverClient.write(JSON.stringify({ type: 'connect', key: key, token: CONFIG.token }));
            // 连接本地服务器
            localClient.connect(localApp.local_port, localApp.host, function () {
              localClient.setTimeout(0);
              log.info(
                name,
                `本地连接建立：http://${localApp.host}:${localApp.local_port}（公网端口 ${localApp.remote_port}）`
              );
            });
            // 本地数据转发服务端
            localClient.pipe(serverClient);
            localClient.on('end', function () {
              serverClient.end();
            });
          });
          serverClient.on('error', function (err) {
            log.error('访问服务器异常', err.message);
            localClient.end();
          });
          localClient.on('error', function (err) {
            log.error('局域网访问异常', err.message);
            serverClient.end();
          });
          // 服务端数据转发本地
          serverClient.pipe(localClient);
          serverClient.on('end', function () {
            localClient.end();
          });
        }
        return;
      }
    } catch (error) {
      log.error('客户端消息处理异常', error.message);
    }
    return linkClient.end();
  });
  linkClient.on('error', (err) => {
    log.error('连接异常', err.message);
  });
  linkClient.on('end', () => {
    log.info('已从服务器断开', `${CONFIG.ip}:${CONFIG.port}`);
  });
}

//异常重试
function tryError() {
  setInterval(() => {
    if (linkClient.readyState == 'closed') {
      linkClient.end();
      log.warn('正在重新连接服务器...');
      listenClient();
    }
  }, CONFIG.interval);
}

module.exports = listenClient;

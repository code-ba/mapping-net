const net = require('net');
const { exec } = require('child_process');
require('colors');
const log = require('npmlog');
const { setLogRole } = require('./log-file');
const path = require('path');
const { existsSync, readFileSync } = require('fs');
const { parse } = require('yaml');
// 配置：config-server.yml 不一定存在，不存在则用内置默认值
const configPath = path.resolve('.', 'config-server.yml');
const CONFIG = {
  ip: '0.0.0.0', //服务端地址 一般是0.0.0.0或127.0.0.1
  port: 10000, //服务端端口
  token: 'sk-123456', //连接令牌
  ...(existsSync(configPath) ? parse(readFileSync(configPath, 'utf8')) : {}),
};

// 配置转 yml 文本（带注释、代码块包裹）
const formatConfigYml = () => {
  return [
    'config-server.yml',
    '```yaml',
    `ip: '${CONFIG.ip}'         # 非必填，服务端地址 一般是 0.0.0.0 或 127.0.0.1，一般不需要改`,
    `port: ${CONFIG.port}           # 非必填，服务端端口，客户端和服务端必须保持一致`,
    `token: '${CONFIG.token}'           # 非必填，连接令牌，客户端和服务端必须保持一致`,
    '```',
  ].join('\n');
};

// 客户端连接集
let linkClients = {};
// 客户端绑定的应用
let clientBings = {};
// 连接记录
let socketRecords = {};
// 删除相关信息
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
};
// 端口转发服务 用于开放访问
function createForwardServer(conf) {
  const remotePort = Number(conf.remote_port);
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535) {
    log.error(conf.name, `远程端口无效：${conf.remote_port}，已跳过该绑定`);
    return null;
  }
  let forwardServer = net.createServer((socket) => {
    // 判断客户是否在线
    if (!linkClients[conf.linkId]) return socket.end();
    let id = [socket.remoteAddress, socket.remoteFamily, socket.remotePort].join('_');
    if (!socketRecords[id]) socketRecords[id] = { bind: socket };
    // 发送需要数据 告诉客户端 开启新的连接用于访问
    conf.linkSocket.write(JSON.stringify({ key: id, name: conf.name, code: conf.code }));
    socket.on('error', (err) => {
      log.error(conf.name, `访问连接异常 ${id}：${err.message}`);
      socket.end();
    });
    socket.on('end', () => {
      log.info(conf.name, `访问连接断开 ${id}`);
      if (socketRecords[id]) {
        if (socketRecords[id].bind) socketRecords[id].client.end();
        if (socketRecords[id].client) socketRecords[id].bind.end();
        delete socketRecords[id];
      }
    });
  });
  forwardServer.on('error', (err) => {
    const message =
      err.code === 'EADDRINUSE'
        ? `远程端口 ${remotePort} 已被占用，已跳过该绑定`
        : `转发服务异常，远程端口 ${remotePort}：${err.message}`;
    log.error(conf.name, message);
    // 只移除出错的这条绑定：多客户端/多绑定场景下，一个远端端口冲突不影响同客户端的其他绑定
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
  log.info('客户端上线', `${socket.remoteAddress}:${socket.remotePort}`);
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
        // 校验连接令牌，与服务端配置不一致时断开
        if (token != CONFIG.token) return socket.end();
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
          const results = await Promise.all(
            registrations.map(async (registration) => ({
              ...registration,
              error: await waitForForwardServer(registration.forwardServer),
            }))
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
          return socket.write(JSON.stringify({ code, type, id, success: true }));
        } else if (type == 'connect') {
          // 客户端连接
          let id = data.key;
          let socketRecord = socketRecords[id];
          if (socketRecord && socketRecord.bind && !socketRecord.client) {
            socketRecord.client = socket; //设置 客户端连接socket
            // 数据转发
            socket.pipe(socketRecord.bind);
            socketRecord.bind.pipe(socket);
            socketRecord.bind.on('end', () => {
              log.info(data.name, `数据转发结束 ${id}`);
              socket.end();
            });
            socketRecord.bind.on('error', (err) => {
              log.error(data.name, `数据转发异常 ${id}：${err.message}`);
              socket.end();
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
    socket.on('end', () => {
      log.info('客户端已断开', id);
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
function listenServe(cmdObj) {
  setLogRole('server');
  if (cmdObj) {
    CONFIG.ip = cmdObj.ip || CONFIG.ip;
    CONFIG.port = cmdObj.port || CONFIG.port;
    CONFIG.token = cmdObj.token || CONFIG.token;
  }
  log.info(`服务端配置文件：\n${formatConfigYml().cyan}`);
  // 启动服务端监听
  listenServer.listen(CONFIG.port, CONFIG.ip, () => {
    log.info('服务端已启动', `监听 ${CONFIG.ip}:${CONFIG.port}`.green);
    if (CONFIG.token === 'sk-123456') {
      log.warn('当前 token 为默认值', '存在安全风险，请修改'.yellow);
    }
    // 查询服务端公网 IP，拼出客户端指令
    exec('curl https://ip.cxvh.com/', (err, stdout) => {
      const publicIp = (stdout || '').trim();
      const ipText = err || !publicIp ? '<服务端公网IP>' : publicIp;
      log.info(
        '转发示例：',
        `本地地址(http://127.0.0.1:8080) ------> 公网地址(http://${ipText}:8080)`.cyan
      );
      log.info(
        '客户端完整指令：',
        `mapping client --server "${ipText}:${CONFIG.port}@${CONFIG.token}" --ports "127.0.0.1:8080:8080"`
          .cyan
      );
      log.info(
        '客户端指令简写：',
        `mapping client --server "${ipText}:${CONFIG.port}@${CONFIG.token}" --ports "8080:8080"`
          .cyan.bold.underline
      );
    });
  });
}

module.exports = listenServe;

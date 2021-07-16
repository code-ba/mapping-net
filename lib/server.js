const net = require('net');
const log=require('npmlog');
const envConfig=require('../config.server')
// 配置
const CONFIG = {
    server_addr: "0.0.0.0",//服务端地址 一般是0.0.0.0或127.0.0.1
    server_port: 10000,//服务端端口
    token: "aksda@$@#kjsk",//连接令牌 
    ...envConfig
};

// 客户端链接集
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
            d.forwardServer.close();
            clientBings[k] = null;
            delete clientBings[k];
        }
    }
};
// 端口转发服务 用于开放访问
function createForwardServer(conf) {
    let forwardServer = net.createServer((socket) => {
        // 判断客户是否在线
        if (!linkClients[conf.linkId]) return socket.end();
        let id = [socket.remoteAddress, socket.remoteFamily, socket.remotePort].join("_");
        if (!socketRecords[id]) socketRecords[id] = { bind: socket };
        // 发送需要数据 告诉客户端 开启新的连接用于访问
        conf.linkSocket.write(JSON.stringify({ key: id, name: conf.name, code: conf.code }));
        socket.on('error', () => {
            socket.end();
        });
        socket.on('end', () => {
            if (socketRecords[id]) {
                if (socketRecords[id].bind) socketRecords[id].client.end();
                if (socketRecords[id].client) socketRecords[id].bind.end();
                delete socketRecords[id];
            }
        })
    });
    forwardServer.listen(conf.remote_port, () => {
        console.log(`[${(new Date()).toLocaleString()}] [${conf.name}] 转发服务开启  ${conf.local_port}<===>${conf.remote_port}`);
    });
    return forwardServer;
}
// 远程监听访问 用于穿透
const listenServer = net.createServer((socket) => {
    let id = [socket.remoteAddress, socket.remoteFamily, socket.remotePort].join("_");
    console.log(`[${(new Date()).toLocaleString()}] ${socket.remoteAddress}:${socket.remotePort} 上线...`);
    if (!linkClients[id]) {
        // 保存连接
        linkClients[id] = socket;
        socket.on('data', (data) => {
            try {
                try {
                    data = JSON.parse(data);
                } catch (error) {
                    return;
                }
                let [token, type, code, binds] = [data.token, data.type, data.code, data.binds];
                if (token != token) return socket.end();
                if (type == 'register') {// 客户端注册
                    for (let k in binds) {
                        let d = binds[k];
                        if (!clientBings[k]) {
                            [d.code, d.name, d.linkSocket, d.linkId] = [data.code, k, socket, id];
                            d.forwardServer = createForwardServer(d);//绑定客户端App对应服务端开放的端口服务
                            clientBings[k] = d;
                        }
                    }
                    return socket.write(JSON.stringify({ code: code, type: type, id: id }));
                } else if (type == 'connect') {// 客户端连接 
                    let id = data.key;
                    let socketRecord = socketRecords[id];
                    if (socketRecord && socketRecord.bind && !socketRecord.client) {
                        socket.firstConnection = false;
                        socketRecord.client = socket;//设置 客户端连接soket
                        // 数据转发
                        socket.pipe(socketRecord.bind);
                        socketRecord.bind.pipe(socket);
                        socketRecord.bind.on('end', () => {
                            socket.end();
                        });
                        socketRecord.bind.on('error', (err) => {
                            socket.end();
                        });
                        return;
                    }
                }
            } catch (error) {
                // 
                removeInfo(id);
            }
            socket.end();
        });
        socket.on('error', (err) => {
            // 
            removeInfo(id);
        })
        socket.on('end', (data) => {
            removeInfo(id);
        });
    }
});
function listenServe(cmdObj){
    if(cmdObj){
        CONFIG.server_addr=cmdObj.server_addr||CONFIG.server_addr;
        CONFIG.server_port=cmdObj.server_port||CONFIG.server_port;
        CONFIG.token=cmdObj.token||CONFIG.token;
    }
    log.info('服务端配置文件：',JSON.stringify(CONFIG,null,2))
    // 启动服务端监听
    listenServer.listen(CONFIG.server_port, CONFIG.server_addr);
}

module.exports=listenServe;
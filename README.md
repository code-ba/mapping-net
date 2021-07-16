# nodejs 实现的 tcp 内网穿透、映射外网服务

### 使用安装

- `npm i -g @mapping/net`，安装完成通过以下指令启动服务
- `npm init mapping-net`，不用安装，可以直接使用以下指令
  - 客户端：`npm init mapping-net client --server_addr 166.169.66.99 --server_port 81 --token "helloServer" --local_ip 127.0.0.1 --local_port 4000 --remote_port 80`
  - 服务端：`npm init mapping-net server --server_port 81 --token "helloServer"`
- 通过`git`安装
  - `git clone https://github.com/code-ba/mapping-net.git`
  - `cd mapping-net && npm install`
  - 配置`config.client.js`、`config.server.js`
  - 通过指令启动，如`npx mapping-net`

---

### 指令

- 客户端
```c
$ mapping client --help
Usage: mapping client [options]
Options:
  --server_addr <server_addr>  服务端地址（默认：0.0.0.0）
  --server_port <server_port>  服务端端口（默认：10000）
  --token <token>              连接令牌（默认：aksda@$@#kjsk）
  --timeout <timeout>          请求超时时间（默认：3000）
  --interval <interval>        连接令牌（默认：5000）
  --binds <binds>              连接令牌（默认：ssh）
  --local_ip <local_ip>        内网被转发的ip（默认：127.0.0.1）
  --local_port <local_port>    内网被转发的端口（默认：80）
  --remote_port <remote_port>  服务端映射的端口（默认：80）
  -h, --help                   display help for command
```

- 服务端
```c
$ mapping server --help
Usage: mapping server [options]
Options:
  --server_addr <server_addr>  服务端地址（默认：0.0.0.0）
  --server_port <server_port>  服务端端口（默认：10000）
  --token <token>              连接令牌（默认：aksda@$@#kjsk）
  -h, --help                   display help for comman
```

- 服务端后台启动方式
  - `pm2 start -- run server`相当于`npm run server`（全局安装`pm2`可使用：`npm install -g pm2`）

---

### 客户端配置

```js
// config.client.js
module.exports={
  server_addr: "166.66.66.66",//服务端地址，纯IP，必须改
  server_port: 10000,//服务端端口，客户端和服务端必须保持一致
  token: "aksd()@$@#kjsk",//连接令牌，客户端和服务端必须保持一致
  timeout: 3000,//请求超时时间
  interval: 5000,//异常重试
  binds: {//绑定内网应用
    ssh: {
      local_ip: "127.0.0.1",//当前内网被转发的ip
      local_port: 80,//当前内网被转发的端口
      remote_port: 10001,//服务端映射的端口
    },
    aria2: {
      local_ip: "192.168.199.193",//当前内网被转发的ip
      local_port: 6800,//当前内网被转发的端口
      remote_port: 10002,//服务端映射的端口
    },
    aria2Ng: {
      local_ip: "127.0.0.1",//当前内网被转发的ip
      local_port: 80,//当前内网被转发的端口
      remote_port: 10003,//服务端映射的端口
    }
  }
}
```

---

### 服务端配置

```js
// config.server.js
module.exports={
  server_addr: "0.0.0.0",//服务端地址 一般是0.0.0.0或127.0.0.1，一般不需要改
  server_port: 10000,//服务端端口，客户端和服务端必须保持一致
  token: "aksd()@$@#kjsk",//连接令牌，客户端和服务端必须保持一致
}
```

---

### 打赏

您的支持是我持续更新的动力！

<img src="https://cdn.jsdelivr.net/gh/cxvh/static@main/img/20210218193037.png" width="200" height="200" alt="微信">
<img src="https://cdn.jsdelivr.net/gh/cxvh/static@main/img/20210218192738.jpg" width="200" height="200" alt="支付宝">

---
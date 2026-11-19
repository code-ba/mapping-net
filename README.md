# nodejs 实现的 tcp 内网穿透、映射外网服务

[![npm version](https://img.shields.io/npm/v/@mapping/net.svg?style=flat&logo=npm)](https://www.npmjs.com/package/@mapping/net)
[![npm downloads](https://img.shields.io/npm/dm/@mapping/net.svg?style=flat&logo=npm)](https://www.npmjs.com/package/@mapping/net)
[![Node.js](https://img.shields.io/node/v/@mapping/net?style=flat&logo=nodedotjs)](https://www.npmjs.com/package/@mapping/net)
[![Build Status](https://img.shields.io/github/actions/workflow/status/code-ba/mapping-net/publish.yml?style=flat&branch=main&logo=github)](https://github.com/code-ba/mapping-net/actions)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat&logo=opensourceinitiative)](https://opensource.org/licenses/Apache-2.0)

## 使用安装

> **服务器注意：**`安全组开放入站出站端口`、`防火墙开放端口`，服务器带宽太低不建议穿透，如 2M 带宽，实际 `2×1024÷8=256kb`/每秒

### 全局安装方式

- `npm i -g @mapping/net`，安装完成通过以下指令启动服务

```sh
# 启动服务端
mapping server --port 81 --token "sk-123456"
```

```sh
# 启动客户端
mapping client --server 166.169.66.99:81@sk-123456
```

### 源码启动

- 通过`git`安装
  - `git clone https://github.com/code-ba/mapping-net.git`
  - `cd mapping-net && npm install`
  - 通过指令启动单个服务：
    - `node bin/index.js client --server 166.169.66.99:81@sk-123456`
    - `node bin/index.js server --port 81`
  - 通过指令启动，如`npm run client` or `npm run server`（启动多个服务需要配置）
    - 配置`config-client.yml`、`config-server.yml`

### ~~init 免安装~~

- ~~`npm init mapping`，免安装可以直接使用以下指令~~

  - ~~客户端：`npm init mapping client --server 166.169.66.99:81@sk-123456 --ports 127.0.0.1:80:4000`~~
  - ~~服务端：`npm init mapping server --port 81 --token "sk-123456"`~~

---

## 指令

- 客户端

```
$ mapping client --help
Usage: mapping client [options]

Options:
  --server <server>      服务端地址（ip:port@token）
  --ports <ports>        端口映射（[ip:]服务端端口:本地端口，ip 省略时默认 127.0.0.1；传该参数只注册终端这一组绑定，配置文件的绑定不注册）
  --timeout <timeout>    请求超时时间
  --interval <interval>  异常重试间隔
  -h, --help             display help for command
```

- 服务端

```
$ mapping server --help
Usage: mapping server [options]

Options:
  --ip <ip>        服务端地址（默认：0.0.0.0）
  --port <port>    服务端端口（默认：10000）
  --token <token>    连接令牌（默认：sk-123456）
  -h, --help         display help for command
```

- 服务端后台启动方式
  - `pm2 start -- run server`相当于`npm run server`（全局安装`pm2`可使用：`npm install -g pm2`）

---

## 客户端配置

```yaml
# config-client.yml
ip: '166.66.66.66' # 必填，服务端地址，纯IP，必须改
port: 10000 # 必填，服务端端口，客户端和服务端必须保持一致
token: 'sk-123456' # 必填，连接令牌，客户端和服务端必须保持一致
timeout: 3000 # 非必填，请求超时时间
interval: 5000 # 非必填，异常重试
binds:
  #绑定内网应用
  - host: '127.0.0.1' # 非必填，当前内网被转发的ip
    ports: '10001:80' # 必填，服务端映射端口:本地端口
  - host: '192.168.199.193' # 非必填，当前内网被转发的ip
    ports: '10002:6800' # 必填，服务端映射端口:本地端口
  - host: '127.0.0.1' # 非必填，当前内网被转发的ip
    ports: '10003:80' # 必填，服务端映射端口:本地端口
```

> binds 为数组，绑定按数组下标自动命名（bind-0、bind-1...），客户端与服务端日志均按该名称显示对应转发。

---

## 服务端配置

```yaml
# config-server.yml
ip: '0.0.0.0' # 非必填，服务端地址 一般是0.0.0.0或127.0.0.1，一般不需要改
port: 10000 # 非必填，服务端端口，客户端和服务端必须保持一致
token: 'sk-123456' # 非必填，连接令牌，客户端和服务端必须保持一致
```

> 多客户端同时连接时，各绑定的远端映射端口（ports 第一段）需要全局唯一；端口冲突只影响冲突的那条绑定，服务端日志会打印 `转发服务异常` 提示。

---

## 打赏

您的支持是我持续更新的动力！

<img src="https://cdn.jsdelivr.net/gh/cxvh/static@main/img/20210218193037.png" width="200" height="200" alt="微信">
<img src="https://cdn.jsdelivr.net/gh/cxvh/static@main/img/20210218192738.jpg" width="200" height="200" alt="支付宝">

---

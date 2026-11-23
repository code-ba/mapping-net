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

  - ~~客户端：`npm init mapping client --server 166.169.66.99:81@sk-123456 --ports 127.0.0.1:4000:80`~~
  - ~~服务端：`npm init mapping server --port 81 --token "sk-123456"`~~

---

## 指令

- 客户端

```
$ mapping client --help
Usage: mapping client [options]

Options:
  --server <server>      服务端地址（ip:port@token）
  --ports <ports>        端口映射（[ip:]本地端口:服务端端口，ip 省略时默认 127.0.0.1；传该参数只注册终端这一组绑定，配置文件的绑定不注册）
  --timeout <timeout>    TCP 建连超时时间（毫秒，默认：3000）
  --interval <interval>  异常重试间隔（毫秒，默认：5000）
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
timeout: 3000 # 非必填，TCP 建连超时时间（毫秒），已建立的长连接不按空闲时间断开
interval: 5000 # 非必填，异常重试间隔（毫秒）
binds:
  #绑定内网应用
  - host: '127.0.0.1' # 非必填，当前内网被转发的ip
    ports: '80:10001' # 必填，本地端口:服务端映射端口
  - host: '192.168.199.193' # 非必填，当前内网被转发的ip
    ports: '6800:10002' # 必填，本地端口:服务端映射端口
  - host: '127.0.0.1' # 非必填，当前内网被转发的ip
    ports: '80:10003' # 必填，本地端口:服务端映射端口
```

> binds 为数组，绑定按数组下标自动命名（bind-0、bind-1...），客户端与服务端日志均按该名称显示对应转发。

---

## 服务端配置

```yaml
# config-server.yml
ip: '0.0.0.0' # 公网服务一般使用 0.0.0.0；127.0.0.1 和 ::1 无法通过公网预检
port: 10000 # 非必填，服务端端口，客户端和服务端必须保持一致
token: 'sk-123456' # 非必填，连接令牌，客户端和服务端必须保持一致
```

> 多客户端同时连接时，远端映射端口（ports 第二段）需要全局唯一。同一次注册中的任一绑定失败，整批注册都会失败并回滚本次已创建的监听；其他已注册客户端不受影响。

### 服务端启动预检

服务端监听控制端口后，按顺序执行三项检查：

1. **防火墙**：Linux 上只读查询 UFW，未安装时查询 firewalld。不执行 `sudo`，不自动修改防火墙；无法查询、端口未放行或非 Linux 系统均按失败处理。
2. **公网 IP**：通过 `https://ip.cxvh.com/` 获取并校验公网 IP，查询失败或超时则停止。
3. **公网连接**：从服务端连接自己的 `公网IP:控制端口`，3 秒内无法建立 TCP 连接则停止。

任一检查失败都会输出 `服务端启动预检失败`、关闭服务并以退出码 `1` 退出，不会打印客户端指令；全部通过后才打印转发示例。交互终端会显示加载动画，重定向日志时自动禁用动画。

> **NAT 回环限制：**第三步依赖服务器访问自己的公网 IP。如果网络不支持 NAT 回环，即使外部客户端实际可以访问，自检也可能失败并停止服务。云安全组和路由仍需人工确认，程序不会自动修改。

> 注册映射端口时，除端口监听校验外，还会对每个映射端口执行同样的防火墙只读检查（UFW / firewalld，封装为 `checkPortFirewall(port)`，与控制端口预检共用）。未放行的绑定按注册失败处理并整批回滚，客户端会收到 `防火墙未放行` 的具体原因。

> 使用 pm2 等进程管理器时，预检失败导致的退出可能触发自动重启；请根据重启日志处理网络或配置问题。

---

## 打赏

您的支持是我持续更新的动力！

<img src="https://cdn.jsdelivr.net/gh/cxvh/static@main/img/20210218193037.png" width="200" height="200" alt="微信">
<img src="https://cdn.jsdelivr.net/gh/cxvh/static@main/img/20210218192738.jpg" width="200" height="200" alt="支付宝">

---

module.exports={
  server_addr: "166.66.66.66",//服务端地址，纯IP，必须改
  server_port: 10000,//服务端端口，客户端和服务端必须保持一致
  token: "aksda@$@#kjsk",//连接令牌，客户端和服务端必须保持一致
  timeout: 3000,//请求超时时间
  interval: 5000,//异常重试
  binds: {//绑定内网应用
    ssh: {
      local_ip: "127.0.0.1",//当前内网被转发的ip
      local_port: 80,//当前内网被转发的端口
      remote_port: 10001,//服务端映射的端口
    }
    // ,
    // aria2: {
    //   local_ip: "192.168.199.193",//当前内网被转发的ip
    //   local_port: 6800,//当前内网被转发的端口
    //   remote_port: 10002,//服务端映射的端口
    // },
    // aria2Ng: {
    //   local_ip: "127.0.0.1",//当前内网被转发的ip
    //   local_port: 90,//当前内网被转发的端口
    //   remote_port: 10003,//服务端映射的端口
    // }
  }
}
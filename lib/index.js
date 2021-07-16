module.exports = core;
const log=require('npmlog')
const colors=require('colors');
const commander=require('commander');
const program=new commander.Command();

const pkg=require('../package.json');
const client=require('./client')
const server=require('./server')

async function core() {
  try{
      // 命令注册
      registerCommand()
  }catch(e){
      log.error(e.message);
      if(program.debug){
          console.log(e)
      }
  }
}
function registerCommand(){
  program
    .name(Object.keys(pkg.bin)[0])
    .usage('<command> [options]')
    .version(pkg.version)
  // 命令注册
  program
      .command('client')
      .option('--server_addr <server_addr>','服务端地址（默认：0.0.0.0）')
      .option('--server_port <server_port>','服务端端口（默认：10000）')
      .option('--token <token>','连接令牌（默认：aksda@$@#kjsk）')
      .option('--timeout <timeout>','请求超时时间（默认：3000）')
      .option('--interval <interval>','连接令牌（默认：5000）')
      .option('--binds <binds>','连接令牌（默认：ssh）')
      .option('--local_ip <local_ip>','内网被转发的ip（默认：127.0.0.1）')
      .option('--local_port <local_port>','内网被转发的端口（默认：80）')
      .option('--remote_port <remote_port>','服务端映射的端口（默认：80）')
      .action(client);
  program
      .command('server')
      .option('--server_addr <server_addr>','服务端地址（默认：0.0.0.0）')
      .option('--server_port <server_port>','服务端端口（默认：10000）')
      .option('--token <token>','连接令牌（默认：aksda@$@#kjsk）')
      .action(server);
  // 对未知命令进行监听
  program.on('command:*',function(obj){
      const availableCommands=program.commands.map(cmd=>cmd.name())
      console.log(colors.red("未知命令："+obj[0]));
      if(availableCommands.length>0){
          console.log(colors.red("可用命令："+availableCommands.join(",")));
      }
  })
  // 解析参数
  program.parse(process.argv)
  if(program.args&&program.args.length<1){
      program.outputHelp()
  }
}
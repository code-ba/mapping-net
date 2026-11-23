module.exports = core;
const log = require('npmlog');
const colors = require('colors');
const commander = require('commander');
const program = new commander.Command();
require('./log-file');

const pkg = require('../package.json');
const client = require('./client');
const server = require('./server');

async function core() {
  try {
    log.info(`版本号：${pkg.version}`);
    // 命令注册
    registerCommand();
  } catch (e) {
    log.error(e.message);
    process.exitCode = 1;
    if (program.debug) {
      console.log(e);
    }
  }
}
function registerCommand() {
  program
    .name(Object.keys(pkg.bin)[0])
    .usage('<command> [options]')
    .version(pkg.version)
    .description('内网穿透工具，将内网服务映射到外网');
  // 命令注册
  program
    .command('client')
    .description('内网穿透客户端，连接服务端并将本地端口映射到服务端对外开放')
    .option('--server <server>', '服务端地址（ip:port@token）')
    .option(
      '--ports <ports>',
      '端口映射（[ip:]本地端口:服务端端口，ip 省略时默认 127.0.0.1；传该参数只注册终端这一组绑定，配置文件的绑定不注册）'
    )
    .option('--timeout <timeout>', 'TCP 建连超时时间（毫秒，默认：3000）')
    .option('--interval <interval>', '异常重试间隔（毫秒，默认：5000）')
    .action(client);
  program
    .command('server')
    .description('内网穿透服务端，接收客户端注册并开放端口供外网访问')
    .option('--ip <ip>', '服务端地址（默认：0.0.0.0）')
    .option('--port <port>', '服务端端口（默认：10000）')
    .option('--token <token>', '连接令牌（默认：sk-123456）')
    .action(server);
  // 对未知命令进行监听
  program.on('command:*', function (obj) {
    const availableCommands = program.commands.map((cmd) => cmd.name());
    console.log(colors.red('未知命令：' + obj[0]));
    if (availableCommands.length > 0) {
      console.log(colors.red('可用命令：' + availableCommands.join(',')));
    }
  });
  // 解析参数
  program.parse(process.argv);
  if (program.args && program.args.length < 1) {
    program.outputHelp();
  }
}

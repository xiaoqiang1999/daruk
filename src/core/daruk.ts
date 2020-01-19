/**
 * @author xiaojue
 * @date 20190614
 * @update 20200113
 * @fileoverview plugin化daruk core
 */
import KoaLogger = require('daruk-logger');
import { EventEmitter } from 'events';
import Http = require('http');
import Https = require('https');
import { inject, injectable, interfaces } from 'inversify';
import { buildProviderModule } from 'inversify-binding-decorators';
import Koa = require('koa');
import deepAssign = require('object-assign-deep');
import { dirname } from 'path';
import { Options, PartialOptions } from '../../types/daruk_options';
import helpDecoratorClass from '../decorators/help_decorator_class';
import mockHttp from '../mock/http_server';
import { pluginClass } from '../typings/daruk';
import { debugLog } from '../utils';
import getDefaultOptions from './daruk_default_options';
import { darukContainer } from './inversify.config';
import Loader from './loader';
import { TYPES } from './types';

@injectable()
class Daruk extends EventEmitter {
  public plugins: { [key: string]: any };
  public name: string;
  public app: Koa;
  public httpServer: Http.Server | Https.Server;
  public logger: KoaLogger.logger;
  public options: Options;
  // @inject(TYPES.DarukOptions) public options: Options;
  @inject(TYPES.Loader) public loader: Loader;
  @inject(TYPES.Koa) private _koa: interfaces.Newable<Koa>;
  @inject(TYPES.KoaLogger) private _koaLogger: interfaces.Newable<KoaLogger.logger>;
  public constructor() {
    super();
    this.plugins = {};
    // 初始化装饰器与 daurk 实例之间的桥梁
    helpDecoratorClass.init(this);
  }
  public initOptions(options: PartialOptions = {}) {
    const rootPath = options.rootPath || dirname(require.main.filename);
    const defaultOptions = getDefaultOptions(rootPath, options.name, options.debug);
    const customLogger = options.customLogger;
    // customLogger 可能是一个类，不能进行 deep assign
    delete options.customLogger;
    this.options = deepAssign({}, defaultOptions, options);
    // 还原被 delete 的 customLogger
    this.options.customLogger = options.customLogger = customLogger;
    // 初始化 logger
    this.logger = customLogger || new this._koaLogger(this.options.loggerOptions);
    // 用于保存 DarukLoader 加载的模块
    if (this.options.serverType === 'koa') {
      this.app = new this._koa();
    } else {
      throw new Error('only support koa server Type');
    }
    // tslint:disable-next-line
    const self = this;
    // 监听 koa 的错误事件，输出日志
    this.app.on('error', function handleKoaError(err: any) {
      self.prettyLog('[koa error] ' + (err.stack || err.message), { level: 'error' });
    });
  }
  public async initPlugin() {
    const plugins = darukContainer.getAll<pluginClass>(TYPES.PLUGINCLASS);
    for (let plugin of plugins) {
      let retValue = await plugin.initPlugin(this);
      darukContainer
        .bind(TYPES.PluginInstance)
        .toConstantValue(retValue)
        .whenTargetNamed(plugin.constructor.name);
    }
    this.emit('init');
    darukContainer.load(buildProviderModule());
  }
  /**
   * @desc 模拟 ctx，从而可以从非请求链路中得到 ctx
   * @param {Object, undefined} req - 配置模拟请求的 headers、query、url 等
   * @return Daruk.Context
   */
  public mockContext(req?: {}) {
    const { request, response } = mockHttp(req);
    // 使用 koa 的 createContext 方法创建一个 ctx
    const ctx = this.app.createContext(request, response);
    return ctx;
  }
  /**
   * @desc 启动服务
   */
  public async listen(...args: any[]): Promise<Http.Server> {
    this.httpServer = this.app.listen(...args);
    this.emit('serverReady');
    return this.httpServer;
  }
  /**
   * @desc 在开发环境下输出 format 日志
   * 正式环境下仍旧保持纯文本输出
   */
  public prettyLog(msg: string, ext?: { type?: string; level?: string; init?: boolean }) {
    const { type, level, init } = { type: '', level: 'info', init: false, ...ext };
    const prefixInfo = [init ? '[init] ' : '', type ? `[${type}] ` : ' '].join('');
    if (this.options.debug) {
      debugLog(`[${new Date().toLocaleString()}] [debug] ${prefixInfo}${msg}`, level);
    } else {
      this.logger[level](prefixInfo + msg);
    }
  }
}

export default Daruk;

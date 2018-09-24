'use strict';

const fs = require('fs');
const http = require('http');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const Router = require('line-router');
const getJson = require('req-parser');

const DefaultConfigFile = './config';
const DefaultSqlFile = './database.sql';
const DefaultPort = 3000;

function App(config) {
  config = config || path.join(process.cwd(), DefaultConfigFile);
  var fileConfig = config.constructor == String;
  this.config = fileConfig ? require(config) : config;
  this.router = new Router();
  this.db = config.database ? mysql.createPool(config.database) : null;
  this.redis = config.redis ? new Redis(config.redis) : null;
  this.patterns = config.patterns ? require('require-yml')(path.join(process.cwd(), config.patterns)) : null;

  this.get = this.get.bind(this);
  this.post = this.post.bind(this);
  this.put = this.put.bind(this);
  this.patch = this.patch.bind(this);
  this.delete = this.delete.bind(this);
  this.any = this.any.bind(this);
  this.notfound = this.notfound.bind(this);
  this.error = this.error.bind(this);
}

App.prototype = {
  run() {
    var [_,_,cmd] = process.argv;
    var isSetup = cmd && ["setup", "install", "init", "setupDatabase"].indexOf(cmd) !== -1;
    if (isSetup) {
      this.setupDatabase();
    } else {
      this.runServer();
    }
  },
  runServer() {
    http.createServer(this.router.handler).listen(this.config.port || DefaultPort);
  },
  setupDatabase() {
    (async () => {
      var fn = this.config.sql || DefaultSqlFile;
      var sql = fs.readFileSync(fn, {encoding: 'utf-8'});
      var lines = sql.split(';').filter((line) => line.trim());
      for (var line of lines) {
        await db.execute(line);
      }
      db.end();
    })().then(function(){
      console.log("All done!")
      process.exit();
    }).catch(function(e){
      console.log(e.stack);
      process.exit();
    })
  },
  get(path, schema, handler) {
    this.registerApi(['get'], path, schema, handler);
  },
  post(path, schema, handler) {
    this.registerApi(['post'], path, schema, handler);
  },
  put(path, schema, handler) {
    this.registerApi(['put'], path, schema, handler);
  },
  patch(path, schema, handler) {
    this.registerApi(['patch'], path, schema, handler);
  },
  delete(path, schema, handler) {
    this.registerApi(['delete'], path, schema, handler);
  },
  any(path, schema, handler) {
    this.registerApi(['get', 'post', 'put', 'delete'], path, schema, handler);
  },
  notfound(handler) {
    this.router.notfound(wrapHandler(handler));
  },
  error(handler) {
    this.router.error(wrapErrorHandler(handler));
  },
  registerApi(methods, path, schema, handler) {
    [schema, handler] = handler ? [schema, handler] : [null, schema];
    handler = wrapHandler(handler, schema);
    for (var method of methods) {
      this.router[method](path, handler);
    }
  }
}

function wrapHandler(handler, schema) {
  return async (req, res) => {
    req.data = await getJson(req, {schema: schema});
    res.setHeader('Content-Type', 'application/json');
    return JSON.stringify(await handler(req, res));
  };
}

function wrapErrorHandler(handler) {
  return async (err, req, res) => {
    req.data = await getJson(req);

    res.setHeader('Content-Type', 'application/json');
    return JSON.stringify(await handler(err, req, res));
  };
}

module.exports = App;

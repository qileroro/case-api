'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const createError = require('http-errors');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const Router = require('line-router');
const getJson = require('req-parser');
const crud = require('crud-sql');
const strengthan = require('strong-handler');

const DefaultConfigFile = './config';
const DefaultSqlFile = './database.sql';
const DefaultPort = 3000;
const DefaultTimeout = 30000;

function App(config) {
  this.config = config = loadConfig(config);
  this.router = new Router();
  var keys = Object.keys(config);
  this.db = keys.indexOf('database') !== -1 ? mysql.createPool(config.database) : null;
  this.redis = keys.indexOf('redis') !== -1 ? new Redis(config.redis) : null;
  this.patterns = keys.indexOf('patterns') !== -1 ? require('require-yml')(path.join(process.cwd(), config.patterns)) : null;
  this.notfoundHandler = this.wrapHandler(defaultNotFoundHandler);
  this.errorHandler = this.wrapHandler(defaultErrorHandler);

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
    http.createServer(this.handler.bind(this)).listen(this.config.port || DefaultPort);
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
  handler(req, res) {
    var matchResult = this.router.matchRoute(req.method, req.url);
    var {handler, params} = matchResult || {handler: this.notfoundHandler};
    req.params = params;

    handler(req, res).catch((err) => {
      req.error = err;
      this.errorHandler(req, res).catch((err) => {
        try {res.statusCode=500} catch {}
        res.end('Server Error');
      });
    });
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
    this.notfoundHandler = this.wrapHandler(handler);
  },
  error(handler) {
    this.errorHandler = this.wrapHandler(handler);
  },
  registerApi(methods, path, schema, handler) {
    [schema, handler] = handler ? [schema, handler] : [null, schema];
    handler = this.wrapHandler(handler, schema);
    for (var method of methods) {
      this.router[method](path, handler);
    }
  },
  wrapHandler(handler, schema) {
    return strengthan(async (req, res) => {
      var reqData = await getJson(req, {schema: schema});
      req.data = {...reqData, ...req.params};
      res.setHeader('Content-Type', 'application/json');
      var handleResult = await handler(req, res);
      var result = JSON.stringify(handleResult);
      return result;
    }, this.config.handlerTimeout || DefaultTimeout);
  },
  crud(path, patterns) {
    var {queryPattern, createPattern, updatePattern, deletePattern, 
         createSchema, updateSchema, deleteSchema} = patterns;
    this.patternQuery(path, queryPattern);
    this.patternCreate(path, createSchema, createPattern);
    this.patternUpdate("post", `${path}/<id:number>`, updateSchema, updatePattern);
    this.patternDelete(`${path}/<id:number>`, deletePattern);

    this.get(path, App.crud.query(queryPattern));
    this.post(path, createSchema, App.crud.create(createPattern));
    this.put(`${path}/<id:number>`, updateSchema, App.crud.update(updatePattern));
    this.delete(`${path}/<id:number>`, deleteSchema, App.crud.delete(deletePattern));
  },
  patternQuery(path, queryPattern) {
    var handler = async (req, res) => {
      var {sql, countSql, values} = crud.selectSql(queryPattern, req.data);
      var [data] = await this.db.query(sql, values);
      var [[{count}]] = await this.db.query(countSql, values);
      var per_page = Number(req.data.per_page || queryPattern.limit || data.length);
      var current = Number(req.data.page || 1);
      var pagination = makePagination(current, per_page, count);
      return {pagination, data};
    };
    this.get(path, handler.bind(this));
  },
  patternCreate(path, createSchema, createPattern) {
    var handler = async (req, res) => {
      var {sql, values} = crud.insertSql(createPattern, req.data);
      var [{insertId}] = await this.db.execute(sql, values);
      var [[row]] = await this.db.query(`SELECT * FROM ${pattern.table} WHERE id=?`, [insertId]);
      return row;
    };
    this.post(path, createSchema, handler.bind(this));
  },
  patternUpdate(method, path, updateSchema, updatePattern) {
    var handler = async (req, res) => {
      var {sql, values} = crud.updateSql(pattern, req.data);
      var [{affectedRows}] = await this.db.execute(sql, values);
      if (affectedRows === 0) {
        throw createError(404);
      }
      var [[row]] = await this.db.query(`SELECT * FROM ${pattern.table} WHERE id=?`, [req.data.id]);
      return row;
    };
    this.registerApi([method], path, updateSchema, handler.bind(this));
  },
  patternDelete(path, deletePattern) {
    var handler = async (req, res) => {
      var {sql, values} = crud.deleteSql(pattern, req.data);
      var [{affectedRows}] = await this.db.execute(sql, values);
      if (affectedRows === 0) {
        throw createError(404);
      }
      return {};
    };
    this.delete(path, handler.bind(this));
  }
}

function loadConfig(config) {
  if (config) {
    if (config.constructor == String) {
      return require(path.join(process.cwd(), config)) || {};
    } else {
      return config;
    }
  } else {
    try {
      return require(path.join(process.cwd(), DefaultConfigFile)) || {};
    } catch {
      return {};
    }
  }
}

function makePagination(current, per_page, total) {
  var previous = current === 1 ? null : current - 1;
  var pages = Math.ceil(total / per_page);
  var next = current === pages ? null : current + 1;
  return {previous, next, current, per_page, total, pages};
}

function defaultNotFoundHandler(req, res) {
  res.statusCode = 404;
  res.end('Not Found');
}

function defaultErrorHandler(err, req, res) {
  var {statusCode=500} = err;
  res.statusCode = statusCode;
  res.end('Server Error');
}

module.exports = App;

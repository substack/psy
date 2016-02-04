var defined = require('defined')
var fs = require('fs')
var randomBytes = require('crypto').randomBytes
var path = require('path')
var configDir = require('xdg-basedir').config
var mkdirp = require('mkdirp')
var xtend = require('xtend')

var autod = require('auto-daemon')
var listen = require('auto-daemon/listen')

var METHODS = [
  'start', 'stop', 'restart', 'remove', 'list', 'log:s',
  'close', 'kill', 'reset'
]

module.exports = Psy

function Psy (args) {
  if (!(this instanceof Psy)) return new Psy(args)
  this.opts = defaults(args)
}

Psy.prototype.run = function (cb) {
  this.opts.autoclose = true
  this.opts.args.splice(-1, 1, '--autoclose')
  autod(xtend(this.opts, { autoclose: false }), cb)
}

Psy.prototype.server = function (cb) {
  var self = this
  self.opts.args.splice(-1, 1, '--no-autoclose')
  self.opts.autoclose = false
  var server = listen(require('./server.js'), self.opts)
  server.once('listening', function () {
    autod(self.opts, function (err, r, c) {
      c.end()
      cb(err)
    })
  })
}

Psy.prototype.start = function (cmd, args, cb) {
  var self = this
  var name = defined(args.name, randomBytes(4).toString('hex'))
  var opts = {
    cwd: defined(args.cwd, process.cwd()),
    env: args.env,
    maxRestarts: defined(args.maxRestarts, -1),
    sleep: defined(args.sleep, 0),
    logfile: args.logfile
  }
  self.run(function (err, r, c) {
    if (err) return cb(err)
    r.start(name, cmd, opts, function (err) {
      c.end()
      cb(err)
    })
  })
}

Psy.prototype.log = function (name, opts, cb) {
  this.run(function (err, r, c) {
    if (err) return cb(err)
    var stream = r.log(name, opts)
    stream.on('end', function () { c.end() })
    cb(null, stream)
  })
}

Psy.prototype.stop = function (name, cb) { this._run('stop', [name], cb) }
Psy.prototype.restart = function (name, cb) { this._run('restart', [name], cb) }
Psy.prototype.remove = function (name, cb) { this._run('remove', [name], cb) }
Psy.prototype.kill = function (cb) { this._run('kill', [], cb) }
Psy.prototype.close = function (cb) { this._run('close', [], cb) }
Psy.prototype.list = function (cb) {
  this.run(function (err, r, c) {
    if (err) return cb(err)
    r.list(function (err, items) {
      cb(err, items)
      c.end()
    })
  })
}

Psy.prototype.pid = function (cb) {
  var self = this
  fs.readFile(self.opts.pidfile, 'utf8', function (err, pid) {
    if (err) return cb(err)
    try {
      process.kill(Number(pid), 0)
    } catch (err) {
      return cb(null, 0)
    }
    return cb(null, pid)
  })
}

Psy.prototype.reset = function (cb) {
  var self = this
  self.run(function (err, r, c) {
    if (err) return cb(err)
    fs.unlink(self.opts.statefile, function () {
      r.reset(function () {
        c.end()
        cb()
      })
    })
  })
}

Psy.prototype._run = function (cmd, args, cb) {
  this.run(function (err, r, c) {
    if (err) return cb(err)
    var done = function (err) {
      c.end()
      cb(err)
    }
    args.push(done)
    r[cmd].apply(r, args)
  })
}

var defaults = function (args) {
  var psyPath = defined(args.psypath, process.env.PSY_PATH, path.join(configDir, 'psy'))
  var sockfile = defined(
    args.sockfile, process.env.PSY_SOCKFILE,
    path.join(psyPath, 'sock')
  )
  var pidfile = defined(
    args.pidfile, process.env.PSY_PIDFILE,
    path.join(psyPath, 'pid')
  )
  var statefile = defined(
    args.statefile, process.env.PSY_STATEFILE,
    path.join(psyPath, 'state')
  )
  var rpcfile = defined(
    args.rpcfile, process.env.PSY_RPCFILE,
    path.join(__dirname, 'server.js')
  )

  mkdirp.sync(path.dirname(sockfile))

  var opts = {
    rpcfile: rpcfile,
    sockfile: sockfile,
    pidfile: pidfile,
    methods: METHODS,
    debug: args.debug,
    autoclose: true,
    args: [
      '--sockfile', sockfile,
      '--pidfile', pidfile,
      '--statefile', statefile,
      '--autoclose'
    ]
  }
  return opts
}

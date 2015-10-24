var respawn = require('respawn-group')
var xtend = require('xtend')
var mkdirp = require('mkdirp')
var minimist = require('minimist')
var onend = require('end-of-stream')
var sliceFile = require('slice-file')
var once = require('once')
var fs = require('fs')
var defined = require('defined')
var through = require('through2')
var has = require('has')
var sprintf = require('sprintf')
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter

var connected = 0
var psy = null

module.exports = function (server, stream, args) {
  var argv = minimist(args)
  if (!psy) psy = new Psy(argv)
  psy.on('error', function (err) { stream.emit('error', err) })
  connected++
  if (!argv.autoclose) onend(stream, function () {
    if (--connected === 0 && psy.group.list().length === 0) {
      setTimeout(function () {
        if (connected !== 0) return
        if (psy.group.list().length > 0) return
        server.close()
      }, 1000)
    }
  })
  return {
    start: psy.start.bind(psy),
    stop: psy.stop.bind(psy),
    restart: psy.restart.bind(psy),
    remove: psy.remove.bind(psy),
    log: psy.log.bind(psy),
    list: psy.list.bind(psy),
    close: function (cb) {
      if (typeof cb !== 'function') cb = noop
      psy.group.list().forEach(function (item) {
        psy.group.remove(item.id)
      })
      server.close()
      cb()
    },
    reset: function (cb) {
      if (typeof cb !== 'function') cb = noop
      server.close()
      var pending = 3
      fs.unlink(psy.pidfile, done)
      fs.unlink(psy.sockfile, done)
      fs.unlink(psy.statefile, done)
      function done (err) {
        if (err) cb(err)
        else if (--pending === 0) cb()
      }
    },
    kill: function (cb) {
      server.close()
      cb()
      process.exit()
    }
  }
}

inherits(Psy, EventEmitter)

function Psy (opts) {
  if (!(this instanceof Psy)) return new Psy(opts)
  var self = this

  self.sockfile = opts.sockfile
  self.pidfile = opts.pidfile
  self.statefile = opts.statefile
  self.psyPath = opts.psyPath

  self.group = respawn()
  self.extra = {}
  self.logging = {}
  self.linestate = {}
  self.group.on('stdout', self._ondata.bind(self))
  self.group.on('stderr', self._ondata.bind(self))

  self.group.on('start', self._onev('start'))
  self.group.on('stop', self._onev('stop'))
  self.group.on('restart', self._onev('restart'))
  self.group.on('crash', self._onev('crash'))
  self.group.on('sleep', self._onev('sleep'))
  self.group.on('spawn', self._onev('spawn', 'PID %d', 'pid'))
  self.group.on('exit', self._onev('exit', '%s'))
  self.group.on('warn', self._onev('warn', '%s'))

  self._readState(function (err, state) {
    if (err) return self.emit('error', err)
    state.forEach(function (e) {
      self.start(e.id, e.command, {
        cwd: e.cwd,
        env: e.env,
        logfile: e.logfile, 
        maxRestarts: e.maxRestarts,
        sleep: e.sleep
      })
    })
  })
}

Psy.prototype._onev = function (name, fmt) {
  var self = this
  name = name.toUpperCase()
  var props = [].slice.call(arguments, 2)

  return function (mon) {
    if (!has(self.logging, mon.id)) return
    var outputs = self.logging[mon.id]
    var args = [].slice.call(arguments, 1)
    for (var i = 0; i < props.length; i++) {
      args[i] = args[i][props[i]]
    }

    outputs.forEach(function (out) {
      var pre = (self.linestate[mon.id] ? '' : '\n') + '!!! PROCESS '
      if (fmt) {
        var str = sprintf.apply(null, [fmt].concat(args).filter(Boolean))
        out.write(pre + name + ': ' + str + '\n')
      } else {
        out.write(pre + name + '\n')
      }
      self.linestate[mon.id] = true
    })
  }
}

Psy.prototype._checkpoint = function (cb) {
  var self = this
  if (typeof cb !== 'function') cb = noop
  var src = JSON.stringify(self.group.list().map(function (e) {
    return {
      id: e.id,
      status: e.status,
      command: e.command,
      cwd: e.cwd,
      env: e.env,
      maxRestarts: e.maxRestarts,
      sleep: e.sleep,
      extra: self.extra[e.id]
    }
  }))
  fs.writeFile(self.statefile, src, cb)
}

Psy.prototype._ondata = function (mon, buf) {
  if (!has(this.logging, mon.id)) return
  var outputs = this.logging[mon.id]
  outputs.forEach(function (out) { out.write(buf) })
  this.linestate[mon.id] = buf[buf.length-1] === 10 // \n
}

Psy.prototype.list = function (cb) {
  var self = this
  var items = self.group.list().map(function (item) {
    var ref = xtend(item, {})
    delete ref.domain
    delete ref.child
    delete ref._events
    delete ref._eventsCount
    delete ref._maxListeners
    delete ref.timeout

    if (has(self.extra, item.id)) return xtend(ref, self.extra[item.id])
    else return ref
  })
  if (typeof cb === 'function') cb(null, items)
}

Psy.prototype.start = function (name, command, opts, cb) {
  var self = this
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (typeof cb !== 'function') cb = noop
  cb = once(cb)

  var gs = self.group.list()
  for (var i = 0; i < gs.length; i++) {
    if (gs[i].id !== name) continue
    if (gs[i].status === 'running') {
      return cb(errinfo('A process called ' + JSON.stringify(name)
        + ' is already running.'))
    } else {
      self.group.remove(name, function (err) {
        if (err) cb(err)
        else cstart(done)
      })
    }
    return
  }
  cstart(done)

  function done (err) {
    if (err) return cb(err)
    self._checkpoint(cb)
  }

  function cstart (cb) {
    self.extra[name] = {}
    if (opts.logfile && !has(self.logging, name)) {
      var w = fs.createWriteStream(opts.logfile, { flags: 'a' })
      w.once('error', cb)
      self.logging[name] = [ w ]
      self.linestate[name] = true
      self.extra[name].logfile = opts.logfile
    }
    if (!self.group.get(name)) self.group.add(name, command, opts)
    self.group.start(name, opts)
    cb()
  }
}

Psy.prototype.stop = function (name, cb) {
  var self = this
  self.group.stop(name, function (err) {
    if (err) return cb(err)
    self._checkpoint(cb)
  })
}

Psy.prototype.restart = function (name, cb) {
  this.group.restart(name)
  this._checkpoint(cb)
}

Psy.prototype.remove = function (name, cb) {
  this.group.remove(name)
  this._checkpoint(cb)
}

Psy.prototype.log = function (name, opts) {
console.log('LOG', name, self.extra)
  var self = this
  if (!opts) opts = {}
  if (!has(self.logging, name)) {
    self.logging[name] = []
    self.linestate[name] = true
  }
  var stream = through()
  if (defined(opts.n, opts.N) !== undefined) {
    if (self.extra[name] && self.extra[name].logfile) showlines()
    else if (!opts.follow) stream.end()
  }
  if (defined(opts.n, opts.N) === undefined || opts.follow) {
    self.logging[name].push(stream)
    onend(stream, function () {
      var ix = self.logging[name].indexOf(stream)
      if (ix >= 0) self.logging[name].splice(ix, 1)
    })
  }
  return stream

  function showlines () {
    stream.pause()
    var sf = sliceFile(self.extra[name].logfile)
    var args = []
    if (/,/.test(opts.n)) {
      args = opts.n.split(',').map(function (s) {
        return -Number(s)
      })
    } else if (opts.n !== undefined) {
      args[0] = -opts.n
    } else if (/,/.test(opts.N)) {
      args = opts.N.split(',').map(Number)
    } else {
      args[0] = opts.N
    }
    sf.slice.apply(sf, args).pipe(through(writec, function () {
      stream.resume()
      if (self.logging[name].indexOf(stream) < 0) {
        stream.end()
      }
    }))
  }
}

Psy.prototype._readState = function (cb) {
  fs.readFile(this.statefile, 'utf8', function (err, src) {
    if (err && err.code === 'ENOENT') src = '[]'
    else if (err) return cb(err)

    try { var state = JSON.parse(src || '[]') }
    catch (err) { return cb(err) }

    if (!Array.isArray(state)) cb(null, [])
    else cb(null, state)
  })
}

function errinfo (msg) {
  var err = new Error(msg)
  err.info = msg
  return err
}
function noop () {}

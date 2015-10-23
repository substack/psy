#!/usr/bin/env node

var fs = require('fs')
var path = require('path')
var net = require('net')

var minimist = require('minimist')
var argv = minimist(process.argv.slice(2), {
  alias: { h: 'help', s: 'sockfile', l: 'logfile', f: 'follow' },
  boolean: [ 'f' ]
})
var cmd = argv._[0]
if (cmd === 'help' || argv.help) return usage(0)

var defined = require('defined')
var has = require('has')
var xtend = require('xtend')
var once = require('once')
var timeago = require('timeago')
var table = require('text-table')
var sprintf = require('sprintf')
var through = require('through2')
var configDir = require('xdg-basedir').config
var sliceFile = require('slice-file')

var rpc = require('rpc-stream')
var respawn = require('respawn-group')

var spawn = require('child_process').spawn
var randomBytes = require('crypto').randomBytes

var METHODS = [
  'start', 'stop', 'restart', 'remove', 'list', 'log',
  'close', 'kill', 'reset'
]

var mkdirp = require('mkdirp')
var psyPath = defined(process.env.PSY_PATH, path.join(configDir, 'psy'))
var sockfile = defined(
  argv.sockfile, process.env.PSY_SOCKFILE,
  path.join(psyPath, 'sock')
)
var pidfile = defined(
  argv.pidfile, process.env.PSY_PIDFILE,
  path.join(psyPath, 'pid')
)
var statefile = defined(
  argv.statefile, process.env.PSY_STATEFILE,
  path.join(psyPath, 'state')
)

mkdirp.sync(path.dirname(sockfile))

if (cmd === 'version' || (!cmd && argv.version)) {
  console.log(require('./package.json').version)
} else if (cmd === 'start') {
  var name = defined(argv.name, argv.n, randomBytes(4).toString('hex'))
  var opts = {
    cwd: defined(argv.cwd, process.cwd()),
    env: argv.env,
    maxRestarts: defined(argv.maxRestarts, -1),
    sleep: defined(argv.sleep, 0),
    logfile: argv.logfile
  }
  getGroup(function (err, group) {
    if (err) return error(err)
    group.list(function (err, gs) {
      if (err) return error(err)
      for (var i = 0; i < gs.length; i++) {
        if (gs[i].id !== name) continue
        if (gs[i].status === 'running') {
          return error('A process called ' + JSON.stringify(name)
            + ' is already running.')
        } else {
          group.remove(name, function (err) {
            if (err) console.error(err)
            cstart(group)
          })
        }
        return
      }
      cstart(group)
    })
  })
  function cstart (group) {
    group.start(name, argv._.slice(1), opts, function (err) {
      if (err) console.error(err)
      else if (!argv.name && !argv.n) console.log(name)
      group.disconnect()
    })
  }
} else if (cmd === 'stop') {
  var name = defined(argv.name, argv.n, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.stop(name, function (err) {
      if (err) return error(err)
      group.disconnect()
    })
  })
} else if (cmd === 'restart') {
  var name = defined(argv.name, argv.n, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.restart(name, function (err) {
      if (err) console.error(err)
      group.disconnect()
    })
  })
} else if (cmd === 'rm' || cmd === 'remove') {
  var name = defined(argv.name, argv.n, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.remove(name, function (err) {
      if (err) console.error(err)
      group.disconnect()
    })
  })
} else if (cmd === 'list' || cmd === 'ls') {
  getGroup(function (err, group) {
    if (err) return error(err)
    group.list(function (err, items) {
      if (err) console.error(err)
      else process.stdout.write(formatList(items))
      group.disconnect()
    })
  })
} else if (cmd === 'log') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.log(name, {
      n: argv.n,
      N: argv.N,
      follow: argv.follow
    }, function (err) {
      if (err) console.error(err)
      //group.disconnect()
    })
  })
} else if (cmd === 'server') {
  fs.stat(sockfile, function (err) {
    if (!err) fs.unlink(sockfile, fstart)
    else fstart()
  })
  function fstart (err) {
    start({ autoclose: defined(argv.autoclose, false) }, function (err) {
      if (err) error(err)
    })
  }
} else if (cmd === 'daemon') {
  daemon({ autoclose: false })
} else if (cmd === 'pid') {
  fs.readFile(pidfile, 'utf8', function (err, pid) {
    if (err) error(err)
    else console.log(pid)
  })
} else if (cmd === 'close') {
  getGroup(function (err, group) {
    if (err) return error(err)
    group.close(function () {
      group.disconnect()
    })
  })
} else if (cmd === 'reset') { 
  fs.unlink(statefile, function () {
    getGroup(function (err, group) {
      if (err) return error(err)
      group.reset(function () {
        group.disconnect()
      })
    })
  })
} else usage(1)

function usage (code) {
  var r = fs.createReadStream(path.join(__dirname, 'usage.txt'))
  if (code) r.once('end', function () { process.exit(code) })
  r.pipe(process.stdout)
}

function start (opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  cb = once(cb)
  var group = respawn()
  var extra = {}
  var logging = {}
  var logfiles = {}
  var linestate = {}
  group.on('stdout', ondata)
  group.on('stderr', ondata)

  group.on('start', onev('start'))
  group.on('stop', onev('stop'))
  group.on('restart', onev('restart'))
  group.on('crash', onev('crash'))
  group.on('sleep', onev('sleep'))
  group.on('spawn', onev('spawn', 'PID %d', 'pid'))
  group.on('exit', onev('exit', '%s'))
  group.on('warn', onev('warn', '%s'))

  function ondata (mon, buf) {
    if (!has(logging, mon.id)) return
    var outputs = logging[mon.id]
    outputs.forEach(function (out) { out.write(buf) })
    linestate[mon.id] = buf[buf.length-1] === 10 // \n
  }

  function checkpoint(cb) {
    var src = JSON.stringify(group.list().map(function (e) {
      return {
        id: e.id,
        status: e.status,
        command: e.command,
        cwd: e.cwd,
        env: e.env,
        maxRestarts: e.maxRestarts,
        sleep: e.sleep,
        extra: extra[e.id]
      }
    }))
    fs.writeFile(statefile, src, function (err) {
      if (cb && typeof cb === 'function') cb(err)
    })
  }

  function onev (name, fmt) {
    name = name.toUpperCase()
    var props = [].slice.call(arguments, 2)

    return function (mon) {
      if (!has(logging, mon.id)) return
      var outputs = logging[mon.id]
      var args = [].slice.call(arguments, 1)
      for (var i = 0; i < props.length; i++) {
        args[i] = args[i][props[i]]
      }

      outputs.forEach(function (out) {
        var pre = (linestate[mon.id] ? '' : '\n') + '!!! PROCESS '
        if (fmt) {
          var str = sprintf.apply(null, [fmt].concat(args).filter(Boolean))
          out.write(pre + name + ': ' + str + '\n')
        } else {
          out.write(pre + name + '\n')
        }
        linestate[mon.id] = true
      })
    }
  }

  var iface = {
    list: function (cb) {
      var items = group.list().map(function (item) {
        var ref = xtend(item, {})
        delete ref.domain
        delete ref.child
        delete ref._events
        delete ref._eventsCount
        delete ref._maxListeners
        delete ref.timeout

        if (has(extra, item.id)) return xtend(ref, extra[item.id])
        else return ref
      })
      if (typeof cb === 'function') cb(null, items)
    },
    start: function (name, command, opts, cb) {
      if (typeof opts === 'function') {
        cb = opts
        opts = {}
      }
      startgroup(name, command, opts, function(err) {
        if (err) return cb(err)
        checkpoint(cb)
      })
    },
    stop: function (name, cb) {
      group.stop(name, function (err) {
        if (err) return cb(err)
        checkpoint(cb)
      })
    },
    restart: function (name, cb) {
      group.restart(name)
      checkpoint(cb)
    },
    remove: function (name, cb) {
      group.remove(name)
      checkpoint(cb)
    },
    kill: function () {
      server.close()
      process.exit()
    },
    close: function (cb) {
      group.list().forEach(function (item) {
        group.remove(item.id)
      })
      server.close()
      if (cb && typeof cb === 'function') cb()
    },
    reset: function (cb) {
      server.close()
      fs.unlink(pidfile)
      fs.unlink(sockfile)
      fs.unlink(statefile)
    }
  }

  function startgroup(name, command, opts, cb) {
    if (opts.logfile && !has(logging, name)) {
      logfiles[name] = opts.logfile
      var w = fs.createWriteStream(opts.logfile, { flags: 'a' })
      w.once('error', function (err) {
        console.error(err.stack || err)
      })
      logging[name] = [ w ]
      linestate[name] = true
      extra[name] = { logfile: opts.logfile }
    }
    if (!group.get(name)) group.add(name, command, opts)
    group.start(name, opts)
    if (cb && typeof cb === 'function') cb()
  }

  readState(function (err, state) {
    if (err) return cb(err)
    state.forEach(function (e) {
      startgroup(e.id, e.command, {
        cwd: e.cwd,
        env: e.env,
        logfile: e.logfile, 
        maxRestarts: e.maxRestarts,
        sleep: e.sleep
      })
    })
  })

  var connected = 0
  var server = net.createServer(function (stream) {
    connected ++
    var isconnected = true
    stream.on('error', function () {})

    iface.log = function (name, opts, cb) {
      if (typeof opts === 'function') {
        cb = opts
        opts = {}
      }
      if (!opts) opts = {}
      if (!has(logging, name)) {
        logging[name] = []
        linestate[name] = true
      }
      var log = through(writec)
      if (defined(opts.n, opts.N) !== undefined && logfiles[name]) {
        showlines()
      }
      if (defined(opts.n, opts.N) === undefined || opts.follow) {
        logging[name].push(log)
        stream.once('_cleanup', function () {
          var ix = logging[name].indexOf(log)
          if (ix >= 0) logging[name].splice(ix, 1)
        })
      }

      function writec (buf, enc, next) {
        client.write(buf.toString('base64'))
        next()
      }

      function showlines () {
        log.pause()
        var sf = sliceFile(logfiles[name])
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
          log.resume()
          if (logging[name] && logging[name].indexOf(log) < 0) {
            stream.end()
          }
        }))
      }
    }
    var rstream = rpc(iface)
    var client = rstream.wrap(['write'])
    stream.pipe(rstream).pipe(stream)

    stream.once('end', onend)
    stream.once('error', onend)
    stream.once('close', onend)
    function onend () {
      if (!isconnected) return
      isconnected = false
      connected -= 1
      stream.emit('_cleanup')

      if (opts.autoclose === false) return
      if (connected === 0 && group.list().length === 0) {
        setTimeout(function () {
          if (connected !== 0) return
          if (group.list().length > 0) return
          server.close()
        }, 1000)
      }
    }
  })
  server.listen(sockfile, function () {
    cb(null, group)
    if (argv.parentpid) process.kill(argv.parentpid, 'SIGUSR2')
  })
  server.once('error', cb)

  process.once('exit', function () {
    fs.unlinkSync(pidfile)
    fs.unlinkSync(sockfile)
  })
}

function daemon (opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  cb = once(cb || function () {})
  var args = [
    __filename, 'server',
    '--pidfile', pidfile,
    '--sockfile', sockfile,
    '--parentpid', process.pid,
    '--statefile', statefile,
    '--autoclose', defined(argv.autoclose, 'true')
  ]
  if (opts.autoclose !== undefined) {
    args.push('--autoclose', String(opts.autoclose))
  }
  var ps = spawn(process.execPath, args, {
    stdio: 'ignore',
    detached: true
  })
  var pending = 2
  fs.writeFile(pidfile, String(ps.pid), function (err) {
    if (err) cb(err)
    else if (--pending === 0) cb()
  })
  ps.once('exit', function (code) {
    cb(new Error('exited with code: ' + code))
  })
  process.once('SIGUSR2', function () {
    ps.unref()
    if (--pending === 0) cb()
  })
}

function connect (cb_) {
  var cb = once(function (err, r) {
    process.nextTick(function () {
      process.removeListener('uncaughtException', onuncaught)
    })
    cb_(err, r)
  })
  process.once('uncaughtException', onuncaught)
  function onuncaught (err) {
    // needed because some core bug with catching errors in unix sockets
    if (err && err.code === 'ECONNREFUSED') {}
    else {
      console.error(err.stack || err)
      process.exit(1)
    }
  }
  var c = net.connect(sockfile)
  var client = rpc({
    write: function (buf) {
      process.stdout.write(Buffer(buf, 'base64'))
    }
  })
 
  var r = client.wrap(METHODS)
  r.disconnect = function () { c.destroy() }
  c.once('connect', function () {
    cb(null, r)
  })
  c.once('error', cb)
  c.pipe(client).pipe(c)
}

function getGroup (cb) {
  fs.stat(sockfile, function (err) {
    if (err) return connectAndDaemonize(cb)
    connect(function (err, r) {
      if (err) return connectAndDaemonize(cb)
      else cb(null, r)
    })
  })
}

function connectAndDaemonize (cb) {
  fs.unlink(sockfile, function () {
    daemon(function (err) {
      if (err) cb(err)
      else connect(cb)
    })
  })
}

function error (err) {
  console.error(err.stack || err)
  process.exit(1)
}

function formatList (items) {
  if (argv.json) {
    return items.map(function (item) {
      return JSON.stringify(item) + '\n'
    }).join('')
  }
  return table(items.map(function (item) {
    return [
      item.id, item.status, item.pid === undefined ? '---' : item.pid,
      item.started ? timeago(new Date(item.started)) : '---',
      item.command.join(' ')
    ]
  })) + (items.length ? '\n' : '')
}

function readState (cb) {
  fs.readFile(statefile, 'utf8', function (err, src) {
    if (err && err.code === 'ENOENT') src = '[]'
    else if (err) return cb(err)

    try { var state = JSON.parse(src) }
    catch (err) { return cb(err) }

    if (!Array.isArray(state)) cb(null, [])
    else cb(null, state)
  })
}

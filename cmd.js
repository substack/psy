#!/usr/bin/env node

var fs = require('fs')
var path = require('path')

var minimist = require('minimist')
var argv = minimist(process.argv.slice(2), {
  alias: { h: 'help', n: 'name', s: 'sockfile' }
})
var cmd = argv._[0]
if (cmd === 'help' || argv.help) return usage(0)

var net = require('net')
var defined = require('defined')
var rpc = require('rpc-stream')
var once = require('once')
var respawn = require('respawn-group')
var spawn = require('child_process').spawn
var randomBytes = require('crypto').randomBytes
var timeago = require('timeago')
var table = require('text-table')

var HOME = defined(process.env.HOME, process.env.USERDIR)
var METHODS = [ 'start', 'stop', 'restart', 'remove', 'list', 'close', 'kill' ]

var mkdirp = require('mkdirp')
var sockfile = defined(
  argv.sockfile, process.env.RESPAWN_SOCKFILE,
  path.join(
    defined(process.env.RESPAWN_PATH, path.join(HOME, '.config/respawn')),
    'sock'
  )
)
var pidfile = defined(
  argv.sockfile, process.env.RESPAWN_PIDFILE,
  path.join(
    defined(process.env.RESPAWN_PATH, path.join(HOME, '.config/respawn')),
    'pid'
  )
)
mkdirp.sync(path.dirname(sockfile))

if (cmd === 'start') {
  var name = defined(argv.name, randomBytes(4).toString('hex'))
  var opts = {
    cwd: argv.cwd,
    env: argv.env,
    maxRestarts: defined(argv.maxRestarts, -1),
    sleep: defined(argv.sleep, 0)
  }
  getGroup(function (err, group) {
    if (err) return error(err)
    group.start(name, argv._.slice(1), opts, function () {
      if (!argv.name) console.log(name)
      group.disconnect()
    })
  })
} else if (cmd === 'stop') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.stop(name, function (err) {
      if (err) return error(err)
      group.disconnect()
    })
  })
} else if (cmd === 'restart') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.restart(name)
    group.disconnect()
  })
} else if (cmd === 'rm' || cmd === 'remove') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.remove(name, function () {
      group.disconnect()
    })
  })
} else if (cmd === 'list' || cmd === 'ls') {
  getGroup(function (err, group) {
    if (err) return error(err)
    group.list(function (items) {
      process.stdout.write(formatList(items))
      group.disconnect()
    })
  })
} else if (cmd === 'server') {
  fs.stat(sockfile, function (err) {
    if (!err) fs.unlink(sockfile, fstart)
    else fstart()
  })
  function fstart (err) {
    start(function (err) {
      if (err) error(err)
    })
  }
} else if (cmd === 'daemon') {
  daemon()
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
} else usage(1)

function usage (code) {
  var r = fs.createReadStream(path.join(__dirname, 'usage.txt'))
  if (code) r.once('end', function () { process.exit(code) })
  r.pipe(process.stdout)
}

function start (cb) {
  cb = once(cb)
  var group = respawn()
  var iface = {
    list: function (cb) {
      if (typeof cb === 'function') cb(group.list())
    },
    start: function (name, command, opts, cb) {
      if (typeof opts === 'function') {
        cb = opts
        opts = {}
      }
      if (!group.get(name)) group.add(name, command)
      group.start(name, opts)
      if (cb && typeof cb === 'function') cb()
    },
    stop: function (name, cb) {
      group.stop(name, cb)
    },
    restart: function (name, cb) {
      group.restart(name)
      if (cb && typeof cb === 'function') cb()
    },
    remove: function (name, cb) {
      group.remove(name)
      if (cb && typeof cb === 'function') cb()
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
    }
  }

  var connected = 0
  var server = net.createServer(function (stream) {
    connected ++
    var isconnected = true
    stream.on('error', function () {})
    stream.pipe(rpc(iface)).pipe(stream)
 
    stream.once('end', onend)
    stream.once('error', onend)
    stream.once('close', onend)
 
    function onend () {
      if (!isconnected) return
      isconnected = false
      connected -= 1

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

function daemon (cb) {
  cb = once(cb || function () {})
  var args = [
    __filename, 'server',
    '--pidfile', pidfile,
    '--sockfile', sockfile,
    '--parentpid', process.pid
  ]
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
  cb = once(function (err, r) {
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
  var client = rpc()
  c.pause()
 
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
      return JSON.stringify(item)
    }).join('\n')
  }
  return table(items.map(function (item) {
    return [
      item.id, item.status, item.pid === undefined ? '---' : item.pid,
      item.started ? timeago(new Date(item.started)) : '---',
      item.command.join(' ')
    ]
  })) + (items.length ? '\n' : '')
}

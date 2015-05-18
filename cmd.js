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
  var name = defined(argv.name, argv._.shift())
  getGroup(function (err, group) {
    if (err) return error(err)
    group.add(name, argv._.slice(1))
    group.start(name)
    group.disconnect()
  })
} else if (cmd === 'stop') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.stop(name, function (err) {
      if (err) return error(err)
      group.list(function (items) {
        if (items.length === 0) group.close()
        group.disconnect()
      })
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
      group.list(function (items) {
        if (items.length === 0) group.close()
        group.disconnect()
      })
    })
  })
} else if (cmd === 'list' || cmd === 'ls') {
  getGroup(function (err, group) {
    if (err) return error(err)
    group.list(function (items) {
      console.log(items)
      group.disconnect()
    })
  })
} else if (cmd === 'server') {
  connect(function (err, r) {
    if (r) return error(new Error('server already running'))
    fs.unlink(sockfile, function () {
      start(function (err) {
        if (err) error(err)
      })
    })
  })
} else if (cmd === 'daemon') {
  daemon()
} else usage(1)

function usage (code) {
  var r = fs.createReadStream(path.join(__dirname, 'usage.txt'))
  if (code) r.once('end', function () { process.exit(code) })
  r.pipe(process.stdout)
}

function start (cb) {
  cb = once(cb)
  var group = respawn()

  var glist = group.list
  group.list = function (fn) { fn(glist.call(group)) }

  var gremove = group.remove
  group.remove = function (fn) {
    gremove.apply(group, arguments)
    fn()
  }
  group.close = function () { server.close() }
  group.kill = function () { process.exit() }

  var server = net.createServer(function (stream) {
    stream.pipe(rpc(group)).pipe(stream)
  })
  server.listen(sockfile, function () {
    cb(null, group)
    if (argv.parentpid) process.kill(argv.parentpid, 'SIGUSR2')
  })
  server.once('error', cb)
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

function connect (cb) {
  cb = once(cb)
  var c = net.connect(sockfile)
  c.once('connect', function () {
    var client = rpc()
    cb(null, client.wrap(METHODS))
  })
  c.once('error', cb)
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

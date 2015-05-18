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
var randomBytes = require('crypto').randomBytes

var HOME = defined(process.env.HOME, process.env.USERDIR)
var METHODS = [ 'start', 'stop', 'restart', 'remove', 'list' ]

var mkdirp = require('mkdirp')
var sockfile = defined(
  argv.sockfile, process.env.RESPAWN_SOCK,
  path.join(HOME, '.config/respawn/sock')
)
mkdirp.sync(path.dirname(sockfile))

if (cmd === 'start') {
  var name = defined(argv.name, argv._.shift())
  getGroup(function (err, group) {
    if (err) return error(err)
    group.add(name, argv._.slice(1))
    group.start(name)
  })
} else if (cmd === 'stop') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.stop(name, function (err) {
      if (err) error(err)
    })
  })
} else if (cmd === 'restart') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.restart(name)
  })
} else if (cmd === 'rm' || cmd === 'remove') {
  var name = defined(argv.name, argv._[1])
  getGroup(function (err, group) {
    if (err) return error(err)
    group.remove(name)
  })
} else if (cmd === 'list' || cmd === 'ls') {
  getGroup(function (err, group) {
    if (err) return error(err)
    group.list(function (items) {
      console.log(items)
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
  var group = rgroup()
  var list = group.list
  group.list = function (fn) { fn(list()) }
 
  var server = net.createServer(function (stream) {
    stream.pipe(rpc(group)).pipe(stream)
  })
  server.listen(sockfile, function () { cb(null, group) })
  server.once('error', cb)
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
    if (err) return start(cb)
    connect(function (err, r) {
      if (err) return start(cb)
      else cb(null, r)
    })
  })
}

function error (err) {
  console.error(err)
  process.exit(1)
}

#!/usr/bin/env node

var fs = require('fs')
var path = require('path')

var minimist = require('minimist')
var argv = minimist(process.argv.slice(2), {
  alias: { h: 'help', s: 'sockfile', l: 'logfile', f: 'follow' },
  boolean: [ 'f', 'debug' ]
})
var cmd = argv._[0]
if (cmd === 'help' || argv.help) return usage(0)

var defined = require('defined')
var timeago = require('timeago')
var table = require('text-table')
var configDir = require('xdg-basedir').config
var randomBytes = require('crypto').randomBytes

var METHODS = [
  'start', 'stop', 'restart', 'remove', 'list', 'log:s',
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
  return console.log(require('./package.json').version)
}

var autod = require('auto-daemon')
var listen = require('auto-daemon/listen')

var opts = {
  rpcfile: path.join(__dirname, 'server.js'),
  sockfile: sockfile,
  pidfile: pidfile,
  methods: METHODS,
  debug: argv.debug,
  args: [
    '--sockfile', sockfile,
    '--pidfile', pidfile,
    '--statefile', statefile
  ]
}
opts._ = ['x'].concat(opts.args)

if (cmd === 'server') {
  opts._.push('--autoclose', false)
  var server = listen(require('./server.js'), opts)
  server.once('listening', function () {
    autod(opts, function (err, r, c) {
      if (err) error(err)
      else c.end()
    })
  })
  return
}

autod(opts, function (err, r, c) {
  if (err) error(err)
  else if (cmd === 'start') {
    var name = defined(argv.name, argv.n, randomBytes(4).toString('hex'))
    var opts = {
      cwd: defined(argv.cwd, process.cwd()),
      env: argv.env,
      maxRestarts: defined(argv.maxRestarts, -1),
      sleep: defined(argv.sleep, 0),
      logfile: argv.logfile
    }
    r.start(name, argv._.slice(1), opts, function (err) {
      if (err && err.info) error(err.info)
      else if (err) error(err)
      else if (!argv.name && !argv.n) console.log(name)
      c.end()
      process.exit()
    })
  } else if (cmd === 'stop') {
    var name = defined(argv.name, argv.n, argv._[1])
    r.stop(name, function (err) {
      if (err) error(err)
      c.end()
    })
  } else if (cmd === 'restart') {
    var name = defined(argv.name, argv.n, argv._[1])
    r.restart(name, function (err) {
      if (err) return error(err)
      c.end()
    })
  } else if (cmd === 'rm' || cmd === 'remove') {
    var name = defined(argv.name, argv.n, argv._[1])
    r.remove(name, function (err) {
      if (err) return error(err)
      c.end()
    })
  } else if (cmd === 'list' || cmd === 'ls') {
    r.list(function (err, items) {
      if (err) console.error(err)
      else process.stdout.write(formatList(items))
      c.end()
    })
  } else if (cmd === 'log') {
    var name = defined(argv.name, argv._[1])
    var stream = r.log(name, {
      n: argv.n,
      N: argv.N,
      follow: argv.follow
    })
    stream.on('end', function () { c.end() })
    stream.pipe(process.stdout)
  } else if (cmd === 'daemon') {
    c.end()
  } else if (cmd === 'pid') {
    fs.readFile(pidfile, 'utf8', function (err, pid) {
      if (err) return error(err)
      try { process.kill(Number(pid), 0) }
      catch (err) {
        console.log(0)
        return c.end()
      }
      console.log(pid)
      c.end()
    })
  } else if (cmd === 'close') {
    r.close(function () {
      c.end()
    })
  } else if (cmd === 'kill') {
    r.kill(function () { c.end() })
  } else if (cmd === 'reset') { 
    fs.unlink(statefile, function () {
      r.reset(function () {
        c.end()
      })
    })
  } else usage(1)
})

function usage (code) {
  var r = fs.createReadStream(path.join(__dirname, 'usage.txt'))
  if (code) r.once('end', function () { process.exit(code) })
  r.pipe(process.stdout)
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

function error (err) {
  console.error(err.stack || err)
  process.exit(1)
}

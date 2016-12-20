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
var timeago = require('timeago.js')()
var table = require('text-table')
var configDir = require('xdg-basedir').config
var randomBytes = require('crypto').randomBytes

if (cmd === 'version' || (!cmd && argv.version)) {
  return console.log(require('./package.json').version)
}

var psy = require('./index.js')(argv)

if (cmd === 'server') {
  psy.server(function (err) {
    if (err) error(err)
  })
  return
}

if (cmd === 'start') {
  var name = defined(argv.name, argv.n, randomBytes(4).toString('hex'))
  var opts = {
    cwd: defined(argv.cwd, process.cwd()),
    env: argv.env,
    maxRestarts: defined(argv.maxRestarts, -1),
    sleep: defined(argv.sleep, 0),
    logfile: argv.logfile,
    name: name
  }
  psy.start(argv._.slice(1), opts, function (err) {
    if (err && err.info) error(err.info)
    else if (err) error(err)
    else if (!argv.name && !argv.n) console.log(name)
    process.exit()
  })
} else if (cmd === 'stop') {
  var name = defined(argv.name, argv.n, argv._[1])
  psy.stop(name, function (err) {
    if (err) error(err)
  })
} else if (cmd === 'restart') {
  var name = defined(argv.name, argv.n, argv._[1])
  psy.restart(name, function (err) {
    if (err) error(err)
  })
} else if (cmd === 'rm' || cmd === 'remove') {
  var name = defined(argv.name, argv.n, argv._[1])
  psy.remove(name, function (err) {
    if (err) error(err)
  })
} else if (cmd === 'list' || cmd === 'ls') {
  psy.list(function (err, items) {
    if (err) console.error(err)
    else process.stdout.write(formatList(items))
  })
} else if (cmd === 'log') {
  var name = defined(argv.name, argv._[1])
  psy.log(name, {
    n: argv.n,
    N: argv.N,
    follow: argv.follow
  }, function (err, stream) {
    if (err) return error(err)
    stream.pipe(process.stdout)
  })
} else if (cmd === 'daemon') {
  psy.run(function (err) {
    if (err) error(err)
  })
} else if (cmd === 'pid') {
  psy.pid(function (err, pid) {
    if (err) return error(err)
    console.log(pid)
  })
} else if (cmd === 'close') {
  psy.close(function (err) {
    if (err) error(err)
  })
} else if (cmd === 'kill') {
  psy.kill(function (err) {
    if (err) error(err)
   })
} else if (cmd === 'reset') {
  psy.reset(function (err) {
    if (err) error(err)
  })
} else usage(1)

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
      item.started ? timeago.format(new Date(item.started)) : '---',
      item.command.join(' ')
    ]
  })) + (items.length ? '\n' : '')
}

function error (err) {
  console.error(err.stack || err)
  process.exit(1)
}

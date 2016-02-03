var test = require('tape')
var exec = require('child_process').exec
var os = require('os')
var path = require('path')
var mkdirp = require('mkdirp')

var env = {
  PATH: process.env.PATH,
  PSY_PATH: path.join(os.tmpdir(), 'psy-test-' + Math.random())
}
console.log(env.PSY_PATH)

function run (cmd, cb) {
  exec(cmd, { env: env }, cb)
}

test('run', function (t) {
  t.plan(6)
  run('psy start -n time'
    + ' -l ' + path.join(env.PSY_PATH, 'time.log')
    + ' -- bash -c "while true; do date; sleep 0.1; done"',
    ready)
  function ready (err) {
    t.ifError(err)
    run('psy ls', function (err, stdout, stderr) {
      var rows = stdout.split('\n').filter(Boolean).map(function (line) {
        return line.split('  ')
      })
      t.equal(rows.length, 1)
      t.equal(rows[0][0], 'time')
      t.equal(rows[0][1], 'running')
    })
    setTimeout(function () {
      run('psy log -n3 time', function (err, stdout, stderr) {
        t.ifError(err)
        t.equal(stdout.split('\n').filter(Boolean).length, 3)
        console.log(stdout)
      })
    }, 1000)
  }
})

test('rm time', function (t) {
  t.plan(1)
  run('psy rm time', function (err) {
    t.ifError(err)
  })
})

test('long lived process pid is stable', function (t) {
  run('psy start -n time2'
    + ' -l ' + path.join(env.PSY_PATH, 'time2.log')
    + ' -- bash -c "while true; do date; sleep 0.1; done"',
    ready)
  function ready (err) {
    t.ifError(err)
    getPid(function (err, pidA) {
      t.ifError(err)
      t.ok(pidA, 'get first pid')
      setTimeout(function () {
        getPid(function (err, pidB) {
          t.ifError(err)
          t.ok(pidB, 'get second pid')
          t.equal(pidA, pidB, 'pids match')
          t.end()
        })
      }, 1000)
    })
  }

  function getPid (cb) {
    run('psy ls', function (err, stdout, stderr) {
      if (err) return cb(err)
      var rows = stdout.split('\n').filter(Boolean).map(function (line) {
        return line.split('  ')
      })
      if (!rows.length) return cb(new Error('psy ls returned no results'))
      cb(null, rows[0][2])
    })
  }
})

test('rm time2', function (t) {
  t.plan(1)
  run('psy rm time2', function (err) {
    t.ifError(err)
  })
})

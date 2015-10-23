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

test('run teardown', function (t) {
  t.plan(1)
  run('psy rm time', function (err) {
    t.ifError(err)
  })
})

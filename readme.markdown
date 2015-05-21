# psy

psy keeps restarting a process when it crashes. It never stops.

This package is like pm2 or forever, but fewer features so there are less things
that can go wrong and fewer options to configure.

# example

Just install `psy` to get started:

```
$ npm install -g psy
```

Now you can start a process called static:

```
$ psy start -n static -- ecstatic ./public -p 8080
```

and another process called api:

```
$ psy start -n api -- node server.js
```

we can list the running processes:

```
 $ psy ls
static  running  5914  less than a minute ago  ecstatic ./public -p 8080
api     running  5932  less than a minute ago  node server.js
```

restart a process:

```
$ psy restart static
$ psy ls
static  running  6015  less than a minute ago  ecstatic ./public -p 8080
api     running  5932  2 minutes ago           node server.js
```

stop a process:

```
$ psy stop api
$ psy ls
static  running  6015  less than a minute ago  ecstatic ./public -p 8080
api     stopped  ---   ---                     node server.js
```

stop and remove a process:

```
$ psy rm static
$ psy ls
api  stopped  ---  ---  node server.js
```

log lifecycle events and stdout+stderr:

```
$ psy log msgs
!!! PROCESS SPAWN: PID 12086
!!! PROCESS START
2015-05-18T14:09:26.886Z
/home/substack/projects/psy/msgs.js:3
    if (Math.random() < 0.2) (undefined).whatever()
                                        ^
TypeError: Cannot read property 'whatever' of undefined
    at null._repeat (/home/substack/projects/psy/msgs.js:3:41)
    at wrapper [as _onTimeout] (timers.js:267:19)
    at Timer.listOnTimeout (timers.js:89:15)
!!! PROCESS EXIT: 1
!!! PROCESS SLEEP
!!! PROCESS SPAWN: PID 12092
2015-05-18T14:09:29.264Z
2015-05-18T14:09:30.303Z
2015-05-18T14:09:31.314Z
!!! PROCESS EXIT: SIGTERM
!!! PROCESS STOP
```

and SEVERAL more!

# usage

```
psy start {OPTIONS} -- [COMMAND...]

  Start a process COMMAND.

   -n, --name        Set a NAME for the process.
   --cwd             Current working directory for COMMAND
   --env.NAME=VALUE  Set environment variables explicitly for COMMAND.
   --sleep           Sleep MS milliseconds between restarts. Default: 1000
   --maxRestarts     Number of restarts allowed in 60 seconds before stopping.
                     -1 for Infinity. Default: -1.
   -l, --logfile     Write stdout, stderr, and process lifecycle events to FILE.

   If NAME isn't given, the generated hex name will be printed.
   When the process crashes, it will be restarted unless maxRestarts is reached.

psy stop NAME

  Stop a process by its NAME.

psy restart NAME

  Restart a process by its NAME.

psy rm NAME
psy remove NAME

  Stop a process and remove it from the list.

psy list
psy ls

  List the running processes as text columns.

  --json     Print the data as json instead of text columns.

psy log NAME

  Show the lifecycle events and stdout+stderr for NAME as it arrives.

psy server

  Run the monitor service in the foreground.

psy daemon

  Run the monitor service in the background.

psy pid

  Print the last known PID of the daemon process.

psy reset

  Clear any process state and close the server. Processes will not come back
  when the server starts up again.

psy close

  Close the server. Processes will come back when the server starts up again.

If the service isn't running when a command like `psy start` or `psy ls` is run,
the service will be opened in autoclose mode. In autoclose mode, the service
automatically exits when there are no open connections and no managed processes.

If the monitor service crashes, the next time the service runs it will restart
any processes it was running before.

GLOBAL OPTIONS

  --pidfile     File to store PID information about the daemon.
  --sockfile    Where to place the unix socket for RPC connections
  --statefile   Store process state information here for recovery.
  --version     Print the version number and exit.

  Options take precedence over environment variables.

ENVIRONMENT VARIABLES

  PSY_SOCKFILE   Unix socket file to use for RPC connections.
  PSY_PIDFILE    File to store PID information about the daemon.
  PSY_STATEFILE  File to store information about process state between runs.
  PSY_PATH       Directory to check for `sock` and `pid` files if PSY_SOCKFILE
                 or PSY_PIDFILE are not given. Default: $HOME/.config/psy

```

# license

MIT

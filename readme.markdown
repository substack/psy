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

and SEVERAL more!

# usage

```
psy start {OPTIONS} -- [COMMAND...]

  Start a process COMMAND.

   -n NAME, --name NAME

     Give the process a name.
     Otherwise the name is a random hex string.

   --maxRestarts N

     Number of restarts allowed in 60 seconds before stopping.
     N=-1 for Infinity. Default: -1.

   -l FILE, --logfile FILE

     Write stdout, stderr, and process lifecycle events to FILE.
 
   --sleep MS

     Sleep MS milliseconds between restarts. Default: 1000

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

psy server

  Run the monitor service in the foreground.

psy daemon

  Run the monitor in the background.

psy pid

  Print the last known PID of the daemon process.

If the service isn't running when a command like `psy start` or `psy ls` is run,
the service will be opened in autoclose mode. In autoclose mode, the service
automatically exits when there are no open connections and no managed processes.
```

# license

MIT

# Supervisor engine

The Scala Supervisor turns readings into timeline segments. It runs the
configured segmentation and tagging rules, resumes from checkpoints, and
publishes segments to the SCADA state sink. The state sink owns persistence.

## Build and run

Use JDK 21. From this directory, run:

```sh
sbt test assembly
java -jar target/scala-3.5.2/scada-supervisor-engine.jar --check /path/to/application.conf
CLASSIFY_GROUP=machine-1 java -jar target/scala-3.5.2/scada-supervisor-engine.jar /path/to/application.conf
```

The HOCON file supplies machine IDs, segment rules, tag rules, source aliases,
broker endpoints and an optional checkpoint API. `CLASSIFY_GROUP` selects the
machine IDs owned by the process. An empty group starts no machine streams.
`--capabilities` reports the history protocols supported by the entry point.

## Extend for a plant

A plant application subclasses `SupervisorRuntime` with its `RuntimeProfile`.
The profile can load a plant-specific machine mode, select a live stream or
history worker, and define segment annotation and publication policies.
The engine supplies the shared execution, replay, writer leases, and transport.

The npm package carries the Scala sources and pinned upstream dependencies
under `supervisor-engine/`. A plant build pins the SCADA package version and
compiles those sources with its own profile. The engine can also be built
directly from this repository as a standalone JAR.

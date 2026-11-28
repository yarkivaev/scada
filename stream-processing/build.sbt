name := "scada-stream-processing"
organization := "io.yarkivaev"
version := "2.10.0"
ThisBuild / scalaVersion := "3.5.2"

Compile / unmanagedSourceDirectories += baseDirectory.value / "vendor" / "temporal-streams" / "src" / "main" / "scala"
Compile / unmanagedJars ++= Seq("stream-worker", "timeline-segmentation").map { dependency =>
  val jar = baseDirectory.value / "dependencies" / s"$dependency.jar"
  require(jar.isFile, "Run ./resolve-dependencies.sh to fetch the pinned processing JARs")
  Attributed.blank(jar)
}
Compile / mainClass := Some("scada.processing.runtime.ProcessingApp")
assembly / mainClass := (Compile / mainClass).value
assembly / assemblyJarName := "scada-stream-processing.jar"
assembly / assemblyMergeStrategy := {
  case PathList("META-INF", "services", _*) => MergeStrategy.concat
  case PathList("META-INF", "versions", _*) => MergeStrategy.first
  case PathList("META-INF", "io.netty.versions.properties") => MergeStrategy.first
  case path if path.endsWith("module-info.class") => MergeStrategy.discard
  case "reference.conf" => MergeStrategy.concat
  case path => (assembly / assemblyMergeStrategy).value(path)
}

libraryDependencies ++= Seq(
  "org.typelevel"    %% "cats-effect"                    % "3.5.7",
  "co.fs2"           %% "fs2-core"                       % "3.11.0",
  "co.fs2"           %% "fs2-io"                         % "3.11.0",
  "io.circe"         %% "circe-core"                     % "0.14.10",
  "io.circe"         %% "circe-generic"                  % "0.14.10",
  "io.circe"         %% "circe-parser"                   % "0.14.10",
  "com.typesafe"      % "config"                         % "1.4.3",
  "org.eclipse.paho"  % "org.eclipse.paho.client.mqttv3" % "1.2.5",
  "org.tpolecat"     %% "doobie-postgres"                % "1.0.0-RC6",
  "org.tpolecat"     %% "doobie-hikari"                  % "1.0.0-RC6",
  "org.http4s"       %% "http4s-ember-server"             % "0.23.28",
  "org.http4s"       %% "http4s-dsl"                      % "0.23.28",
  "org.typelevel"    %% "log4cats-slf4j"                 % "2.7.0",
  "ch.qos.logback"    % "logback-classic"                % "1.5.12",
  "org.typelevel"    %% "munit-cats-effect"               % "2.0.0" % Test
)

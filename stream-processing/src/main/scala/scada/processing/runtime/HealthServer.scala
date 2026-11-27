package scada.processing.runtime

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import com.comcast.ip4s.*
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.ember.server.EmberServerBuilder

/**
 * Kubernetes-friendly liveness/readiness endpoint pair.
 *
 *   - `GET /health` — 200 OK as soon as the HTTP server is bound.
 *   - `GET /ready`  — 200 OK while this process is listening.
 *     A silent source does not make the process unhealthy.
 *
 * {{{
 * HealthServer().serve(8080)
 * }}}
 */
final class HealthServer:

  def serve(port: Int): Resource[IO, Unit] =
    Port
      .fromInt(port)
      .fold(Resource.raiseError[IO, Unit, Throwable](IllegalArgumentException(s"invalid health port: $port"))): p =>
        EmberServerBuilder
          .default[IO]
          .withHost(host"0.0.0.0")
          .withPort(p)
          .withHttpApp(routes.orNotFound)
          .build
          .void

  private[runtime] def routes: HttpRoutes[IO] =
    HttpRoutes.of[IO]:
      case GET -> Root / "health" => Ok("ok")
      case GET -> Root / "ready"  => Ok("ready")

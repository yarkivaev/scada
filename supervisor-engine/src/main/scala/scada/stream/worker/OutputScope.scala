package scada.stream.worker

import cats.effect.{IO, IOLocal}

/** Carries the durable worker output ID through decorators that emit multiple wire messages. */
final class OutputScope private (local: IOLocal[Option[OutputId]]):
  def current: IO[Option[OutputId]] = local.get

  def within[A](id: OutputId)(write: IO[A]): IO[A] =
    local.get.bracket(previous => local.set(Some(id)) *> write)(local.set)

object OutputScope:
  def create: IO[OutputScope] = IOLocal(Option.empty[OutputId]).map(new OutputScope(_))

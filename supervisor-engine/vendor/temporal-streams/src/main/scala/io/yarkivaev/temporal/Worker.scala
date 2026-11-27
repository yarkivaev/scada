package io.yarkivaev.temporal

import cats.Monad
import cats.syntax.all.*
import fs2.Pipe

/** Persistent application ports. commit must be idempotent for work.id; acknowledge only retires work. */
trait Processing[F[_], Result]:
  /** None means required historical context is unavailable; do not classify. */
  def context(work: Work): F[Option[Vector[Observation]]]
  def classify(work: Work, context: Vector[Observation]): F[Vector[Result]]
  def commit(work: Work, result: Vector[Result]): F[Unit]
  def acknowledge(work: Work): F[Unit]

final class Worker[F[_]: Monad, Result](ports: Processing[F,Result]):
  def run(work: Work): F[Unit] =
    ports.context(work).flatMap:
      case None => ports.acknowledge(work)
      case Some(points) => ports.classify(work,points).flatMap(ports.commit(work,_)) *> ports.acknowledge(work)
  /** Serial processing is intentional: external partitioning can provide bounded parallelism. */
  def pipe: Pipe[F,Work,Unit] = _.evalMap(run)

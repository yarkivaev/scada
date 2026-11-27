package scada.processing.core

/**
 * Lifecycle marker for a value flowing through the pipeline.
 *
 * `Started` carries a pending value whose boundaries may still grow;
 * `Emitted` carries the finalised value.
 *
 * {{{
 * Emission.Started(segment): Emission[Segment]
 * Emission.Emitted(segment): Emission[Segment]
 * }}}
 */
sealed trait Emission[+A]:
  def value: A

object Emission:
  final case class Started[A](value: A) extends Emission[A]
  final case class Emitted[A](value: A) extends Emission[A]

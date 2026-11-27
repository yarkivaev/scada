package scada.processing.core

/**
 * Epoch seconds (double, millisecond precision) as an opaque type so
 * it stays allocation-free in segmentation hot paths yet never mixes
 * with raw numeric values.
 *
 * {{{
 * val t = Timestamp(1700000000.0)
 * t.minus(Timestamp(1699999985.0))
 * }}}
 */
opaque type Timestamp = Double

object Timestamp:
  def apply(epochSeconds: Double): Timestamp = epochSeconds

  given Ordering[Timestamp] = Ordering.Double.TotalOrdering

  extension (self: Timestamp)
    def epoch: Double = self
    def millis: Long = (self * 1000).toLong
    def minus(other: Timestamp): Double = self - other
    def plus(seconds: Double): Timestamp = self + seconds
    def isAfter(other: Timestamp): Boolean = self > other
    def isBefore(other: Timestamp): Boolean = self < other

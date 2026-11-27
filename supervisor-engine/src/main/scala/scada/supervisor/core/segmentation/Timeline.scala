package scada.supervisor.core.segmentation

import scada.supervisor.core.{Params, SegmentDef}

/** Transitions over classified samples in input order. The coordinate type is
  * chosen by the caller and is never rounded or compared here.
  */
object Timeline:
  enum Boundary:
    case Live, Observed

  final case class Interval[+A](name: String, start: A, end: A)

  enum Event[+A]:
    case Sample(at: A, name: String, continuous: Boolean)
    case DeadlineExpired(at: A)
    case EndOfInput

  enum Output[+A]:
    case Pending(interval: Interval[A])
    case Closed(interval: Interval[A])

  final case class Result[A](open: Option[Interval[A]], outputs: Vector[Output[A]])

  def classifier(definitions: List[SegmentDef]): Params => Option[String] =
    val lookup = (name: String) => definitions.find(_.name == name).map(_.condition)
    params => definitions.find(_.condition.matches(params, lookup)).map(_.name)

  def step[A](boundary: Boundary, open: Option[Interval[A]], event: Event[A]): Result[A] =
    event match
      case Event.Sample(at, name, continuous) =>
        open match
          case Some(previous) if continuous && previous.name == name =>
            val updated = previous.copy(end = at)
            Result(Some(updated), Vector(Output.Pending(updated)))
          case _ =>
            val next = Interval(name, at, at)
            val closed = open.map: previous =>
              val end = if boundary == Boundary.Live && previous.name != name then at else previous.end
              Output.Closed(previous.copy(end = end))
            Result(Some(next), closed.toVector :+ Output.Pending(next))
      // The existing policies keep the last interval open through silence and finite EOF.
      case Event.DeadlineExpired(_) | Event.EndOfInput => Result(open, Vector.empty)

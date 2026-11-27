package scada.processing.infra.stomp

import io.circe.Json
import io.circe.parser.parse as parseJson
import scada.processing.core.{Decision, MachineId, SplitEntry, Timestamp}

/**
 * Inbound-wire parser for operator [[Decision]]s arriving on the
 * STOMP `user_decisions` destination. Reads a JSON body and picks the
 * decision variant:
 *
 *   - presence of `splits` → [[Decision.Split]]
 *   - presence of `tags`   → [[Decision.Resolve]]
 *   - otherwise            → [[Decision.Skip]]
 *
 * Missing `machine` / `start` keys produce `None` so the consumer can
 * drop malformed frames.
 *
 * {{{
 * DecisionMessage.parse(bodyJson)
 * }}}
 */
object DecisionMessage:

  def parse(body: String): Option[Decision] =
    parseJson(body).toOption.flatMap: json =>
      val cursor  = json.hcursor
      val machine = cursor.downField("machine").as[String].toOption.map(MachineId(_))
      val start   = cursor.downField("start").as[Double].toOption.map(Timestamp(_))
      (machine, start) match
        case (Some(m), Some(s)) if cursor.downField("splits").succeeded =>
          Some(Decision.Split(m, s, splits(cursor.downField("splits").as[List[Json]].toOption.getOrElse(Nil))))
        case (Some(m), Some(s)) if cursor.downField("tags").succeeded =>
          val tags  = cursor.downField("tags").as[List[String]].toOption.getOrElse(Nil)
          val props = cursor.downField("properties").as[Map[String, String]].toOption.getOrElse(Map.empty)
          Some(Decision.Resolve(m, s, tags, props))
        case (Some(m), Some(s)) =>
          Some(Decision.Skip(s"${m.raw}-${s.millis}"))
        case _ => None

  private def splits(rows: List[Json]): List[SplitEntry] =
    rows.flatMap: j =>
      val cursor = j.hcursor
      val open = cursor.downField("open").as[Boolean].toOption.getOrElse(false)
      val tag = cursor.downField("tag").as[String].toOption.getOrElse("")
      for
        st <- cursor.downField("start").as[Double].toOption
        en <- cursor.downField("end").as[Double].toOption.orElse(Option.when(open)(st))
      yield SplitEntry(Timestamp(st), Timestamp(en), tag, open)

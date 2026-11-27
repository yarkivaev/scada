package scada.supervisor.infra.stomp

import cats.effect.IO
import fs2.Stream
import scada.supervisor.core.{Decision,MachineId}
import scada.supervisor.infra.config.RabbitMqConfig

/** A durable per-machine copy; unrelated machine decisions are discarded only from this copy. */
final class StompMachineDecisions(config: RabbitMqConfig, queue: String, machine: MachineId):
  def subscribe: Stream[IO,Decision] =
    val open = StompConnection.open(config.address.host,config.address.port,config.vhost,config.credentials.login,config.credentials.passcode)
      .map(connection => connection: StompLink)
    StompQueue(open,queue,(frame: StompFrame) => DecisionMessage.parse(frame.body)).subscribe.filter:
      case Decision.Resolve(id,_,_,_) => id == machine
      case Decision.Split(id,_,_) => id == machine
      case _ => false

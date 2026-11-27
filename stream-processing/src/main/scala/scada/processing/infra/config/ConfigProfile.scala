package scada.processing.infra.config

import com.typesafe.config.Config
import scada.processing.core.{MachineConfig, MachineMode}

/** Extension points for site-specific HOCON rules and groups. */
trait ConfigProfile:
  def mode(machine: Config): Option[MachineMode] = None
  def inGroup(machine: MachineConfig, groups: Set[String]): Boolean = false
  def validate(raw: Config, config: AppConfig): Unit = ()

object ConfigProfile:
  val default: ConfigProfile = new ConfigProfile {}

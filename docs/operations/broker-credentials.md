[Documentation](../README.md) / [Operations](README.md)

# Broker credentials

Configure RabbitMQ definitions and runtime credentials through Kubernetes Secrets.

Set `rabbitmq.definitionsSecret` to a separately provisioned Secret with the key
`definitions.json`; the chart then omits definitions from its ConfigMap. Set
`rabbitmq.runtimeSecret` for `AMQP_URL`, `STOMP_LOGIN` and `STOMP_PASSCODE`.
Other clients can reference the same or narrower Secrets explicitly. Anonymous
MQTT remains compatible by default; set `rabbitmq.extraConfig["mqtt.allow_anonymous"]`
to false only after all MQTT clients have authenticated credentials. A frozen
broker PodTemplate cannot adopt these mounts: unfreeze it for a controlled
restart while preserving the claim. Definitions import does not delete an
existing guest user; retire it explicitly after all dependent clients reconnect.

---

← [Database migrations](database-migrations.md) · [Upgrades and adoption](upgrades.md) →

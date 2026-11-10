{{- define "scada.prefix" -}}
{{- default .Release.Name .Values.prefix -}}
{{- end }}

{{- define "scada.labels" -}}
app.kubernetes.io/name: scada
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- include "scada.extraLabels" . }}
{{- end }}

{{- define "scada.extraLabels" -}}
{{- range $key, $val := (.Values.extraLabels | default dict) }}
{{ $key }}: {{ $val | quote }}
{{- end }}
{{- end }}

{{- define "scada.match" -}}
app: {{ .app }}
{{- range $key, $val := (.ctx.Values.extraLabels | default dict) }}
{{ $key }}: {{ $val | quote }}
{{- end }}
{{- end }}

{{- define "scada.claim" -}}
accessModes: ["ReadWriteOnce"]
{{- if .class }}
storageClassName: {{ .class | quote }}
{{- end }}
resources:
  requests:
    storage: {{ .size | quote }}
volumeMode: Filesystem
{{- end }}

{{- define "scada.device" -}}
{{- $serial := regexFind "/dev/tty[A-Za-z0-9]+" . -}}
{{- if $serial -}}
{{- $serial -}}
{{- else -}}
{{- . -}}
{{- end -}}
{{- end }}

{{- define "scada.slug" -}}
{{- regexReplaceAll "[^A-Za-z0-9]+" . "-" | trimAll "-" | lower -}}
{{- end }}

{{- define "scada.routingKey" -}}
{{- if eq . "*" -}}
#
{{- else if hasSuffix "/*" . -}}
{{- printf "%s.#" (replace "/" "." (trimSuffix "/*" .)) -}}
{{- else -}}
{{- replace "/" "." . -}}
{{- end -}}
{{- end }}

{{- define "scada.linkEnv" -}}
- name: SINK_DB_PROFILE
  value: {{ .Values.role | quote }}
{{- if .Values.postgres.enabled }}
- name: POSTGRES_URL
  valueFrom:
    secretKeyRef:
      name: {{ default .Values.postgres.secret .Values.postgres.runtimeSecret }}
      key: url
{{- if eq .Values.postgres.migrationsMode "verify" }}
- name: SUPERVISOR_MIGRATIONS
  value: "verify"
{{- else }}
- name: POSTGRES_ADMIN_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgres.secret }}
      key: adminUrl
{{- end }}
{{- end }}
{{- if .Values.rabbitmq.enabled }}
- name: STOMP_URL
  value: {{ printf "stomp://%s-rabbitmq:61613" (include "scada.prefix" .) | quote }}
{{- if .Values.rabbitmq.runtimeSecret }}
{{- range $name := list "STOMP_LOGIN" "STOMP_PASSCODE" "AMQP_URL" }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.rabbitmq.runtimeSecret | quote }}
      key: {{ $name }}
{{- end }}
{{- else }}
- name: STOMP_LOGIN
  value: guest
- name: STOMP_PASSCODE
  value: guest
- name: AMQP_URL
  value: {{ printf "amqp://guest:guest@%s-rabbitmq:5672" (include "scada.prefix" .) | quote }}
{{- end }}
- name: STOMP_HOST
  value: /
{{- end }}
{{- if .Values.clickhouse.enabled }}
- name: CLICKHOUSE_HOST
  value: {{ printf "%s-clickhouse" (include "scada.prefix" .) | quote }}
- name: CLICKHOUSE_URL
  value: {{ printf "http://%s-clickhouse:8123" (include "scada.prefix" .) | quote }}
{{- end }}
{{- end }}

{{- define "scada.brokerConfigName" -}}
{{- default (printf "%s-rabbitmq" (include "scada.prefix" .)) .Values.rabbitmq.configName -}}
{{- end }}

{{/* Literal env values remain strings; Kubernetes valueFrom references stay opaque. */}}
{{- define "scada.envValue" -}}
{{- if kindIs "map" . }}
{{- toYaml . }}
{{- else }}
value: {{ . | quote }}
{{- end }}
{{- end }}

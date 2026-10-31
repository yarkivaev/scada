{{- define "scada.labels" -}}
app.kubernetes.io/name: scada
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

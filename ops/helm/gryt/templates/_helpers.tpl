{{/*
Expand the name of the chart.
*/}}
{{- define "gryt.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "gryt.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "gryt.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "gryt.labels" -}}
helm.sh/chart: {{ include "gryt.chart" . }}
{{ include "gryt.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "gryt.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gryt.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
SFU labels
*/}}
{{- define "gryt.sfu.labels" -}}
{{ include "gryt.labels" . }}
app.kubernetes.io/component: sfu
{{- end }}

{{/*
SFU selector labels
*/}}
{{- define "gryt.sfu.selectorLabels" -}}
{{ include "gryt.selectorLabels" . }}
app.kubernetes.io/component: sfu
{{- end }}

{{/*
Server labels
*/}}
{{- define "gryt.server.labels" -}}
{{ include "gryt.labels" . }}
app.kubernetes.io/component: server
{{- end }}

{{/*
Server selector labels
*/}}
{{- define "gryt.server.selectorLabels" -}}
{{ include "gryt.selectorLabels" . }}
app.kubernetes.io/component: server
{{- end }}

{{/*
Client labels
*/}}
{{- define "gryt.client.labels" -}}
{{ include "gryt.labels" . }}
app.kubernetes.io/component: client
{{- end }}

{{/*
Client selector labels
*/}}
{{- define "gryt.client.selectorLabels" -}}
{{ include "gryt.selectorLabels" . }}
app.kubernetes.io/component: client
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "gryt.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "gryt.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the image name with registry and tag
*/}}
{{- define "gryt.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" -}}
{{- $repository := .repository -}}
{{- $tag := .tag | default $.Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Get the SFU WebSocket host
*/}}
{{- define "gryt.sfu.wsHost" -}}
{{- printf "ws://%s-sfu:%d" (include "gryt.fullname" .) (.Values.sfu.service.port | int) -}}
{{- end }}



{{/*
Get the CORS origin
*/}}
{{- define "gryt.corsOrigin" -}}
{{- if .Values.ingress.routing.useSubdomains -}}
{{- printf "https://%s.%s" .Values.ingress.routing.subdomains.client .Values.gryt.domain -}}
{{- else -}}
{{- printf "https://%s" .Values.gryt.domain -}}
{{- end -}}
{{- end }}

{{/*
Common annotations
*/}}
{{- define "gryt.annotations" -}}
{{- with .Values.commonAnnotations }}
{{ toYaml . }}
{{- end }}
{{- end }} 
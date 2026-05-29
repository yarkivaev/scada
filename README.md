# @yarkivaev/scada

Generic industrial plant monitoring domain, HTTP API, and supervisor-sink runtime.

Repository: `https://gitlab.scada.svsokol.ru/scada/scada`

## Install

From GitLab npm registry (after publish):

1. In the **scada** GitLab project, note the numeric **Project ID** (`PROJECT_ID`).
2. In the consuming repo, add `.npmrc`:

```ini
@yarkivaev/scada:registry=https://gitlab.scada.svsokol.ru/api/v4/projects/PROJECT_ID/packages/npm/
//gitlab.scada.svsokol.ru/api/v4/projects/PROJECT_ID/packages/npm/:_authToken=YOUR_TOKEN_HERE
```

Use a deploy token or personal access token with package registry read. Cross-project CI needs a token on the **scada** project (not `CI_JOB_TOKEN` from another project).

3. `npm install @yarkivaev/scada@VERSION`

`@yarkivaev/simple-server` and `@yarkivaev/source-to-sink` resolve from registry.npmjs.org (publish `simple-server` via GitHub Actions before first `npm ci`).

## First-time publish order

1. Push `simple-server` to GitHub `main` → publishes `@yarkivaev/simple-server@1.0.0` to npmjs
2. Push `scada` to GitLab `main` → publishes `@yarkivaev/scada` to GitLab npm

Publishing runs from **`release-npm`** (`scada/gitlab-ci-templates/release-npm.yml`) on tag **`v` + `version`** from `package.json`. On **`main`**: **test** → **validate-version** → **create-tag** → on tag pipeline **release-npm**.

## Usage

```javascript
import {
    plant, shop, machine, timeline, alerts, alert, initialized,
    plantApi, pgTimeline, stompTimeline, memoryTimelineFull
} from '@yarkivaev/scada';

const area = shop('shop1', initialized({ icht1: machine('icht1', { timeline: memoryTimelineFull() }) }, Object.values), alerts(alert, acknowledgedAlert));
const factory = plant(initialized({ shop1: area }, Object.values));
const api = plantApi('/api/v1', factory);
```

Melting-specific domain and routes live in `sokol-scada`.

## Public API

- **Domain:** `plant`, `shop`, `machine`, `timeline`, `alerts`, `alert`, `acknowledgedAlert`, `initialized`, `pubsub`
- **HTTP:** `plantApi`, `edgeApi`, `startTestEdgeApi`
- **Persistence:** `pgTimeline`, `pgAlerts`, `stompTimeline`, `memoryTimelineFull`, `stateDataFromPool`, `stateDataFake`
- **Sink:** `supervisorSink`, `runRetention`
- **Client:** `@yarkivaev/scada/client`

## supervisor-sink

```bash
node src/bin/supervisor-sink.js
```

Edge HTTP API exposes metrics, checkpoints, and retention only. Timeline and alerts are read from PostgreSQL (`SUPERVISOR_STATE_PG_URL`); retag/respond writes go through STOMP.

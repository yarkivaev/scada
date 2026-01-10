# scada

SCADA domain objects for industrial plant monitoring.

## Install

```
npm install scada
```

## Usage

```javascript
import { plant, meltingShop, meltingMachine, meltings, alerts, initialized } from 'scada';

const machine = meltingMachine('icht1', sensors, alertHistory);
const shop = meltingShop('shop1', initialized({ icht1: machine }, Object.values), meltings());
const factory = plant(initialized({ shop1: shop }, Object.values));
```

## Modules

### Plant Hierarchy
- `plant`
- `meltingShop`
- `meltingMachine`
- `machineChronology`
- `monitoredMeltingMachine`

### Melting Operations
- `activeMelting`
- `completedMelting`
- `meltings`
- `meltingChronology`

### Alerting
- `alert`
- `acknowledgedAlert`
- `alerts`
- `meltingRuleEngine`

### Sensors
- `scyllaSensor`
- `clickhouseSensor`

### Utilities
- `interval`
- `initialized`
- `events`

## License

MIT

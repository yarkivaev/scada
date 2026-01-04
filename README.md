# scada

SCADA domain objects for industrial plant monitoring.

## Install

```
npm install scada
```

## Usage

```javascript
import { plant, meltingShop, meltingMachine, alerts } from 'scada';

const machine = meltingMachine('icht1', voltageSensor, cosphiSensor, alertHistory);
const shop = meltingShop(initializedList(machine));
const factory = plant(initializedList(shop));
```

## Modules

- `plant` - Top-level plant structure
- `meltingShop` - Melting shop containing machines
- `meltingMachine` - Machine tracking weight and measurements
- `monitoredMeltingMachine` - Machine with periodic monitoring
- `activeMelting` - In-progress melting session
- `completedMelting` - Finished melting record
- `meltings` - Collection of melting sessions
- `meltingRuleEngine` - Alert evaluation engine
- `alerts` - Alert history with filtering
- `alert` - Immutable alert record
- `acknowledgedAlert` - Acknowledged alert record
- `interval` - Periodic action executor
- `initializedList` - List with batch initialization

## License

MIT

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
factory.init(); // initializes all shops and machines
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
- `initialized` - Collection-agnostic batch initialization wrapper

## License

MIT

# AGENTS.md

`@yarkivaev/scada` is factory-agnostic. Plant/Sokol melting domain (bath, chem, HMI, `weight_after` fold) belongs in `sokol-scada`, not here.

Opaque operation kinds and generic ports (`latestForMachine`, list/upsert/stream) are fine. See `README.md` § Package boundary and `CLAUDE.md`.

# PLC drivers

Tele-Pendant talks to plant hardware through a protocol-neutral port in `@tele-pendant/plc-driver`.

## Contract

`PlcPort` in [`packages/plc-driver/src/port.ts`](../packages/plc-driver/src/port.ts) defines:

- `connect` / `disconnect` / `isConnected`
- `read(point)` / `write(point, value)` for coils, discretes, holdings, and inputs

New fieldbuses implement `PlcPort`. The API (`apps/api/src/plc/providers/plc.service.ts`) selects the active connection and maps HMI register rows onto that port.

## Shipped drivers

| Protocol | Status | Notes |
| -------- | ------ | ----- |
| Modbus TCP | Default (lab) | Cleartext `net.Socket`; demo simulator on port `1502`. Config warns when saving non-simulator cleartext. |
| Modbus TLS | Optional | Encrypted Modbus TCP Security / MBAPS-style socket via `tls.connect`. Requires CA / client cert / key paths on the API host. |
| OPC UA | Optional | Compose profile `opcua`; default **SignAndEncrypt** + **Basic256Sha256** with client cert/key paths. Fill each register’s node id. |

Admin **Config → PLC connections** toggles protocol and security fields. Register maps store Modbus address and optional OPC UA node id so the same HMI layout can switch backends. Diagnostics / health may show `modbus-tls` or `opcua SignAndEncrypt`.

### Channel security (classic on-prem)

- **Plant links:** prefer **OPC UA SignAndEncrypt** (or at least Sign) with PEM files mounted into the API container, or **Modbus TLS** when the gateway supports it.
- **Cleartext Modbus TCP:** only for the demo simulator or an isolated OT VLAN / VPN. It cannot be “encrypted in place.”
- Certificate paths are files on the API host (Docker volume). Example compose mount:

```yaml
services:
  api:
    volumes:
      - ./certs:/certs:ro
```

Then set **CA / trust PEM path** to `/certs/ca.pem`, **Client cert** to `/certs/client.pem`, **Client key** to `/certs/client.key`. Keep **Verify server certificate** on unless you are in a lab. OPC UA passwords use a **password file path** (e.g. `/run/secrets/opc-password`), not a DB column.

Recommended OPC UA defaults for new plant rows: security mode **SignAndEncrypt**, policy **Basic256Sha256**, anonymous session under the secure channel, or username + password file when the server requires it. **None/None** is allowed only when explicitly selected (lab) and shows the same class of warning as cleartext Modbus.

Modbus TCP/TLS connect and each later read or write use the connection timeout. A request that does not finish in that time closes the socket and the driver reports disconnected. OPC UA reads and writes throw when the status code is not Good. A lost session (`BadSession`, `BadConnection`, `BadSecureChannel`, `BadNotConnected`) clears the connection so the next poll sees it as disconnected.

For connecting a **real** PLC (fields, example values, where to read them on the machine), see [REAL_PLC_WIRING.md](./REAL_PLC_WIRING.md).

## Adding a driver

1. Implement `PlcPort` in `packages/plc-driver` (or a sibling package).
2. Wire construction in `plc.service.ts` next to Modbus / OPC UA.
3. Document host/port/auth env vars here and in `INSTALLATION.md`.
4. Keep safety supervision (deadman / e-stop / watchdog) at the HMI/API layer; do not claim SIL in the driver.

Out of scope for this delivery: Profinet, EtherNet/IP, and other fieldbuses beyond Modbus TCP / Modbus TLS / OPC UA. Transport encryption is not SIL / functional-safety certification.

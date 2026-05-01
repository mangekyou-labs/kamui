# IOTA VRF Structure

## Folder Organization

```
iota/
├── move/              # Move package for on-chain coordinator
│   ├── sources/       # Move source files
│   ├── tests/         # Move tests
│   └── Move.toml      # Package manifest
├── node/              # Off-chain VRF node (TypeScript/Node.js)
│   ├── src/
│   │   ├── ingest/    # Event polling & cursor management
│   │   ├── prove/     # VRF proof generation
│   │   ├── submit/    # Transaction submission & retries
│   │   ├── store/     # State persistence
│   │   ├── api/       # Health & metrics endpoints
│   │   └── config/    # Configuration & validation
│   └── package.json
└── docker/            # Containerization
```

## Naming Conventions

### Move Package
- **Package name**: `kamui_iota_vrf` (snake_case)
- **Named address**: `kamui_iota_vrf` (`0x0` in source; assigned on publish)
- **Mainnet package ID**: `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`
- **Module names**:
  - `kamui_iota_vrf::coordinator`
  - `kamui_iota_vrf::request`
  - `kamui_iota_vrf::demo_consumer`

### Off-chain Node
- **Package name**: `@kamui/iota-vrf-node`
- **Main entry**: `src/index.ts`
- **Binary name**: `kamui-iota-vrf-node`

### Published Artifacts
- **Move package**: Published to IOTA mainnet on `2026-03-18`
- **Publish transaction digest**: `2aUubEafHMXdrgoe5feTfKmJkozPVeGnqQA5mzzArzkf`
- **Upgrade cap**: `0x67ad0d6c28cd664daa73beecc983f2b7ef1f4b39601997144f9a4b83a8f0c898`
- **Docker image**: `kamui/iota-vrf-node:latest`

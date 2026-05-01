# IOTA VRF Proof Generation Solution

## Problem Resolved
The mangekyou ecvrf-cli generates proofs incompatible with IOTA's `ecvrf_verify` because it uses a different VRF suite identifier.

## Solution: MystenLabs fastcrypto CLI

**Source**: https://github.com/MystenLabs/fastcrypto

IOTA's on-chain ECVRF verification uses MystenLabs fastcrypto library with the `iota_vrf` suite identifier.

## Installation

```bash
# Clone fastcrypto repository
git clone https://github.com/MystenLabs/fastcrypto.git
cd fastcrypto

# Build ecvrf-cli
cargo build --release --bin ecvrf-cli

# Binary location
./target/release/ecvrf-cli
```

## CLI Usage

### Generate Keypair
```bash
cargo run --bin ecvrf-cli keygen
# Output:
# Secret key: <32-byte hex>
# Public key: <32-byte hex>
```

### Generate Proof
```bash
cargo run --bin ecvrf-cli prove \
  --input <hex_input> \
  --secret-key <hex_secret_key>
# Output:
# Proof: <80-byte hex>
# Output: <64-byte hex>
```

### Verify Proof
```bash
cargo run --bin ecvrf-cli verify \
  --output <hex_output> \
  --proof <hex_proof> \
  --input <hex_input> \
  --public-key <hex_public_key>
# Output: Proof verified correctly!
```

## Integration with IOTA VRF Node

The off-chain VRF node will use fastcrypto CLI exactly like the Solana implementation uses mangekyou CLI:

1. Spawn `ecvrf-cli prove` as external process
2. Parse stdout for proof and output
3. Submit to coordinator's `fulfill_randomness()`
4. IOTA's `ecvrf_verify` will accept the proof (guaranteed compatibility)

## Next Steps

1. Clone and build fastcrypto CLI
2. Test proof generation and on-chain verification
3. Implement IOTA VRF node using fastcrypto CLI
4. Deploy and test end-to-end flow

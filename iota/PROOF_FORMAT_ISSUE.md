# ECVRF Proof Format Incompatibility Issue

## Status
**RESOLVED** - Historical note kept for context; the node now targets MystenLabs
`fastcrypto` for IOTA-compatible proof generation.

## Problem
The ecvrf-cli tool (from mangekyou-cli) generates proofs that are **not compatible** with IOTA's `iota::ecvrf::ecvrf_verify` function, despite both claiming to implement CFRG VRF draft-15 with Ristretto255.

## Evidence
- IOTA's own test vectors pass verification ✅
- ecvrf-cli generated proofs fail verification ❌
- Both use same format: 32B public key, 80B proof, 64B output
- Both claim CFRG VRF draft-15 + Ristretto255 + SHA-512

## Root Cause (Hypothesis)
Possible cryptographic parameter differences:
1. **Suite string**: Different VRF suite identifiers
2. **Hash-to-curve**: Different H2C implementations
3. **Proof encoding**: Subtle serialization differences
4. **Implementation bugs**: Either in mangekyou or IOTA framework

## Impact
- `mangekyou` must not be used for IOTA proof generation
- The production/off-chain path is `fastcrypto`
- The original blocker for Phase 2 node implementation is closed

## Resolution Options

### Option 1: Fix mangekyou ecvrf (HIGH EFFORT)
- Audit mangekyou crypto implementation
- Align with IOTA's exact parameters
- Risk: Deep cryptographic changes

### Option 2: Use IOTA-native tooling (RECOMMENDED)
- Research IOTA SDK proof generation APIs
- Use IOTA's own crypto libraries (fastcrypto)
- Guaranteed compatibility

### Option 3: Reverse-engineer format (MEDIUM EFFORT)
- Analyze IOTA's test vectors
- Identify parameter differences
- Patch mangekyou to match

## Resolution
1. Use MystenLabs `fastcrypto` CLI for off-chain proof generation
2. Keep the node's proving adapter isolated so the CLI can later be replaced with a library binding
3. Validate generated proof and output lengths before transaction submission
4. Continue end-to-end validation on testnet with the live coordinator + node flow

## Workaround for Phase 1
Use IOTA's test vectors to validate on-chain verification works correctly. Defer proof generation compatibility to Phase 2.

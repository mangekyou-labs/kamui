# ECVRF Proof Format Specification

## Overview
IOTA Move framework uses ECVRF (Elliptic Curve Verifiable Random Function) over Ristretto255 according to CFRG VRF draft-15.

## Format Specifications

### Private Key
- **Length**: 32 bytes
- **Encoding**: Hex string (64 characters)
- **Type**: Scalar in Ristretto255
- **Example**: `d354a0525580ab79bf67797b824a7df3ddf81ff45729175fa4d98d9f3dcd150f`

### Public Key
- **Length**: 32 bytes
- **Encoding**: Hex string (64 characters)
- **Type**: Ristretto255 point (canonical encoding)
- **Example**: `7a66a0fe0f2bcdcea5bfb97e3e9f6b298d25899052721bc2b4f3cb570a921b23`

### Proof
- **Length**: 80 bytes
- **Encoding**: Hex string (160 characters)
- **Type**: ECVRF proof per draft-irtf-cfrg-vrf-15
- **Example**: `54b58f527e999ceedb24485a7629e3caa9f7deb152852a0f483a6646495fa253c4131e87ff0b48fefacf4b5be04211a77390ca85553aa2c06f0023db34e7b36194eadf11539c0ef1c8dcae09aa35580a`

### Output (VRF Hash)
- **Length**: 64 bytes
- **Encoding**: Hex string (128 characters)
- **Type**: SHA-512 hash of the proof
- **Example**: `8d9c5b901c05a4edf4dff80bbe970db6ca782fe785ef1375989a3fdb3a93b521f4165ea3a6d1c90ae5641bb528beb98c1eed13d36fb32951ecf163b7900e3da6`

### Alpha (Input)
- **Type**: Arbitrary byte vector
- **Encoding**: Hex string
- **Example**: `4869204b616d756921` (hex for "Hi Kamui!")

## IOTA Move Verification

### Function Signature
```move
iota::ecvrf::ecvrf_verify(
    output: &vector<u8>,      // 64 bytes
    alpha_string: &vector<u8>, // arbitrary length
    public_key: &vector<u8>,   // 32 bytes
    proof: &vector<u8>         // 80 bytes
) -> bool
```

## Proof Generation Tool

### ecvrf-cli (MystenLabs fastcrypto)
The node must use the `ecvrf-cli` binary from MystenLabs `fastcrypto`, which matches
IOTA's on-chain verifier suite configuration.

**Build:**
```bash
git clone https://github.com/MystenLabs/fastcrypto.git
cd fastcrypto
cargo build --release --bin ecvrf-cli
```

**Usage:**
```bash
# Generate keypair
./target/release/ecvrf-cli keygen

# Generate proof
./target/release/ecvrf-cli prove \
  --input <hex_alpha> \
  --secret-key <hex_sk>

# Verify proof
./target/release/ecvrf-cli verify \
  --input <hex_alpha> \
  --public-key <hex_pk> \
  --proof <hex_proof> \
  --output <hex_output>
```

## Compatibility Confirmation

✅ **Verified target**: MystenLabs fastcrypto matches IOTA's ECVRF implementation
- CFRG VRF draft-15 semantics over Ristretto255
- 32-byte public keys
- 80-byte proofs
- 64-byte outputs

⚠️ `mangekyou` is not the proving path for this integration and should not be used for the
IOTA node.

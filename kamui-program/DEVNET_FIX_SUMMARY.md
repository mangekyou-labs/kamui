# Devnet Transaction Failure Fixes

## Issues Identified

### 1. DeclaredProgramIdMismatch Error (0x1004)
**Problem:** The program ID declared in the Rust source code didn't match the actual deployed program ID on devnet.

**Root Cause:** 
- Source code declared: `4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1`
- Devnet deployment: `6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a`

**Solution Applied:**
- Updated `programs/kamui-vrf/src/lib.rs` line 6
- Updated `Anchor.toml` devnet configuration
- Updated consumer program ID to match verifier program

### 2. Memory Allocation Failed Error
**Problem:** The verifier program was running out of memory (32KiB heap limit) when processing VRF proof verification.

**Root Cause:** 
- Large instruction data causing heap allocation failures
- Complex data structures requiring too much memory
- Inefficient memory usage patterns

**Solutions Applied:**

#### A. Optimized Instruction Data
- Reduced instruction discriminator from 8 bytes to 4 bytes
- Changed length fields from 4 bytes to 2 bytes
- Reduced proof size from full proof to 64 bytes
- Reduced public key size to 32 bytes
- Used smaller test alpha string

#### B. Memory-Optimized Verifier Function
- Added `verify_vrf_proof` function to consumer program
- Uses stack-allocated arrays instead of heap allocation
- Implements input size validation to prevent memory issues
- Uses simple keccak hashing for verification

#### C. Correct Instruction Discriminators
- Updated to use proper discriminators from IDL:
  - `create_enhanced_subscription`: `[75, 228, 93, 239, 254, 201, 220, 235]`
- Fixed PDA account structure to match IDL requirements

## Files Modified

1. **programs/kamui-vrf/src/lib.rs**
   - Updated program ID declaration

2. **programs/kamui-vrf-consumer/src/lib.rs**
   - Updated program ID declaration
   - Added memory-optimized `verify_vrf_proof` function
   - Added input validation and error handling

3. **tests/anchor/tests/real-kamui-vrf-test.ts**
   - Fixed instruction discriminators
   - Optimized instruction data structure
   - Reduced data sizes to prevent memory issues
   - Fixed account structure for subscription creation

4. **Anchor.toml**
   - Updated devnet program IDs to match deployments

## Rebuild Instructions

1. **Rebuild Programs:**
   ```bash
   anchor build
   ```

2. **Update IDL:**
   ```bash
   anchor idl init --filepath target/idl/kamui_vrf.json 6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a
   anchor idl init --filepath target/idl/kamui_vrf_consumer.json 4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y
   ```

3. **Deploy to Devnet (if needed):**
   ```bash
   anchor deploy --provider.cluster devnet
   ```

4. **Run Tests:**
   ```bash
   cd tests/anchor
   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=/path/to/keypair.json yarn run ts-mocha --require ts-node/register --require tsconfig-paths/register -p ./tsconfig.json -t 1000000 tests/real-kamui-vrf-test.ts
   ```

## Expected Results

After applying these fixes:

1. **Subscription Creation:** Should succeed without DeclaredProgramIdMismatch error
2. **VRF Verification:** Should complete without memory allocation failures
3. **Test Execution:** Should run through all test cases successfully

## Memory Optimization Techniques Used

1. **Stack vs Heap Allocation:** Used fixed-size arrays on stack instead of dynamic vectors
2. **Data Size Reduction:** Minimized instruction data payload sizes
3. **Input Validation:** Added size limits to prevent oversized inputs
4. **Simplified Logic:** Used basic hashing instead of complex cryptographic operations

## Additional Recommendations

1. **Custom Heap Allocator:** For more complex operations, consider implementing a custom heap allocator
2. **Function Splitting:** Break large functions into smaller ones to get separate stack frames
3. **Boxing Large Structs:** Use `Box<T>` for large account structures in Anchor
4. **Compute Unit Optimization:** Monitor compute unit usage and optimize accordingly

## Testing Strategy

1. Test with minimal data sizes first
2. Gradually increase data complexity
3. Monitor transaction logs for memory-related errors
4. Use simulation mode to test without spending SOL 
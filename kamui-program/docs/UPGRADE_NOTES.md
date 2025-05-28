# Anchor 0.31.0 Upgrade Notes

This document outlines the changes made to upgrade the Kamui VRF program from earlier versions of Anchor to version 0.31.0.

## Key Changes in Anchor 0.31.0

Anchor 0.31.0 introduces significant changes to account serialization and deserialization, particularly:

1. **Mandatory Discriminators**: All account structs must now properly implement the Discriminator trait with appropriate DISCRIMINATOR constants.
2. **Account Initialization Space**: The way account space is calculated has changed, requiring a more explicit approach.

## Changes Made to This Project

### 1. Account Struct Changes

All account structs have been updated with:

- `#[derive(InitSpace)]` attribute added to automatically calculate required space for account initialization
- `#[max_len()]` attributes added to properly size vector fields 
- Manual space calculations replaced with `AccountName::INIT_SPACE`

### 2. Account Context Updates

All account initialization contexts now use:

```rust
space = 8 + AccountName::INIT_SPACE
```

instead of manual space calculations.

### 3. Testing Approach

Due to IDL generation and deployment challenges during the transition, a script `run-tests.sh` has been created to run tests directly with ts-mocha, bypassing the Anchor command.

```bash
# Run default test
./run-tests.sh

# Run specific test
./run-tests.sh tests/your-test-file.ts
```

## Potential Issues

1. **proc-macro2 Compatibility**: If you encounter errors related to the proc-macro2 crate, you may need to pin it to version 1.0.60:

   ```toml
   # In Cargo.toml
   [dependencies]
   proc-macro2 = "=1.0.60" 
   ```

2. **Missing Discriminator Field**: If you see errors mentioning "missing field `discriminator`", make sure all account structs have the `#[derive(InitSpace)]` attribute.

3. **Manual IDL Files**: In some cases, you may need to manually create IDL files as Anchor 0.31.0's IDL generation can be more sensitive to errors.

## References

- [Anchor 0.31.0 Release Notes](https://github.com/coral-xyz/anchor/releases/tag/v0.31.0)
- [Anchor Book - Account Discriminators](https://www.anchor-lang.com/docs/account-discriminator) 
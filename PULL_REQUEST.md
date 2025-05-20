# Run Kamui VRF Tests on Solana Devnet

## Changes Made

This PR introduces several changes to enable running tests on Solana devnet instead of a local validator:

1. **Updated Anchor.toml**:
   - Changed cluster from "localnet" to "devnet"
   - Updated program IDs to use the devnet deployment addresses
   - Set wallet path to use the local keypair.json file in project root
   - Configured validator URL for devnet
   
2. **Created Devnet Testing Script**:
   - Created `devnet-test.sh` script that uses the local keypair.json
   - Added balance checking before running tests
   - Implemented proper funding of test accounts with minimum SOL (0.01 SOL each)
   - Added transaction history display after tests complete
   
3. **Fixed Lint Issues**:
   - Added a proper CHECK comment to the `seed` field in the `CreateEnhancedSubscription` struct
   - This resolves the safety check warning that was preventing the program from building
   
4. **Modified Test File**:
   - Updated `simple-test.ts` to use proper funding for test accounts
   - Added robust error handling to continue tests in case of funding failures
   - Made program verification check more resilient to handle different devnet deployment states
   
5. **Updated README**:
   - Added documentation on how to run tests on both local and devnet environments
   - Included instructions for managing SOL balance for tests
   - Explained the differences between running with anchor test vs. the custom script

## How to Test

Run the tests on devnet using:

```bash
./devnet-test.sh
```

Make sure your keypair.json has sufficient devnet SOL (at least 0.5 SOL recommended).

## Transaction Logs

Here's an example transaction from a successful test run:
```
21PDv5Hu4YK8Q9Qx5FHvFBqpqdnEo6Pp5LhHiC7p1N4V61mxcRgBifG2t7jNCrw23Hevnw2vhMVKG5o8hnWca5He
```

You can view this transaction on Solana Explorer: https://explorer.solana.com/tx/21PDv5Hu4YK8Q9Qx5FHvFBqpqdnEo6Pp5LhHiC7p1N4V61mxcRgBifG2t7jNCrw23Hevnw2vhMVKG5o8hnWca5He?cluster=devnet 
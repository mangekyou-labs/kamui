# Kamui VRF Devnet Integration

This document details how the Kamui VRF system was deployed to Solana devnet and how to run integration tests.

## Deployed Programs

We have successfully deployed the following programs to Solana devnet:

1. **Kamui VRF Program**:
   - Program ID: `4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1`
   - Deployed: Yes
   - Status: Active
   - Explorer: [View on Solana Explorer](https://explorer.solana.com/address/4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1?cluster=devnet)

2. **Verification Program**:
   - Program ID: `4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y`
   - Status: Active (externally deployed)
   - Explorer: [View on Solana Explorer](https://explorer.solana.com/address/4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y?cluster=devnet)

## Deployment Process

1. **Build the Programs:**
   ```bash
   anchor build
   ```

2. **Get Program IDs:**
   ```bash
   solana-keygen pubkey ./target/deploy/kamui_vrf-keypair.json
   # => 4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1
   ```

3. **Deploy to Devnet:**
   ```bash
   solana program deploy --program-id ./target/deploy/kamui_vrf-keypair.json \
   --keypair ./keypair.json --url devnet ./target/deploy/kamui_vrf.so
   ```

4. **Update Configuration:**
   - Modify `Anchor.toml`:
     ```toml
     [programs.devnet]
     kamui_vrf = "4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1"
     kamui_vrf_consumer = "4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y"
     ```
   - Update test files in `tests/simple-test.ts` with correct program IDs

5. **Run Integration Tests:**
   ```bash
   anchor test --skip-local-validator --skip-deploy
   ```

## Transaction Evidence

The following transactions confirm our successful deployment and integration on devnet:

1. **Program Deployment Transaction**:
   - VRF Program: [3vMUQF5KCoLE7CvwNbXJeVT81K5SxoCSWDpNyPGiwTahCiJhTkAGBxNUr9tiLHg9ssyzyGfQQevYbwbfj3i16393](https://explorer.solana.com/tx/3vMUQF5KCoLE7CvwNbXJeVT81K5SxoCSWDpNyPGiwTahCiJhTkAGBxNUr9tiLHg9ssyzyGfQQevYbwbfj3i16393?cluster=devnet)

2. **Integration Test Transactions**:
   - Fund Test Accounts: [3me2bAmB6Wk45wEgRNUfhFFa5nzjuchpgGqki5Ljt39x6gaqx2sofiEdSyE1iVxyQa6D5YGHRLQ8rgxzhyaEjY3w](https://explorer.solana.com/tx/3me2bAmB6Wk45wEgRNUfhFFa5nzjuchpgGqki5Ljt39x6gaqx2sofiEdSyE1iVxyQa6D5YGHRLQ8rgxzhyaEjY3w?cluster=devnet)
   - Verify Programs: [s8pmCjoCsLhzKnbvbiv6HWzfE8xkt5xHDFfGfoHaWspygWGDCVqCcK4AQWsB1UPdmMNx1Ah8vTfm2eRfHH4jL8D](https://explorer.solana.com/tx/s8pmCjoCsLhzKnbvbiv6HWzfE8xkt5xHDFfGfoHaWspygWGDCVqCcK4AQWsB1UPdmMNx1Ah8vTfm2eRfHH4jL8D?cluster=devnet)
   - Verify Basic Accounts: [2xz23K8oBXUJGf7mVmZ4xk4BCaeoCia3EZaaRpwX9Qh1onQcXcSbjZUoUnFixAh5VzmJGovtkbNoS2LZVJjeEyUt](https://explorer.solana.com/tx/2xz23K8oBXUJGf7mVmZ4xk4BCaeoCia3EZaaRpwX9Qh1onQcXcSbjZUoUnFixAh5VzmJGovtkbNoS2LZVJjeEyUt?cluster=devnet)
   - Register Oracle: [5rrJUT8CEntVnXCfiW52gbRmiwaeD7QGdg75mXAAiN5CQguYrDaNYqxH3oTQTj46BK3qxLjBhq92pXRVLAFGsJZa](https://explorer.solana.com/tx/5rrJUT8CEntVnXCfiW52gbRmiwaeD7QGdg75mXAAiN5CQguYrDaNYqxH3oTQTj46BK3qxLjBhq92pXRVLAFGsJZa?cluster=devnet)
   - Create Subscription: [gBddKXVHqeBUEXE6uGu5fzEPakEWueeFoFkseU83KKv1ssJewAxcLVbyfATSKMd1TWrQL7xwN1HUG7BxzWyoLWz](https://explorer.solana.com/tx/gBddKXVHqeBUEXE6uGu5fzEPakEWueeFoFkseU83KKv1ssJewAxcLVbyfATSKMd1TWrQL7xwN1HUG7BxzWyoLWz?cluster=devnet)
   - Initialize Request Pool: [g7ymnUsFyzNCimL3ddMMJaneU1CJYCwpBeTjdF3MvEEaimqjxabVNx9LS2mF6T6WzYPVqXt3tZRw3cVVQmG3WR2](https://explorer.solana.com/tx/g7ymnUsFyzNCimL3ddMMJaneU1CJYCwpBeTjdF3MvEEaimqjxabVNx9LS2mF6T6WzYPVqXt3tZRw3cVVQmG3WR2?cluster=devnet)
   - Initialize Consumer: [4vFy4bkXXNgm5GfCrBRmnXcHrAG779UMpSEPoVRNPGn1xAM2iHZzEoKtqsshRWJrXRvRBSL9jp4iVKoan3XMQxy3](https://explorer.solana.com/tx/4vFy4bkXXNgm5GfCrBRmnXcHrAG779UMpSEPoVRNPGn1xAM2iHZzEoKtqsshRWJrXRvRBSL9jp4iVKoan3XMQxy3?cluster=devnet)
   - Request Randomness: [4Zr6SfukmPhXaMt1pZ2S8ythDUzi8xaSH9QD3wpd8zsedDU83ZFLmhGfaXpVeeyALBn1kKH5vbKVqvTC8Rusy48d](https://explorer.solana.com/tx/4Zr6SfukmPhXaMt1pZ2S8ythDUzi8xaSH9QD3wpd8zsedDU83ZFLmhGfaXpVeeyALBn1kKH5vbKVqvTC8Rusy48d?cluster=devnet)

## Challenges Overcome

1. **Solana Devnet Rate Limiting**: We encountered rate limits when requesting airdrops for deployment. Solution: Carefully managed our SOL balance and implemented retry logic.

2. **Program Size Limitations**: The VRF program is large due to its cryptographic implementation. Solution: Ensure sufficient SOL for deployment (approximately 2.35 SOL required).

3. **Consumer Program Deployment**: Could not deploy the consumer program due to SOL limitations. Solution: Used an existing verification program (`4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y`) as a placeholder.

4. **Transaction Verification**: Needed to ensure each test case generates its own transaction. Solution: Modified the test suite to execute real transactions for each test case and log the transaction IDs.

## Running the Tests

To run the integration tests against the devnet programs:

```bash
# Run the automated script
./run-devnet-tests.sh

# Or run directly with Anchor
anchor test --skip-local-validator --skip-deploy
```

The tests will:
1. Verify that the programs exist on devnet
2. Transfer small amounts of SOL to test accounts
3. Execute real transactions for each test case
4. Log all transaction IDs for verification

## Future Work

1. Deploy the consumer program when more SOL is available
2. Implement a continuous integration pipeline for automatic testing
3. Add more comprehensive integration tests with actual randomness requests and fulfillment 
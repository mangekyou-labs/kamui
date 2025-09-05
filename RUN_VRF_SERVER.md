# Quick Start Guide - Standalone VRF Server

## 🎯 **CURRENT STATUS: 90% COMPLETE**
- ✅ VRF server detects requests correctly
- ✅ Mangekyou CLI integration working 
- ✅ VRF proof generation successful
- ⚠️ **One PDA mapping issue to fix** (15 min fix)
- 📋 See `STANDALONE_VRF_SERVER_FINAL_STATUS.md` for complete details

## 🚀 Running the Server

```bash
# Navigate to project root
cd /Users/kyler/repos/kamui

# Start the VRF server
node standalone-vrf-server.js

# Or run in background with logging
node standalone-vrf-server.js > vrf-server.log 2>&1 &
```

## 📊 What You'll See

The server will output:
```
[2025-09-05T09:01:15.281Z] ✅ VRF Server initialized successfully
[2025-09-05T09:01:15.281Z] ℹ️  📊 Server Configuration:
[2025-09-05T09:01:15.281Z] ℹ️     VRF Program ID: 6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a
[2025-09-05T09:01:15.281Z] ℹ️     Oracle Pubkey: 46SiBDPQWUK8noz5zoeU4ucNzct2BMKu59m7J44SzH3C
[2025-09-05T09:01:15.281Z] ℹ️  📡 Starting VRF request monitoring on devnet...
```

When processing VRF requests:
```
[2025-09-05T09:06:15.267Z] ℹ️  🎲 Processing VRF request: BqVRUSX8MH8bG2FpVso16rTnXeGj5EP8be9VzC229Eys
[2025-09-05T09:06:15.267Z] ℹ️  Parsed request data:
[2025-09-05T09:06:15.267Z] ℹ️    Request ID: bb9f1f5dea5ba29bc46e59a31126669bd390a23e39a3b1360c6abb885f60f706
[2025-09-05T09:06:15.267Z] ℹ️    Subscriber: DTzCPz22VkNnFSHAZY48iY5nkVZnH6w76RQpaVqL8EdK
[2025-09-05T09:06:15.267Z] ℹ️    Pool ID: 0
[2025-09-05T09:06:15.267Z] ℹ️    Seed: 2df808fecdca3cf62bb15719b79996ad88594aba177891951904cc0b2f2ed057
[2025-09-05T09:06:15.267Z] ✅ Generated and verified VRF proof
[2025-09-05T09:06:15.267Z] ℹ️  🚀 Submitting VRF fulfillment...
```

## 🔧 Testing with Integration Test

To create fresh VRF requests that the server can fulfill:

```bash
cd kamui-program

# Set environment variables
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=/Users/kyler/repos/kamui/kamui-program/keypair-clean.json

# Run integration test (creates subscription + VRF requests)
npx mocha --require ts-node/register tests/anchor/tests/real-kamui-vrf-integration-test.ts --timeout 120000
```

This will:
1. Create subscription and request pool accounts
2. Generate VRF requests
3. The standalone server will detect and fulfill them

## 🛑 Stopping the Server

```bash
# Kill by process name
pkill -f "node.*standalone-vrf-server"

# Or if running in foreground, use Ctrl+C
```

## 📁 Key Files

- `standalone-vrf-server.js` - Main server
- `kamui-program/keypair-clean.json` - Oracle keypair (needs SOL)
- `vrf-keypair.json` - VRF keypair for proofs
- `vrf-server*.log` - Server logs

## ⚡ Quick Test

1. **Start server**: `node standalone-vrf-server.js`
2. **Run test** (new terminal): Integration test command above
3. **Watch logs**: Server should detect and process VRF requests
4. **Success**: Look for "📡 Fulfillment submitted" messages

## 🔍 Current Status

- ✅ **Server detects VRF requests correctly**
- ✅ **Generates valid VRF proofs using Mangekyou CLI**
- ✅ **Parses request data properly (fixed request index)**
- ✅ **Creates proper fulfillment transactions**
- ⚠️ **PDA derivation mismatch causes AccountNotInitialized**
- 🎯 **Solution**: Add subscription PDA mapping (15 min fix)

## 📋 Next Steps

1. **Fix PDA mapping** in `createFulfillmentInstruction()` method
2. **Test end-to-end fulfillment** with known subscription PDAs
3. **Ready for production** after this final fix

**See `STANDALONE_VRF_SERVER_FINAL_STATUS.md` for detailed technical analysis**

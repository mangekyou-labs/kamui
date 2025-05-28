import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";

async function debugAccountData() {
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

    // Use the subscription PDA from the test
    const KAMUI_VRF_PROGRAM_ID = new PublicKey("6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a");
    const owner = new PublicKey("E7cRZrBWpJ22hX6MbEVqE8b71rAPYxsp4fpAVq9CmbmB");
    const cleanSeed = new PublicKey("7vXpRGR1ZEexQ3QQGEQHbw4LSTspMvWnYFSUUvRhFrvF"); // From test output

    // Derive the subscription PDA
    const [subscriptionPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("subscription"), cleanSeed.toBuffer()],
        KAMUI_VRF_PROGRAM_ID
    );

    console.log(`🔍 Debugging subscription account: ${subscriptionPDA.toString()}`);

    // Get the raw account data
    const accountInfo = await connection.getAccountInfo(subscriptionPDA);

    if (!accountInfo) {
        console.log("❌ Account not found");
        return;
    }

    console.log(`📊 Account owner: ${accountInfo.owner.toString()}`);
    console.log(`📊 Account data length: ${accountInfo.data.length} bytes`);
    console.log(`📊 Raw data (hex):`);

    // Print the raw data in chunks for analysis
    const data = accountInfo.data;
    for (let i = 0; i < data.length; i += 16) {
        const chunk = data.slice(i, Math.min(i + 16, data.length));
        const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(chunk).map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
        console.log(`${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48, ' ')} ${ascii}`);
    }

    // Now let's try to parse it step by step
    console.log(`\n🔧 Manual parsing:`);

    // Skip discriminator (8 bytes)
    let offset = 8;
    console.log(`Discriminator (8 bytes): ${Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Owner (32 bytes)
    const ownerBytes = data.slice(offset, offset + 32);
    const ownerPubkey = new PublicKey(ownerBytes);
    console.log(`Owner (32 bytes): ${ownerPubkey.toString()}`);
    offset += 32;

    // Balance (8 bytes, little-endian)
    const balanceBytes = data.slice(offset, offset + 8);
    const balance = balanceBytes.readBigUInt64LE(0);
    console.log(`Balance (8 bytes): ${balance} lamports`);
    console.log(`Balance hex: ${Array.from(balanceBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    offset += 8;

    // Min Balance (8 bytes, little-endian)
    const minBalanceBytes = data.slice(offset, offset + 8);
    const minBalance = minBalanceBytes.readBigUInt64LE(0);
    console.log(`Min Balance (8 bytes): ${minBalance} lamports`);
    console.log(`Min Balance hex: ${Array.from(minBalanceBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    offset += 8;

    // Confirmations (1 byte)
    const confirmations = data[offset];
    console.log(`Confirmations (1 byte): ${confirmations}`);
    offset += 1;

    // Active Requests (2 bytes, little-endian)
    const activeRequestsBytes = data.slice(offset, offset + 2);
    const activeRequests = activeRequestsBytes.readUInt16LE(0);
    console.log(`Active Requests (2 bytes): ${activeRequests}`);
    console.log(`Active Requests hex: ${Array.from(activeRequestsBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    offset += 2;

    // Max Requests (2 bytes, little-endian)
    const maxRequestsBytes = data.slice(offset, offset + 2);
    const maxRequests = maxRequestsBytes.readUInt16LE(0);
    console.log(`Max Requests (2 bytes): ${maxRequests}`);
    console.log(`Max Requests hex: ${Array.from(maxRequestsBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    offset += 2;

    // Request Counter (8 bytes, little-endian)
    const requestCounterBytes = data.slice(offset, offset + 8);
    const requestCounter = requestCounterBytes.readBigUInt64LE(0);
    console.log(`Request Counter (8 bytes): ${requestCounter}`);
    console.log(`Request Counter hex: ${Array.from(requestCounterBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    offset += 8;

    // Vec fields start here
    console.log(`\n📝 Remaining data from offset ${offset}:`);
    const remainingData = data.slice(offset);
    console.log(`Remaining bytes: ${remainingData.length}`);
    console.log(`Remaining hex: ${Array.from(remainingData).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Try to parse Vec length (4 bytes, little-endian)
    if (remainingData.length >= 4) {
        const vecLength = remainingData.readUInt32LE(0);
        console.log(`Vec length (4 bytes): ${vecLength}`);
        offset += 4;
    }

    console.log(`\n✅ Manual parsing complete`);
    console.log(`Total bytes parsed: ${offset}`);
    console.log(`Account data length: ${data.length}`);
}

debugAccountData().catch(console.error); 
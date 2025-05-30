import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

describe("test-kamui-vrf", () => {
  it("Program exists", async () => {
    const connection = new Connection("http://localhost:8899");
    const programId = new PublicKey("3pEbPBZVHGWhb4grRVvrdxxSMrW65G3cjDTJZD23gprK");
    
    const accountInfo = await connection.getAccountInfo(programId);
    console.log("Program account info:", accountInfo);
    
    if (accountInfo) {
      console.log("✅ Program is deployed and accessible");
      console.log("Program data length:", accountInfo.data.length);
      console.log("Program owner:", accountInfo.owner.toString());
    } else {
      throw new Error("Program not found");
    }
  });
});

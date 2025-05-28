const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
const { assert } = require('chai');

describe('Simple Kamui VRF Test', () => {
    // Configure the client
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Get our program
    const vrfProgram = anchor.workspace.KamuiVrf;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer;

    it('Program has the correct IDs', () => {
        console.log('VRF Program ID:', vrfProgram.programId.toString());
        console.log('Consumer Program ID:', consumerProgram.programId.toString());

        assert.equal(
            vrfProgram.programId.toString(),
            '6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a'
        );

        assert.equal(
            consumerProgram.programId.toString(),
            '2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE'
        );
    });

    it('Program has prepared the correct accounts', () => {
        console.log('Account Id: ');

        assert.equal(

        )
    })
}); 
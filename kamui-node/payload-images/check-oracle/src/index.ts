import { getCheckOracleInstructionDataCodec } from '@cambrianone/oracle-client';
import { AccountRole, address, getBase58Codec, getProgramDerivedAddress, getUtf8Codec } from '@solana/web3.js';

import { BN } from 'bn.js';
const toLeBytes = (n: number | string | bigint): Uint8Array =>
  new BN(String(n)).toArrayLike(Buffer, 'le', 8) as Uint8Array;


const run = async (_input: any): Promise<void> => {
  try {
    const { poaName, proposalStorageKey } = _input;

    const storageSpace = 3 * 25;

    const SOLANA_THRESHOLD_SIGNATURE_PROGRAM_PROGRAM_ADDRESS = address('FGgNUqGxdEYM1gVtQT5QcTbzNv4y1UPoVvXPRnooBdxo');

    const ORACLE_PROGRAM_PROGRAM_ADDRESS = address('ECb6jyKXDTE8NjVjsKgNpjSjcv4h2E7JQ42yKqWihBQE');

    const poaStateKey = getUtf8Codec().encode(poaName);

    const [proposalStoragePDA] = await getProgramDerivedAddress({
      seeds: ['STORAGE', poaName, proposalStorageKey, toLeBytes(storageSpace)],
      programAddress: SOLANA_THRESHOLD_SIGNATURE_PROGRAM_PROGRAM_ADDRESS,
    });

    const [poaStatePDA] = await getProgramDerivedAddress({
      programAddress: SOLANA_THRESHOLD_SIGNATURE_PROGRAM_PROGRAM_ADDRESS,
      seeds: ['STATE', poaStateKey],
    });

    const res = {
      proposalInstructions: [
        {
          programAddress: ORACLE_PROGRAM_PROGRAM_ADDRESS,
          accounts: [
            {
              address: proposalStoragePDA,
              role: AccountRole.WRITABLE,
            },
            {
              address: poaStatePDA,
              role: AccountRole.READONLY,
            },
            {
              address: address('Sysvar1nstructions1111111111111111111111111'),
              role: AccountRole.READONLY,
            },
            {
              address: ORACLE_PROGRAM_PROGRAM_ADDRESS,
              role: AccountRole.READONLY,
            },
          ],
          data: getBase58Codec().decode(
            getCheckOracleInstructionDataCodec().encode({ poaStateKey }),
          ),
        },
      ],
    };


    console.log(JSON.stringify(res));
  } catch (e) {
    console.error('Payload error', e);
    throw e;
  }
};

const input = JSON.parse(process.env.CAMB_INPUT ?? '{}');

run(input).catch(e => {
  console.error('Error', e);
});

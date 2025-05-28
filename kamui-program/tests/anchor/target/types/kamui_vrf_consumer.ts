/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kamui_vrf_consumer.json`.
 */
export type KamuiVrfConsumer = {
  "address": "2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE",
  "metadata": {
    "name": "kamuiVrfConsumer",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Example consumer for the Kamui VRF system"
  },
  "instructions": [
    {
      "name": "consumeRandomness",
      "discriminator": [
        190,
        217,
        49,
        162,
        99,
        26,
        73,
        234
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game_state.owner",
                "account": "gameState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "requestRandomness",
      "discriminator": [
        213,
        5,
        173,
        166,
        37,
        236,
        31,
        18
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "kamuiProgram"
        },
        {
          "name": "request"
        },
        {
          "name": "subscription"
        },
        {
          "name": "requestPool"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "callbackGasLimit",
          "type": "u64"
        },
        {
          "name": "poolId",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameState",
      "discriminator": [
        144,
        94,
        208,
        172,
        248,
        99,
        134,
        120
      ]
    }
  ],
  "types": [
    {
      "name": "gameState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "result",
            "type": "u64"
          },
          {
            "name": "lastRequestSlot",
            "type": "u64"
          },
          {
            "name": "requestCounter",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

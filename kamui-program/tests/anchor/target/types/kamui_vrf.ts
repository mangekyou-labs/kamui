/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kamui_vrf.json`.
 */
export type KamuiVrf = {
  "address": "4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1",
  "metadata": {
    "name": "kamuiVrf",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Anchor implementation of Kamui VRF (Verifiable Random Function) program"
  },
  "instructions": [
    {
      "name": "createEnhancedSubscription",
      "discriminator": [
        75,
        228,
        93,
        239,
        254,
        201,
        220,
        235
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "subscription",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  117,
                  98,
                  115,
                  99,
                  114,
                  105,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "seed"
              }
            ]
          }
        },
        {
          "name": "seed"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "minBalance",
          "type": "u64"
        },
        {
          "name": "confirmations",
          "type": "u8"
        },
        {
          "name": "maxRequests",
          "type": "u16"
        }
      ]
    },
    {
      "name": "fulfillRandomness",
      "discriminator": [
        235,
        105,
        140,
        46,
        40,
        88,
        117,
        2
      ],
      "accounts": [
        {
          "name": "oracle",
          "writable": true,
          "signer": true
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  114,
                  102,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "requestId"
              }
            ]
          }
        },
        {
          "name": "vrfResult",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  114,
                  102,
                  95,
                  114,
                  101,
                  115,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request"
              }
            ]
          }
        },
        {
          "name": "requestPool",
          "writable": true
        },
        {
          "name": "subscription",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proof",
          "type": "bytes"
        },
        {
          "name": "publicKey",
          "type": "bytes"
        },
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "poolId",
          "type": "u8"
        },
        {
          "name": "requestIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "fundSubscription",
      "discriminator": [
        224,
        196,
        55,
        110,
        8,
        87,
        188,
        114
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "subscription",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeOracleRegistry",
      "discriminator": [
        190,
        92,
        228,
        114,
        56,
        71,
        101,
        220
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
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
          "name": "minStake",
          "type": "u64"
        },
        {
          "name": "rotationFrequency",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeRequestPool",
      "discriminator": [
        179,
        102,
        255,
        254,
        232,
        62,
        64,
        97
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "subscription"
        },
        {
          "name": "requestPool",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "poolId",
          "type": "u8"
        },
        {
          "name": "maxSize",
          "type": "u32"
        }
      ]
    },
    {
      "name": "registerOracle",
      "discriminator": [
        176,
        200,
        234,
        37,
        199,
        129,
        164,
        111
      ],
      "accounts": [
        {
          "name": "oracleAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "oracleAuthority"
              }
            ]
          }
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
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
          "name": "vrfKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "stakeAmount",
          "type": "u64"
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
          "name": "request",
          "writable": true,
          "signer": true
        },
        {
          "name": "subscription",
          "writable": true
        },
        {
          "name": "requestPool",
          "writable": true
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
          "name": "callbackData",
          "type": "bytes"
        },
        {
          "name": "numWords",
          "type": "u32"
        },
        {
          "name": "minimumConfirmations",
          "type": "u8"
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
    },
    {
      "name": "rotateOracles",
      "discriminator": [
        23,
        117,
        113,
        130,
        185,
        235,
        89,
        18
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "enhancedOracle",
      "discriminator": [
        142,
        152,
        64,
        24,
        212,
        126,
        130,
        253
      ]
    },
    {
      "name": "enhancedSubscription",
      "discriminator": [
        161,
        251,
        15,
        216,
        114,
        246,
        92,
        244
      ]
    },
    {
      "name": "oracleRegistry",
      "discriminator": [
        94,
        153,
        19,
        250,
        94,
        0,
        12,
        172
      ]
    },
    {
      "name": "randomnessRequest",
      "discriminator": [
        244,
        231,
        228,
        160,
        148,
        28,
        17,
        184
      ]
    },
    {
      "name": "requestPool",
      "discriminator": [
        49,
        144,
        171,
        111,
        172,
        112,
        31,
        237
      ]
    },
    {
      "name": "vrfResult",
      "discriminator": [
        24,
        254,
        248,
        67,
        215,
        198,
        47,
        144
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidConfirmations",
      "msg": "The provided confirmations are invalid"
    },
    {
      "code": 6001,
      "name": "invalidMaxRequests",
      "msg": "The provided maximum requests value is invalid"
    },
    {
      "code": 6002,
      "name": "invalidAmount",
      "msg": "The provided amount is invalid"
    },
    {
      "code": 6003,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow occurred"
    },
    {
      "code": 6004,
      "name": "unauthorized",
      "msg": "Unauthorized access"
    },
    {
      "code": 6005,
      "name": "invalidPoolSize",
      "msg": "Invalid pool size specified"
    },
    {
      "code": 6006,
      "name": "invalidPoolSubscription",
      "msg": "Invalid pool subscription"
    },
    {
      "code": 6007,
      "name": "invalidPoolId",
      "msg": "Invalid pool ID"
    },
    {
      "code": 6008,
      "name": "tooManyRequests",
      "msg": "Too many active requests"
    },
    {
      "code": 6009,
      "name": "insufficientFunds",
      "msg": "Insufficient subscription funds"
    },
    {
      "code": 6010,
      "name": "poolCapacityExceeded",
      "msg": "Request pool capacity exceeded"
    },
    {
      "code": 6011,
      "name": "invalidWordCount",
      "msg": "Invalid word count requested"
    },
    {
      "code": 6012,
      "name": "invalidGasLimit",
      "msg": "Invalid gas limit"
    },
    {
      "code": 6013,
      "name": "invalidRequestId",
      "msg": "Invalid request ID"
    },
    {
      "code": 6014,
      "name": "invalidRequestIndex",
      "msg": "Invalid request index"
    },
    {
      "code": 6015,
      "name": "requestNotPending",
      "msg": "Request is not in pending state"
    },
    {
      "code": 6016,
      "name": "proofVerificationFailed",
      "msg": "VRF proof verification failed"
    },
    {
      "code": 6017,
      "name": "invalidVrfKey",
      "msg": "Invalid VRF key"
    },
    {
      "code": 6018,
      "name": "invalidSubscriptionOwner",
      "msg": "Invalid subscription owner"
    },
    {
      "code": 6019,
      "name": "requestAlreadyFulfilled",
      "msg": "Request is already fulfilled"
    },
    {
      "code": 6020,
      "name": "requestExpired",
      "msg": "Request has expired"
    },
    {
      "code": 6021,
      "name": "invalidStakeAmount",
      "msg": "Invalid stake amount"
    },
    {
      "code": 6022,
      "name": "insufficientStake",
      "msg": "Insufficient stake"
    },
    {
      "code": 6023,
      "name": "invalidRotationFrequency",
      "msg": "Invalid rotation frequency"
    },
    {
      "code": 6024,
      "name": "oracleNotActive",
      "msg": "Oracle not active"
    },
    {
      "code": 6025,
      "name": "batchLimitExceeded",
      "msg": "Batch request limit exceeded"
    }
  ],
  "types": [
    {
      "name": "enhancedOracle",
      "docs": [
        "Enhanced oracle with stake and reputation"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "The oracle's authority"
            ],
            "type": "pubkey"
          },
          {
            "name": "vrfKey",
            "docs": [
              "The oracle's VRF public key"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "stakeAmount",
            "docs": [
              "Staked amount"
            ],
            "type": "u64"
          },
          {
            "name": "reputation",
            "docs": [
              "Reputation score (successful fulfillments)"
            ],
            "type": "u16"
          },
          {
            "name": "lastActive",
            "docs": [
              "Last active slot"
            ],
            "type": "u64"
          },
          {
            "name": "isActive",
            "docs": [
              "Whether the oracle is active"
            ],
            "type": "bool"
          },
          {
            "name": "fulfillmentCount",
            "docs": [
              "Number of successful fulfillments"
            ],
            "type": "u64"
          },
          {
            "name": "failureCount",
            "docs": [
              "Number of failed fulfillments"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "enhancedSubscription",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "The owner of this subscription"
            ],
            "type": "pubkey"
          },
          {
            "name": "balance",
            "docs": [
              "Current balance for VRF requests"
            ],
            "type": "u64"
          },
          {
            "name": "minBalance",
            "docs": [
              "Minimum balance required for requests"
            ],
            "type": "u64"
          },
          {
            "name": "confirmations",
            "docs": [
              "Number of confirmations required before generating VRF proof"
            ],
            "type": "u8"
          },
          {
            "name": "activeRequests",
            "docs": [
              "Number of active requests"
            ],
            "type": "u16"
          },
          {
            "name": "maxRequests",
            "docs": [
              "Maximum allowed concurrent requests"
            ],
            "type": "u16"
          },
          {
            "name": "requestCounter",
            "docs": [
              "Current request counter (for generating unique IDs)"
            ],
            "type": "u64"
          },
          {
            "name": "requestKeys",
            "docs": [
              "Truncated hashes of active request keys for quick lookup"
            ],
            "type": {
              "vec": {
                "array": [
                  "u8",
                  16
                ]
              }
            }
          },
          {
            "name": "poolIds",
            "docs": [
              "Associated request pool IDs"
            ],
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "oracleRegistry",
      "docs": [
        "Oracle registry for managing multiple oracles"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Admin authority"
            ],
            "type": "pubkey"
          },
          {
            "name": "oracleCount",
            "docs": [
              "Current number of active oracles"
            ],
            "type": "u16"
          },
          {
            "name": "minStake",
            "docs": [
              "Minimum stake amount required"
            ],
            "type": "u64"
          },
          {
            "name": "rotationFrequency",
            "docs": [
              "Slots between oracle rotation"
            ],
            "type": "u64"
          },
          {
            "name": "lastRotation",
            "docs": [
              "Last slot when oracles were rotated"
            ],
            "type": "u64"
          },
          {
            "name": "oracles",
            "docs": [
              "List of oracle public keys"
            ],
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "randomnessRequest",
      "docs": [
        "Detailed request data for processing"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscription",
            "docs": [
              "The subscription this request belongs to"
            ],
            "type": "pubkey"
          },
          {
            "name": "seed",
            "docs": [
              "The seed used for randomness"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "requester",
            "docs": [
              "The requester's program ID that will receive the callback"
            ],
            "type": "pubkey"
          },
          {
            "name": "callbackData",
            "docs": [
              "The callback function data"
            ],
            "type": "bytes"
          },
          {
            "name": "requestSlot",
            "docs": [
              "Block number when request was made"
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "Status of the request"
            ],
            "type": {
              "defined": {
                "name": "requestStatus"
              }
            }
          },
          {
            "name": "numWords",
            "docs": [
              "Number of random words requested"
            ],
            "type": "u32"
          },
          {
            "name": "callbackGasLimit",
            "docs": [
              "Maximum compute units for callback"
            ],
            "type": "u64"
          },
          {
            "name": "poolId",
            "docs": [
              "Request pool ID"
            ],
            "type": "u8"
          },
          {
            "name": "requestIndex",
            "docs": [
              "Request index in pool"
            ],
            "type": "u32"
          },
          {
            "name": "requestId",
            "docs": [
              "Unique request identifier"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "requestEntry",
      "docs": [
        "Request entry for storage in pools"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "docs": [
              "Request index"
            ],
            "type": "u32"
          },
          {
            "name": "data",
            "docs": [
              "Request summary data"
            ],
            "type": {
              "defined": {
                "name": "requestSummary"
              }
            }
          }
        ]
      }
    },
    {
      "name": "requestPool",
      "docs": [
        "Request Pool - organized by subscription"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscription",
            "docs": [
              "The subscription this pool belongs to"
            ],
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "docs": [
              "Pool identifier"
            ],
            "type": "u8"
          },
          {
            "name": "requestCount",
            "docs": [
              "Current number of requests in the pool"
            ],
            "type": "u32"
          },
          {
            "name": "maxSize",
            "docs": [
              "Maximum capacity of this pool"
            ],
            "type": "u32"
          },
          {
            "name": "requestEntries",
            "docs": [
              "List of request summaries in the pool"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "requestEntry"
                }
              }
            }
          },
          {
            "name": "lastProcessedSlot",
            "docs": [
              "Last slot this pool was processed"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "requestStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "fulfilled"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "requestSummary",
      "docs": [
        "Compact request summary for storage in pools"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requester",
            "docs": [
              "The requestor's program ID"
            ],
            "type": "pubkey"
          },
          {
            "name": "seedHash",
            "docs": [
              "Hash of the original seed (for verification)"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Timestamp of request creation"
            ],
            "type": "i64"
          },
          {
            "name": "status",
            "docs": [
              "Current status of the request"
            ],
            "type": {
              "defined": {
                "name": "requestStatus"
              }
            }
          },
          {
            "name": "requestSlot",
            "docs": [
              "Block height when request was made"
            ],
            "type": "u64"
          },
          {
            "name": "callbackGasLimit",
            "docs": [
              "Callback gas limit"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vrfResult",
      "docs": [
        "VRF result data"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "randomness",
            "docs": [
              "The randomness outputs"
            ],
            "type": {
              "vec": {
                "array": [
                  "u8",
                  64
                ]
              }
            }
          },
          {
            "name": "proof",
            "docs": [
              "The VRF proof"
            ],
            "type": "bytes"
          },
          {
            "name": "proofSlot",
            "docs": [
              "Block number when proof was generated"
            ],
            "type": "u64"
          },
          {
            "name": "requestId",
            "docs": [
              "Request ID this result is for"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};

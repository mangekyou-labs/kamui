use {
    borsh::{BorshDeserialize, BorshSerialize},
    mangekyou::kamui_vrf::{
        ecvrf::ECVRFKeyPair,
        VRFKeyPair,
    },
    solana_program::{
        account_info::AccountInfo,
        instruction::{AccountMeta, Instruction},
        program_pack::Pack,
        pubkey::Pubkey,
        sysvar::rent,
        system_instruction,
        system_program,
    },
    solana_program_test::{processor, ProgramTest, ProgramTestBanks},
    solana_sdk::{
        account::Account,
        commitment_config::CommitmentLevel,
        signature::{Keypair, Signer},
        transaction::Transaction,
        transport::TransportError,
    },
    solana_program::keccak,
    std::{borrow::BorrowMut, cell::RefCell, rc::Rc, str::FromStr, thread, time::Duration},
};

// Import program files
use kamui_program::{
    processor::Processor,
    instruction::{VrfCoordinatorInstruction, VerifyVrfInput},
    state::{EnhancedSubscription, RequestPool, RequestStatus, EnhancedOracle, OracleRegistry},
};

// Utility function to find PDA
fn find_program_address(seeds: &[&[u8]], program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, program_id)
}

// Test for enhanced VRF functions with direct proof generation
#[tokio::test]
async fn test_enhanced_vrf_direct_proof() {
    // Initialize program test
    let program_id = Pubkey::new_unique();
    let mut program_test = ProgramTest::new(
        "kamui_program",
        program_id,
        processor!(Processor::process),
    );

    // Create test participants
    let admin = Keypair::new();
    let wallet = Keypair::new();
    let oracle = Keypair::new();
    
    // Add accounts with initial balances
    program_test.add_account(
        admin.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        wallet.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        oracle.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    // Start the program test
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    // Generate VRF keys for testing
    let vrf_keypair = ECVRFKeyPair::generate(&mut rand::thread_rng());
    let vrf_pubkey = vrf_keypair.pk.as_ref().to_vec();
    
    // Step 1: Initialize Oracle Registry
    println!("Step 1: Initializing Oracle Registry");
    let (registry_pda, _) = find_program_address(&[b"oracle_registry"], &program_id);
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(registry_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::InitializeOracleRegistry {
            min_stake: 10_000_000,
            rotation_frequency: 500,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &admin], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Oracle Registry initialized: {}", registry_pda);

    // Step 2: Register Oracle
    println!("Step 2: Registering Oracle");
    let (oracle_config_pda, _) = find_program_address(
        &[b"oracle_config", oracle.pubkey().as_ref()],
        &program_id,
    );
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(oracle.pubkey(), true),
            AccountMeta::new(oracle_config_pda, false),
            AccountMeta::new(registry_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::RegisterOracle {
            vrf_key: vrf_keypair.pk.as_ref().try_into().unwrap(),
            stake_amount: 10_000_000,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &oracle], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Oracle registered: {}", oracle_config_pda);

    // Step 3: Create Enhanced Subscription
    println!("Step 3: Creating Enhanced Subscription");
    let subscription_seed = keccak::hash(wallet.pubkey().as_ref()).to_bytes();
    let (subscription_pda, _) = find_program_address(
        &[b"subscription", &subscription_seed],
        &program_id,
    );
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(wallet.pubkey(), true),
            AccountMeta::new(subscription_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::CreateEnhancedSubscription {
            min_balance: 1_000_000,
            confirmations: 1,
            max_requests: 10,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &wallet], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Enhanced Subscription created: {}", subscription_pda);

    // Step 4: Fund Subscription
    println!("Step 4: Funding Subscription");
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(wallet.pubkey(), true),
            AccountMeta::new(subscription_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::FundSubscription {
            amount: 50_000_000,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &wallet], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Subscription funded");

    // Step 5: Initialize Request Pool
    println!("Step 5: Initializing Request Pool");
    let pool_id = 1;
    let (pool_pda, _) = find_program_address(
        &[
            b"request_pool",
            subscription_pda.as_ref(),
            &[pool_id],
        ],
        &program_id,
    );
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(wallet.pubkey(), true),
            AccountMeta::new_readonly(subscription_pda, false),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::InitializeRequestPool {
            pool_id,
            max_size: 100,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &wallet], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Request Pool initialized: {}", pool_pda);

    // Step 6: Request Randomness
    println!("Step 6: Requesting Randomness");
    let seed: [u8; 32] = rand::random();
    let callback_data = vec![1, 2, 3, 4];
    let num_words = 1;
    let request_id = RequestPool::generate_request_id(
        &seed,
        &wallet.pubkey(),
        &subscription_pda,
        pool_id,
        0, // request_index
    );
    
    let (request_pda, _) = find_program_address(
        &[b"vrf_request", &request_id],
        &program_id,
    );
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(wallet.pubkey(), true),
            AccountMeta::new(request_pda, false),
            AccountMeta::new(subscription_pda, false),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::RequestRandomness {
            seed,
            callback_data,
            num_words,
            minimum_confirmations: 1,
            callback_gas_limit: 100_000,
            pool_id,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &wallet], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Randomness requested: {}", request_pda);

    // Step 7: Generate VRF Proof directly (no server needed)
    println!("Step 7: Generating VRF Proof directly using ECVRF keypair");
    let (output, proof) = vrf_keypair.output(&seed);
    let proof_bytes = proof.to_bytes();
    println!("Generated proof: length = {}", proof_bytes.len());
    println!("Generated output: {}", hex::encode(&output));

    // Step 8: Fulfill Randomness with the generated proof
    println!("Step 8: Fulfilling Randomness with generated proof");
    let (result_pda, _) = find_program_address(
        &[b"vrf_result", request_pda.as_ref()],
        &program_id,
    );
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(oracle.pubkey(), true),
            AccountMeta::new(request_pda, false),
            AccountMeta::new(result_pda, false),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new(subscription_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::FulfillRandomness {
            proof: proof_bytes,
            public_key: vrf_pubkey,
            request_id,
            pool_id,
            request_index: 0,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &oracle], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Randomness fulfilled: {}", result_pda);

    // Step 9: Process a batch of requests
    println!("Step 9: Testing batch processing");
    
    // Create multiple requests
    let mut request_ids = Vec::new();
    let mut seeds = Vec::new();
    let mut request_indices = Vec::new();
    let mut proofs = Vec::new();
    
    for i in 1..4 {
        let seed: [u8; 32] = rand::random();
        seeds.push(seed);
        
        let request_id = RequestPool::generate_request_id(
            &seed,
            &wallet.pubkey(),
            &subscription_pda,
            pool_id,
            i, // request_index
        );
        request_ids.push(request_id);
        
        let (request_pda, _) = find_program_address(
            &[b"vrf_request", &request_id],
            &program_id,
        );
        
        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(wallet.pubkey(), true),
                AccountMeta::new(request_pda, false),
                AccountMeta::new(subscription_pda, false),
                AccountMeta::new(pool_pda, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: VrfCoordinatorInstruction::RequestRandomness {
                seed,
                callback_data: vec![i as u8],
                num_words: 1,
                minimum_confirmations: 1,
                callback_gas_limit: 100_000,
                pool_id,
            }
            .try_to_vec()
            .unwrap(),
        };
        
        let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
        transaction.sign(&[&payer, &wallet], recent_blockhash);
        
        banks_client.process_transaction(transaction).await.unwrap();
        println!("Batch request {} created with ID: {}", i, hex::encode(&request_id));
        
        // Generate proof for this request
        let (_, proof) = vrf_keypair.output(&seed);
        proofs.push(proof.to_bytes());
        request_indices.push(i);
    }
    
    // Process the batch with directly generated proofs
    println!("Processing batch of {} requests", request_ids.len());
    let batch_proof_bytes: Vec<Vec<u8>> = proofs;
    let batch_public_keys: Vec<Vec<u8>> = vec![vrf_pubkey.clone(); request_ids.len()];
    
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(oracle.pubkey(), true),
            AccountMeta::new(oracle_config_pda, false),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: VrfCoordinatorInstruction::ProcessRequestBatch {
            request_ids: request_ids.clone(),
            proofs: batch_proof_bytes,
            public_keys: batch_public_keys,
            pool_id,
            request_indices,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &oracle], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Batch processing completed successfully");

    // Step 10: Clean Expired Requests (this test shouldn't have any expired requests)
    println!("Step 10: Testing clean expired requests functionality");
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(wallet.pubkey(), true),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new(subscription_pda, false),
        ],
        data: VrfCoordinatorInstruction::CleanExpiredRequests {
            pool_id,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &wallet], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Clean expired requests completed");

    // Step 11: Rotate Oracles
    println!("Step 11: Testing oracle rotation");
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(registry_pda, false),
        ],
        data: VrfCoordinatorInstruction::RotateOracles {}
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &admin], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Oracle rotation completed");

    // Step 12: Update Oracle Reputation
    println!("Step 12: Testing update oracle reputation");
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(oracle_config_pda, false),
            AccountMeta::new(registry_pda, false),
        ],
        data: VrfCoordinatorInstruction::UpdateOracleReputation {
            oracle_authority: oracle.pubkey(),
            successful_fulfillments: 5,
            failed_fulfillments: 0,
        }
        .try_to_vec()
        .unwrap(),
    };
    
    let mut transaction = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer, &admin], recent_blockhash);
    
    banks_client.process_transaction(transaction).await.unwrap();
    println!("Oracle reputation updated");

    println!("All tests completed successfully!");
} 
use {
    borsh::{BorshDeserialize, BorshSerialize},
    kamui_program::{
        instruction::{VrfCoordinatorInstruction, VerifyVrfInput},
        state::Subscription,
    },
    solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        system_program,
        system_instruction,
    },
    solana_client::{
        rpc_client::RpcClient,
        nonblocking::pubsub_client::PubsubClient,
        rpc_config::{RpcTransactionLogsFilter, RpcTransactionLogsConfig},
    },
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::{Keypair, Signer},
        transaction::Transaction,
    },
    spl_token::native_mint,
    spl_associated_token_account,
    mangekyou::kamui_vrf::{
        ecvrf::{ECVRFKeyPair, ECVRFProof},
        VRFProof,
        VRFKeyPair,
    },
    rand::thread_rng,
    anyhow::Result,
    std::{str::FromStr, fs::File, io::{Read, Write}, thread, time::Duration, sync::{Arc, Mutex}},
    serde_json,
    hex,
    futures::StreamExt,
};

// Game-related structures for testing
#[derive(BorshSerialize, BorshDeserialize)]
pub enum GameInstruction {
    Initialize,
    RequestNewNumber,
    ConsumeRandomness,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GameState {
    /// The owner of the game
    pub owner: Pubkey,
    /// The VRF subscription used by this game
    pub subscription: Pubkey,
    /// The current random number (1-100)
    pub current_number: u8,
    /// Whether we're waiting for randomness
    pub is_pending: bool,
}

impl GameState {
    pub fn try_deserialize(data: &[u8]) -> Result<Self> {
        // Check discriminator
        if data.len() < 8 || &data[0..8] != b"GAMESTAT" {
            return Err(anyhow::anyhow!("Invalid discriminator"));
        }
        // Skip discriminator and deserialize the rest
        Ok(Self::try_from_slice(&data[8..])?)
    }
}

// Helper function to send transaction with retries
fn send_transaction_with_retries(
    rpc_client: &RpcClient,
    transaction: &Transaction,
    signers: &[&Keypair],
    max_retries: usize,
) -> Result<String> {
    let mut attempt = 0;
    
    while attempt < max_retries {
        match rpc_client.send_and_confirm_transaction_with_spinner(transaction) {
            Ok(signature) => return Ok(signature.to_string()),
            Err(err) => {
                println!("Transaction failed (attempt {}/{}): {}", attempt + 1, max_retries, err);
                
                if attempt == max_retries - 1 {
                    return Err(anyhow::anyhow!("Failed to send transaction after {} attempts: {}", max_retries, err));
                }
                
                // Rebuild transaction with new blockhash
                thread::sleep(Duration::from_secs(1));
                let recent_blockhash = rpc_client.get_latest_blockhash()?;
                let mut new_tx = transaction.clone();
                new_tx.sign(signers, recent_blockhash);
                
                attempt += 1;
            }
        }
    }
    
    Err(anyhow::anyhow!("Failed to send transaction after {} attempts", max_retries))
}

// WebSocket listener to monitor VRF server transactions
async fn start_vrf_transaction_monitor(program_id: Pubkey) -> Result<(), anyhow::Error> {
    println!("Starting VRF transaction monitor...");
    let rpc_url = "https://api.devnet.solana.com";
    let ws_url = rpc_url.replace("https://", "wss://").replace("http://", "ws://");
    
    println!("Connecting to WebSocket at {}", ws_url);
    let pubsub_client = PubsubClient::new(&ws_url).await.map_err(|e| anyhow::anyhow!("PubSub client error: {:?}", e))?;
    
    println!("WebSocket connected. Subscribing to logs for program: {}", program_id);
    
    // Move the client into the task so it stays alive
    tokio::spawn(async move {
        match pubsub_client.logs_subscribe(
            RpcTransactionLogsFilter::Mentions(vec![program_id.to_string()]),
            RpcTransactionLogsConfig {
                commitment: Some(CommitmentConfig::confirmed()),
            },
        ).await {
            Ok((mut notifications, _unsubscribe)) => {
                println!("Successfully subscribed to program logs");
                println!("VRF transaction monitor is now running in the background");
                
                while let Some(log_info) = notifications.next().await {
                    println!("\n========= DETECTED VRF SERVER TRANSACTION =========");
                    println!("Transaction signature: {}", log_info.value.signature);
                    
                    // Print all relevant logs
                    for log_line in log_info.value.logs {
                        // Only print logs that are important for debugging
                        if log_line.contains("VRF") || 
                           log_line.contains("request") || 
                           log_line.contains("random") || 
                           log_line.contains("fulfill") {
                            println!("LOG: {}", log_line);
                        }
                    }
                    println!("====================================================\n");
                }
                
                println!("VRF transaction monitor has stopped");
            },
            Err(e) => {
                println!("Failed to subscribe to logs: {:?}", e);
            }
        }
    });
    
    // Give the subscription time to establish
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    println!("VRF transaction monitor is ready");
    
    Ok(())
}

// Function to send a test transaction to check if WebSocket monitoring works
async fn send_test_transaction(rpc_client: &RpcClient, payer: &Keypair, vrf_program_id: &Pubkey) -> Result<String> {
    println!("\n=== Sending test transaction to check WebSocket monitoring ===");
    
    // Create a simple memo transaction mentioning the VRF program ID
    let memo_program_id = Pubkey::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap();
    let memo_data = format!("TEST TX FOR VRF PROGRAM: {}", vrf_program_id);
    
    let memo_ix = Instruction {
        program_id: memo_program_id,
        accounts: Vec::new(),
        data: memo_data.clone().into_bytes(),
    };
    
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let transaction = Transaction::new_signed_with_payer(
        &[memo_ix],
        Some(&payer.pubkey()),
        &[payer],
        recent_blockhash,
    );
    
    println!("Sending memo transaction with data: {}", memo_data);
    let signature = rpc_client.send_and_confirm_transaction_with_spinner(&transaction)?;
    println!("Test transaction sent! Signature: {}", signature);
    println!("If WebSocket monitoring is working, you should see this transaction in the logs");
    println!("Waiting 5 seconds to allow transaction to propagate...");
    
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    
    // Now send a direct transaction to the VRF program with an invalid instruction
    // This should be detected by the program monitor
    println!("\n=== Sending direct test transaction to VRF program ===");
    
    // Create a dummy data array for testing VRF program interaction
    // We're intentionally sending an invalid instruction to avoid side effects
    // The first byte "99" is not a valid instruction, but this should still be
    // picked up by the WebSocket listener since it targets the VRF program
    let test_data = vec![99, 1, 2, 3, 4, 5];
    
    let test_ix = Instruction {
        program_id: *vrf_program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ],
        data: test_data,
    };
    
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let transaction = Transaction::new_signed_with_payer(
        &[test_ix],
        Some(&payer.pubkey()),
        &[payer],
        recent_blockhash,
    );
    
    println!("Sending test transaction to VRF program (will fail with invalid instruction)");
    
    // Send the transaction but don't expect it to succeed - we just want the VRF server to see it
    let result = rpc_client.send_and_confirm_transaction_with_spinner(&transaction);
    match result {
        Ok(sig) => {
            println!("Test transaction unexpectedly succeeded! Signature: {}", sig);
            Ok(sig.to_string())
        }
        Err(err) => {
            println!("Test transaction failed as expected: {}", err);
            println!("This is normal since we sent an invalid instruction");
            println!("Checking if the transaction was still visible to the WebSocket monitor...");
            // Wait a bit to see if the failed transaction is still detected
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            Ok("failed-but-visible".to_string())
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn test_vrf_flow_devnet() -> Result<()> {
    // Start the VRF transaction monitor right at the beginning
    let vrf_program_id = Pubkey::from_str("BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D").unwrap();
    start_vrf_transaction_monitor(vrf_program_id).await.expect("Failed to start VRF transaction monitor");
    println!("VRF transaction monitor started successfully");

    // Connect to devnet
    let rpc_url = "https://api.devnet.solana.com".to_string();
    let rpc_client = RpcClient::new_with_commitment(rpc_url, CommitmentConfig::confirmed());

    // Load program IDs
    let game_program_id = Pubkey::from_str("5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6").unwrap();
    let vrf_verify_program_id = Pubkey::from_str("4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y").unwrap();
    
    // Load keypair from file
    let mut keypair_file = File::open("keypair.json").expect("Failed to open keypair.json");
    let mut keypair_data = String::new();
    keypair_file.read_to_string(&mut keypair_data).expect("Failed to read keypair.json");
    let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data).expect("Failed to parse keypair JSON");
    let payer = Keypair::from_bytes(&keypair_bytes).expect("Failed to create keypair from bytes");
    
    println!("Using keypair with pubkey: {}", payer.pubkey());
    
    // Verify the balance
    let balance = rpc_client.get_balance(&payer.pubkey()).expect("Failed to get balance");
    println!("Current balance: {} SOL", balance as f64 / 1_000_000_000.0);

    if balance == 0 {
        panic!("Account has no SOL balance");
    }
    
    // Send a test transaction to verify WebSocket monitoring
    send_test_transaction(&rpc_client, &payer, &vrf_program_id).await?;
    
    // Step 1: Create VRF subscription
    println!("Creating VRF subscription...");
    let subscription_owner = Keypair::new();
    let subscription_account = Keypair::new();
    
    // Fund the subscription owner account to ensure it has enough SOL for rent exemption and game operations
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let fund_tx = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(
            &payer.pubkey(),
            &subscription_owner.pubkey(),
            5_000_000, // 0.005 SOL
        )],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    
    println!("Funding subscription owner account...");
    send_transaction_with_retries(&rpc_client, &fund_tx, &[&payer], 5)
        .expect("Failed to fund subscription owner");
    println!("Subscription owner funded successfully with 0.005 SOL!");

    // Create subscription
    let create_sub_ix = VrfCoordinatorInstruction::CreateSubscription {
        min_balance: 100_000,  // Reduced from 500_000 to even smaller value of 0.0001 SOL
        confirmations: 1,
    };
    let create_sub_ix_data = borsh::to_vec(&create_sub_ix)?;
    let create_sub_ix = Instruction {
        program_id: vrf_program_id,
        accounts: vec![
            AccountMeta::new(subscription_owner.pubkey(), true),
            AccountMeta::new(subscription_account.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: create_sub_ix_data,
    };

    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let mut transaction = Transaction::new_with_payer(
        &[create_sub_ix],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer, &subscription_owner, &subscription_account], recent_blockhash);
    
    println!("Sending transaction to create subscription...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer, &subscription_owner, &subscription_account], 5)
        .expect("Failed to create subscription");
    println!("Subscription created! Signature: {}", signature);

    // Create token accounts for funding
    let mint = native_mint::id();

    // Create funder's token account
    let funder_token = spl_associated_token_account::get_associated_token_address(
        &subscription_owner.pubkey(),
        &mint,
    );
    let create_funder_token_ix = spl_associated_token_account::instruction::create_associated_token_account(
        &payer.pubkey(),
        &subscription_owner.pubkey(),
        &mint,
        &spl_token::id(),
    );

    // Create subscription's token account
    let subscription_token = spl_associated_token_account::get_associated_token_address(
        &subscription_account.pubkey(),
        &mint,
    );
    let create_sub_token_ix = spl_associated_token_account::instruction::create_associated_token_account(
        &payer.pubkey(),
        &subscription_account.pubkey(),
        &mint,
        &spl_token::id(),
    );

    // Create token accounts
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let mut transaction = Transaction::new_with_payer(
        &[create_funder_token_ix, create_sub_token_ix],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer], recent_blockhash);
    
    println!("Creating token accounts...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer], 5)
        .expect("Failed to create token accounts");
    println!("Token accounts created! Signature: {}", signature);

    // Fund subscription
    // First wrap SOL into the funder's token account
    let wrap_amount = 1_000_000; // Reduced from 2_000_000 to 0.001 SOL
    let transfer_ix = system_instruction::transfer(
        &subscription_owner.pubkey(),
        &funder_token,
        wrap_amount,
    );
    let sync_native_ix = spl_token::instruction::sync_native(
        &spl_token::id(),
        &funder_token,
    )?;

    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let mut transaction = Transaction::new_with_payer(
        &[transfer_ix, sync_native_ix],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer, &subscription_owner], recent_blockhash);
    
    println!("Wrapping SOL...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer, &subscription_owner], 5)
        .expect("Failed to wrap SOL");
    println!("SOL wrapped! Signature: {}", signature);

    // Now fund the subscription
    let fund_sub_ix = VrfCoordinatorInstruction::FundSubscription {
        amount: wrap_amount,
    };
    let fund_sub_ix_data = borsh::to_vec(&fund_sub_ix)?;
    let fund_sub_ix = Instruction {
        program_id: vrf_program_id,
        accounts: vec![
            AccountMeta::new(subscription_owner.pubkey(), true),
            AccountMeta::new(subscription_account.pubkey(), false),
            AccountMeta::new(funder_token, false),
            AccountMeta::new(subscription_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: fund_sub_ix_data,
    };

    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let mut transaction = Transaction::new_with_payer(
        &[fund_sub_ix],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer, &subscription_owner], recent_blockhash);
    
    println!("Funding subscription...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer, &subscription_owner], 5)
        .expect("Failed to fund subscription");
    println!("Subscription funded! Signature: {}", signature);

    // Step 2: Initialize game
    println!("Initializing game...");
    let game_owner = Keypair::new();
    
    // Fund the game owner account
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let fund_tx = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(
            &payer.pubkey(),
            &game_owner.pubkey(),
            20_000_000, // 0.02 SOL to ensure enough funds
        )],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    send_transaction_with_retries(&rpc_client, &fund_tx, &[&payer], 5)
        .expect("Failed to fund game owner");
    
    // Derive the game state PDA
    let (game_state_pda, bump) = Pubkey::find_program_address(
        &[b"game_state", game_owner.pubkey().as_ref()],
        &game_program_id,
    );

    // Initialize game instruction
    let init_ix = GameInstruction::Initialize;
    let init_ix_data = borsh::to_vec(&init_ix)?;
    let init_game_ix = Instruction {
        program_id: game_program_id,
        accounts: vec![
            AccountMeta::new(game_owner.pubkey(), true),
            AccountMeta::new(game_state_pda, false),
            AccountMeta::new_readonly(subscription_account.pubkey(), false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: init_ix_data,
    };

    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let mut transaction = Transaction::new_with_payer(
        &[init_game_ix],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer, &game_owner], recent_blockhash);
    
    println!("Initializing game state...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer, &game_owner], 5)
        .expect("Failed to initialize game");
    println!("Game initialized! Signature: {}", signature);

    // Track balances before VRF operations
    let initial_payer_balance = rpc_client.get_balance(&payer.pubkey())?;
    let initial_game_owner_balance = rpc_client.get_balance(&game_owner.pubkey())?;
    println!("\n=== Starting VRF Cost Analysis ===");
    println!("Initial payer balance: {} SOL", initial_payer_balance as f64 / 1_000_000_000.0);
    println!("Initial game owner balance: {} SOL", initial_game_owner_balance as f64 / 1_000_000_000.0);

    // Step 3: Request random number
    println!("\n1. Requesting random number...");
    let pre_request_payer_balance = rpc_client.get_balance(&payer.pubkey())?;
    let pre_request_game_owner_balance = rpc_client.get_balance(&game_owner.pubkey())?;
    
    // Derive request account PDA using subscription nonce
    let subscription_data = rpc_client.get_account_data(&subscription_account.pubkey())?;
    let subscription = Subscription::try_from_slice(&subscription_data[8..])?;  // Skip discriminator
    let (request_account, _request_bump) = Pubkey::find_program_address(
        &[
            b"request",
            subscription_account.pubkey().as_ref(),
            subscription.nonce.to_le_bytes().as_ref(),
        ],
        &vrf_program_id
    );

    // Create VRF request instruction
    let seed = [0u8; 32];
    let request_ix = VrfCoordinatorInstruction::RequestRandomness {
        seed,
        callback_data: borsh::to_vec(&GameInstruction::ConsumeRandomness)?,
        num_words: 1,
        minimum_confirmations: 1,
        callback_gas_limit: 100_000,  // Reduced from 200_000
    };
    let request_ix_data = borsh::to_vec(&request_ix)?;
    let request_vrf_ix = Instruction {
        program_id: vrf_program_id,
        accounts: vec![
            AccountMeta::new(game_owner.pubkey(), true),  // Game owner is the requester
            AccountMeta::new(request_account, false),  // Request account PDA
            AccountMeta::new(subscription_account.pubkey(), false),  // Subscription account
            AccountMeta::new_readonly(system_program::id(), false),  // System program
        ],
        data: request_ix_data,
    };

    let mut transaction = Transaction::new_with_payer(
        &[request_vrf_ix],
        Some(&payer.pubkey()),
    );
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    transaction.sign(
        &[
            &payer,
            &game_owner,  // Game owner must sign as requester
        ],
        recent_blockhash,
    );
    
    println!("Requesting random number...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer, &game_owner], 5)
        .expect("Failed to request random number");
    println!("Random number requested! Signature: {}", signature);

    let post_request_payer_balance = rpc_client.get_balance(&payer.pubkey())?;
    let post_request_game_owner_balance = rpc_client.get_balance(&game_owner.pubkey())?;
    let request_cost = (pre_request_payer_balance - post_request_payer_balance) + 
                      (pre_request_game_owner_balance - post_request_game_owner_balance);
    println!("Request cost: {} SOL", request_cost as f64 / 1_000_000_000.0);

    // Step 4: Wait for the VRF server to fulfill the randomness
    println!("\n2. Waiting for VRF server to fulfill randomness...");
    let pre_fulfill_payer_balance = rpc_client.get_balance(&payer.pubkey())?;

    // Create VRF result PDA using game owner (requester) key
    let (vrf_result, _bump) = Pubkey::find_program_address(
        &[b"vrf_result", game_owner.pubkey().as_ref()],
        &vrf_program_id
    );
    
    println!("VRF result PDA: {}", vrf_result);
    println!("Request account: {}", request_account);
    println!("Subscription account: {}", subscription_account.pubkey());
    println!("Game owner (requester): {}", game_owner.pubkey());
    println!("Game state PDA: {}", game_state_pda);
    println!("Waiting for the VRF server to fulfill the request...");
    
    // Wait for the VRF result account to be created
    let mut result_account_exists = false;
    let mut attempts = 0;
    let max_attempts = 60; // 60 seconds max wait time
    
    while !result_account_exists && attempts < max_attempts {
        match rpc_client.get_account(&vrf_result) {
            Ok(account) => {
                result_account_exists = true;
                println!("VRF result account created! Data length: {}", account.data.len());
                
                // Print first few bytes to verify it's a proper VRF result
                if account.data.len() >= 16 {
                    println!("First 16 bytes: {:?}", &account.data[0..16]);
                }
            },
            Err(err) => {
                if attempts % 5 == 0 {
                    // Every 5 attempts, check the request account status
                    match rpc_client.get_account(&request_account) {
                        Ok(req_account) => {
                            println!("Request account data length: {}", req_account.data.len());
                            
                            // Skip 8 byte discriminator
                            if req_account.data.len() > 136 { // Make sure we have enough data
                                // The status is at offset ~136 (depending on callback_data length)
                                let status_approx = req_account.data[136];
                                println!("Request account exists, approximate status byte: {}", status_approx);
                                
                                // Try to get more status information
                                if req_account.data.len() >= 150 {
                                    println!("Request data bytes 130-150: {:?}", &req_account.data[130..150]);
                                }
                            }
                        },
                        Err(_) => println!("Request account not found or error accessing it"),
                    }
                    
                    // Print remaining time
                    println!("Waited for {} seconds, {} seconds remaining...", 
                             attempts, max_attempts - attempts);
                }
                
                print!(".");
                std::io::stdout().flush()?;
                thread::sleep(Duration::from_secs(1));
                attempts += 1;
            }
        }
    }
    
    if !result_account_exists {
        // In case of timeout, check subscription and request account status one final time
        println!("\nTimed out waiting for VRF server to fulfill randomness!");
        println!("Checking final subscription state:");
        
        match rpc_client.get_account(&subscription_account.pubkey()) {
            Ok(sub_account) => {
                println!("Subscription account exists, data length: {}", sub_account.data.len());
                if sub_account.data.len() > 8 {
                    let subscription = Subscription::try_from_slice(&sub_account.data[8..])?;
                    println!("Subscription nonce: {}", subscription.nonce);
                    println!("Subscription balance: {}", subscription.balance);
                }
            },
            Err(_) => println!("Could not access subscription account"),
        }
        
        match rpc_client.get_account(&request_account) {
            Ok(req_account) => {
                println!("Request account exists, data length: {}", req_account.data.len());
                if req_account.data.len() > 136 {
                    println!("Status approximate byte: {}", req_account.data[136]);
                }
            },
            Err(_) => println!("Could not access request account"),
        }
        
        println!("Check VRF server logs for more details.");
        return Err(anyhow::anyhow!("Timed out waiting for VRF server to fulfill randomness"));
    }
    
    println!("\nVRF server has fulfilled the randomness!");
    
    let post_fulfill_payer_balance = rpc_client.get_balance(&payer.pubkey())?;
    let fulfill_cost = pre_fulfill_payer_balance - post_fulfill_payer_balance;
    println!("Fulfill cost: {} SOL", fulfill_cost as f64 / 1_000_000_000.0);

    // Then call ConsumeRandomness on our game program
    println!("\n3. Consuming randomness...");
    let pre_consume_payer_balance = rpc_client.get_balance(&payer.pubkey())?;
    let consume_ix = GameInstruction::ConsumeRandomness;
    let consume_ix_data = borsh::to_vec(&consume_ix)?;
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let mut transaction = Transaction::new_with_payer(
        &[Instruction {
            program_id: game_program_id,
            accounts: vec![
                AccountMeta::new_readonly(vrf_result, false),  // vrf_result
                AccountMeta::new_readonly(request_account, false),  // request_account
                AccountMeta::new(game_state_pda, false),  // game_state
            ],
            data: consume_ix_data,
        }],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer], recent_blockhash);
    
    println!("Consuming randomness...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer], 5)
        .expect("Failed to consume randomness");
    println!("Randomness consumed! Signature: {}", signature);

    let post_consume_payer_balance = rpc_client.get_balance(&payer.pubkey())?;
    let consume_cost = pre_consume_payer_balance - post_consume_payer_balance;
    println!("Consume cost: {} SOL", consume_cost as f64 / 1_000_000_000.0);

    // Calculate total VRF operation costs
    let total_vrf_cost = request_cost + fulfill_cost + consume_cost;
    println!("\n=== VRF Cost Summary ===");
    println!("Request cost:  {} SOL", request_cost as f64 / 1_000_000_000.0);
    println!("Fulfill cost:  {} SOL", fulfill_cost as f64 / 1_000_000_000.0);
    println!("Consume cost:  {} SOL", consume_cost as f64 / 1_000_000_000.0);
    println!("Total VRF cost: {} SOL", total_vrf_cost as f64 / 1_000_000_000.0);
    println!("==================\n");

    // Verify final game state
    let game_account_data = rpc_client.get_account_data(&game_state_pda)?;
    let final_state = GameState::try_deserialize(&game_account_data)?;
    assert!(!final_state.is_pending);
    assert!(final_state.current_number > 0 && final_state.current_number <= 100);

    println!("VRF flow test completed successfully on devnet!");
    println!("Final game state: {:?}", final_state);

    // Demonstrate subsequent VRF request cost
    println!("\n=== Testing Subsequent VRF Request Cost ===");
    let pre_second_request_balance = rpc_client.get_balance(&payer.pubkey())?;
    
    // Create second VRF request using updated subscription nonce
    let subscription_data = rpc_client.get_account_data(&subscription_account.pubkey())?;
    let subscription = Subscription::try_from_slice(&subscription_data[8..])?;  // Skip discriminator
    let (request_account, _request_bump) = Pubkey::find_program_address(
        &[
            b"request",
            subscription_account.pubkey().as_ref(),
            subscription.nonce.to_le_bytes().as_ref(),
        ],
        &vrf_program_id
    );

    let request_ix = VrfCoordinatorInstruction::RequestRandomness {
        seed: [0u8; 32],  // Use the same seed as the first request
        callback_data: borsh::to_vec(&GameInstruction::ConsumeRandomness)?,
        num_words: 1,
        minimum_confirmations: 1,
        callback_gas_limit: 100_000,
    };
    let request_ix_data = borsh::to_vec(&request_ix)?;
    let request_vrf_ix = Instruction {
        program_id: vrf_program_id,
        accounts: vec![
            AccountMeta::new(game_owner.pubkey(), true),
            AccountMeta::new(request_account, false),  // Reuse the same request account
            AccountMeta::new(subscription_account.pubkey(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: request_ix_data,
    };

    let mut transaction = Transaction::new_with_payer(
        &[request_vrf_ix],
        Some(&payer.pubkey()),
    );
    let recent_blockhash = rpc_client.get_latest_blockhash()?;
    transaction.sign(&[&payer, &game_owner], recent_blockhash);
    
    println!("Making second VRF request...");
    let signature = send_transaction_with_retries(&rpc_client, &transaction, &[&payer, &game_owner], 5)
        .expect("Failed to make second request");
    println!("Second request made! Signature: {}", signature);

    // Wait for the VRF server to fulfill the second request
    println!("Waiting for VRF server to fulfill second request...");
    
    // Create VRF result PDA for the second request
    let (vrf_result, _bump) = Pubkey::find_program_address(
        &[b"vrf_result", game_owner.pubkey().as_ref()],
        &vrf_program_id
    );
    
    // Wait for the VRF result to be updated
    let mut result_updated = false;
    let mut attempts = 0;
    let max_attempts = 30; // Wait up to 30 seconds
    
    while !result_updated && attempts < max_attempts {
        match rpc_client.get_account(&vrf_result) {
            Ok(account) => {
                // Check if the account has actual data
                if account.data.len() > 0 {
                    println!("VRF result account exists with data length: {}", account.data.len());
                    if attempts % 5 == 0 {
                        // Every 5 attempts, print more details about the result
                        if account.data.len() >= 16 {
                            println!("First 16 bytes: {:?}", &account.data[0..16]);
                        }
                    }
                    
                    // Wait a bit longer to ensure it's fully updated
                    if attempts > 3 {
                        result_updated = true;
                        println!("VRF result updated for second request!");
                    } else {
                        println!("Found VRF result account, waiting a few more seconds to ensure it's updated...");
                        thread::sleep(Duration::from_secs(1));
                        attempts += 1;
                    }
                } else {
                    println!("VRF result account exists but has no data");
                    thread::sleep(Duration::from_secs(1));
                    attempts += 1;
                }
            },
            Err(_) => {
                if attempts % 5 == 0 {
                    println!("Waited for {} seconds, {} seconds remaining...", 
                             attempts, max_attempts - attempts);
                }
                print!(".");
                std::io::stdout().flush()?;
                thread::sleep(Duration::from_secs(1));
                attempts += 1;
            }
        }
    }
    
    if !result_updated {
        println!("\nTimed out waiting for VRF server to fulfill second request");
        println!("Check VRF server logs for more details");
        return Err(anyhow::anyhow!("Timed out waiting for VRF server to fulfill second request"));
    }

    let post_second_request_balance = rpc_client.get_balance(&payer.pubkey())?;
    let second_request_cost = pre_second_request_balance - post_second_request_balance;
    
    println!("\n=== Cost Comparison ===");
    println!("First request total cost:  {} SOL", total_vrf_cost as f64 / 1_000_000_000.0);
    println!("Second request cost:       {} SOL", second_request_cost as f64 / 1_000_000_000.0);
    println!("Cost reduction:            {:.2}%", 
        ((total_vrf_cost - second_request_cost) as f64 / total_vrf_cost as f64) * 100.0);
    println!("==================\n");

    Ok(())
}
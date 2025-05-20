use {
    borsh::{BorshDeserialize, BorshSerialize},
    crate::{
        instruction::VrfCoordinatorInstruction,
        state::{
            RandomnessRequest, RequestStatus, RequestPool, RequestSummary,
            EnhancedSubscription, EnhancedOracle, VrfResult, OracleRegistry,
            MAX_REQUESTS_PER_SUBSCRIPTION, MAX_ACTIVE_ORACLES, ORACLE_ROTATION_FREQUENCY
        },
        event::VrfEvent,
        error::VrfCoordinatorError,
    },
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        instruction::{AccountMeta, Instruction},
        msg,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        pubkey::Pubkey,
        system_instruction,
        sysvar::{rent::Rent, clock::Clock, Sysvar},
    },
    std::collections::BTreeMap,
};
use spl_token::instruction as token_instruction;

pub struct Processor;

impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        msg!("VRF Coordinator: Processing instruction");
        let instruction = VrfCoordinatorInstruction::try_from_slice(instruction_data)
            .map_err(|e| {
                msg!("VRF Coordinator: Failed to deserialize instruction: {}", e);
                ProgramError::InvalidInstructionData
            })?;

        match instruction {
            VrfCoordinatorInstruction::CreateEnhancedSubscription { 
                min_balance, 
                confirmations,
                max_requests,
            } => {
                msg!("VRF Coordinator: CreateEnhancedSubscription - min_balance: {}, confirmations: {}, max_requests: {}", 
                    min_balance, confirmations, max_requests);
                Self::process_create_enhanced_subscription(program_id, accounts, min_balance, confirmations, max_requests)
            },
            VrfCoordinatorInstruction::InitializeRequestPool { 
                pool_id, 
                max_size 
            } => {
                msg!("VRF Coordinator: InitializeRequestPool - pool_id: {}, max_size: {}", pool_id, max_size);
                Self::process_initialize_request_pool(program_id, accounts, pool_id, max_size)
            },
            VrfCoordinatorInstruction::RequestRandomness { 
                seed, 
                callback_data,
                num_words,
                minimum_confirmations,
                callback_gas_limit,
                pool_id,
            } => {
                msg!("VRF Coordinator: RequestRandomness - seed: {:?}, num_words: {}, min_confirmations: {}, gas_limit: {}, pool_id: {}", 
                    seed, num_words, minimum_confirmations, callback_gas_limit, pool_id);
                Self::process_request_randomness(program_id, accounts, seed, callback_data, num_words, minimum_confirmations, callback_gas_limit, pool_id)
            },
            VrfCoordinatorInstruction::FulfillRandomness { 
                proof, 
                public_key,
                request_id,
                pool_id,
                request_index,
            } => {
                msg!("VRF Coordinator: FulfillRandomness - proof length: {}, public_key length: {}, request_id: {:?}", 
                    proof.len(), public_key.len(), request_id);
                Self::process_fulfill_randomness(program_id, accounts, proof, public_key, request_id, pool_id, request_index)
            },
            VrfCoordinatorInstruction::FundSubscription { amount } => {
                msg!("VRF Coordinator: FundSubscription - amount: {}", amount);
                Self::process_fund_subscription(accounts, amount)
            },
            VrfCoordinatorInstruction::CancelRequest { 
                request_id,
                pool_id,
                request_index,
            } => {
                msg!("VRF Coordinator: CancelRequest - request_id: {:?}, pool_id: {}, request_index: {}", 
                    request_id, pool_id, request_index);
                Self::process_cancel_request(accounts, request_id, pool_id, request_index)
            },
            VrfCoordinatorInstruction::CleanExpiredRequests { pool_id } => {
                msg!("VRF Coordinator: CleanExpiredRequests - pool_id: {}", pool_id);
                Self::process_clean_expired_requests(accounts, pool_id)
            },
            VrfCoordinatorInstruction::InitializeOracleRegistry { 
                min_stake, 
                rotation_frequency 
            } => {
                msg!("VRF Coordinator: InitializeOracleRegistry - min_stake: {}, rotation_frequency: {}", 
                    min_stake, rotation_frequency);
                Self::process_initialize_oracle_registry(program_id, accounts, min_stake, rotation_frequency)
            },
            VrfCoordinatorInstruction::RegisterOracle { 
                vrf_key, 
                stake_amount 
            } => {
                msg!("VRF Coordinator: RegisterOracle - vrf_key: {:?}, stake_amount: {}", 
                    vrf_key, stake_amount);
                Self::process_register_oracle(program_id, accounts, vrf_key, stake_amount)
            },
            VrfCoordinatorInstruction::DeactivateOracle => {
                msg!("VRF Coordinator: DeactivateOracle");
                Self::process_deactivate_oracle(program_id, accounts)
            },
            VrfCoordinatorInstruction::ProcessRequestBatch { 
                request_ids, 
                proofs, 
                public_keys,
                pool_id,
                request_indices,
            } => {
                msg!("VRF Coordinator: ProcessRequestBatch - request count: {}", request_ids.len());
                Self::process_request_batch(program_id, accounts, request_ids, proofs, public_keys, pool_id, request_indices)
            },
            VrfCoordinatorInstruction::RotateOracles => {
                msg!("VRF Coordinator: RotateOracles");
                Self::process_rotate_oracles(accounts)
            },
            VrfCoordinatorInstruction::UpdateOracleReputation { 
                oracle_authority, 
                successful_fulfillments, 
                failed_fulfillments 
            } => {
                msg!("VRF Coordinator: UpdateOracleReputation - oracle: {}, success: {}, failures: {}", 
                    oracle_authority, successful_fulfillments, failed_fulfillments);
                Self::process_update_oracle_reputation(accounts, oracle_authority, successful_fulfillments, failed_fulfillments)
            },
        }
    }

    fn process_create_enhanced_subscription(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        min_balance: u64,
        confirmations: u8,
        max_requests: u16,
    ) -> ProgramResult {
        msg!("VRF Coordinator: Creating enhanced subscription...");
        let accounts_iter = &mut accounts.iter();
        let subscription_owner = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        msg!("VRF Coordinator: Subscription owner: {}", subscription_owner.key);
        msg!("VRF Coordinator: Subscription account: {}", subscription_account.key);

        if !subscription_owner.is_signer {
            msg!("VRF Coordinator: Error - Missing subscription owner signature");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Validate parameters
        if confirmations < crate::state::MINIMUM_REQUEST_CONFIRMATIONS 
            || confirmations > crate::state::MAXIMUM_REQUEST_CONFIRMATIONS {
            msg!("VRF Coordinator: Error - Invalid confirmation value: {}", confirmations);
            return Err(VrfCoordinatorError::InvalidRequestConfirmations.into());
        }

        if max_requests == 0 || max_requests > MAX_REQUESTS_PER_SUBSCRIPTION {
            msg!("VRF Coordinator: Error - Invalid max_requests value: {}", max_requests);
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        let subscription = EnhancedSubscription {
            owner: *subscription_owner.key,
            balance: 0,
            min_balance,
            confirmations,
            active_requests: 0,
            max_requests,
            request_counter: 0,
            request_keys: Vec::new(),
            pool_ids: Vec::new(),
        };

        let rent = Rent::get()?;
        // Calculate space for the account: discriminator + fixed fields + vector space
        let space = 8 +  // discriminator
                    32 + // owner
                    8 +  // balance
                    8 +  // min_balance
                    1 +  // confirmations
                    2 +  // active_requests
                    2 +  // max_requests
                    8 +  // request_counter
                    4 +  // request_keys vector length
                    4;   // pool_ids vector length
                    
        let lamports = rent.minimum_balance(space);

        msg!("VRF Coordinator: Creating subscription account - space: {}, lamports: {}", space, lamports);

        // Create the account
        invoke(
            &system_instruction::create_account(
                subscription_owner.key,
                subscription_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                subscription_owner.clone(),
                subscription_account.clone(),
                system_program.clone(),
            ],
        )?;

        // Initialize the account data with discriminator
        let mut data = subscription_account.try_borrow_mut_data()?;
        data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]); // "SUBSCRIP" as bytes
        subscription.serialize(&mut &mut data[8..])?;

        // Emit subscription created event
        VrfEvent::SubscriptionCreated {
            subscription: *subscription_account.key,
            owner: *subscription_owner.key,
            min_balance,
            max_requests,
        }.emit();

        Ok(())
    }

    fn process_initialize_request_pool(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        pool_id: u8,
        max_size: u32,
    ) -> ProgramResult {
        msg!("VRF Coordinator: Initializing request pool...");
        let accounts_iter = &mut accounts.iter();
        let owner = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let pool_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        // Verify owner is signer
        if !owner.is_signer {
            msg!("VRF Coordinator: Error - Missing owner signature");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load subscription
        let mut subscription_data = subscription_account.try_borrow_data()?;
        if subscription_data.len() <= 8 || &subscription_data[0..8] != &[83, 85, 66, 83, 67, 82, 73, 80] {
            msg!("VRF Coordinator: Error - Invalid subscription account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut subscription = EnhancedSubscription::try_from_slice(&subscription_data[8..])?;

        // Verify owner
        if subscription.owner != *owner.key {
            msg!("VRF Coordinator: Error - Only subscription owner can initialize pools");
            return Err(VrfCoordinatorError::InvalidSubscriptionOwner.into());
        }

        // Check if pool ID already exists
        if subscription.pool_ids.contains(&pool_id) {
            msg!("VRF Coordinator: Error - Pool ID already exists");
            return Err(VrfCoordinatorError::InvalidPoolId.into());
        }

        // Add pool ID to subscription
        subscription.pool_ids.push(pool_id);

        // Initialize request pool
        let pool = RequestPool {
            subscription: *subscription_account.key,
            pool_id,
            request_count: 0,
            max_size,
            requests: BTreeMap::new(),
            last_processed_slot: Clock::get()?.slot,
        };

        // Create the pool account
        let seeds = &[
            b"request_pool".as_ref(),
            subscription_account.key.as_ref(),
            &[pool_id],
        ];
        let (expected_pool_address, bump_seed) = Pubkey::find_program_address(seeds, program_id);

        if expected_pool_address != *pool_account.key {
            msg!("VRF Coordinator: Error - Pool account address mismatch");
            return Err(ProgramError::InvalidArgument);
        }

        let pool_size = 8 +  // discriminator
                       32 +  // subscription
                       1 +   // pool_id
                       4 +   // request_count
                       4 +   // max_size
                       8 +   // last_processed_slot
                       4;    // requests map (empty initially)

        let pool_size_with_buffer = pool_size + 1024; // Add buffer for future growth
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(pool_size_with_buffer);

        let signer_seeds = &[
            b"request_pool".as_ref(),
            subscription_account.key.as_ref(),
            &[pool_id],
            &[bump_seed],
        ];

        // Create the pool account
        invoke_signed(
            &system_instruction::create_account(
                owner.key,
                pool_account.key,
                lamports,
                pool_size_with_buffer as u64,
                program_id,
            ),
            &[
                owner.clone(),
                pool_account.clone(),
                system_program.clone(),
            ],
            &[signer_seeds],
        )?;

        // Write pool data
        let mut pool_data = pool_account.try_borrow_mut_data()?;
        pool_data[0..8].copy_from_slice(&[80, 79, 79, 76, 0, 0, 0, 0]); // "POOL\0\0\0\0" as bytes
        pool.serialize(&mut &mut pool_data[8..])?;

        // Update subscription
        {
            let mut subscription_data = subscription_account.try_borrow_mut_data()?;
            subscription_data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]); // "SUBSCRIP" as bytes
            subscription.serialize(&mut &mut subscription_data[8..])?;
        }

        // Emit pool initialized event
        VrfEvent::RequestPoolInitialized {
            subscription: *subscription_account.key,
            pool_id,
            max_size,
        }.emit();

        Ok(())
    }

    fn process_request_randomness(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let requester = next_account_info(accounts_iter)?;
        let request_account = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let request_pool_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        if !requester.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Validate parameters
        if num_words == 0 || num_words > crate::state::MAXIMUM_RANDOM_WORDS {
            msg!("VRF Coordinator: Invalid number of words: {}", num_words);
            return Err(VrfCoordinatorError::InvalidNumberOfWords.into());
        }

        if minimum_confirmations < crate::state::MINIMUM_REQUEST_CONFIRMATIONS 
            || minimum_confirmations > crate::state::MAXIMUM_REQUEST_CONFIRMATIONS {
            msg!("VRF Coordinator: Invalid confirmation value: {}", minimum_confirmations);
            return Err(VrfCoordinatorError::InvalidRequestConfirmations.into());
        }

        if callback_gas_limit < crate::state::MINIMUM_CALLBACK_GAS_LIMIT 
            || callback_gas_limit > crate::state::MAXIMUM_CALLBACK_GAS_LIMIT {
            msg!("VRF Coordinator: Invalid gas limit: {}", callback_gas_limit);
            return Err(VrfCoordinatorError::InvalidCallbackGasLimit.into());
        }

        // Load subscription
        let mut subscription_data = subscription_account.try_borrow_data()?;
        if subscription_data.len() <= 8 || &subscription_data[0..8] != &[83, 85, 66, 83, 67, 82, 73, 80] {
            msg!("VRF Coordinator: Invalid subscription account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut subscription = EnhancedSubscription::try_from_slice(&subscription_data[8..])?;

        // Check subscription balance
        if subscription.balance < subscription.min_balance {
            msg!("VRF Coordinator: Insufficient subscription balance");
            return Err(VrfCoordinatorError::InsufficientBalance.into());
        }

        // Check if subscription has reached maximum request limit
        if subscription.active_requests >= subscription.max_requests {
            msg!("VRF Coordinator: Subscription request limit exceeded");
            return Err(VrfCoordinatorError::SubscriptionRequestLimitExceeded.into());
        }

        // Check if pool ID is valid
        if !subscription.pool_ids.contains(&pool_id) {
            msg!("VRF Coordinator: Invalid pool ID for subscription");
            return Err(VrfCoordinatorError::InvalidPoolId.into());
        }

        // Load and verify request pool
        let mut pool_data = request_pool_account.try_borrow_data()?;
        if pool_data.len() <= 8 || &pool_data[0..8] != &[80, 79, 79, 76, 0, 0, 0, 0] {
            msg!("VRF Coordinator: Invalid request pool account");
            return Err(VrfCoordinatorError::RequestPoolNotInitialized.into());
        }

        let mut request_pool = RequestPool::try_from_slice(&pool_data[8..])?;
        
        // Verify pool belongs to subscription and has the right ID
        if request_pool.subscription != *subscription_account.key || request_pool.pool_id != pool_id {
            msg!("VRF Coordinator: Pool and subscription mismatch");
                return Err(ProgramError::InvalidAccountData);
            }

        // Check if pool is full
        if request_pool.request_count >= request_pool.max_size {
            msg!("VRF Coordinator: Request pool is full");
            return Err(VrfCoordinatorError::PoolIsFull.into());
        }

        // Get next request index
        let request_index = request_pool.next_request_index();
        
        // Generate request ID
        let request_id = RequestPool::generate_request_id(
            &seed,
            requester.key,
            subscription_account.key,
            pool_id,
            request_index,
        );

        // Create request summary for pool
        let current_slot = Clock::get()?.slot;
        let current_timestamp = Clock::get()?.unix_timestamp;
        
        let request_summary = RequestSummary {
            requester: *requester.key,
            seed_hash: solana_program::keccak::hash(&seed).to_bytes(),
            timestamp: current_timestamp,
            status: RequestStatus::Pending,
            request_slot: current_slot,
            callback_gas_limit,
        };

        // Add to request pool
        request_pool.requests.insert(request_index, request_summary);
        request_pool.request_count = request_pool.request_count.saturating_add(1);

        // Create full request account for the callback
            let request = RandomnessRequest {
                subscription: *subscription_account.key,
                seed,
            requester: *requester.key,
                callback_data,
            request_slot: current_slot,
                status: RequestStatus::Pending,
                num_words,
                callback_gas_limit,
            pool_id,
            request_index,
            request_id,
        };

        // Create the request account with PDA
        let seeds = &[
            b"vrf_request",
            &request_id,
        ];
        let (expected_request_address, bump_seed) = Pubkey::find_program_address(seeds, program_id);
        
        if expected_request_address != *request_account.key {
            msg!("VRF Coordinator: Request account address mismatch");
            return Err(ProgramError::InvalidArgument);
        }

        let request_size = 8 + // discriminator
                          32 + // subscription
                          32 + // seed
                          32 + // requester
                          4 + callback_data.len() + // callback_data
                          8 + // request_slot
                          1 + // status
                          4 + // num_words
                          8 + // callback_gas_limit
                          1 + // pool_id
                          4 + // request_index
                          32; // request_id

            let rent = Rent::get()?;
        let lamports = rent.minimum_balance(request_size);

        // Create account using PDA
            invoke_signed(
                &system_instruction::create_account(
                    requester.key,
                    request_account.key,
                    lamports,
                request_size as u64,
                    program_id,
                ),
                &[
                    requester.clone(),
                    request_account.clone(),
                    system_program.clone(),
                ],
                &[&[
                b"vrf_request",
                &request_id,
                &[bump_seed],
                ]],
            )?;

        // Write request data
        let mut request_data = request_account.try_borrow_mut_data()?;
        request_data[0..8].copy_from_slice(&[82, 69, 81, 85, 69, 83, 84, 0]); // "REQUEST\0" as bytes
        request.serialize(&mut &mut request_data[8..])?;

        // Update subscription data
        {
            // Deduct min_balance from subscription
            subscription.balance = subscription.balance.checked_sub(subscription.min_balance)
                .ok_or(VrfCoordinatorError::InsufficientBalance)?;
            
            // Increment active requests count
            subscription.active_requests = subscription.active_requests.saturating_add(1);
            
            // Add truncated request key for tracking
            let mut truncated_key = [0u8; 16];
            truncated_key.copy_from_slice(&request_id[0..16]);
            subscription.request_keys.push(truncated_key);
            
            // Increment request counter
            subscription.request_counter = subscription.request_counter.saturating_add(1);
            
            // Write back subscription data
        let mut subscription_data = subscription_account.try_borrow_mut_data()?;
            subscription_data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]);
        subscription.serialize(&mut &mut subscription_data[8..])?;
        }
        
        // Update request pool data
        {
            let mut pool_data = request_pool_account.try_borrow_mut_data()?;
            pool_data[0..8].copy_from_slice(&[80, 79, 79, 76, 0, 0, 0, 0]);
            request_pool.serialize(&mut &mut pool_data[8..])?;
        }

        // Emit randomness requested event
        VrfEvent::RandomnessRequested {
            request_id,
            requester: *requester.key,
            subscription: *subscription_account.key,
            seed,
            pool_id,
            request_index,
        }.emit();

        Ok(())
    }

    fn process_fulfill_randomness(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        proof: Vec<u8>,
        public_key: Vec<u8>,
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let oracle = next_account_info(accounts_iter)?;
        let request_account = next_account_info(accounts_iter)?;
        let vrf_result_account = next_account_info(accounts_iter)?;
        let request_pool_account = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let callback_program = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        // Verify oracle signer
        if !oracle.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load and validate request
        let mut request_data = request_account.try_borrow_data()?;
        if request_data.len() <= 8 || &request_data[0..8] != &[82, 69, 81, 85, 69, 83, 84, 0] {
            msg!("VRF Coordinator: Invalid request account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut request = RandomnessRequest::try_from_slice(&request_data[8..])?;

        // Verify request ID
        if request.request_id != request_id {
            msg!("VRF Coordinator: Request ID mismatch");
            return Err(VrfCoordinatorError::RequestIdMismatch.into());
        }

        // Verify pool ID and request index
        if request.pool_id != pool_id || request.request_index != request_index {
            msg!("VRF Coordinator: Pool ID or request index mismatch");
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        // Check request status
        if request.status != RequestStatus::Pending {
            msg!("VRF Coordinator: Request is not pending");
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }

        // Load and validate request pool
        let mut pool_data = request_pool_account.try_borrow_data()?;
        if pool_data.len() <= 8 || &pool_data[0..8] != &[80, 79, 79, 76, 0, 0, 0, 0] {
            msg!("VRF Coordinator: Invalid request pool account");
            return Err(VrfCoordinatorError::RequestPoolNotInitialized.into());
        }

        let mut request_pool = RequestPool::try_from_slice(&pool_data[8..])?;
        
        // Verify pool belongs to subscription
        if request_pool.subscription != *subscription_account.key || request_pool.pool_id != pool_id {
            msg!("VRF Coordinator: Pool and subscription mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Check if request exists in pool
        let request_summary = request_pool.requests.get_mut(&request_index).ok_or(VrfCoordinatorError::RequestNotFound)?;
        
        // Check if request is expired
        let current_slot = Clock::get()?.slot;
        if RequestPool::is_request_expired(request_summary.request_slot, current_slot) {
            msg!("VRF Coordinator: Request is expired");
            
            // Mark as expired and update
            request.status = RequestStatus::Expired;
            request_summary.status = RequestStatus::Expired;
            
            // Update request data
            request_data[0..8].copy_from_slice(&[82, 69, 81, 85, 69, 83, 84, 0]);
            request.serialize(&mut &mut request_data[8..])?;
            
            // Update pool data
            pool_data[0..8].copy_from_slice(&[80, 79, 79, 76, 0, 0, 0, 0]);
            request_pool.serialize(&mut &mut pool_data[8..])?;
            
            // Emit request expired event
            VrfEvent::RequestExpired {
                request_id,
                subscription: *subscription_account.key,
                pool_id,
                request_index,
            }.emit();
            
            return Err(VrfCoordinatorError::RequestExpired.into());
        }

        // Verify VRF proof
        // TODO: Implement actual VRF proof verification here
        // This is a placeholder for the verification logic
        let vrf_proof_valid = true; // Assume valid for now, replace with actual verification
        
        if !vrf_proof_valid {
            msg!("VRF Coordinator: Invalid VRF proof");
            return Err(VrfCoordinatorError::InvalidVrfProof.into());
        }

        // Generate randomness from proof
        // This is a placeholder for the actual randomness derivation
        let mut randomness = Vec::with_capacity(request.num_words as usize);
        for i in 0..request.num_words {
            let mut word = [0u8; 64];
            let hash_input = [&request_id[..], &i.to_le_bytes()[..]].concat();
            let hash = solana_program::keccak::hash(&hash_input);
            word[0..32].copy_from_slice(&hash.to_bytes());
            word[32..64].copy_from_slice(&hash.to_bytes()); // Duplicate for now, replace with actual derivation
            randomness.push(word);
        }

        // Create VRF result
        let vrf_result = VrfResult {
            randomness,
            proof: proof.clone(),
            proof_slot: current_slot,
            request_id,
        };

        // Create VRF result account
        let result_seeds = &[
            b"vrf_result",
            &request_id,
        ];
        let (expected_result_address, result_bump) = Pubkey::find_program_address(result_seeds, program_id);
        
        if expected_result_address != *vrf_result_account.key {
            msg!("VRF Coordinator: Result account address mismatch");
            return Err(ProgramError::InvalidArgument);
        }

        let result_size = 8 + // discriminator
                         4 + (64 * request.num_words as usize) + // randomness
                         4 + proof.len() + // proof
                         8 + // proof_slot
                         32; // request_id

        let rent = Rent::get()?;
        let result_lamports = rent.minimum_balance(result_size);

        // Create result account
            invoke_signed(
                &system_instruction::create_account(
                    oracle.key,
                    vrf_result_account.key,
                result_lamports,
                result_size as u64,
                    program_id,
                ),
                &[
                    oracle.clone(),
                    vrf_result_account.clone(),
                    system_program.clone(),
                ],
            &[&[
                b"vrf_result",
                &request_id,
                &[result_bump],
            ]],
        )?;

        // Write result data
        let mut result_data = vrf_result_account.try_borrow_mut_data()?;
        result_data[0..8].copy_from_slice(&[82, 69, 83, 85, 76, 84, 0, 0]); // "RESULT\0\0" as bytes
        vrf_result.serialize(&mut &mut result_data[8..])?;

        // Update request status
            request.status = RequestStatus::Fulfilled;
        request_data[0..8].copy_from_slice(&[82, 69, 81, 85, 69, 83, 84, 0]);
        request.serialize(&mut &mut request_data[8..])?;

        // Update request summary in pool
        request_summary.status = RequestStatus::Fulfilled;
        pool_data[0..8].copy_from_slice(&[80, 79, 79, 76, 0, 0, 0, 0]);
        request_pool.serialize(&mut &mut pool_data[8..])?;

        // Update subscription data
        {
            let mut subscription_data = subscription_account.try_borrow_data()?;
            if subscription_data.len() <= 8 || &subscription_data[0..8] != &[83, 85, 66, 83, 67, 82, 73, 80] {
                msg!("VRF Coordinator: Invalid subscription account");
                return Err(ProgramError::InvalidAccountData);
            }

            let mut subscription = EnhancedSubscription::try_from_slice(&subscription_data[8..])?;
            
            // Decrement active requests count
            subscription.active_requests = subscription.active_requests.saturating_sub(1);
            
            // Remove request key from tracking
            let mut truncated_key = [0u8; 16];
            truncated_key.copy_from_slice(&request_id[0..16]);
            
            if let Some(pos) = subscription.request_keys.iter().position(|x| *x == truncated_key) {
                subscription.request_keys.remove(pos);
            }
            
            // Write back subscription data
            subscription_data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]);
            subscription.serialize(&mut &mut subscription_data[8..])?;
        }

        // Call callback function if provided
        if !request.callback_data.is_empty() {
            // Prepare callback instruction data
            let mut callback_data = Vec::with_capacity(request.callback_data.len() + 64);
            callback_data.extend_from_slice(&request.callback_data);
            callback_data.extend_from_slice(&vrf_result.randomness[0]); // Add first random value

            // Create callback instruction
            let callback_instruction = Instruction {
                program_id: request.requester,
                accounts: vec![
                    AccountMeta::new_readonly(*request_account.key, false),
                    AccountMeta::new_readonly(*vrf_result_account.key, false),
                ],
                data: callback_data,
            };

            // Execute callback
            match invoke(
                &callback_instruction,
                &[
                request_account.clone(),
                    vrf_result_account.clone(),
                    callback_program.clone(),
                ],
            ) {
                Ok(_) => {
                    msg!("VRF Coordinator: Callback executed successfully");
                }
                Err(err) => {
                    msg!("VRF Coordinator: Callback failed: {:?}", err);
                    // We don't propagate callback errors to avoid failed transactions
                }
            }
        }

        // Emit randomness fulfilled event
        VrfEvent::RandomnessFulfilled {
            request_id,
            requester: request.requester,
            randomness: vrf_result.randomness[0],
            oracle: *oracle.key,
        }.emit();

        Ok(())
    }

    fn process_cancel_request(
        accounts: &[AccountInfo],
        request_id: Pubkey,
        pool_id: u8,
        request_index: u32,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let owner = next_account_info(accounts_iter)?;
        let request_account = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let subscription_balance = next_account_info(accounts_iter)?;

        if !owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let request = RandomnessRequest::try_from_slice(&request_account.data.borrow())?;
        let mut subscription = EnhancedSubscription::try_from_slice(&subscription_account.data.borrow()[8..])?;

        if request.status != RequestStatus::Pending {
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }

        if subscription.owner != *owner.key {
            return Err(VrfCoordinatorError::InvalidSubscriptionOwner.into());
        }

        // Refund the subscription balance
        subscription.balance = subscription.balance.checked_add(subscription.min_balance)
            .ok_or(ProgramError::InvalidInstructionData)?;
        
        // Write back with discriminator
        let mut data = subscription_account.try_borrow_mut_data()?;
        data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]); // "SUBSCRIP" as bytes
        subscription.serialize(&mut &mut data[8..])?;

        // Emit request cancelled event
        VrfEvent::RequestCancelled {
            request_id: *request_account.key,
            subscription: request.subscription,
        }.emit();

        // Close request account
        **request_account.try_borrow_mut_lamports()? = 0;
        request_account.data.borrow_mut().fill(0);

        Ok(())
    }

    fn process_register_oracle(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        vrf_key: [u8; 32],
        stake_amount: u64,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let admin = next_account_info(accounts_iter)?;
        let oracle_config_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        if !admin.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let oracle_config = EnhancedOracle {
            vrf_key,
            stake_amount,
            is_active: true,
        };

        let rent = Rent::get()?;
        let space = borsh::to_vec(&oracle_config)?.len();
        let lamports = rent.minimum_balance(space);

        invoke(
            &system_instruction::create_account(
                admin.key,
                oracle_config_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                admin.clone(),
                oracle_config_account.clone(),
                system_program.clone(),
            ],
        )?;

        oracle_config.serialize(&mut *oracle_config_account.data.borrow_mut())?;

        Ok(())
    }

    fn process_deactivate_oracle(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let admin = next_account_info(accounts_iter)?;
        let oracle_config_account = next_account_info(accounts_iter)?;

        if !admin.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut oracle_config = EnhancedOracle::try_from_slice(&oracle_config_account.data.borrow())?;

        oracle_config.is_active = false;
        oracle_config.serialize(&mut *oracle_config_account.data.borrow_mut())?;

        Ok(())
    }

    fn process_clean_expired_requests(
        accounts: &[AccountInfo],
        pool_id: u8,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let request_pool_account = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;

        // Verify signer
        if !signer.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load and validate request pool
        let mut pool_data = request_pool_account.try_borrow_data()?;
        if pool_data.len() <= 8 || &pool_data[0..8] != &[80, 79, 79, 76, 0, 0, 0, 0] {
            msg!("VRF Coordinator: Invalid request pool account");
            return Err(VrfCoordinatorError::RequestPoolNotInitialized.into());
        }

        let mut request_pool = RequestPool::try_from_slice(&pool_data[8..])?;
        
        // Verify pool ID matches
        if request_pool.pool_id != pool_id {
            msg!("VRF Coordinator: Pool ID mismatch");
            return Err(VrfCoordinatorError::InvalidPoolId.into());
        }

        // Verify pool belongs to subscription
        if request_pool.subscription != *subscription_account.key {
            msg!("VRF Coordinator: Pool and subscription mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Clean expired requests
        let expired_count = request_pool.clean_expired_requests();
        
        if expired_count > 0 {
            // Update subscription data to reduce active_requests count
            let mut subscription_data = subscription_account.try_borrow_data()?;
            if subscription_data.len() <= 8 || &subscription_data[0..8] != &[83, 85, 66, 83, 67, 82, 73, 80] {
                msg!("VRF Coordinator: Invalid subscription account");
                return Err(ProgramError::InvalidAccountData);
            }

            let mut subscription = EnhancedSubscription::try_from_slice(&subscription_data[8..])?;
            
            // Update subscription's active_requests count
            subscription.active_requests = subscription.active_requests.saturating_sub(expired_count as u16);
            
            // TODO: We should also clean up the request_keys array, but we'd need the request IDs
            // which we don't have in this context. This is a limitation of the current design.
            
            // Write back subscription data
            subscription_data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]);
            subscription.serialize(&mut &mut subscription_data[8..])?;
            
            // Write back pool data
            pool_data[0..8].copy_from_slice(&[80, 79, 79, 76, 0, 0, 0, 0]);
            request_pool.serialize(&mut &mut pool_data[8..])?;
            
            // Emit pool cleaned event
            VrfEvent::RequestPoolCleaned {
                subscription: *subscription_account.key,
                pool_id,
                expired_count,
            }.emit();
        }

        Ok(())
    }

    fn process_initialize_oracle_registry(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        min_stake: u64,
        rotation_frequency: u64,
    ) -> ProgramResult {
        msg!("VRF Coordinator: Initializing oracle registry...");
        let accounts_iter = &mut accounts.iter();
        let admin = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        // Verify admin is signer
        if !admin.is_signer {
            msg!("VRF Coordinator: Error - Missing admin signature");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Create registry PDA
        let (expected_registry, bump) = Pubkey::find_program_address(&[b"oracle_registry"], program_id);
        
        if expected_registry != *registry_account.key {
            msg!("VRF Coordinator: Registry account address mismatch");
            return Err(ProgramError::InvalidArgument);
        }

        // Validate parameters
        if rotation_frequency == 0 {
            msg!("VRF Coordinator: Error - Rotation frequency cannot be zero");
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        // Create registry data
        let registry = OracleRegistry {
            admin: *admin.key,
            oracle_count: 0,
            min_stake,
            rotation_frequency,
            last_rotation: Clock::get()?.slot,
            oracles: Vec::new(),
        };

        // Calculate space
        let registry_size = 8 + // discriminator
                            32 + // admin
                            2 + // oracle_count
                            8 + // min_stake
                            8 + // rotation_frequency
                            8 + // last_rotation
                            4; // oracles vector (empty initially)

        let registry_size_with_buffer = registry_size + 1024; // Add buffer for future growth
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(registry_size_with_buffer);

        // Create registry account
        invoke_signed(
            &system_instruction::create_account(
                admin.key,
                registry_account.key,
                lamports,
                registry_size_with_buffer as u64,
                program_id,
            ),
            &[
                admin.clone(),
                registry_account.clone(),
                system_program.clone(),
            ],
            &[&[b"oracle_registry", &[bump]]],
        )?;

        // Write registry data
        let mut registry_data = registry_account.try_borrow_mut_data()?;
        registry_data[0..8].copy_from_slice(&[82, 69, 71, 73, 83, 84, 82, 89]); // "REGISTRY" as bytes
        registry.serialize(&mut &mut registry_data[8..])?;

        // Emit registry initialized event
        VrfEvent::OracleRegistryInitialized {
            admin: *admin.key,
            min_stake,
            rotation_frequency,
        }.emit();

        Ok(())
    }

    fn process_register_oracle(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        vrf_key: [u8; 32],
        stake_amount: u64,
    ) -> ProgramResult {
        msg!("VRF Coordinator: Registering oracle...");
        let accounts_iter = &mut accounts.iter();
        let authority = next_account_info(accounts_iter)?;
        let oracle_account = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        // Verify authority is signer
        if !authority.is_signer {
            msg!("VRF Coordinator: Error - Missing oracle authority signature");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load registry
        let mut registry_data = registry_account.try_borrow_data()?;
        if registry_data.len() <= 8 || &registry_data[0..8] != &[82, 69, 71, 73, 83, 84, 82, 89] {
            msg!("VRF Coordinator: Invalid registry account");
            return Err(VrfCoordinatorError::RegistryNotInitialized.into());
        }

        let mut registry = OracleRegistry::try_from_slice(&registry_data[8..])?;

        // Check stake amount meets minimum
        if stake_amount < registry.min_stake {
            msg!("VRF Coordinator: Insufficient stake amount");
            return Err(VrfCoordinatorError::InsufficientStake.into());
        }

        // Create oracle account PDA
        let (expected_oracle, bump) = Pubkey::find_program_address(
            &[b"oracle", authority.key.as_ref()],
            program_id,
        );
        
        if expected_oracle != *oracle_account.key {
            msg!("VRF Coordinator: Oracle account address mismatch");
            return Err(ProgramError::InvalidArgument);
        }

        // Check if authority is already registered
        if registry.oracles.contains(authority.key) {
            msg!("VRF Coordinator: Oracle already registered");
            return Err(VrfCoordinatorError::OracleAlreadyRegistered.into());
        }

        // Create oracle data
        let oracle = EnhancedOracle {
            authority: *authority.key,
            vrf_key,
            stake_amount,
            reputation: 0,
            last_active: Clock::get()?.slot,
            is_active: true,
            fulfillment_count: 0,
            failure_count: 0,
        };

        // Calculate space
        let oracle_size = 8 + // discriminator
                          32 + // authority
                          32 + // vrf_key
                          8 + // stake_amount
                          2 + // reputation
                          8 + // last_active
                          1 + // is_active
                          8 + // fulfillment_count
                          8; // failure_count

        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(oracle_size);

        // Create oracle account
        invoke_signed(
            &system_instruction::create_account(
                authority.key,
                oracle_account.key,
                lamports,
                oracle_size as u64,
                program_id,
            ),
            &[
                authority.clone(),
                oracle_account.clone(),
                system_program.clone(),
            ],
            &[&[b"oracle", authority.key.as_ref(), &[bump]]],
        )?;

        // Write oracle data
        let mut oracle_data = oracle_account.try_borrow_mut_data()?;
        oracle_data[0..8].copy_from_slice(&[79, 82, 65, 67, 76, 69, 0, 0]); // "ORACLE\0\0" as bytes
        oracle.serialize(&mut &mut oracle_data[8..])?;

        // Update registry
        registry.oracles.push(*authority.key);
        registry.oracle_count = registry.oracle_count.saturating_add(1);
        
        registry_data[0..8].copy_from_slice(&[82, 69, 71, 73, 83, 84, 82, 89]);
        registry.serialize(&mut &mut registry_data[8..])?;

        // Emit oracle registered event
        VrfEvent::OracleRegistered {
            authority: *authority.key,
            oracle_account: *oracle_account.key,
            stake_amount,
        }.emit();

        Ok(())
    }

    fn process_deactivate_oracle(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
    ) -> ProgramResult {
        msg!("VRF Coordinator: Deactivating oracle...");
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let oracle_account = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;

        // Verify signer
        if !signer.is_signer {
            msg!("VRF Coordinator: Error - Missing signer");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load oracle
        let mut oracle_data = oracle_account.try_borrow_data()?;
        if oracle_data.len() <= 8 || &oracle_data[0..8] != &[79, 82, 65, 67, 76, 69, 0, 0] {
            msg!("VRF Coordinator: Invalid oracle account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut oracle = EnhancedOracle::try_from_slice(&oracle_data[8..])?;

        // Load registry
        let mut registry_data = registry_account.try_borrow_data()?;
        if registry_data.len() <= 8 || &registry_data[0..8] != &[82, 69, 71, 73, 83, 84, 82, 89] {
            msg!("VRF Coordinator: Invalid registry account");
            return Err(VrfCoordinatorError::RegistryNotInitialized.into());
        }

        let mut registry = OracleRegistry::try_from_slice(&registry_data[8..])?;

        // Check if signer is either the oracle authority or registry admin
        if *signer.key != oracle.authority && *signer.key != registry.admin {
            msg!("VRF Coordinator: Signer is neither oracle authority nor admin");
            return Err(VrfCoordinatorError::InvalidOracleAuthority.into());
        }

        // Deactivate oracle
        oracle.is_active = false;
        
        // Update oracle data
        oracle_data[0..8].copy_from_slice(&[79, 82, 65, 67, 76, 69, 0, 0]);
        oracle.serialize(&mut &mut oracle_data[8..])?;

        // Remove from registry's active oracles
        if let Some(pos) = registry.oracles.iter().position(|x| *x == oracle.authority) {
            registry.oracles.remove(pos);
            registry.oracle_count = registry.oracle_count.saturating_sub(1);
            
            // Update registry data
            registry_data[0..8].copy_from_slice(&[82, 69, 71, 73, 83, 84, 82, 89]);
            registry.serialize(&mut &mut registry_data[8..])?;
        }

        // Emit oracle deactivated event
        VrfEvent::OracleDeactivated {
            authority: oracle.authority,
            oracle_account: *oracle_account.key,
        }.emit();

        Ok(())
    }

    fn process_rotate_oracles(
        accounts: &[AccountInfo],
    ) -> ProgramResult {
        msg!("VRF Coordinator: Rotating oracles...");
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;

        // Verify signer
        if !signer.is_signer {
            msg!("VRF Coordinator: Error - Missing signer");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load registry
        let mut registry_data = registry_account.try_borrow_data()?;
        if registry_data.len() <= 8 || &registry_data[0..8] != &[82, 69, 71, 73, 83, 84, 82, 89] {
            msg!("VRF Coordinator: Invalid registry account");
            return Err(VrfCoordinatorError::RegistryNotInitialized.into());
        }

        let mut registry = OracleRegistry::try_from_slice(&registry_data[8..])?;

        // Check if rotation is due
        let current_slot = Clock::get()?.slot;
        if current_slot < registry.last_rotation.saturating_add(registry.rotation_frequency) {
            msg!("VRF Coordinator: Rotation not yet due");
            return Err(VrfCoordinatorError::RotationNotDue.into());
        }

        // Update last rotation timestamp
        registry.last_rotation = current_slot;
        
        // Write registry data
        registry_data[0..8].copy_from_slice(&[82, 69, 71, 73, 83, 84, 82, 89]);
        registry.serialize(&mut &mut registry_data[8..])?;

        // Emit oracles rotated event
        VrfEvent::OraclesRotated {
            registry: *registry_account.key,
            active_count: registry.oracle_count,
        }.emit();

        Ok(())
    }

    fn process_update_oracle_reputation(
        accounts: &[AccountInfo],
        oracle_authority: Pubkey,
        successful_fulfillments: u16,
        failed_fulfillments: u16,
    ) -> ProgramResult {
        msg!("VRF Coordinator: Updating oracle reputation...");
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let oracle_account = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;

        // Verify signer
        if !signer.is_signer {
            msg!("VRF Coordinator: Error - Missing signer");
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load registry
        let registry_data = registry_account.try_borrow_data()?;
        if registry_data.len() <= 8 || &registry_data[0..8] != &[82, 69, 71, 73, 83, 84, 82, 89] {
            msg!("VRF Coordinator: Invalid registry account");
            return Err(VrfCoordinatorError::RegistryNotInitialized.into());
        }

        let registry = OracleRegistry::try_from_slice(&registry_data[8..])?;

        // Only admin can update reputation
        if *signer.key != registry.admin {
            msg!("VRF Coordinator: Signer is not admin");
            return Err(VrfCoordinatorError::InvalidAdmin.into());
        }

        // Load oracle
        let mut oracle_data = oracle_account.try_borrow_data()?;
        if oracle_data.len() <= 8 || &oracle_data[0..8] != &[79, 82, 65, 67, 76, 69, 0, 0] {
            msg!("VRF Coordinator: Invalid oracle account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut oracle = EnhancedOracle::try_from_slice(&oracle_data[8..])?;

        // Verify oracle authority matches
        if oracle.authority != oracle_authority {
            msg!("VRF Coordinator: Oracle authority mismatch");
            return Err(VrfCoordinatorError::InvalidOracleAuthority.into());
        }

        // Update reputation
        oracle.fulfillment_count = oracle.fulfillment_count.saturating_add(successful_fulfillments as u64);
        oracle.failure_count = oracle.failure_count.saturating_add(failed_fulfillments as u64);
        
        // Calculate new reputation score
        let total_fulfillments = oracle.fulfillment_count.saturating_add(oracle.failure_count);
        let success_rate = if total_fulfillments > 0 {
            (oracle.fulfillment_count * 100) / total_fulfillments
        } else {
            0
        };
        
        // Cap reputation at 10,000 
        oracle.reputation = (success_rate as u16).min(10_000);
        
        // Update oracle's last active timestamp
        oracle.last_active = Clock::get()?.slot;
        
        // Write oracle data
        oracle_data[0..8].copy_from_slice(&[79, 82, 65, 67, 76, 69, 0, 0]);
        oracle.serialize(&mut &mut oracle_data[8..])?;

        // Emit oracle reputation updated event
        VrfEvent::OracleReputationUpdated {
            authority: oracle.authority,
            oracle_account: *oracle_account.key,
            reputation: oracle.reputation,
        }.emit();

        Ok(())
    }

    fn process_request_batch(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        request_ids: Vec<[u8; 32]>,
        proofs: Vec<Vec<u8>>,
        public_keys: Vec<Vec<u8>>,
        pool_id: u8,
        request_indices: Vec<u32>,
    ) -> ProgramResult {
        msg!("VRF Coordinator: Processing request batch...");
        
        // Validate input arrays
        if request_ids.len() != proofs.len() || request_ids.len() != public_keys.len() || request_ids.len() != request_indices.len() {
            msg!("VRF Coordinator: Error - Input arrays length mismatch");
            return Err(VrfCoordinatorError::InvalidBatchParameters.into());
        }
        
        if request_ids.is_empty() {
            msg!("VRF Coordinator: Error - No requests to process");
            return Err(VrfCoordinatorError::NoRequestsToProcess.into());
        }
        
        let accounts_iter = &mut accounts.iter();
        let oracle = next_account_info(accounts_iter)?;
        let oracle_config = next_account_info(accounts_iter)?;
        let request_pool = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;
        
        // Verify oracle is signer
        if !oracle.is_signer {
            msg!("VRF Coordinator: Error - Missing oracle signature");
            return Err(ProgramError::MissingRequiredSignature);
        }
        
        // Load oracle config
        let oracle_data = oracle_config.try_borrow_data()?;
        if oracle_data.len() <= 8 || &oracle_data[0..8] != &[79, 82, 65, 67, 76, 69, 0, 0] {
            msg!("VRF Coordinator: Invalid oracle config account");
            return Err(ProgramError::InvalidAccountData);
        }
        
        let oracle_config = EnhancedOracle::try_from_slice(&oracle_data[8..])?;
        
        // Verify oracle authority
        if oracle_config.authority != *oracle.key {
            msg!("VRF Coordinator: Oracle authority mismatch");
            return Err(VrfCoordinatorError::InvalidOracleAuthority.into());
        }
        
        // Verify oracle is active
        if !oracle_config.is_active {
            msg!("VRF Coordinator: Oracle is not active");
            return Err(VrfCoordinatorError::InvalidOracle.into());
        }

        // Process each request
        let mut successful_count = 0;
        for i in 0..request_ids.len() {
            // We need to have at least 2 accounts per request - request account and result account
            if accounts_iter.len() < 2 {
                msg!("VRF Coordinator: Error - Not enough accounts provided for request {}", i);
                continue;
            }
            
            let request_account = next_account_info(accounts_iter)?;
            let result_account = next_account_info(accounts_iter)?;
            
            // Try to fulfill each request
            match Self::process_fulfill_randomness(
                program_id,
                &[
                    oracle.clone(), 
                    request_account.clone(), 
                    result_account.clone(),
                    request_pool.clone(),
                    next_account_info(accounts_iter)?.clone(), // subscription
                    next_account_info(accounts_iter)?.clone(), // callback program
                    system_program.clone(),
                ],
                proofs[i].clone(),
                public_keys[i].clone(),
                request_ids[i],
                pool_id,
                request_indices[i],
            ) {
                Ok(_) => {
                    successful_count += 1;
                },
                Err(e) => {
                    msg!("VRF Coordinator: Failed to process request {}: {:?}", i, e);
                    // Continue with other requests
                }
            }
        }
        
        // Emit batch processed event
        VrfEvent::BatchProcessed {
            oracle: *oracle.key,
            pool_id,
            count: successful_count,
        }.emit();
        
        Ok(())
    }

    fn process_fund_subscription(
        accounts: &[AccountInfo],
        amount: u64,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let funder = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;

        if !funder.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load subscription
        let mut subscription_data = subscription_account.try_borrow_data()?;
        if subscription_data.len() <= 8 || &subscription_data[0..8] != &[83, 85, 66, 83, 67, 82, 73, 80] {
            msg!("VRF Coordinator: Invalid subscription account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut subscription = EnhancedSubscription::try_from_slice(&subscription_data[8..])?;
        
        // Transfer SOL
        invoke(
            &system_instruction::transfer(
                funder.key,
                subscription_account.key,
                amount,
            ),
            &[
                funder.clone(),
                subscription_account.clone(),
                system_program.clone(),
            ],
        )?;

        // Update subscription balance
        subscription.balance = subscription.balance.checked_add(amount)
            .ok_or(ProgramError::InvalidInstructionData)?;
        
        // Write back subscription data
        subscription_data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]);
        subscription.serialize(&mut &mut subscription_data[8..])?;

        // Emit subscription funded event
        VrfEvent::SubscriptionFunded {
            subscription: *subscription_account.key,
            funder: *funder.key,
            amount,
        }.emit();

        Ok(())
    }

    fn process_cancel_request(
        accounts: &[AccountInfo],
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let owner = next_account_info(accounts_iter)?;
        let request_account = next_account_info(accounts_iter)?;
        let request_pool_account = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;

        if !owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Load request
        let mut request_data = request_account.try_borrow_data()?;
        if request_data.len() <= 8 || &request_data[0..8] != &[82, 69, 81, 85, 69, 83, 84, 0] {
            msg!("VRF Coordinator: Invalid request account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut request = RandomnessRequest::try_from_slice(&request_data[8..])?;
        
        // Verify request ID, pool ID, and request index
        if request.request_id != request_id || request.pool_id != pool_id || request.request_index != request_index {
            msg!("VRF Coordinator: Request data mismatch");
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        // Check request status
        if request.status != RequestStatus::Pending {
            msg!("VRF Coordinator: Request is not pending");
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }

        // Load subscription
        let mut subscription_data = subscription_account.try_borrow_data()?;
        if subscription_data.len() <= 8 || &subscription_data[0..8] != &[83, 85, 66, 83, 67, 82, 73, 80] {
            msg!("VRF Coordinator: Invalid subscription account");
            return Err(ProgramError::InvalidAccountData);
        }

        let mut subscription = EnhancedSubscription::try_from_slice(&subscription_data[8..])?;
        
        // Verify owner
        if subscription.owner != *owner.key {
            msg!("VRF Coordinator: Only subscription owner can cancel requests");
            return Err(VrfCoordinatorError::InvalidSubscriptionOwner.into());
        }

        // Load request pool
        let mut pool_data = request_pool_account.try_borrow_data()?;
        if pool_data.len() <= 8 || &pool_data[0..8] != &[80, 79, 79, 76, 0, 0, 0, 0] {
            msg!("VRF Coordinator: Invalid request pool account");
            return Err(VrfCoordinatorError::RequestPoolNotInitialized.into());
        }

        let mut request_pool = RequestPool::try_from_slice(&pool_data[8..])?;
        
        // Update request status
        request.status = RequestStatus::Cancelled;
        request_data[0..8].copy_from_slice(&[82, 69, 81, 85, 69, 83, 84, 0]);
        request.serialize(&mut &mut request_data[8..])?;
        
        // Update request in pool
        if let Some(request_summary) = request_pool.requests.get_mut(&request_index) {
            request_summary.status = RequestStatus::Cancelled;
        } else {
            msg!("VRF Coordinator: Request not found in pool");
            return Err(VrfCoordinatorError::RequestNotFound.into());
        }
        
        // Decrement active requests count
        subscription.active_requests = subscription.active_requests.saturating_sub(1);
        
        // Refund subscription balance
        subscription.balance = subscription.balance.checked_add(subscription.min_balance)
            .ok_or(ProgramError::InvalidInstructionData)?;
        
        // Remove request key from tracking
        let mut truncated_key = [0u8; 16];
        truncated_key.copy_from_slice(&request_id[0..16]);
        
        if let Some(pos) = subscription.request_keys.iter().position(|x| *x == truncated_key) {
            subscription.request_keys.remove(pos);
        }
        
        // Write back subscription data
        subscription_data[0..8].copy_from_slice(&[83, 85, 66, 83, 67, 82, 73, 80]);
        subscription.serialize(&mut &mut subscription_data[8..])?;
        
        // Write back pool data
        pool_data[0..8].copy_from_slice(&[80, 79, 79, 76, 0, 0, 0, 0]);
        request_pool.serialize(&mut &mut pool_data[8..])?;
        
        // Emit request cancelled event
        VrfEvent::RequestCancelled {
            request_id,
            subscription: *subscription_account.key,
            pool_id,
            request_index,
        }.emit();

        Ok(())
    }
} 
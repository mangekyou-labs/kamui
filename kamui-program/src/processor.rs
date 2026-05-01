use {
    crate::{
        error::VrfCoordinatorError,
        event::VrfEvent,
        instruction::VrfCoordinatorInstruction,
        state::{
            EnhancedOracle, EnhancedSubscription, OracleRegistry, RandomnessRequest, RequestPool,
            RequestStatus, RequestSummary, VrfResult, MAXIMUM_CALLBACK_GAS_LIMIT,
            MAXIMUM_RANDOM_WORDS, MAXIMUM_REQUEST_CONFIRMATIONS, MAX_ACTIVE_ORACLES,
            MAX_CALLBACK_DATA_LEN, MAX_PROOF_LEN, MAX_REQUESTS_PER_SUBSCRIPTION,
            MINIMUM_CALLBACK_GAS_LIMIT, MINIMUM_REQUEST_CONFIRMATIONS, ORACLE_DISCRIMINATOR,
            REGISTRY_DISCRIMINATOR, REQUEST_DISCRIMINATOR, REQUEST_POOL_DISCRIMINATOR,
            RESULT_DISCRIMINATOR, SUBSCRIPTION_DISCRIMINATOR,
        },
    },
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        instruction::{AccountMeta, Instruction},
        keccak::hashv,
        msg,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        pubkey::Pubkey,
        system_instruction, system_program,
        sysvar::{clock::Clock, rent::Rent, Sysvar},
    },
    std::collections::BTreeMap,
};

pub struct Processor;

impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        let instruction = VrfCoordinatorInstruction::unpack(instruction_data).map_err(|e| {
            msg!("VRF Coordinator: instruction decode failed: {}", e);
            ProgramError::InvalidInstructionData
        })?;

        match instruction {
            VrfCoordinatorInstruction::CreateEnhancedSubscription {
                min_balance,
                confirmations,
                max_requests,
            } => Self::process_create_enhanced_subscription(
                program_id,
                accounts,
                min_balance,
                confirmations,
                max_requests,
            ),
            VrfCoordinatorInstruction::FundSubscription { amount } => {
                Self::process_fund_subscription(program_id, accounts, amount)
            }
            VrfCoordinatorInstruction::InitializeRequestPool { pool_id, max_size } => {
                Self::process_initialize_request_pool(program_id, accounts, pool_id, max_size)
            }
            VrfCoordinatorInstruction::RequestRandomness {
                seed,
                callback_data,
                num_words,
                minimum_confirmations,
                callback_gas_limit,
                pool_id,
            } => Self::process_request_randomness(
                program_id,
                accounts,
                seed,
                callback_data,
                num_words,
                minimum_confirmations,
                callback_gas_limit,
                pool_id,
            ),
            VrfCoordinatorInstruction::FulfillRandomness {
                proof,
                public_key,
                request_id,
                pool_id,
                request_index,
            } => Self::process_fulfill_randomness(
                program_id,
                accounts,
                proof,
                public_key,
                request_id,
                pool_id,
                request_index,
            ),
            VrfCoordinatorInstruction::CancelRequest {
                request_id,
                pool_id,
                request_index,
            } => Self::process_cancel_request(
                program_id,
                accounts,
                request_id,
                pool_id,
                request_index,
            ),
            VrfCoordinatorInstruction::CleanExpiredRequests { pool_id } => {
                Self::process_clean_expired_requests(program_id, accounts, pool_id)
            }
            VrfCoordinatorInstruction::InitializeOracleRegistry {
                min_stake,
                rotation_frequency,
            } => Self::process_initialize_oracle_registry(
                program_id,
                accounts,
                min_stake,
                rotation_frequency,
            ),
            VrfCoordinatorInstruction::RegisterOracle {
                vrf_key,
                stake_amount,
            } => Self::process_register_oracle(program_id, accounts, vrf_key, stake_amount),
            VrfCoordinatorInstruction::DeactivateOracle => {
                Self::process_deactivate_oracle(program_id, accounts)
            }
            VrfCoordinatorInstruction::ProcessRequestBatch {
                request_ids,
                proofs,
                public_keys,
                pool_id,
                request_indices,
            } => Self::process_request_batch(
                program_id,
                accounts,
                request_ids,
                proofs,
                public_keys,
                pool_id,
                request_indices,
            ),
            VrfCoordinatorInstruction::RotateOracles => {
                Self::process_rotate_oracles(program_id, accounts)
            }
            VrfCoordinatorInstruction::UpdateOracleReputation {
                oracle_authority,
                successful_fulfillments,
                failed_fulfillments,
            } => Self::process_update_oracle_reputation(
                program_id,
                accounts,
                oracle_authority,
                successful_fulfillments,
                failed_fulfillments,
            ),
        }
    }

    fn process_create_enhanced_subscription(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        min_balance: u64,
        confirmations: u8,
        max_requests: u16,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let subscription_owner = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(subscription_owner)?;
        require_writable(subscription_account)?;
        require_system_program(system_program_account)?;

        if confirmations < MINIMUM_REQUEST_CONFIRMATIONS
            || confirmations > MAXIMUM_REQUEST_CONFIRMATIONS
        {
            return Err(VrfCoordinatorError::InvalidRequestConfirmations.into());
        }
        if max_requests == 0 || max_requests > MAX_REQUESTS_PER_SUBSCRIPTION {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        let seeds = [b"subscription".as_ref(), subscription_owner.key.as_ref()];
        let bump = require_pda(subscription_account, &seeds, program_id)?;

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

        create_pda_account(
            subscription_owner,
            subscription_account,
            system_program_account,
            program_id,
            EnhancedSubscription::space(max_requests, MAX_ACTIVE_ORACLES as usize),
            &[b"subscription", subscription_owner.key.as_ref(), &[bump]],
        )?;

        write_account(
            subscription_account,
            SUBSCRIPTION_DISCRIMINATOR,
            &subscription,
        )?;

        VrfEvent::SubscriptionCreated {
            subscription: *subscription_account.key,
            owner: *subscription_owner.key,
            min_balance,
            max_requests,
        }
        .emit();

        Ok(())
    }

    fn process_fund_subscription(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let funder = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(funder)?;
        require_system_program(system_program_account)?;

        let mut subscription: EnhancedSubscription =
            read_account(subscription_account, SUBSCRIPTION_DISCRIMINATOR, program_id)?;

        invoke(
            &system_instruction::transfer(funder.key, subscription_account.key, amount),
            &[
                funder.clone(),
                subscription_account.clone(),
                system_program_account.clone(),
            ],
        )?;

        subscription.balance = subscription
            .balance
            .checked_add(amount)
            .ok_or(ProgramError::InvalidInstructionData)?;

        write_account(
            subscription_account,
            SUBSCRIPTION_DISCRIMINATOR,
            &subscription,
        )?;

        VrfEvent::SubscriptionFunded {
            subscription: *subscription_account.key,
            funder: *funder.key,
            amount,
        }
        .emit();

        Ok(())
    }

    fn process_initialize_request_pool(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        pool_id: u8,
        max_size: u32,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let owner = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;
        let pool_account = next_account_info(accounts_iter)?;
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(owner)?;
        require_writable(subscription_account)?;
        require_writable(pool_account)?;
        require_system_program(system_program_account)?;

        if max_size == 0 {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        let mut subscription: EnhancedSubscription =
            read_account(subscription_account, SUBSCRIPTION_DISCRIMINATOR, program_id)?;

        if subscription.owner != *owner.key {
            return Err(VrfCoordinatorError::InvalidSubscriptionOwner.into());
        }
        if subscription.pool_ids.contains(&pool_id) {
            return Err(VrfCoordinatorError::InvalidPoolId.into());
        }
        if subscription.pool_ids.len() >= MAX_ACTIVE_ORACLES as usize {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        let seeds = [
            b"request_pool".as_ref(),
            subscription_account.key.as_ref(),
            &[pool_id],
        ];
        let bump = require_pda(pool_account, &seeds, program_id)?;

        let pool = RequestPool {
            subscription: *subscription_account.key,
            pool_id,
            request_count: 0,
            max_size,
            requests: BTreeMap::new(),
            last_processed_slot: Clock::get()?.slot,
        };

        create_pda_account(
            owner,
            pool_account,
            system_program_account,
            program_id,
            RequestPool::space(max_size),
            &[
                b"request_pool",
                subscription_account.key.as_ref(),
                &[pool_id],
                &[bump],
            ],
        )?;

        write_account(pool_account, REQUEST_POOL_DISCRIMINATOR, &pool)?;

        subscription.pool_ids.push(pool_id);
        write_account(
            subscription_account,
            SUBSCRIPTION_DISCRIMINATOR,
            &subscription,
        )?;

        VrfEvent::RequestPoolInitialized {
            subscription: *subscription_account.key,
            pool_id,
            max_size,
        }
        .emit();

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
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
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(requester)?;
        require_writable(request_account)?;
        require_writable(subscription_account)?;
        require_writable(request_pool_account)?;
        require_system_program(system_program_account)?;

        if num_words == 0 || num_words > MAXIMUM_RANDOM_WORDS {
            return Err(VrfCoordinatorError::InvalidNumberOfWords.into());
        }
        if minimum_confirmations < MINIMUM_REQUEST_CONFIRMATIONS
            || minimum_confirmations > MAXIMUM_REQUEST_CONFIRMATIONS
        {
            return Err(VrfCoordinatorError::InvalidRequestConfirmations.into());
        }
        if callback_gas_limit < MINIMUM_CALLBACK_GAS_LIMIT
            || callback_gas_limit > MAXIMUM_CALLBACK_GAS_LIMIT
        {
            return Err(VrfCoordinatorError::InvalidCallbackGasLimit.into());
        }
        if callback_data.len() > MAX_CALLBACK_DATA_LEN {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        let mut subscription: EnhancedSubscription =
            read_account(subscription_account, SUBSCRIPTION_DISCRIMINATOR, program_id)?;
        let mut request_pool: RequestPool =
            read_account(request_pool_account, REQUEST_POOL_DISCRIMINATOR, program_id)?;

        if subscription.balance < subscription.min_balance {
            return Err(VrfCoordinatorError::InsufficientBalance.into());
        }
        if minimum_confirmations < subscription.confirmations {
            return Err(VrfCoordinatorError::InsufficientConfirmations.into());
        }
        if subscription.active_requests >= subscription.max_requests {
            return Err(VrfCoordinatorError::SubscriptionRequestLimitExceeded.into());
        }
        if !subscription.pool_ids.contains(&pool_id) {
            return Err(VrfCoordinatorError::InvalidPoolId.into());
        }

        if request_pool.subscription != *subscription_account.key || request_pool.pool_id != pool_id
        {
            return Err(ProgramError::InvalidAccountData);
        }
        if request_pool.request_count >= request_pool.max_size {
            return Err(VrfCoordinatorError::PoolIsFull.into());
        }

        let request_index = request_pool
            .next_request_index()
            .ok_or(VrfCoordinatorError::InvalidRequestParameters)?;
        if request_index >= request_pool.max_size {
            return Err(VrfCoordinatorError::PoolIsFull.into());
        }

        let clock = Clock::get()?;
        let request_id = RequestPool::generate_request_id(
            &seed,
            requester.key,
            subscription_account.key,
            pool_id,
            request_index,
            clock.slot,
            clock.unix_timestamp,
        );

        let request_bump = require_pda(
            request_account,
            &[b"vrf_request".as_ref(), request_id.as_ref()],
            program_id,
        )?;

        let request = RandomnessRequest {
            subscription: *subscription_account.key,
            seed,
            requester: *requester.key,
            callback_data,
            request_slot: clock.slot,
            status: RequestStatus::Pending,
            num_words,
            callback_gas_limit,
            pool_id,
            request_index,
            request_id,
        };

        let request_summary = RequestSummary {
            requester: *requester.key,
            seed_hash: hashv(&[&seed]).to_bytes(),
            timestamp: clock.unix_timestamp,
            status: RequestStatus::Pending,
            request_slot: clock.slot,
            callback_gas_limit,
        };

        create_pda_account(
            requester,
            request_account,
            system_program_account,
            program_id,
            RandomnessRequest::space(request.callback_data.len()),
            &[b"vrf_request", request_id.as_ref(), &[request_bump]],
        )?;

        write_account(request_account, REQUEST_DISCRIMINATOR, &request)?;

        request_pool.requests.insert(request_index, request_summary);
        request_pool.request_count = request_pool.request_count.saturating_add(1);

        subscription.balance = subscription
            .balance
            .checked_sub(subscription.min_balance)
            .ok_or(VrfCoordinatorError::InsufficientBalance)?;
        subscription.active_requests = subscription
            .active_requests
            .checked_add(1)
            .ok_or(VrfCoordinatorError::InvalidRequestParameters)?;
        subscription.track_request(&request_id);

        write_account(
            subscription_account,
            SUBSCRIPTION_DISCRIMINATOR,
            &subscription,
        )?;
        write_account(
            request_pool_account,
            REQUEST_POOL_DISCRIMINATOR,
            &request_pool,
        )?;

        VrfEvent::RandomnessRequested {
            request_id,
            requester: *requester.key,
            subscription: *subscription_account.key,
            seed,
            pool_id,
            request_index,
        }
        .emit();

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
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(oracle)?;
        require_writable(request_account)?;
        require_writable(vrf_result_account)?;
        require_writable(request_pool_account)?;
        require_writable(subscription_account)?;
        require_system_program(system_program_account)?;

        if proof.is_empty() || proof.len() > MAX_PROOF_LEN || public_key.len() != 32 {
            return Err(VrfCoordinatorError::InvalidVrfProof.into());
        }
        if !is_supported_vrf_artifact(&proof, &public_key) {
            return Err(VrfCoordinatorError::InvalidVrfProof.into());
        }

        let mut request: RandomnessRequest =
            read_account(request_account, REQUEST_DISCRIMINATOR, program_id)?;
        let mut request_pool: RequestPool =
            read_account(request_pool_account, REQUEST_POOL_DISCRIMINATOR, program_id)?;
        let mut subscription: EnhancedSubscription =
            read_account(subscription_account, SUBSCRIPTION_DISCRIMINATOR, program_id)?;

        if request.request_id != request_id {
            return Err(VrfCoordinatorError::RequestIdMismatch.into());
        }
        if request.pool_id != pool_id || request.request_index != request_index {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }
        if request.status != RequestStatus::Pending {
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }
        if request.subscription != *subscription_account.key {
            return Err(ProgramError::InvalidAccountData);
        }

        if request_pool.subscription != *subscription_account.key || request_pool.pool_id != pool_id
        {
            return Err(ProgramError::InvalidAccountData);
        }

        let summary = request_pool
            .requests
            .get_mut(&request_index)
            .ok_or(VrfCoordinatorError::RequestNotFound)?;
        if summary.status != RequestStatus::Pending {
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }

        let current_slot = Clock::get()?.slot;
        if RequestPool::is_request_expired(summary.request_slot, current_slot) {
            request.status = RequestStatus::Expired;
            summary.status = RequestStatus::Expired;
            request_pool.request_count = request_pool.request_count.saturating_sub(1);
            subscription.active_requests = subscription.active_requests.saturating_sub(1);
            subscription.untrack_request(&request_id);
            subscription.balance = subscription
                .balance
                .checked_add(subscription.min_balance)
                .ok_or(ProgramError::InvalidInstructionData)?;

            write_account(request_account, REQUEST_DISCRIMINATOR, &request)?;
            write_account(
                request_pool_account,
                REQUEST_POOL_DISCRIMINATOR,
                &request_pool,
            )?;
            write_account(
                subscription_account,
                SUBSCRIPTION_DISCRIMINATOR,
                &subscription,
            )?;

            VrfEvent::RequestExpired {
                request_id,
                subscription: *subscription_account.key,
                pool_id,
                request_index,
            }
            .emit();

            return Err(VrfCoordinatorError::RequestExpired.into());
        }

        let randomness =
            derive_randomness_words(&request_id, &proof, &public_key, request.num_words);
        let vrf_result = VrfResult {
            randomness,
            proof: proof.clone(),
            proof_slot: current_slot,
            request_id,
        };

        let result_bump = require_pda(
            vrf_result_account,
            &[b"vrf_result".as_ref(), request_id.as_ref()],
            program_id,
        )?;

        create_pda_account(
            oracle,
            vrf_result_account,
            system_program_account,
            program_id,
            VrfResult::space(request.num_words as usize, proof.len()),
            &[b"vrf_result", request_id.as_ref(), &[result_bump]],
        )?;

        write_account(vrf_result_account, RESULT_DISCRIMINATOR, &vrf_result)?;

        request.status = RequestStatus::Fulfilled;
        summary.status = RequestStatus::Fulfilled;
        request_pool.request_count = request_pool.request_count.saturating_sub(1);

        subscription.active_requests = subscription.active_requests.saturating_sub(1);
        subscription.untrack_request(&request_id);

        write_account(request_account, REQUEST_DISCRIMINATOR, &request)?;
        write_account(
            request_pool_account,
            REQUEST_POOL_DISCRIMINATOR,
            &request_pool,
        )?;
        write_account(
            subscription_account,
            SUBSCRIPTION_DISCRIMINATOR,
            &subscription,
        )?;

        if !request.callback_data.is_empty() {
            if request.requester != *callback_program.key {
                return Err(VrfCoordinatorError::InvalidRequestParameters.into());
            }

            let mut callback_data = request.callback_data.clone();
            if let Some(first_word) = vrf_result.randomness.first() {
                callback_data.extend_from_slice(first_word);
            }

            let callback_ix = Instruction {
                program_id: request.requester,
                accounts: vec![
                    AccountMeta::new_readonly(*request_account.key, false),
                    AccountMeta::new_readonly(*vrf_result_account.key, false),
                ],
                data: callback_data,
            };

            invoke(
                &callback_ix,
                &[
                    request_account.clone(),
                    vrf_result_account.clone(),
                    callback_program.clone(),
                ],
            )?;
        }

        VrfEvent::RandomnessFulfilled {
            request_id,
            requester: request.requester,
            randomness: vrf_result.randomness.first().copied().unwrap_or([0u8; 64]),
            oracle: *oracle.key,
        }
        .emit();

        Ok(())
    }

    fn process_cancel_request(
        program_id: &Pubkey,
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

        require_signer(owner)?;

        let mut request: RandomnessRequest =
            read_account(request_account, REQUEST_DISCRIMINATOR, program_id)?;
        let mut request_pool: RequestPool =
            read_account(request_pool_account, REQUEST_POOL_DISCRIMINATOR, program_id)?;
        let mut subscription: EnhancedSubscription =
            read_account(subscription_account, SUBSCRIPTION_DISCRIMINATOR, program_id)?;

        if subscription.owner != *owner.key {
            return Err(VrfCoordinatorError::InvalidSubscriptionOwner.into());
        }
        if request.subscription != *subscription_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if request.request_id != request_id
            || request.pool_id != pool_id
            || request.request_index != request_index
        {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }
        if request.status != RequestStatus::Pending {
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }
        if request_pool.subscription != *subscription_account.key || request_pool.pool_id != pool_id
        {
            return Err(ProgramError::InvalidAccountData);
        }

        let request_summary = request_pool
            .requests
            .get_mut(&request_index)
            .ok_or(VrfCoordinatorError::RequestNotFound)?;
        if request_summary.status != RequestStatus::Pending {
            return Err(VrfCoordinatorError::InvalidRequestStatus.into());
        }

        request.status = RequestStatus::Cancelled;
        request_summary.status = RequestStatus::Cancelled;
        request_pool.request_count = request_pool.request_count.saturating_sub(1);

        subscription.active_requests = subscription.active_requests.saturating_sub(1);
        subscription.balance = subscription
            .balance
            .checked_add(subscription.min_balance)
            .ok_or(ProgramError::InvalidInstructionData)?;
        subscription.untrack_request(&request_id);

        write_account(request_account, REQUEST_DISCRIMINATOR, &request)?;
        write_account(
            request_pool_account,
            REQUEST_POOL_DISCRIMINATOR,
            &request_pool,
        )?;
        write_account(
            subscription_account,
            SUBSCRIPTION_DISCRIMINATOR,
            &subscription,
        )?;

        VrfEvent::RequestCancelled {
            request_id,
            subscription: *subscription_account.key,
            pool_id,
            request_index,
        }
        .emit();

        Ok(())
    }

    fn process_clean_expired_requests(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        pool_id: u8,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let request_pool_account = next_account_info(accounts_iter)?;
        let subscription_account = next_account_info(accounts_iter)?;

        require_signer(signer)?;

        let mut request_pool: RequestPool =
            read_account(request_pool_account, REQUEST_POOL_DISCRIMINATOR, program_id)?;
        let mut subscription: EnhancedSubscription =
            read_account(subscription_account, SUBSCRIPTION_DISCRIMINATOR, program_id)?;

        if request_pool.pool_id != pool_id {
            return Err(VrfCoordinatorError::InvalidPoolId.into());
        }
        if request_pool.subscription != *subscription_account.key {
            return Err(ProgramError::InvalidAccountData);
        }

        let current_slot = Clock::get()?.slot;
        let expired_indexes = request_pool.collect_expired_pending(current_slot);
        let expired_count = request_pool.mark_expired(&expired_indexes);

        if expired_count > 0 {
            request_pool.request_count = request_pool.request_count.saturating_sub(expired_count);
            subscription.active_requests = subscription
                .active_requests
                .saturating_sub(expired_count as u16);

            let refund = subscription
                .min_balance
                .saturating_mul(expired_count as u64);
            subscription.balance = subscription
                .balance
                .checked_add(refund)
                .ok_or(ProgramError::InvalidInstructionData)?;

            write_account(
                request_pool_account,
                REQUEST_POOL_DISCRIMINATOR,
                &request_pool,
            )?;
            write_account(
                subscription_account,
                SUBSCRIPTION_DISCRIMINATOR,
                &subscription,
            )?;

            VrfEvent::RequestPoolCleaned {
                subscription: *subscription_account.key,
                pool_id,
                expired_count,
            }
            .emit();
        }

        Ok(())
    }

    fn process_initialize_oracle_registry(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        min_stake: u64,
        rotation_frequency: u64,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let admin = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(admin)?;
        require_writable(registry_account)?;
        require_system_program(system_program_account)?;

        if rotation_frequency == 0 {
            return Err(VrfCoordinatorError::InvalidRequestParameters.into());
        }

        let bump = require_pda(registry_account, &[b"oracle_registry".as_ref()], program_id)?;

        let registry = OracleRegistry {
            admin: *admin.key,
            oracle_count: 0,
            min_stake,
            rotation_frequency,
            last_rotation: Clock::get()?.slot,
            oracles: Vec::new(),
        };

        create_pda_account(
            admin,
            registry_account,
            system_program_account,
            program_id,
            OracleRegistry::space(MAX_ACTIVE_ORACLES as usize),
            &[b"oracle_registry", &[bump]],
        )?;

        write_account(registry_account, REGISTRY_DISCRIMINATOR, &registry)?;

        VrfEvent::OracleRegistryInitialized {
            admin: *admin.key,
            min_stake,
            rotation_frequency,
        }
        .emit();

        Ok(())
    }

    fn process_register_oracle(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        vrf_key: [u8; 32],
        stake_amount: u64,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let authority = next_account_info(accounts_iter)?;
        let oracle_account = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(authority)?;
        require_writable(oracle_account)?;
        require_writable(registry_account)?;
        require_system_program(system_program_account)?;

        let mut registry: OracleRegistry =
            read_account(registry_account, REGISTRY_DISCRIMINATOR, program_id)?;

        if stake_amount < registry.min_stake {
            return Err(VrfCoordinatorError::InsufficientStake.into());
        }
        if registry.oracles.contains(authority.key) {
            return Err(VrfCoordinatorError::OracleAlreadyRegistered.into());
        }
        if registry.oracles.len() >= MAX_ACTIVE_ORACLES as usize {
            return Err(VrfCoordinatorError::InvalidOracle.into());
        }

        let bump = require_pda(
            oracle_account,
            &[b"oracle".as_ref(), authority.key.as_ref()],
            program_id,
        )?;

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

        create_pda_account(
            authority,
            oracle_account,
            system_program_account,
            program_id,
            EnhancedOracle::space(),
            &[b"oracle", authority.key.as_ref(), &[bump]],
        )?;

        write_account(oracle_account, ORACLE_DISCRIMINATOR, &oracle)?;

        registry.oracles.push(*authority.key);
        registry.oracle_count = registry.oracles.len() as u16;
        write_account(registry_account, REGISTRY_DISCRIMINATOR, &registry)?;

        VrfEvent::OracleRegistered {
            authority: *authority.key,
            oracle_account: *oracle_account.key,
            stake_amount,
        }
        .emit();

        Ok(())
    }

    fn process_deactivate_oracle(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let oracle_account = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;

        require_signer(signer)?;

        let mut oracle: EnhancedOracle =
            read_account(oracle_account, ORACLE_DISCRIMINATOR, program_id)?;
        let mut registry: OracleRegistry =
            read_account(registry_account, REGISTRY_DISCRIMINATOR, program_id)?;

        if *signer.key != oracle.authority && *signer.key != registry.admin {
            return Err(VrfCoordinatorError::InvalidOracleAuthority.into());
        }

        oracle.is_active = false;
        write_account(oracle_account, ORACLE_DISCRIMINATOR, &oracle)?;

        registry.oracles.retain(|pk| *pk != oracle.authority);
        registry.oracle_count = registry.oracles.len() as u16;
        write_account(registry_account, REGISTRY_DISCRIMINATOR, &registry)?;

        VrfEvent::OracleDeactivated {
            authority: oracle.authority,
            oracle_account: *oracle_account.key,
        }
        .emit();

        Ok(())
    }

    fn process_rotate_oracles(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;

        require_signer(signer)?;

        let mut registry: OracleRegistry =
            read_account(registry_account, REGISTRY_DISCRIMINATOR, program_id)?;

        let current_slot = Clock::get()?.slot;
        if current_slot
            < registry
                .last_rotation
                .saturating_add(registry.rotation_frequency)
        {
            return Err(VrfCoordinatorError::RotationNotDue.into());
        }

        registry.last_rotation = current_slot;
        write_account(registry_account, REGISTRY_DISCRIMINATOR, &registry)?;

        VrfEvent::OraclesRotated {
            registry: *registry_account.key,
            active_count: registry.oracle_count,
        }
        .emit();

        Ok(())
    }

    fn process_update_oracle_reputation(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        oracle_authority: Pubkey,
        successful_fulfillments: u16,
        failed_fulfillments: u16,
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        let signer = next_account_info(accounts_iter)?;
        let oracle_account = next_account_info(accounts_iter)?;
        let registry_account = next_account_info(accounts_iter)?;

        require_signer(signer)?;

        let registry: OracleRegistry =
            read_account(registry_account, REGISTRY_DISCRIMINATOR, program_id)?;
        if *signer.key != registry.admin {
            return Err(VrfCoordinatorError::InvalidAdmin.into());
        }

        let mut oracle: EnhancedOracle =
            read_account(oracle_account, ORACLE_DISCRIMINATOR, program_id)?;
        if oracle.authority != oracle_authority {
            return Err(VrfCoordinatorError::InvalidOracleAuthority.into());
        }

        oracle.fulfillment_count = oracle
            .fulfillment_count
            .checked_add(successful_fulfillments as u64)
            .ok_or(ProgramError::InvalidInstructionData)?;
        oracle.failure_count = oracle
            .failure_count
            .checked_add(failed_fulfillments as u64)
            .ok_or(ProgramError::InvalidInstructionData)?;

        let total = oracle
            .fulfillment_count
            .checked_add(oracle.failure_count)
            .ok_or(ProgramError::InvalidInstructionData)?;
        let score_bps = if total > 0 {
            (oracle.fulfillment_count.saturating_mul(10_000)) / total
        } else {
            0
        };
        oracle.reputation = score_bps.min(10_000) as u16;
        oracle.last_active = Clock::get()?.slot;

        write_account(oracle_account, ORACLE_DISCRIMINATOR, &oracle)?;

        VrfEvent::OracleReputationUpdated {
            authority: oracle.authority,
            oracle_account: *oracle_account.key,
            reputation: oracle.reputation,
        }
        .emit();

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn process_request_batch(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        request_ids: Vec<[u8; 32]>,
        proofs: Vec<Vec<u8>>,
        public_keys: Vec<Vec<u8>>,
        pool_id: u8,
        request_indices: Vec<u32>,
    ) -> ProgramResult {
        if request_ids.is_empty() {
            return Err(VrfCoordinatorError::NoRequestsToProcess.into());
        }
        if request_ids.len() != proofs.len()
            || request_ids.len() != public_keys.len()
            || request_ids.len() != request_indices.len()
        {
            return Err(VrfCoordinatorError::InvalidBatchParameters.into());
        }

        let expected_account_len = 4 + (request_ids.len() * 4);
        if accounts.len() != expected_account_len {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let accounts_iter = &mut accounts.iter();
        let oracle = next_account_info(accounts_iter)?;
        let oracle_config_account = next_account_info(accounts_iter)?;
        let request_pool_account = next_account_info(accounts_iter)?;
        let system_program_account = next_account_info(accounts_iter)?;

        require_signer(oracle)?;
        require_system_program(system_program_account)?;

        let oracle_config: EnhancedOracle =
            read_account(oracle_config_account, ORACLE_DISCRIMINATOR, program_id)?;
        if oracle_config.authority != *oracle.key {
            return Err(VrfCoordinatorError::InvalidOracleAuthority.into());
        }
        if !oracle_config.is_active {
            return Err(VrfCoordinatorError::InvalidOracle.into());
        }

        let mut successful_count = 0u32;
        for index in 0..request_ids.len() {
            let request_account = next_account_info(accounts_iter)?;
            let result_account = next_account_info(accounts_iter)?;
            let subscription_account = next_account_info(accounts_iter)?;
            let callback_program = next_account_info(accounts_iter)?;

            let accounts_for_request = [
                oracle.clone(),
                request_account.clone(),
                result_account.clone(),
                request_pool_account.clone(),
                subscription_account.clone(),
                callback_program.clone(),
                system_program_account.clone(),
            ];

            match Self::process_fulfill_randomness(
                program_id,
                &accounts_for_request,
                proofs[index].clone(),
                public_keys[index].clone(),
                request_ids[index],
                pool_id,
                request_indices[index],
            ) {
                Ok(_) => successful_count = successful_count.saturating_add(1),
                Err(error) => {
                    msg!(
                        "VRF Coordinator: batch item {} failed with {:?}",
                        index,
                        error
                    );
                }
            }
        }

        if successful_count == 0 {
            return Err(VrfCoordinatorError::NoRequestsToProcess.into());
        }

        VrfEvent::BatchProcessed {
            oracle: *oracle.key,
            pool_id,
            count: successful_count,
        }
        .emit();

        Ok(())
    }
}

fn is_supported_vrf_artifact(proof: &[u8], public_key: &[u8]) -> bool {
    proof.len() == 80 && public_key.len() == 32
}

fn derive_randomness_words(
    request_id: &[u8; 32],
    proof: &[u8],
    public_key: &[u8],
    num_words: u32,
) -> Vec<[u8; 64]> {
    let mut output = Vec::with_capacity(num_words as usize);
    for index in 0..num_words {
        let left = hashv(&[
            b"kamui:vrf:left",
            request_id,
            proof,
            public_key,
            &index.to_le_bytes(),
        ])
        .to_bytes();
        let right = hashv(&[
            b"kamui:vrf:right",
            request_id,
            proof,
            public_key,
            &index.to_le_bytes(),
        ])
        .to_bytes();

        let mut word = [0u8; 64];
        word[..32].copy_from_slice(&left);
        word[32..].copy_from_slice(&right);
        output.push(word);
    }
    output
}

fn require_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn require_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn require_system_program(account: &AccountInfo) -> ProgramResult {
    if *account.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

fn require_pda(
    account: &AccountInfo,
    seeds: &[&[u8]],
    program_id: &Pubkey,
) -> Result<u8, ProgramError> {
    let (expected, bump) = Pubkey::find_program_address(seeds, program_id);
    if expected != *account.key {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(bump)
}

fn create_pda_account(
    payer: &AccountInfo,
    target: &AccountInfo,
    system_program_account: &AccountInfo,
    program_id: &Pubkey,
    space: usize,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    if !target.data_is_empty() || *target.owner != system_program::id() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let lamports = Rent::get()?.minimum_balance(space);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            target.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            payer.clone(),
            target.clone(),
            system_program_account.clone(),
        ],
        &[signer_seeds],
    )
}

fn deserialize_prefix<T: BorshDeserialize>(bytes: &[u8]) -> Result<T, ProgramError> {
    let mut data = bytes;
    T::deserialize(&mut data).map_err(|_| ProgramError::InvalidAccountData)
}

fn read_account<T: BorshDeserialize>(
    account: &AccountInfo,
    discriminator: [u8; 8],
    expected_owner: &Pubkey,
) -> Result<T, ProgramError> {
    if account.owner != expected_owner {
        return Err(ProgramError::IncorrectProgramId);
    }
    read_account_unowned(account, discriminator)
}

fn read_account_unowned<T: BorshDeserialize>(
    account: &AccountInfo,
    discriminator: [u8; 8],
) -> Result<T, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 || data[..8] != discriminator {
        return Err(ProgramError::InvalidAccountData);
    }
    deserialize_prefix(&data[8..])
}

fn write_account<T: BorshSerialize>(
    account: &AccountInfo,
    discriminator: [u8; 8],
    value: &T,
) -> ProgramResult {
    write_account_unowned(account, discriminator, value)
}

fn write_account_unowned<T: BorshSerialize>(
    account: &AccountInfo,
    discriminator: [u8; 8],
    value: &T,
) -> ProgramResult {
    let encoded = borsh::to_vec(value).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = account.try_borrow_mut_data()?;

    if data.len() < 8 + encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }

    data.fill(0);
    data[..8].copy_from_slice(&discriminator);
    data[8..8 + encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

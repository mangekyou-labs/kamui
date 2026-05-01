module kamui_iota_vrf::coordinator;

use iota::table;
use iota::vec_set;
use iota::coin::{Self, Coin};
use iota::iota::IOTA;
use iota::balance::{Self, Balance};
use iota::ecvrf;
use iota::event;
use kamui_iota_vrf::request;

/// Abort codes.
const E_NOT_SUBSCRIPTION_OWNER: u64 = 1;
const E_SUBSCRIPTION_NOT_FOUND: u64 = 2;
const E_CONSUMER_ALREADY_AUTHORIZED: u64 = 3;
const E_CONSUMER_NOT_AUTHORIZED: u64 = 4;
const E_INSUFFICIENT_BALANCE: u64 = 5;
const E_UNAUTHORIZED_CONSUMER: u64 = 6;
const E_REQUEST_NOT_PENDING: u64 = 7;
const E_INVALID_PROOF: u64 = 8;
const E_INVALID_NUM_WORDS: u64 = 9;
const E_CALLBACK_DATA_TOO_LARGE: u64 = 10;
const E_NOT_COORDINATOR_OWNER: u64 = 11;
const E_INVALID_VRF_PUBLIC_KEY: u64 = 12;
const E_INVALID_FEE_MODEL: u64 = 13;
const E_REQUEST_NOT_FULFILLED: u64 = 14;

const MAX_NUM_WORDS: u32 = 16;
const MAX_CALLBACK_DATA_BYTES: u64 = 256;
const VRF_PUBLIC_KEY_LENGTH_BYTES: u64 = 32;

public struct VrfPublicKeyRotated has copy, drop {
    new_public_key: vector<u8>,
    updated_by: address,
}

public struct Coordinator has key {
    id: object::UID,
    owner: address,
    next_subscription_id: u64,
    next_request_id: u64,
    subscriptions: table::Table<u64, Subscription>,
    requests: table::Table<u64, request::RequestRecord>,
    fee_per_request: u64,
    fulfiller_reward: u64,
    treasury: Balance<IOTA>,
    vrf_public_key: vector<u8>,
}

public struct Subscription has store {
    owner: address,
    consumers: vec_set::VecSet<address>,
    balance: Balance<IOTA>,
}

/// Package initializer.
///
/// Deployment-time VRF keys are environment-specific, so production coordinators
/// must be created explicitly via `create_coordinator`.
fun init(_ctx: &mut TxContext) {
}

/// Creates a new coordinator object.
public fun new(owner: address, fee_per_request: u64, fulfiller_reward: u64, vrf_public_key: vector<u8>, ctx: &mut TxContext): Coordinator {
    assert!(
        vector::length(&vrf_public_key) == VRF_PUBLIC_KEY_LENGTH_BYTES,
        E_INVALID_VRF_PUBLIC_KEY
    );
    assert!(fulfiller_reward <= fee_per_request, E_INVALID_FEE_MODEL);
    Coordinator {
        id: object::new(ctx),
        owner,
        next_subscription_id: 0,
        next_request_id: 0,
        subscriptions: table::new(ctx),
        requests: table::new(ctx),
        fee_per_request,
        fulfiller_reward,
        treasury: balance::zero(),
        vrf_public_key,
    }
}

/// Creates and shares a new coordinator object using the caller as owner.
public entry fun create_coordinator(
    fee_per_request: u64,
    fulfiller_reward: u64,
    vrf_public_key: vector<u8>,
    ctx: &mut TxContext,
) {
    let coordinator = new(
        tx_context::sender(ctx),
        fee_per_request,
        fulfiller_reward,
        vrf_public_key,
        ctx,
    );
    transfer::share_object(coordinator);
}

/// Creates a subscription and auto-authorizes the subscription owner.
public fun create_subscription(coordinator: &mut Coordinator, subscription_owner: address, _ctx: &mut TxContext): u64 {
    let subscription_id = coordinator.next_subscription_id;
    coordinator.next_subscription_id = subscription_id + 1;

    let mut consumers = vec_set::empty();
    consumers.insert(subscription_owner);

    coordinator.subscriptions.add(
        subscription_id,
        Subscription {
            owner: subscription_owner,
            consumers,
            balance: balance::zero(),
        },
    );
    subscription_id
}

/// Funds a subscription with IOTA coins.
public fun fund_subscription(coordinator: &mut Coordinator, subscription_id: u64, payment: Coin<IOTA>) {
    assert!(coordinator.subscriptions.contains(subscription_id), E_SUBSCRIPTION_NOT_FOUND);
    let subscription = &mut coordinator.subscriptions[subscription_id];
    subscription.balance.join(payment.into_balance());
}

/// Withdraws funds from a subscription (owner-only).
public fun withdraw_subscription(
    coordinator: &mut Coordinator,
    caller: address,
    subscription_id: u64,
    amount: u64,
    ctx: &mut TxContext
): Coin<IOTA> {
    assert_subscription_owner(coordinator, subscription_id, caller);
    let subscription = &mut coordinator.subscriptions[subscription_id];
    assert!(subscription.balance.value() >= amount, E_INSUFFICIENT_BALANCE);
    coin::from_balance(subscription.balance.split(amount), ctx)
}

/// Adds a consumer to the allowlist for a subscription.
public fun add_consumer(
    coordinator: &mut Coordinator,
    caller: address,
    subscription_id: u64,
    consumer: address,
) {
    assert_subscription_owner(coordinator, subscription_id, caller);
    let subscription = &mut coordinator.subscriptions[subscription_id];
    assert!(
        !subscription.consumers.contains(&consumer),
        E_CONSUMER_ALREADY_AUTHORIZED
    );
    subscription.consumers.insert(consumer);
}

/// Removes a consumer from the allowlist for a subscription.
public fun remove_consumer(
    coordinator: &mut Coordinator,
    caller: address,
    subscription_id: u64,
    consumer: address,
) {
    assert_subscription_owner(coordinator, subscription_id, caller);
    let subscription = &mut coordinator.subscriptions[subscription_id];
    assert!(
        subscription.consumers.contains(&consumer),
        E_CONSUMER_NOT_AUTHORIZED
    );
    subscription.consumers.remove(&consumer);
}

/// Returns true if a consumer is allowlisted for a subscription.
public fun is_authorized_consumer(
    coordinator: &Coordinator,
    subscription_id: u64,
    consumer: address,
): bool {
    if (!coordinator.subscriptions.contains(subscription_id)) {
        return false
    };
    coordinator.subscriptions[subscription_id].consumers.contains(&consumer)
}

/// Returns the subscription balance.
public fun subscription_balance(coordinator: &Coordinator, subscription_id: u64): u64 {
    assert!(coordinator.subscriptions.contains(subscription_id), E_SUBSCRIPTION_NOT_FOUND);
    coordinator.subscriptions[subscription_id].balance.value()
}

/// Returns the fee per request.
public fun fee_per_request(coordinator: &Coordinator): u64 {
    coordinator.fee_per_request
}

/// Returns the fulfiller reward.
public fun fulfiller_reward(coordinator: &Coordinator): u64 {
    coordinator.fulfiller_reward
}

/// Returns the subscription owner.
public fun subscription_owner(coordinator: &Coordinator, subscription_id: u64): address {
    assert!(
        coordinator.subscriptions.contains(subscription_id),
        E_SUBSCRIPTION_NOT_FOUND
    );
    coordinator.subscriptions[subscription_id].owner
}

/// Returns the coordinator owner.
public fun owner(coordinator: &Coordinator): address {
    coordinator.owner
}

/// Returns the active VRF public key.
public fun vrf_public_key(coordinator: &Coordinator): vector<u8> {
    coordinator.vrf_public_key
}

/// Returns the maximum allowed num_words for a request.
public fun max_num_words(): u32 {
    MAX_NUM_WORDS
}

/// Returns the maximum callback data size in bytes.
public fun max_callback_data_bytes(): u64 {
    MAX_CALLBACK_DATA_BYTES
}

/// Rotates the active VRF public key (owner-only).
public fun set_vrf_public_key(
    coordinator: &mut Coordinator,
    caller: address,
    vrf_public_key: vector<u8>,
) {
    assert_coordinator_owner(coordinator, caller);
    assert!(
        vector::length(&vrf_public_key) == VRF_PUBLIC_KEY_LENGTH_BYTES,
        E_INVALID_VRF_PUBLIC_KEY
    );

    coordinator.vrf_public_key = vrf_public_key;
    event::emit(VrfPublicKeyRotated {
        new_public_key: coordinator.vrf_public_key,
        updated_by: caller,
    });
}

/// Requests randomness from the coordinator.
public fun request_randomness(
    coordinator: &mut Coordinator,
    subscription_id: u64,
    requester: address,
    seed: vector<u8>,
    num_words: u32,
    callback_data: vector<u8>,
    ctx: &mut TxContext
): u64 {
    // Verify subscription exists and requester is authorized
    assert!(coordinator.subscriptions.contains(subscription_id), E_SUBSCRIPTION_NOT_FOUND);
    assert!(is_authorized_consumer(coordinator, subscription_id, requester), E_UNAUTHORIZED_CONSUMER);
    assert!(num_words > 0 && num_words <= MAX_NUM_WORDS, E_INVALID_NUM_WORDS);
    assert!(
        vector::length(&callback_data) <= MAX_CALLBACK_DATA_BYTES,
        E_CALLBACK_DATA_TOO_LARGE
    );

    // Check and deduct fee
    let subscription = &mut coordinator.subscriptions[subscription_id];
    assert!(subscription.balance.value() >= coordinator.fee_per_request, E_INSUFFICIENT_BALANCE);

    let fee = subscription.balance.split(coordinator.fee_per_request);
    coordinator.treasury.join(fee);

    let request_id = coordinator.next_request_id;
    coordinator.next_request_id = request_id + 1;

    let request_record = request::new_request(
        subscription_id,
        requester,
        seed,
        num_words,
        callback_data,
        ctx,
    );
    coordinator.requests.add(request_id, request_record);
    request::emit_requested(request_id, &coordinator.requests[request_id]);
    request_id
}

/// Fulfills a randomness request (permissionless).
public fun fulfill_randomness(
    coordinator: &mut Coordinator,
    request_id: u64,
    proof: vector<u8>,
    output: vector<u8>,
    ctx: &mut TxContext
): Coin<IOTA> {
    assert!(coordinator.requests.contains(request_id), E_REQUEST_NOT_PENDING);
    assert!(
        request::status(&coordinator.requests[request_id]) == 0,
        E_REQUEST_NOT_PENDING
    );

    let seed = request::seed(&coordinator.requests[request_id]);
    assert!(
        ecvrf::ecvrf_verify(&output, &seed, &coordinator.vrf_public_key, &proof),
        E_INVALID_PROOF
    );

    let request_record = &mut coordinator.requests[request_id];
    request::mark_fulfilled(
        request_record,
        output,
        tx_context::sender(ctx),
        tx_context::epoch(ctx),
    );
    request::emit_fulfilled(request_id, request_record);

    coin::from_balance(coordinator.treasury.split(coordinator.fulfiller_reward), ctx)
}

public fun request_exists(coordinator: &Coordinator, request_id: u64): bool {
    coordinator.requests.contains(request_id)
}

public fun request_status(coordinator: &Coordinator, request_id: u64): u8 {
    assert!(coordinator.requests.contains(request_id), E_REQUEST_NOT_PENDING);
    request::status(&coordinator.requests[request_id])
}

public fun request_output(coordinator: &Coordinator, request_id: u64): vector<u8> {
    assert_request_fulfilled(coordinator, request_id);
    request::output(&coordinator.requests[request_id])
}

public fun request_callback_data(coordinator: &Coordinator, request_id: u64): vector<u8> {
    assert!(coordinator.requests.contains(request_id), E_REQUEST_NOT_PENDING);
    request::callback_data(&coordinator.requests[request_id])
}

public fun request_fulfilled_at(coordinator: &Coordinator, request_id: u64): u64 {
    assert_request_fulfilled(coordinator, request_id);
    request::fulfilled_at(&coordinator.requests[request_id])
}

public fun request_fulfilled_by(coordinator: &Coordinator, request_id: u64): address {
    assert_request_fulfilled(coordinator, request_id);
    request::fulfilled_by(&coordinator.requests[request_id])
}

public fun treasury_balance(coordinator: &Coordinator): u64 {
    coordinator.treasury.value()
}

fun assert_coordinator_owner(coordinator: &Coordinator, caller: address) {
    assert!(coordinator.owner == caller, E_NOT_COORDINATOR_OWNER);
}

fun assert_subscription_owner(coordinator: &Coordinator, subscription_id: u64, caller: address) {
    assert!(
        coordinator.subscriptions.contains(subscription_id),
        E_SUBSCRIPTION_NOT_FOUND
    );
    assert!(
        coordinator.subscriptions[subscription_id].owner == caller,
        E_NOT_SUBSCRIPTION_OWNER
    );
}

fun assert_request_fulfilled(coordinator: &Coordinator, request_id: u64) {
    assert!(coordinator.requests.contains(request_id), E_REQUEST_NOT_PENDING);
    assert!(
        request::status(&coordinator.requests[request_id]) == 1,
        E_REQUEST_NOT_FULFILLED
    );
}

#[test_only]
public fun destroy_for_testing(coordinator: Coordinator) {
    let Coordinator {
        id,
        owner: _,
        next_subscription_id,
        next_request_id,
        mut subscriptions,
        mut requests,
        fee_per_request: _,
        fulfiller_reward: _,
        treasury,
        vrf_public_key: _,
    } = coordinator;

    let mut i = 0;
    while (i < next_subscription_id) {
        if (subscriptions.contains(i)) {
            let subscription = subscriptions.remove(i);
            let Subscription { owner: _, consumers: _, balance } = subscription;
            balance.destroy_for_testing();
        };
        i = i + 1;
    };

    let mut request_id = 0;
    while (request_id < next_request_id) {
        if (requests.contains(request_id)) {
            request::destroy_for_testing(requests.remove(request_id));
        };
        request_id = request_id + 1;
    };

    subscriptions.destroy_empty();
    requests.destroy_empty();
    treasury.destroy_for_testing();
    id.delete();
}

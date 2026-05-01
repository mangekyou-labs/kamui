module kamui_iota_vrf::demo_consumer;

use kamui_iota_vrf::coordinator;

const E_NOT_CONSUMER_OWNER: u64 = 1;
const E_NO_ACTIVE_REQUEST: u64 = 2;
const E_REQUEST_ALREADY_ACTIVE: u64 = 3;

public struct DemoConsumer has key {
    id: object::UID,
    owner: address,
    subscription_id: u64,
    has_active_request: bool,
    active_request_id: u64,
    last_consumed_request_id: u64,
    last_output: vector<u8>,
    last_callback_data: vector<u8>,
    consumed_count: u64,
}

/// Creates a demo consumer object for a specific subscription.
public fun new(owner: address, subscription_id: u64, ctx: &mut TxContext): DemoConsumer {
    DemoConsumer {
        id: object::new(ctx),
        owner,
        subscription_id,
        has_active_request: false,
        active_request_id: 0,
        last_consumed_request_id: 0,
        last_output: b"",
        last_callback_data: b"",
        consumed_count: 0,
    }
}

/// Creates and shares a demo consumer using the caller as owner.
public entry fun create_demo_consumer(subscription_id: u64, ctx: &mut TxContext) {
    transfer::share_object(new(tx_context::sender(ctx), subscription_id, ctx));
}

/// Requests randomness through the coordinator and tracks the active request locally.
public fun request_randomness(
    consumer: &mut DemoConsumer,
    coordinator_object: &mut coordinator::Coordinator,
    caller: address,
    seed: vector<u8>,
    num_words: u32,
    callback_data: vector<u8>,
    ctx: &mut TxContext,
): u64 {
    assert_owner(consumer, caller);
    assert!(!consumer.has_active_request, E_REQUEST_ALREADY_ACTIVE);

    let request_id = coordinator::request_randomness(
        coordinator_object,
        consumer.subscription_id,
        caller,
        seed,
        num_words,
        callback_data,
        ctx,
    );
    consumer.has_active_request = true;
    consumer.active_request_id = request_id;
    request_id
}

/// Consumes the fulfilled randomness result and stores the latest output locally.
public fun consume_randomness(
    consumer: &mut DemoConsumer,
    coordinator_object: &coordinator::Coordinator,
    caller: address,
) {
    assert_owner(consumer, caller);
    assert!(consumer.has_active_request, E_NO_ACTIVE_REQUEST);

    let request_id = consumer.active_request_id;
    consumer.last_output = coordinator::request_output(coordinator_object, request_id);
    consumer.last_callback_data = coordinator::request_callback_data(coordinator_object, request_id);
    consumer.last_consumed_request_id = request_id;
    consumer.has_active_request = false;
    consumer.active_request_id = 0;
    consumer.consumed_count = consumer.consumed_count + 1;
}

public fun owner(consumer: &DemoConsumer): address {
    consumer.owner
}

public fun subscription_id(consumer: &DemoConsumer): u64 {
    consumer.subscription_id
}

public fun has_active_request(consumer: &DemoConsumer): bool {
    consumer.has_active_request
}

public fun active_request_id(consumer: &DemoConsumer): u64 {
    consumer.active_request_id
}

public fun last_consumed_request_id(consumer: &DemoConsumer): u64 {
    consumer.last_consumed_request_id
}

public fun last_output(consumer: &DemoConsumer): vector<u8> {
    consumer.last_output
}

public fun last_callback_data(consumer: &DemoConsumer): vector<u8> {
    consumer.last_callback_data
}

public fun consumed_count(consumer: &DemoConsumer): u64 {
    consumer.consumed_count
}

fun assert_owner(consumer: &DemoConsumer, caller: address) {
    assert!(consumer.owner == caller, E_NOT_CONSUMER_OWNER);
}

#[test_only]
public fun destroy_for_testing(consumer: DemoConsumer) {
    let DemoConsumer {
        id,
        owner: _,
        subscription_id: _,
        has_active_request: _,
        active_request_id: _,
        last_consumed_request_id: _,
        last_output: _,
        last_callback_data: _,
        consumed_count: _,
    } = consumer;
    id.delete();
}

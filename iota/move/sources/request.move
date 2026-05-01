module kamui_iota_vrf::request;

use iota::event;

public struct RequestRecord has store {
    subscription_id: u64,
    requester: address,
    seed: vector<u8>,
    num_words: u32,
    callback_data: vector<u8>,
    created_at: u64,
    status: u8, // 0=Pending, 1=Fulfilled, 2=Cancelled
    output: vector<u8>,
    fulfilled_at: u64,
    fulfilled_by: address,
}

public struct RandomnessRequested has copy, drop {
    request_id: u64,
    subscription_id: u64,
    requester: address,
    seed: vector<u8>,
    num_words: u32,
}

public struct RandomnessFulfilled has copy, drop {
    request_id: u64,
    output: vector<u8>,
    fulfilled_by: address,
}

/// Creates a new request record to be stored in the coordinator.
public fun new_request(
    subscription_id: u64,
    requester: address,
    seed: vector<u8>,
    num_words: u32,
    callback_data: vector<u8>,
    ctx: &mut TxContext
): RequestRecord {
    RequestRecord {
        subscription_id,
        requester,
        seed,
        num_words,
        callback_data,
        created_at: tx_context::epoch(ctx),
        status: 0, // Pending
        output: b"",
        fulfilled_at: 0,
        fulfilled_by: @0x0,
    }
}

public fun emit_requested(request_id: u64, request: &RequestRecord) {
    event::emit(RandomnessRequested {
        request_id,
        subscription_id: request.subscription_id,
        requester: request.requester,
        seed: request.seed,
        num_words: request.num_words,
    });
}

public fun status(request: &RequestRecord): u8 {
    request.status
}

public fun seed(request: &RequestRecord): vector<u8> {
    request.seed
}

public fun output(request: &RequestRecord): vector<u8> {
    request.output
}

public fun callback_data(request: &RequestRecord): vector<u8> {
    request.callback_data
}

public fun fulfilled_at(request: &RequestRecord): u64 {
    request.fulfilled_at
}

public fun fulfilled_by(request: &RequestRecord): address {
    request.fulfilled_by
}

public fun mark_fulfilled(
    request: &mut RequestRecord,
    output: vector<u8>,
    fulfilled_by: address,
    fulfilled_at: u64,
) {
    request.status = 1;
    request.output = output;
    request.fulfilled_by = fulfilled_by;
    request.fulfilled_at = fulfilled_at;
}

public fun emit_fulfilled(request_id: u64, request: &RequestRecord) {
    event::emit(RandomnessFulfilled {
        request_id,
        output: request.output,
        fulfilled_by: request.fulfilled_by,
    });
}

#[test_only]
public fun destroy_for_testing(request: RequestRecord) {
    let RequestRecord {
        subscription_id: _,
        requester: _,
        seed: _,
        num_words: _,
        callback_data: _,
        created_at: _,
        status: _,
        output: _,
        fulfilled_at: _,
        fulfilled_by: _,
    } = request;
}

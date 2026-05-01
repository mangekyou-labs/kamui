#[test_only]
module kamui_iota_vrf::demo_consumer_tests;

use kamui_iota_vrf::coordinator;
use kamui_iota_vrf::demo_consumer;
use iota::balance;
use iota::coin;
use iota::iota::IOTA;
use iota::test_scenario;

const VRF_PK: vector<u8> = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
const PROOF: vector<u8> =
    x"d8ad2eafb4f2eaf317447726e541359f26dfce248431fe09984fdc73144abb6ceb006c57a29a742eae5a81dd04239870769e310a81046cbbaff8b0bd27a6d6affee167ebba50549b58ffdf9aa192f506";
const OUTPUT: vector<u8> =
    x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8";

#[test]
fun test_demo_consumer_request_fulfill_consume() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, VRF_PK, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(2_000_000, scenario.ctx()),
    );

    let mut consumer = demo_consumer::new(@0xB, subscription_id, scenario.ctx());
    let request_id = demo_consumer::request_randomness(
        &mut consumer,
        &mut coordinator_object,
        @0xB,
        b"Hello, world!",
        1,
        b"round-1",
        scenario.ctx(),
    );

    assert!(request_id == 0);
    assert!(demo_consumer::owner(&consumer) == @0xB);
    assert!(demo_consumer::subscription_id(&consumer) == subscription_id);
    assert!(demo_consumer::has_active_request(&consumer));
    assert!(demo_consumer::active_request_id(&consumer) == request_id);

    let reward = coordinator::fulfill_randomness(
        &mut coordinator_object,
        request_id,
        PROOF,
        OUTPUT,
        scenario.ctx(),
    );
    assert!(balance::destroy_for_testing(reward.into_balance()) == 800_000);

    demo_consumer::consume_randomness(&mut consumer, &coordinator_object, @0xB);

    assert!(!demo_consumer::has_active_request(&consumer));
    assert!(demo_consumer::active_request_id(&consumer) == 0);
    assert!(demo_consumer::last_consumed_request_id(&consumer) == request_id);
    assert!(
        demo_consumer::last_output(&consumer) ==
            x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8"
    );
    assert!(demo_consumer::last_callback_data(&consumer) == b"round-1");
    assert!(demo_consumer::consumed_count(&consumer) == 1);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    demo_consumer::destroy_for_testing(consumer);
}

#[test]
#[expected_failure(abort_code = demo_consumer::E_NOT_CONSUMER_OWNER)]
fun test_demo_consumer_rejects_non_owner_request() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, VRF_PK, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );

    let mut consumer = demo_consumer::new(@0xB, subscription_id, scenario.ctx());
    demo_consumer::request_randomness(
        &mut consumer,
        &mut coordinator_object,
        @0xC,
        b"demo-seed",
        1,
        b"round-1",
        scenario.ctx(),
    );

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    demo_consumer::destroy_for_testing(consumer);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_REQUEST_NOT_FULFILLED)]
fun test_demo_consumer_requires_fulfilled_request_before_consuming() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, VRF_PK, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );

    let mut consumer = demo_consumer::new(@0xB, subscription_id, scenario.ctx());
    let _request_id = demo_consumer::request_randomness(
        &mut consumer,
        &mut coordinator_object,
        @0xB,
        b"Hello, world!",
        1,
        b"round-1",
        scenario.ctx(),
    );

    demo_consumer::consume_randomness(&mut consumer, &coordinator_object, @0xB);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    demo_consumer::destroy_for_testing(consumer);
    abort 42
}

#[test]
#[expected_failure(abort_code = demo_consumer::E_REQUEST_ALREADY_ACTIVE)]
fun test_demo_consumer_rejects_second_active_request() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, VRF_PK, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(2_000_000, scenario.ctx()),
    );

    let mut consumer = demo_consumer::new(@0xB, subscription_id, scenario.ctx());
    let _request_id = demo_consumer::request_randomness(
        &mut consumer,
        &mut coordinator_object,
        @0xB,
        b"Hello, world!",
        1,
        b"round-1",
        scenario.ctx(),
    );

    demo_consumer::request_randomness(
        &mut consumer,
        &mut coordinator_object,
        @0xB,
        b"demo-seed-2",
        1,
        b"round-2",
        scenario.ctx(),
    );

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    demo_consumer::destroy_for_testing(consumer);
    abort 42
}

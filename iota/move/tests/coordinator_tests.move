#[test_only]
module kamui_iota_vrf::coordinator_tests;

use kamui_iota_vrf::coordinator;
use iota::balance;
use iota::coin;
use iota::iota::IOTA;
use iota::test_scenario;

#[test]
#[expected_failure(abort_code = coordinator::E_INVALID_FEE_MODEL)]
fun test_unsound_fee_model_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let coordinator_object = coordinator::new(@0xA, 799_999, 800_000, vrf_pk, scenario.ctx());
    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
fun test_subscription_allowlist() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1000000, 800000, vrf_pk, scenario.ctx());

    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    assert!(coordinator::subscription_owner(&coordinator_object, subscription_id) == @0xB);
    assert!(coordinator::is_authorized_consumer(&coordinator_object, subscription_id, @0xB));
    assert!(!coordinator::is_authorized_consumer(&coordinator_object, subscription_id, @0xC));

    coordinator::add_consumer(&mut coordinator_object, @0xB, subscription_id, @0xC);
    assert!(coordinator::is_authorized_consumer(&coordinator_object, subscription_id, @0xC));

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
}

#[test]
fun test_request_randomness_stores_request_and_debits_fee() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());

    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    let payment = coin::mint_for_testing<IOTA>(2_000_000, scenario.ctx());
    coordinator::fund_subscription(&mut coordinator_object, subscription_id, payment);

    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"round-1",
        scenario.ctx(),
    );

    assert!(request_id == 0);
    assert!(coordinator::request_exists(&coordinator_object, request_id));
    assert!(coordinator::request_status(&coordinator_object, request_id) == 0);
    assert!(coordinator::request_callback_data(&coordinator_object, request_id) == b"round-1");
    assert!(coordinator::subscription_balance(&coordinator_object, subscription_id) == 1_000_000);
    assert!(coordinator::treasury_balance(&coordinator_object) == 1_000_000);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
}

#[test]
fun test_fulfill_randomness_marks_request_and_pays_reward() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());

    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(2_000_000, scenario.ctx()),
    );

    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );

    let proof =
        x"d8ad2eafb4f2eaf317447726e541359f26dfce248431fe09984fdc73144abb6ceb006c57a29a742eae5a81dd04239870769e310a81046cbbaff8b0bd27a6d6affee167ebba50549b58ffdf9aa192f506";
    let output =
        x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8";

    let reward = coordinator::fulfill_randomness(
        &mut coordinator_object,
        request_id,
        proof,
        output,
        scenario.ctx(),
    );

    assert!(coordinator::request_status(&coordinator_object, request_id) == 1);
    assert!(
        coordinator::request_output(&coordinator_object, request_id) ==
            x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8"
    );
    assert!(coordinator::request_fulfilled_by(&coordinator_object, request_id) == @0xA);
    assert!(coordinator::request_fulfilled_at(&coordinator_object, request_id) == 0);
    assert!(coordinator::treasury_balance(&coordinator_object) == 200_000);
    assert!(coin::value(&reward) == 800_000);
    assert!(balance::destroy_for_testing(reward.into_balance()) == 800_000);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
}

#[test]
#[expected_failure(abort_code = coordinator::E_NOT_SUBSCRIPTION_OWNER)]
fun test_non_owner_cannot_add_consumer() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1000000, 800000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::add_consumer(&mut coordinator_object, @0xC, subscription_id, @0xD);
    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_UNAUTHORIZED_CONSUMER)]
fun test_unauthorized_consumer_cannot_request_randomness() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );

    coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xC,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );
    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_CONSUMER_ALREADY_AUTHORIZED)]
fun test_duplicate_consumer_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1000000, 800000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::add_consumer(&mut coordinator_object, @0xB, subscription_id, @0xC);
    coordinator::add_consumer(&mut coordinator_object, @0xB, subscription_id, @0xC);
    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
fun test_remove_consumer() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1000000, 800000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::add_consumer(&mut coordinator_object, @0xB, subscription_id, @0xC);
    assert!(coordinator::is_authorized_consumer(&coordinator_object, subscription_id, @0xC));

    coordinator::remove_consumer(&mut coordinator_object, @0xB, subscription_id, @0xC);
    assert!(!coordinator::is_authorized_consumer(&coordinator_object, subscription_id, @0xC));

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
}

#[test]
fun test_owner_can_rotate_vrf_public_key() {
    let mut scenario = test_scenario::begin(@0xA);
    let original_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let replacement_pk = x"2ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00f";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, original_pk, scenario.ctx());

    coordinator::set_vrf_public_key(&mut coordinator_object, @0xA, replacement_pk);

    assert!(coordinator::vrf_public_key(&coordinator_object) == replacement_pk);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
}

#[test]
#[expected_failure(abort_code = coordinator::E_NOT_COORDINATOR_OWNER)]
fun test_non_owner_cannot_rotate_vrf_public_key() {
    let mut scenario = test_scenario::begin(@0xA);
    let original_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let replacement_pk = x"2ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00f";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, original_pk, scenario.ctx());

    coordinator::set_vrf_public_key(&mut coordinator_object, @0xB, replacement_pk);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_REQUEST_NOT_PENDING)]
fun test_duplicate_fulfill_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 1_000_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(2_000_000, scenario.ctx()),
    );

    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );
    let proof =
        x"d8ad2eafb4f2eaf317447726e541359f26dfce248431fe09984fdc73144abb6ceb006c57a29a742eae5a81dd04239870769e310a81046cbbaff8b0bd27a6d6affee167ebba50549b58ffdf9aa192f506";
    let output =
        x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8";

    let reward = coordinator::fulfill_randomness(
        &mut coordinator_object,
        request_id,
        proof,
        output,
        scenario.ctx(),
    );
    assert!(balance::destroy_for_testing(reward.into_balance()) == 1_000_000);

    let reward = coordinator::fulfill_randomness(
        &mut coordinator_object,
        request_id,
        proof,
        output,
        scenario.ctx(),
    );
    assert!(balance::destroy_for_testing(reward.into_balance()) == 1_000_000);
    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_REQUEST_NOT_FULFILLED)]
fun test_pending_request_output_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );
    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );

    let _output = coordinator::request_output(&coordinator_object, request_id);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_REQUEST_NOT_FULFILLED)]
fun test_pending_request_fulfilled_by_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );
    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );

    let _fulfilled_by = coordinator::request_fulfilled_by(&coordinator_object, request_id);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_REQUEST_NOT_FULFILLED)]
fun test_pending_request_fulfilled_at_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );
    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );

    let _fulfilled_at = coordinator::request_fulfilled_at(&coordinator_object, request_id);

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_INVALID_NUM_WORDS)]
fun test_num_words_limit_enforced() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );

    coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        coordinator::max_num_words() + 1,
        b"",
        scenario.ctx(),
    );

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_CALLBACK_DATA_TOO_LARGE)]
fun test_callback_data_limit_enforced() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(1_000_000, scenario.ctx()),
    );

    let mut callback_data = vector::empty<u8>();
    let mut i = 0;
    while (i <= coordinator::max_callback_data_bytes()) {
        vector::push_back(&mut callback_data, 7);
        i = i + 1;
    };

    coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        callback_data,
        scenario.ctx(),
    );

    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

#[test]
#[expected_failure(abort_code = coordinator::E_INVALID_PROOF)]
fun test_invalid_proof_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let vrf_pk = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let mut coordinator_object = coordinator::new(@0xA, 1_000_000, 800_000, vrf_pk, scenario.ctx());
    let subscription_id = coordinator::create_subscription(&mut coordinator_object, @0xB, scenario.ctx());
    coordinator::fund_subscription(
        &mut coordinator_object,
        subscription_id,
        coin::mint_for_testing<IOTA>(2_000_000, scenario.ctx()),
    );

    let request_id = coordinator::request_randomness(
        &mut coordinator_object,
        subscription_id,
        @0xB,
        b"Hello, world!",
        1,
        b"",
        scenario.ctx(),
    );
    let proof =
        x"d8ad2eafb4f2eaf317447726e541359f26dfce248431fe09984fdc73144abb6ceb006c57a29a742eae5a81dd04239870769e310a81046cbbaff8b0bd27a6d6affee167ebba50549b58ffdf9aa192f507";
    let output =
        x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8";

    let reward = coordinator::fulfill_randomness(
        &mut coordinator_object,
        request_id,
        proof,
        output,
        scenario.ctx(),
    );
    assert!(balance::destroy_for_testing(reward.into_balance()) == 800_000);
    scenario.end();
    coordinator::destroy_for_testing(coordinator_object);
    abort 42
}

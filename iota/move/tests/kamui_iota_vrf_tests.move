#[test_only]
module kamui_iota_vrf::kamui_iota_vrf_tests;

use kamui_iota_vrf::kamui_iota_vrf;
use iota::ecvrf;

#[test]
fun test_verify_valid_vector() {
    // Test vector from IOTA framework crypto tests.
    let output =
        x"4fad431c7402fa1d4a7652e975aeb9a2b746540eca0b1b1e59c8d19c14a7701918a8249136e355455b8bc73851f7fc62c84f2e39f685b281e681043970026ed8";
    let alpha_string = b"Hello, world!";
    let public_key = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let proof =
        x"d8ad2eafb4f2eaf317447726e541359f26dfce248431fe09984fdc73144abb6ceb006c57a29a742eae5a81dd04239870769e310a81046cbbaff8b0bd27a6d6affee167ebba50549b58ffdf9aa192f506";
    assert!(kamui_iota_vrf::verify(&output, &alpha_string, &public_key, &proof));
}

#[test]
#[expected_failure(abort_code = ecvrf::EInvalidHashLength)]
fun test_verify_invalid_hash_length() {
    let output = b"short";
    let alpha_string = b"Hello, world!";
    let public_key = x"1ea6f0f467574295a2cd5d21a3fd3a712ade354d520d3bd0fe6088d7b7c2e00e";
    let proof =
        x"d8ad2eafb4f2eaf317447726e541359f26dfce248431fe09984fdc73144abb6ceb006c57a29a742eae5a81dd04239870769e310a81046cbbaff8b0bd27a6d6affee167ebba50549b58ffdf9aa192f506";
    kamui_iota_vrf::verify(&output, &alpha_string, &public_key, &proof);
}

// NOTE: the off-chain node must use MystenLabs fastcrypto for proof generation.
// The known-good vector above matches IOTA's on-chain verifier and is the baseline
// integration check while the node shells out to fastcrypto CLI.

module kamui_iota_vrf::kamui_iota_vrf;

use iota::ecvrf;

/// Minimal wrapper for test-time validation of IOTA ECVRF verification.
public fun verify(
    output: &vector<u8>,
    alpha_string: &vector<u8>,
    public_key: &vector<u8>,
    proof: &vector<u8>,
): bool {
    ecvrf::ecvrf_verify(output, alpha_string, public_key, proof)
}


Milestone 1: Core Protocol Implementation & Mainnet Deployment
Focus: Porting the contract logic to leverage IOTA's built-in ECVRF SDK and adapting the off-chain Prover for IOTA's event system.
Timeline: 3 Weeks
Deliverables:
IOTA VRF Contracts: Implementation of the VRF coordinator contract includes Subscription and Request/Fulfill logic on IOTA Mainnet.
Key difference: Replaces the current Ristretto Curve verification logic with direct calls to IOTA’s built-in ecvrf_verify module.
IOTA Prover Server: Modification of the local Rust/Node.js Prover to listen to IOTA VRF program events and prove the proofs.
Kamui Integration Guide:  A README documentation that describes how to use the IOTA VRF program to get the randomness for dApps.
Key Performance Indicators (KPIs):
Technical:
[ ] Successful deployment of the Kamui_IOTA contract to Mainnet.
[ ] A demo video that demonstrates a dApp requesting randomness from Kamui successfully on the IOTA mainnet.
[ ] A demo video/README of how to spin up the local prover and request randomness from Kamui successfully on the IOTA testnet.
[ ] Prover listens to the request and processes within <2s latency in the IOTA testnet.
Milestone 2: Report
Focus: Creating a draft grant proposal/report to reflect the complete form of a VRF product. It should tackle the security of the VRF prover on Mainnet as well as request funding for the expenses required to run those nodes on mainnet for 6 months.
Timeline: 1 Week
Deliverables:
A report with future milestones and KPIs
Milestone 3: Community Events
Focus: Ensuring economic sustainability and aggressive marketing.
Timeline: 2 Weeks
Deliverables:
Documentation Portal: A published article on "How to use Kamui in your IOTA Move."
X Post: A long thread to introduce the current VRF problems and Kamui’s competitive advantages, architecture walkthrough, and a link to the published article “How to use Kamui in your IOTA Move.”
X Space: Join a 30-minute X space for an introduction to Kamui to the IOTA community and do Q&A within the time bound.

Milestone 4: Mainnet KPIs
Timeline: 2 weeks
Key Performance Indicators (KPIs):
Technical:
[ ] Handing over the repo to IOTA with a comprehensive README, so that IOTA can highlight it on their side as a sample repo and share it with interested builders.

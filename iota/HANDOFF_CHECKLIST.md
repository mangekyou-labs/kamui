# IOTA VRF Handoff Checklist

Use this checklist before calling the repo handoff complete.

## Deployment Artifacts

- [x] Mainnet package ID pinned: `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`
- [x] Mainnet coordinator object ID pinned: `0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc`
- [x] Publish digest pinned: `2aUubEafHMXdrgoe5feTfKmJkozPVeGnqQA5mzzArzkf`
- [x] Coordinator creation digest pinned: `ELTY6msVVQznjQ4UGnD8rwFMnkdJ5wxB1CH4v9qXRAgi`
- [x] Real demo flow digests pinned in repo docs

## Runtime Packaging

- [x] Node Docker image builds the vendored `fastcrypto` tree pinned at `c141d4c2d52efe18d2b9193b071fdc188411da3b`
- [x] Default Compose path keeps ops endpoints private
- [x] Public ops exposure requires the explicit override file
- [x] Mainnet config template documents env/file secret loading
- [x] Mainnet config template documents command-based KMS/vault secret loading

## Validation Commands

- [x] `cd iota/move && iota move test`
- [x] `cd iota/node && npm test`
- [x] `docker compose -f iota/docker/docker-compose.yml config`
- [x] `docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml config`

## Runbooks

- [x] Mainnet operator config: [MAINNET_NODE_CONFIG.md](/Users/kyler/repos/kamui/iota/MAINNET_NODE_CONFIG.md)
- [x] Mainnet publish runbook: [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md)
- [x] Demo walkthrough: [DEMO.md](/Users/kyler/repos/kamui/iota/DEMO.md)
- [x] Integration guide: [INTEGRATION.md](/Users/kyler/repos/kamui/iota/INTEGRATION.md)
- [x] Troubleshooting guide: [TROUBLESHOOTING.md](/Users/kyler/repos/kamui/iota/TROUBLESHOOTING.md)
- [x] KMS/vault setup guide: [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md)

## Optional Follow-Up

- [ ] Replace CLI-based command sourcing with first-party cloud SDK integrations if you need in-process secret refresh or provider-native auth/error handling

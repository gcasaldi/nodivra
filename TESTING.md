# Testing NODIVRA

The test suite uses Node.js's built-in test runner and **never makes a live blockchain request**. It mocks public indexer and RPC responses to check handling of known data, empty results and provider failures.

Run from the repository root:

```bash
npm test
```

To test the real website (manual, not yet signed off):

1. Open the [public preview](https://gcasaldi.github.io/nodivra/) in a browser.
2. Paste a known, active Ethereum address and look for native balances or indexed assets. Compare the explorer link.
3. Run a one-hop incoming investigation, then two hops. Open the transaction hash for at least one graph edge.
4. Check a valid but inactive address. NODIVRA must show *unknown* or *not indexed* instead of inventing an owner.
5. Check a BTC address and a Solana address. Their network-specific summaries should load or explain rate limits.
6. Turn off the connection or simulate API failure. The UI must not report zero transactions based on missing data.
7. Export a dossier and verify that the included sources, chain and evidence IDs agree with the interface.

**Scope warning:** This beta does not verify real-world wallet ownership, follow arbitrary fund laundering, or merge identifiers across chains without independently documented evidence.

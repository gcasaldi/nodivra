# Graph-first wallet investigation — test log

Test input: \`0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\` (public Ethereum wallet used as a smoke-test starting address, **not** a suspected illicit wallet).

## What I actually built

- A searched EVM wallet opens the CONNECT graph directly, regardless of whether the separate balance lookup succeeds.
- Click/touch/keyboard-select an observed address to look up its own public transfers while retaining previous, separately sourced graph edges.
- Back, breadcrumb path, return to starting wallet, 1/2-hop depth, EVM chain selector, zoom and selected wallet/transaction details.
- Source-linked native and ERC-20 transfer edges; dedicated transfer evidence list; export of collected observations to JSON.
- A constrained Ethereum wallet lookup fallback adds real indexed successful transfers if the richer graph endpoint fails; never a fabricated relationship inferred from an address label or balance.
- Public tags are visually distinguished and explicitly described as **unverified**.
- Bitcoin and Solana still have limited address snapshots, **not** this transfer-drilldown workflow. No speculative cross-chain edges.

## Mock validation (synthetic transactions, not live facts about the example wallet)

| Case | Expected result | Status |
|---|---|---|
| Search example address | Graph module opens and requests address + both directions + 1 hop | Simulated check passed |
| A → B, click B, then B → C | Two separately indexed transfer edges; no invented A → C edge | Simulated check passed |
| Back to A | Navigation restored; previous evidence retained | Simulated check passed |
| Backend returns HTTP 429 | Clear provider error, no fabricated links | Simulated check passed |
| Ethereum wallet lookup has one successful and one failed tx | Only the successful indexed transfer is added to fallback graph | Simulated check passed |
| Switching EVM network | Clear old network evidence before retrieving new chain | Implemented + mock test |
| Start a different case | Clear previous case history and transaction links | Implemented + mock test |
| Static integrity | No missing map element IDs, correct script order, JS syntax valid | Passed |
| GitHub Pages | Deployment of the modular map code on main branch | Succeeded per GitHub Actions |

Automated mock tests are in \`tests/map.test.mjs\` and \`tests/modules.test.mjs\`. The mock connections in those tests are **synthetic**, even though the initial test address is a real public Ethereum address.

## Live acceptance test — **still pending**

This environment couldn't successfully call the hosted Pages URL, the Cloudflare Worker endpoint, or Blockscout for end-to-end transaction verification. The deployed frontend and backend have **not** been tested together through a real browser session against the example wallet.

The live test must verify:

1. Open \`https://gcasaldi.github.io/nodivra/?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\`.
2. Confirm the app automatically opens **CONNECT** and resolves public transfer edges from the real API rather than a synthetic fixture.
3. Select a visible neighboring wallet and check that the new query returns a verifiable transaction hash on the same chain.
4. Verify **Back**, **Starting wallet**, a different EVM network and **Export map JSON**.
5. Check Android narrow-screen layout and accessibility using a real mobile browser.
6. Exercise genuine 429/timeout conditions. An empty graph or provider outage must never be described as a zero-activity wallet.
7. Compare what the app displays with the original transaction explorer, including success state, token contract and source links.

A good UX is not enough: the graph is only credible if each displayed edge is backed by a source transaction. No five-case operational incident benchmark has been completed.

## Known limits

This is a read-only public beta. The graph only shows observed, sampled transaction links, not asset conservation, criminal involvement, confirmed wallet ownership, or a certified case chain of custody. Ethereum and other supported EVM chains can be selected, but Bitcoin, Solana, Tron and cross-chain path tracing still need separate implementations and real-world validation.

## Screenshot incident — 2026-10-31

The Android screenshot showed the EVM wallet map for `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` with zero fetched edges, **HTTP 429** on the public indexer and **HTTP 503** from the graph gateway. These are provider errors, not proof the wallet has zero transfers.

### Mitigations applied

- Graph-only initial lookup, with research labels, additional EVM network scans and Ethereum metadata moved to explicit actions in CORRELATE. This removes the simultaneous fanout of many indexer requests.
- Routescan keyless Etherscan-compatible API as a read-only secondary transaction index when both Blockscout trace endpoints are unavailable. Strict address/hash/execution validation before creating edges.
- One-first-page-per-address provider lookups and edge response caching for 10 minutes in the Worker edge cache, when the cache API is available.
- Explicit source provenance in graph responses, HTTP 429/503 treated as unavailable, never a fabricated zero-activity finding.
- Original transaction links, optional Etherscan manual cross-check and visible provider source in graph status.

Routescan's free keyless tier has a strict per-second quota and may still be unavailable or rate-limited. Its stated terms request a **Powered by Routescan.io APIs** link, now included in the UI.

### Acceptance status

- GitHub Pages: current frontend deployed successfully according to GitHub Actions.
- Cloudflare API Worker: new code upload accepted (HTTP 200).
- Simulated mock: Blockscout 429 + Routescan valid transaction returns a source-linked edge; failed or invalid entries are excluded.
- **Still not verified end-to-end against live provider data:** the connected runtime cannot access external API hosts for an independent test. The Android user must be able to obtain verifiable edges in the real browser before we can close the incident.

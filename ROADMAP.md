# Roadmap

I want NODIVRA to be a practical intelligence tool, not just another wallet explorer.

The question I want it to answer is simple: **what can I actually find out about this wallet, and what evidence supports it?**

## The one problem I want to solve

I don't need another blockchain explorer. Arkham, GraphSense, Breadcrumbs and Chainalysis already trace wallets, show graphs and identify public services. I won't call those features unique.

**My goal: turn a reported crypto loss into the first evidence-backed action an investigator can take.**

The input should be as small as possible: **a transaction hash or an address, an approximate amount, and a date**.

The output should answer three questions:

1. **Where can I actually trace the reported funds?** Show time-ordered, chain-specific, sourced transfers; distinguish direct transfers from uncertain fund-flow heuristics.
2. **What's the first actionable lead?** For example, a publicly tagged exchange address *with a linked transaction* — not an invented owner or an unsupported allegation.
3. **What can I prove, what is only plausible, and where did the trail stop?** Explain missing records, swaps, bridges, provider outages and alternative interpretations. Export a compact, independently checkable case report.

This is the **Evidence-to-Action / Claim Checker** idea. It is a product hypothesis, **not a feature I've finished**. I won't claim it is unprecedented: professional tools already automate much of this. Our possible differentiation is a compact, transparent, openly auditable workflow that makes evidence gaps and the next lawful investigative step explicit.

### What would convince me to use NODIVRA

- [ ] Run at least **five public, independently documented crypto-theft cases** end to end, keeping exact transaction hashes and ground truth in a reproducible benchmark.
- [ ] For each case, either produce **at least one traceable, source-backed investigative lead** or explicitly conclude **no verified lead** without inventing a path.
- [ ] Check chronology, chain, token type, amount, transaction success, provider coverage and competing interpretations. Do not treat two connected addresses as proof that the same coins moved.
- [ ] Include the first clearly sourced service touchpoint when one exists, or show exactly why it cannot be established.
- [ ] Generate a **one-page readable finding** and machine-readable evidence bundle with original hashes, source timestamps, data versions and limitations.
- [ ] Compare against a **manual explorer workflow and a competing public tool**; measure time saved, accuracy, false positives and unverified labels. If we cannot demonstrate a meaningful advantage, narrow the project instead of adding more datasets.

**Stop rule:** no more dataset integrations, decorative dashboards or generic features until a real case passes this test. Public beta capabilities below are building blocks, not a finished investigative product.

## What I've built

- [x] Search public activity on Ethereum, Base, Arbitrum, Optimism, Polygon, Bitcoin and Solana.
- [x] Add on-demand historical FuseChain research lookup for Ethereum addresses with explicit label and source limitations.
- [x] Add an offline graph-edge analyzer for the Elliptic Bitcoin research benchmark; it is not an address-to-identity database.
- [x] Add a selective CSV preparation script for the large Ethereum research dataset (no automatic 92 GB download).
- [x] Start from an EVM transaction hash on a selected network and follow its sender or recipient.
- [x] Search public ENS names using a possible name or surname, with clear evidence and uncertainty labels.
- [x] Cache public search results and stagger cross-chain requests to reduce upstream rate-limit bursts.
- [x] Show native balances and indexed tokens where the public APIs allow it.
- [x] Follow native and token transfers up to two hops on EVM networks.
- [x] Visualize connected addresses and open the original transaction evidence.
- [x] Check public names and labels, keeping their sources and uncertainty visible.
- [x] Turn observed counterparties into prioritized leads with transaction links and source-tag warnings.
- [x] Export a JSON investigation dossier with optional case notes kept only in the browser session.
- [x] Add clear messages when an API is unavailable or an address has no indexed activity.

## What I'm improving now

- [ ] Test the complete live website and API with several real wallets across networks.
- [x] Add independent RPC balance/type fallback on five EVM networks when indexers refuse requests.
- [ ] Complete rate-limit handling and transaction pagination; an RPC balance alone does not supply a history.
- [ ] Add verified public-profile cross-checks for name-to-wallet attribution, without treating matching ENS names as proof of identity.
- [ ] Improve token classification and filter obvious spam tokens without hiding evidence.
- [ ] Make the tracing graph easier to navigate on mobile.
- [ ] Add more automated tests for cross-chain data, dataset lookup behavior and unusual transactions.
- [ ] Validate real HF filtered queries and provider availability; do not claim live research coverage until tested.

## What I'd love to build next

- [ ] Follow Bitcoin UTXOs and Solana transactions with chain-specific investigation logic.
- [ ] Recognize bridges, exchange deposit services, contracts and swaps without inventing ownership links.
- [ ] Trace longer histories with careful limits and clear data coverage.
- [ ] Compare multiple independently confirmed attribution sources and show why an entity label can be trusted.
- [ ] Validate real investigation scenarios with external experts; a beta is not a police-grade forensic system.
- [ ] Export a shareable, source-backed PDF report and add case workspaces.
- [ ] Explore AI-assisted summaries that cite evidence rather than guessing.

## One rule I won't compromise on

A wallet address isn't a person's name. A transfer isn't proof of shared ownership. And a public label isn't automatically true.

If I can't verify something, **NODIVRA should say so**.

If you have an idea, found a bug, or want to collaborate, please [open an issue](https://github.com/gcasaldi/nodivra/issues) or read [CONTRIBUTING.md](CONTRIBUTING.md).

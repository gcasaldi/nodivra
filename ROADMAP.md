# Roadmap

I want NODIVRA to be a practical intelligence tool, not just another wallet explorer.

The question I want it to answer is simple: **what can I actually find out about this wallet, and what evidence supports it?**

## What I've built

- [x] Search public activity on Ethereum, Base, Arbitrum, Optimism, Polygon, Bitcoin and Solana.
- [x] Show native balances and indexed tokens where the public APIs allow it.
- [x] Follow native and token transfers up to two hops on EVM networks.
- [x] Visualize connected addresses and open the original transaction evidence.
- [x] Check public names and labels, keeping their sources and uncertainty visible.
- [x] Export a JSON investigation dossier.
- [x] Add clear messages when an API is unavailable or an address has no indexed activity.

## What I'm improving now

- [ ] Test the complete live website and API with several real wallets across networks.
- [ ] Make the API fallbacks, pagination and rate-limit handling more reliable.
- [ ] Improve token classification and filter obvious spam tokens without hiding evidence.
- [ ] Make the tracing graph easier to navigate on mobile.
- [ ] Add more automated tests for cross-chain data and unusual transactions.

## What I'd love to build next

- [ ] Follow Bitcoin UTXOs and Solana transactions with chain-specific investigation logic.
- [ ] Recognize bridges, exchange deposit services, contracts and swaps without inventing ownership links.
- [ ] Trace longer histories with careful limits and clear data coverage.
- [ ] Compare multiple public attribution sources and show why an entity label can be trusted.
- [ ] Export a shareable, source-backed PDF report and add case workspaces.
- [ ] Explore AI-assisted summaries that cite evidence rather than guessing.

## One rule I won't compromise on

A wallet address isn't a person's name. A transfer isn't proof of shared ownership. And a public label isn't automatically true.

If I can't verify something, **NODIVRA should say so**.

If you have an idea, found a bug, or want to collaborate, please [open an issue](https://github.com/gcasaldi/nodivra/issues) or read [CONTRIBUTING.md](CONTRIBUTING.md).

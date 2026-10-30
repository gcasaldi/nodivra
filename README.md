# NODIVRA

**Open-source blockchain intelligence. Follow the funds. Check the evidence.**

I started NODIVRA because I kept seeing wallet addresses in crypto investigations, but finding out what actually happened meant jumping between explorers and long lists of transactions.

I wanted one place to start: enter an address or an EVM transaction hash, see where it appears, follow the transfers, check the public labels, and keep track of what I can *actually* verify.

The current version searches Ethereum, Base, Arbitrum, Optimism, Polygon, Bitcoin and Solana for publicly indexed activity. On EVM networks, the investigation engine also follows native and token transfers up to two hops, shows the relationships in a visual graph, and helps identify practical next steps: which transactions to check, which publicly labelled services need independent verification, and where the trail becomes uncertain. You can export a source-backed case dossier.

NODIVRA is **not** a way to magically reveal who owns an anonymous wallet. If there isn't a reliable public attribution, I want it to say **unknown**.

**[Try NODIVRA](https://gcasaldi.github.io/nodivra/)** · **[Roadmap](ROADMAP.md)** · **[Contribute](CONTRIBUTING.md)**

I’d love to build this with others. If you work with blockchain, OSINT, cybersecurity or data visualization, feel free to open an issue or share an idea.

*Status: public beta. The first investigation tools are implemented, but live-browser testing, provider reliability and deeper cross-chain tracing still need work.*

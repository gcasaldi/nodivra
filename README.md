# NODIVRA

**Open-source crypto incident triage. Find the first verifiable investigative step.**

I started NODIVRA because I kept seeing wallet addresses in crypto investigations, but finding out what actually happened meant jumping between explorers and long lists of transactions.

I wanted one place to start: start with a public name, an ENS alias, an address or an EVM transaction hash, see what can actually be verified, follow the transfers, check the public labels, and keep track of what I can *actually* verify.

The interface is split into five clear modules — **INVESTIGATE, CORRELATE, CONNECT, RECOMMEND, REPORT**. Each module shows the observations the beta actually supports, and distinguishes unavailable functions from verified evidence. The modular UI changes the analyst workflow; it does not claim unsupported Bitcoin/Solana or cross-chain transaction tracing.

The **Incident Triage beta** starts from an EVM transaction hash, checks whether execution succeeded, examines the original native/ERC-20 transfers, and looks for chronologically later same-asset transactions in a bounded sample. It recommends the first source-backed verification step and exports a short report. This is not proof of fund continuity or wallet ownership.

The current version searches Ethereum, Base, Arbitrum, Optimism, Polygon, Bitcoin and Solana for publicly indexed activity. The Ethereum wallet view also queries **FuseChain's historical research classifications** on Hugging Face through a read-only filtered lookup; it never turns a research label into a claim about a person or current criminal activity. On EVM networks, the investigation engine also follows native and token transfers up to two hops, shows the relationships in a visual graph, and helps identify practical next steps: which transactions to check, which publicly labelled services need independent verification, and where the trail becomes uncertain. You can export a source-backed case dossier.

The public name search checks registered ENS-domain matches and suggests independent checks for public wallet disclosures. An ENS name that resembles someone's name is **not** evidence that the person owns it.

NODIVRA is **not** a way to magically reveal who owns an anonymous wallet. If there isn't a reliable public attribution, I want it to say **unknown**.

**[Incident triage](docs/INCIDENT-TRIAGE.md)** · **[Research datasets](docs/DATASETS.md)** · **[Try NODIVRA](https://gcasaldi.github.io/nodivra/)** · **[Roadmap](ROADMAP.md)** · **[Contribute](CONTRIBUTING.md)**

I’d love to build this with others. If you work with blockchain, OSINT, cybersecurity or data visualization, feel free to open an issue or share an idea.

*Status: public beta. The first investigation tools are implemented, but live-browser testing, provider reliability and deeper cross-chain tracing still need work.*

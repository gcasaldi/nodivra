# NODIVRA — cross-chain discovery (beta)

The public gateway supports read-only wallet intelligence across a bounded set of blockchain networks.

- \`GET /multichain?address=0x...\` searches **Ethereum, Base, Arbitrum One, OP Mainnet, Polygon PoS** via the corresponding community Blockscout explorers. It returns per-chain source status, native asset balance, token holdings where indexed, recent transaction samples, and sourced public names.
- \`GET /multichain?address=bc1...\` (also legacy Bitcoin address prefixes) uses **mempool.space**, returning confirmed transaction count, address-level BTC balance in satoshis, and recent transactions.
- Existing \`/lookup\`, \`/origin\` and \`/resolve\` endpoints remain for Ethereum investigative detail and ENS names.

- `GET /multichain?address=<Solana base58 address>` queries **Solana mainnet** via a rate-limited public JSON-RPC endpoint, retrieving SOL balance, SPL + Token-2022 accounts and recent signatures. Mint addresses are shown without unverified token brand symbols.

An address by itself has no globally unique owner record, even across EVM chains. Indexed token lists can contain spam or counterfeit symbols. Native and token balances are not added into an unreliable portfolio valuation. Each source may be rate-limited, restricted or offline; NODIVRA marks unavailable results separately from zero activity.

No transaction submission, private key, or account login is supported. Never use the tool to assume that two addresses belong to the same owner or that a community label is a verified person.

References:
- https://github.com/blockscout/blockscout-api-v2-swagger
- https://mempool.space/docs/api/rest
- https://developer.arbitrum.io/arbitrum-essentials/reference/monitoring-tools-block-explorers

# Attribution & Investigation Engine (beta)

Read-only on-chain investigation across Ethereum, Base, Arbitrum, Optimism and Polygon.

### API
\`GET /investigate?address=0x...&network=ethereum&direction=in&depth=2\`

- \`network\`: ethereum / base / arbitrum / optimism / polygon.
- \`direction\`: in (sources), out (destinations), both.
- \`depth\`: 1 or 2 hops.

Returns a bounded evidence graph with addresses (nodes) and transfers (edges). Each edge includes chain, direction, transaction hash, token type or native coin, amount in token/native units, time where indexed, hop number, and a verifiable explorer URL. Token transfer and native transfers are separate; the graph makes no inference about common ownership.

### OSINT labels
Blockscout's publicly listed address/ENS labels are consulted for the subject and up to four first-hop counterparties. On Ethereum, an optional community label database (eth-labels) is attempted as a second source. Every label is recorded with provenance. None proves a legal identity. The tool doesn't attempt private KYC, phishing, deanonymization by deception, or unauthorized account access.

### Explicit caps
- 2 hops, up to 4 expanded counterparties and up to 3 qualifying second-hop leads per expanded node.
- 50 evidence edges; 20 address nodes; only the most recent API page on each visited address.
- Partial provider errors are visible. Missing results do *not* imply absence of activity.
- Smart contracts, bridges, exchanges, mixers, swaps and internal calls are not accurately represented by naïve multi-hop adjacency.

### Reporting
The client exports an evidence dossier as JSON, including original transaction hashes, source URLs, sample limits, flags and uncertainty. It does not infer guilt, exact residence, real-world identity or entity control from an address. Users should independently verify the source hashes.

### Source
[Blockscout API v2](https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml). These APIs provide transaction and token transfer history with direction filters, subject to public endpoints and limits.

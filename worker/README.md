# NODIVRA read-only gateway

The website uses a small Cloudflare Worker to request public Ethereum data from Blockscout. This avoids relying entirely on cross-origin browser access.

- \`GET /health\`: confirm the gateway is available.
- \`GET /lookup?address=0x...\`: public account data, recent external transactions, recent token and internal transfers, and an observed counterparty summary.
- \`GET /origin?address=0x...\`: bounded pagination of external transactions to find the earliest observed native-ETH funding transaction. This may be partial.

No API key or private wallet information is needed. Endpoints only accept Ethereum addresses and never sign or submit transactions. The front end shows the data source and limitations.

## Deployment

The current worker runs on Cloudflare under \`nodivra-api.gcasaldi.workers.dev\`. The source is kept in \`worker/worker.js\` for review and contributions.

Public Blockscout APIs can become unavailable or rate limited. Evidence must be independently verified before using it for attribution.

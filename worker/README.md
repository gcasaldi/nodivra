# NODIVRA public intelligence gateway

An independent read-only Cloudflare Worker used by the [NODIVRA web explorer](https://gcasaldi.github.io/nodivra/).

### Data sources
- **Blockscout Ethereum API** — indexed account metadata, external transactions, token/internal transfers, public name tags, ENS reverse names, contract details.
- **Ethereum JSON-RPC (PublicNode, dRPC fallback)** — live Ethereum balance, account nonce and code to distinguish contracts vs EOAs, when the indexed account endpoint is unavailable.
- **eth-labels open dataset** — community name tags and classifications; the source is attributed and labels are expressly marked *unverified*. MIT licensed code; source: https://github.com/dawsbot/eth-labels.

### Routes
- \`GET /health\` — confirms deployment.
- \`GET /lookup?address=0x...\` — separate source statuses, wallet metadata, recent transfers and public evidence labels.
- \`GET /origin?address=0x...\` — *bounded* oldest observed external transactions, not proof of true origin.
- \`GET /resolve?name=example.eth\` — ENS forward lookup via Blockscout.

### Important limits
Addresses are pseudonymous. A name tag can refer to a smart-contract project, exchange service, brand or a self-declared ENS name; **none proves the real-world legal owner**. Personal KYC data is not publicly accessible.

The transaction lists are sampled and providers can rate-limit or temporarily fail. If no index is available, the UI must display "unavailable", never invent zero transactions or an identity. The code performs no transaction signing, wallet connection or private data access.

## Intelligence brief (beta)

`GET /lookup` includes `intelligence`, `provenance` (earliest incoming **in the sampled data**), and `linked_entities` (up to four directly connected addresses enriched from Blockscout). The UI renders a source-aware summary and exports a JSON evidence report. It does **not** expose KYC, claim real-world owners, or infer common ownership from wallet transfers.

The `/origin` bounded historical scan is a separate, explicitly requested action to limit public-provider load.

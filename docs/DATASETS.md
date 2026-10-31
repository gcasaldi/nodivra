# Research datasets in NODIVRA

I only want datasets here when they help answer a real investigative question, and I want their limitations to be visible.

## FuseChain — historical Ethereum research labels (beta API integration)

- Source: https://huggingface.co/datasets/Nileshka/fusechain-data
- Publisher-reported license: MIT
- 35,272 Ethereum EOA records; historical 2017–2021 snapshot.
- Live integration: NODIVRA `GET /research-labels?address=0x...` uses the public Hugging Face Dataset Viewer **filtered lookup** (not bulk downloads).
- The UI can show a historical research class for an exact wallet match. **Neither class is a current trust score, evidence of criminal activity, or a human identity.**
- Social features are global/community time-series aggregates; they must NOT be presented as social activity by a wallet owner.
- If the public filter is rate-limited, unavailable or only partial, we display **unavailable**. An address absent from the sample is not "safe".
- Viewer filter documentation: https://huggingface.co/docs/dataset-viewer/filter

## Ethereum Fraud Dataset by Activity — offline/selective preparation

- Source: https://huggingface.co/datasets/fesevu/ethereum_fraud_dataset_by_activity
- Publisher-reported license: CC BY 4.0. Upstream component licenses and attribution still require review before redistribution.
- Around 1.62 billion Ethereum transactions, roughly 92.3 GB total; 115k-address balanced label file is documented.
- Deliberately **not** imported into GitHub Pages or Worker memory.
- `scripts/prepare_ethereum_labels.py` accepts a *locally obtained authorized copy* of `addr_labels_balanced.csv`, validates fields, normalizes flags and emits a bounded research index and SHA-256 manifest.
- This is an *offline preparation tool*, not a deployed address-label database. No public-address row has been imported into the production backend yet.
- Scam/non-scam labels come from merged historical sources and have unknown noise rates; no automatic guilt or exoneration claims.

## Elliptic Bitcoin dataset — offline evaluation benchmark

- Source: https://huggingface.co/datasets/edisonlin2002/elliptic-bitcoin-dataset
- Publisher-reported license: MIT; original Elliptic paper should be cited.
- 203,769 transaction nodes and their edge list, with illicit / licit / unknown research classes.
- IDs in the graph are **research transaction identifiers**, not known Bitcoin wallet owners.
- Appropriate for testing graph algorithms and measuring false positives, **not** for looking up an arbitrary BTC wallet or individual.

## Release rules

1. An address must match exactly; no guessing.
2. Every label needs a source, timeframe, dataset license and a clear uncertainty statement.
3. "No match", "rate-limited", "missing" and "verified label" are different states.
4. Research labels are excluded from automated person-attribution and real-time accusation scores.
5. Reuse of original datasets is subject to their actual data rights, not just the wrapper repository license.

The investigation tool is still a **public beta**. Full source-independent production validation, robust rate-limit handling, and forensic chain-of-custody workflows remain open.

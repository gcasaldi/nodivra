# Incident Triage (Evidence-to-Action beta)

I built this first-response workflow because another graph of wallet addresses isn't enough. I want to help an investigator decide **which fact to verify next**.

## How to use it

Paste a complete EVM transaction hash and select Ethereum, Base, Arbitrum, Optimism or Polygon. The tool checks execution, the original native/ERC-20 transfer events, and a recent sample of outgoing activity from up to two observed recipients.

The output is intentionally short: **what can be established, what the first verification step is, what the evidence links are, and where coverage stops**. The user can add local case notes and export a text brief or JSON.

## What it does not establish

- A later transfer of the same asset is **not proof** that those exact stolen funds moved onward.
- Public labels are not owner identities, guilt assessments or independently verified service classifications.
- There is no full historical pagination; only a bounded recent page is checked for at most two recipients.
- A successful contract call can move funds through internal calls or token events that this first iteration does not reconstruct.
- Bitcoin UTXO analysis, Solana instructions, swaps, bridges, cross-chain paths and fund conservation are not supported in this initial incident engine.
- The report is an investigative starting point, not a certified chain-of-custody artifact.

## Validation still required

Real provider tests and at least five independently documented incidents with original transaction hashes, evidence links and known expected outcomes. Compare findings against manual explorer work and competing public tooling. Document false positives before calling this suitable for operational investigations.

Source API: https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml

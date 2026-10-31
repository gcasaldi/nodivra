# UI reference: Velociraptor (Velocidex)

Reference: https://github.com/Velocidex/velociraptor

I examined the project and its React GUI architecture. Velociraptor is an endpoint incident response tool: it queries hosts, collects forensic artifacts and manages hunts through a dedicated service and its own client agents. It does **not** provide a crypto transaction database or on-chain address attribution.

## Adapted design patterns — original code

- Console-style navigation: every investigation module is discoverable.
- Informative status tiles and source coverage, not decorative counters.
- Compact, legible panels with contrast and functional status colors.
- Local action log and a specific wallet inspector with source-linked evidence.
- A deliberate hierarchy: search → map → source check → actionable next step → report.

## Not imported

No Velociraptor source code, binaries, endpoint collectors, VQL artifacts, frontend components or logos have been copied into NODIVRA. Its main repository is licensed AGPLv3, and incorporating that code would raise license compatibility obligations. More importantly, its server/client stack is unrelated to public blockchain investigation and needs separate deployment, credentials and operations.

This is a **design inspiration only**, not an integration or dependency. NODIVRA remains a separate original open-source app. A genuine endpoint-artifact import might make sense in a future separate DFIR integration with user authorization and careful licensing/security review.

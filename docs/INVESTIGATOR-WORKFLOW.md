# NODIVRA · Investigator workflow

I want NODIVRA to save time during the first stages of an on-chain investigation.

1. **Search an address** across the supported networks and check whether data is indexed or only available through RPC.
2. **Trace public transfers** on an EVM network, selecting direction and one or two hops.
3. **Review the leads**: each first-hop counterparty includes transaction evidence, any sourced public label, and a suggested verification step.
4. **Explore connections** by clicking through to the counterparty and opening the original transfer hash. Expand the network graph only when useful.
5. **Document the case**: write local-only notes and export a JSON dossier of the publicly indexed transactions, sources, limitations and observations.

There are no automatic accusations or verified legal owners. An exchange tag is a clue to be verified, not proof that the exchange owns or operated the wallet. Private subscriber records generally need the relevant service's cooperation and lawful process.

**Current scope:** EVM native/token transfers only for the lead engine; maximum two hops and a bounded first page of recent transfers. Bitcoin and Solana have preliminary discovery, not equivalent forensic tracing. The public APIs may rate-limit or become unavailable. Browser and real-world validation are ongoing.

This export is not a certified chain-of-custody record and is not a substitute for specialist forensic examination.

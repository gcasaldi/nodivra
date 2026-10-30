# Public Name Search — OSINT Beta

I wanted NODIVRA to support a common real-world starting point: sometimes I have a name, a surname, or a public alias rather than a wallet address.

The public search looks for **registered ENS names** using an independent open index. Results are only **possible leads**. A name resembling a person doesn't mean the person owns that ENS name or its linked wallet.

The workflow is: enter a possible name → review public ENS candidates → open the original ENS record → resolve the currently published wallet address → check authenticated public disclosures → investigate on-chain transactions if there is evidence.

- Data source: [ENSWhois public index](https://docs.enswhois.com/api/domains), `GET /api/search-domains?q=...`.
- Endpoint: `GET /name-search?q=...`, read-only, cached public results.
- Availability: unauthenticated provider requests are rate-limited; this is a best-effort search, not a global registry of people or wallets.
- Name search does **not** scrape private profiles, bypass identity protections, or claim an individual's legal wallet ownership.
- Public search links open user-controlled browsers for independent checks; they are not automatically validated.

For investigations involving real people, document where any claimed wallet was publicly self-disclosed and when, and preserve the original source. Unverified name matches must not be elevated to factual attribution.

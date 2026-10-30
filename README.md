# NODIVRA

**Blockchain forensics, built around one simple question: where did this wallet come from?**

## Why I'm building this

Every time I read about a crypto theft, I see the same thing: millions of dollars moving between wallet addresses that anyone can look up. The transactions are public, but the people behind them often aren't.

That made me curious. If we can follow the money, how far back can we go? Where did a wallet receive its first funds? Did those funds come from an exchange, another wallet, or a service that makes tracing harder?

I started NODIVRA to explore those questions and make the investigation easier to follow, even if you're not a blockchain expert.

## What is NODIVRA?

NODIVRA is a blockchain forensics project focused on tracing the history of crypto wallets and finding **verifiable connections**, not guessing who owns them.

The idea is to enter a wallet address and work backwards: follow its transactions, understand where the funds came from, see how addresses are connected, and check whether any of those connections lead to publicly known services or entities.

A wallet can be created without registering anywhere, so there isn't always a real name to find. I want NODIVRA to be clear about that. Sometimes the answer will be a useful lead. Sometimes it will simply be **unknown**.

## What I want it to do

- **Find the starting point.** Look at a wallet's earliest activity and identify its first visible funding transaction.
- **Follow the funds.** Trace transfers backwards and forwards across connected addresses.
- **Show the connections.** Turn transaction histories into a visual map that's easier to investigate.
- **Recognize known entities.** Highlight exchanges, smart contracts, and services when there is a reliable public source for the label.
- **Look for patterns.** Flag unusual activity that could be worth reviewing, without treating it as proof of wrongdoing.
- **Check possible attribution.** Bring together public blockchain data and open-source information, with a source and confidence level for every claim.
- **Keep the evidence.** Produce a readable report showing what was found, where it was found, and what still needs verification.

## Why this matters

Blockchain transparency is useful, but a list of transactions doesn't automatically explain a case. One address might lead to dozens of others. An exchange can be visible on-chain while its customers' identities remain private. A mixer can make the path harder to follow.

I want a tool that helps separate **what we know** from **what we think**.

NODIVRA isn't meant to expose private information or magically reveal the owner of any wallet. The goal is to help people investigate public evidence responsibly and know when the trail stops.

## Where I'm starting

I'll start with **Ethereum**, focusing first on wallet history, initial funding, and transaction tracing. From there, I want to add a visual investigation graph, evidence-based attribution, reporting, and eventually support for other blockchains.

AI may help connect and summarize findings later, but it should never invent an identity or turn a weak clue into a fact.

## Project status

**Early stage — concept and development roadmap.**

This README describes what I'm building, not a finished product. There is no released investigation engine yet. I'll update the documentation as features are implemented and tested.

---

*The blockchain shows where funds move. NODIVRA is my attempt to make sense of the story behind those movements.*

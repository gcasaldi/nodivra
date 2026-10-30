"use strict";
(function () {
  const API = "https://eth.blockscout.com/api/v2";
  const EXPLORER = "https://eth.blockscout.com/address/";
  const form = document.getElementById("lookup-form");
  const input = document.getElementById("wallet");
  const button = document.getElementById("lookup-button");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const txList = document.getElementById("transactions");
  const example = document.getElementById("example");
  let currentController = null;

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
  }
  function short(hash) {
    if (!hash) return "Unknown";
    return hash.length > 20 ? hash.slice(0, 9) + "…" + hash.slice(-7) : hash;
  }
  function eth(wei) {
    try {
      const value = BigInt(wei || "0");
      const whole = value / 1000000000000000000n;
      const fraction = (value % 1000000000000000000n).toString().padStart(18, "0").slice(0, 6);
      if (value > 0n && whole === 0n && Number(fraction) === 0) return "<0.000001 ETH";
      return whole.toString() + "." + fraction + " ETH";
    } catch (_) {
      return "Unavailable";
    }
  }
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  async function readJson(url, signal) {
    const response = await fetch(url, { signal: signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Data provider returned HTTP " + response.status + ".");
    return response.json();
  }
  function appendTx(tx, wallet) {
    const row = el("div", "tx-item");
    const info = el("div", "tx-main");
    const link = el("a", "tx-link", short(tx.hash));
    link.href = "https://eth.blockscout.com/tx/" + encodeURIComponent(tx.hash || "");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    info.appendChild(link);
    const from = (tx.from && tx.from.hash) || "";
    const to = (tx.to && tx.to.hash) || "";
    const direction = from.toLowerCase() === wallet.toLowerCase() ? "OUT" : to.toLowerCase() === wallet.toLowerCase() ? "IN" : "OTHER";
    const date = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "Time unavailable";
    info.appendChild(el("div", "tx-sub", date + " · " + short(from) + " → " + short(to)));
    const amount = el("div", "tx-amount");
    const directionEl = el("span", "tx-dir" + (direction === "OUT" ? " out" : ""), direction);
    amount.appendChild(directionEl);
    amount.appendChild(el("div", "", eth(tx.value)));
    row.appendChild(info);
    row.appendChild(amount);
    txList.appendChild(row);
  }
  async function lookup(wallet) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      results.hidden = true;
      setStatus("Please enter a valid Ethereum address (0x followed by 40 hexadecimal characters).", true);
      return;
    }
    if (currentController) currentController.abort();
    const controller = new AbortController();
    currentController = controller;
    const timeout = setTimeout(function () { controller.abort(); }, 18000);
    button.disabled = true;
    button.textContent = "Loading…";
    results.hidden = true;
    setStatus("Checking the public Ethereum indexer…", false);
    try {
      const encoded = encodeURIComponent(wallet);
      const data = await Promise.all([
        readJson(API + "/addresses/" + encoded, controller.signal),
        readJson(API + "/addresses/" + encoded + "/transactions", controller.signal)
      ]);
      if (currentController !== controller) return;
      const address = data[0];
      const transactions = Array.isArray(data[1].items) ? data[1].items.slice(0, 12) : [];
      document.getElementById("result-address").textContent = wallet;
      document.getElementById("explorer-link").href = EXPLORER + encoded;
      document.getElementById("balance").textContent = eth(address.coin_balance);
      document.getElementById("shown").textContent = String(transactions.length);
      document.getElementById("account-type").textContent = address.is_contract ? "Contract" : "Account";
      txList.replaceChildren();
      if (transactions.length) {
        transactions.forEach(function (tx) { appendTx(tx, wallet); });
      } else {
        txList.appendChild(el("p", "disclaimer", "No transactions were returned for this address."));
      }
      results.hidden = false;
      setStatus("Public on-chain data loaded. This is a recent-activity preview, not a full forensic attribution.", false);
    } catch (error) {
      if (currentController !== controller) return;
      if (error.name === "AbortError") {
        setStatus("The lookup timed out. Please try again.", true);
      } else {
        setStatus("The public data service could not be reached. Try again later or open the address in Blockscout. " + error.message, true);
      }
    } finally {
      clearTimeout(timeout);
      if (currentController === controller) {
        button.disabled = false;
        button.textContent = "Investigate →";
      }
    }
  }
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    lookup(input.value.trim());
  });
  example.addEventListener("click", function () {
    input.value = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    lookup(input.value);
  });
})();

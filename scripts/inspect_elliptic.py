#!/usr/bin/env python3
"""Inspect the Elliptic research graph without inferring wallet ownership.

Usage:
 python scripts/inspect_elliptic.py \
   --classes elliptic_txs_classes.csv --edges elliptic_txs_edgelist.csv \
   --output data/elliptic-summary.json

Elliptic txIds are research graph identifiers, not Bitcoin wallet addresses.
"""
import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

CLASSES = {"1": "illicit_research_class", "2": "licit_research_class", "unknown": "unlabeled"}

def inspect(classes_path: Path, edges_path: Path, output: Path, max_edges: int = 1000000):
    if max_edges < 1 or max_edges > 5000000:
        raise ValueError("max_edges must be between 1 and 5,000,000")
    labels = {}
    with classes_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not {"txId", "class"}.issubset(reader.fieldnames or []):
            raise ValueError("Expected txId,class columns")
        for row in reader:
            txid = (row.get("txId") or "").strip()
            kind = (row.get("class") or "").strip().lower()
            if txid and kind in CLASSES:
                labels[txid] = CLASSES[kind]

    transitions = Counter()
    total_edges = 0
    skipped = 0
    truncated = False
    with edges_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file)
        first = next(reader, None)
        if not first or len(first) < 2:
            raise ValueError("Expected two-column CSV edge list")
        first_data = first if first[0] not in {"txId1", "txid1"} else None
        # Streaming including a headerless first data row.
        def iter_rows():
            if first_data is not None:
                yield first_data
            yield from reader
        for row in iter_rows():
            if total_edges >= max_edges:
                truncated = True
                break
            if len(row) < 2:
                skipped += 1
                continue
            src, dst = row[0].strip(), row[1].strip()
            if src not in labels or dst not in labels:
                skipped += 1
                continue
            transitions[(labels[src], labels[dst])] += 1
            total_edges += 1

    classes = Counter(labels.values())
    report = {
        "dataset": "Elliptic Bitcoin transaction research dataset",
        "source": "https://huggingface.co/datasets/edisonlin2002/elliptic-bitcoin-dataset",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_only": True,
        "not_bitcoin_address_attribution": True,
        "nodes": len(labels),
        "classes": dict(classes),
        "qualifying_edges": total_edges,
        "edges_skipped": skipped,
        "truncated": truncated,
        "label_transitions": [
            {"from_class": key[0], "to_class": key[1], "count": value}
            for key, value in sorted(transitions.items())
        ],
        "warning": "Graph node IDs are not identified wallet owners; labels are research classes, not proof of criminal behavior.",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"summary": str(output), "nodes": len(labels), "edges": total_edges}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classes", required=True, type=Path)
    parser.add_argument("--edges", required=True, type=Path)
    parser.add_argument("--output", default=Path("data/elliptic-summary.json"), type=Path)
    parser.add_argument("--max-edges", type=int, default=1000000)
    args = parser.parse_args()
    inspect(args.classes, args.edges, args.output, args.max_edges)

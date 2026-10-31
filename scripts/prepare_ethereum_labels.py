#!/usr/bin/env python3
"""Prepare a bounded, auditable research index from an authorized historical CSV.

No remote download, no owner inference, no automatic upload to GitHub.
Example:
 python scripts/prepare_ethereum_labels.py --input addr_labels_balanced.csv --output data/research-labels.jsonl --max-rows 25000
"""
import argparse
import csv
import hashlib
import json
import pathlib
import re
from datetime import datetime, timezone

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
REQUIRED = {"address", "is_scam", "description", "is_contract"}

def prepare(source: pathlib.Path, output: pathlib.Path, max_rows: int):
    if max_rows < 1 or max_rows > 200000:
        raise ValueError("--max-rows must be between 1 and 200000")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    skipped = 0
    seen = set()
    sha = hashlib.sha256()
    with source.open("r", encoding="utf-8-sig", newline="") as stream, \
         output.open("wb") as dest:
        reader = csv.DictReader(stream)
        if not REQUIRED.issubset(reader.fieldnames or []):
            raise ValueError("Missing required columns: " + ", ".join(sorted(REQUIRED - set(reader.fieldnames or []))))
        for row in reader:
            if count >= max_rows:
                break
            address = (row.get("address") or "").strip().lower()
            label = (row.get("is_scam") or "").strip()
            contract = (row.get("is_contract") or "").strip()
            if not ADDRESS.fullmatch(address) or label not in {"0", "1"} or contract not in {"0", "1"} or address in seen:
                skipped += 1
                continue
            seen.add(address)
            record = {
                "address": address,
                "historical_label": "research_scam_class" if label == "1" else "research_non_scam_class",
                "is_contract": contract == "1",
                "source": "fesevu/ethereum_fraud_dataset_by_activity",
                "evidence": "historical merged research label only; not legal proof",
            }
            line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            dest.write(line)
            sha.update(line)
            count += 1
    manifest = {
        "source": str(source),
        "output": str(output),
        "records": count,
        "invalid_or_duplicate_rows": skipped,
        "sha256": sha.hexdigest(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_only": True,
        "not_for_identity_or_accusation": True,
    }
    manifest_path = output.with_suffix(output.suffix + ".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=pathlib.Path)
    parser.add_argument("--output", default=pathlib.Path("data/research-labels.jsonl"), type=pathlib.Path)
    parser.add_argument("--max-rows", default=25000, type=int)
    args = parser.parse_args()
    prepare(args.input, args.output, args.max_rows)

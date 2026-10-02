#!/usr/bin/env python3
"""Check recorded evidence and frozen source hashes; never run services/tests."""
from pathlib import Path
import hashlib
import json

folder = Path(__file__).resolve().parent
repo = folder.parents[3]
manifest = json.loads((folder / "manifest.json").read_text())
receipt = json.loads((folder / "receipt.json").read_text())
failures = []
def check(path, expected):
    if not path.is_file():
        failures.append(f"Missing {path}")
    elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        failures.append(f"Hash mismatch {path}")
for relative, expected in manifest["files"].items():
    check(folder / relative, expected)
for relative, expected in receipt["frozenSourceSha256"].items():
    check(repo / relative, expected)
if failures:
    raise SystemExit("\n".join(failures))
print(f"Verified {len(manifest['files'])} durable artifacts and {len(receipt['frozenSourceSha256'])} frozen source files.")

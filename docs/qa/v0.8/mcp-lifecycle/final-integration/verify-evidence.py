#!/usr/bin/env python3
"""Read-only evidence integrity check; no tests/services are run."""
from pathlib import Path
import hashlib,json
folder=Path(__file__).resolve().parent
repo=folder.parents[4]
manifest=json.loads((folder/'manifest.json').read_text())
receipt=json.loads((folder/'receipt.json').read_text())
failures=[]
for relative,expected in manifest['files'].items():
 p=folder/relative
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:failures.append(relative)
for relative,expected in receipt['frozenSourceSha256'].items():
 p=repo/relative
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:failures.append(relative)
if failures:raise SystemExit('Hash mismatches: '+', '.join(failures))
print(f"Verified {len(manifest['files'])} durable artifacts and {len(receipt['frozenSourceSha256'])} frozen source files.")

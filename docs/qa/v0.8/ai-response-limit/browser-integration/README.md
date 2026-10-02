# Compiled integrated browser check

The SDK candidate was merged with v0.8 at `44458fec` before building. This fresh, immutable compiled bundle passed 18 desktop/mobile AI draft and Timeline cases: Stay/Leave, hidden draft and sign-out retry, SDK account replacement, composing Enter, Timeline IME, recurring keyboard activation, and downgrade copy/no-write/close behavior. One worker, zero retries.

The ten screenshots are actual disposable compiled browser fixtures. They show inherited UI behavior after the SDK integration, not a live provider response or production account. Root visually inspected both AI warning sizes and the desktop Timeline warning; the browser assertions check the behavior.

An initial private preview command retained an extra npm separator and exited before test execution by selecting default `dist`. Its failed-start log is preserved. Correcting only that harness command allowed the single actual18-case gate to run. Source snapshots are equal before/after; the receipt records all41 immutable compiled artifact hashes and all screenshot/log/harness hashes.

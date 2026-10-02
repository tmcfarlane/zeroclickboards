# Exact-CI sign-out fixture repair

The initial PR42 Node 20 CI unit gate failed six sign-out UI cases. The first looked for pending UI synchronously after transport arrival, then exited before releasing a held actual SDK logout. The following five tests timed out in SDK session setup. The SQL wire cases passed in that CI run.

This narrow test-only repair waits for the actual pending button/menuitem, still asserts disabled state and duplicate prevention, and releases held responses plus drains the public SDK session lock during teardown. No product source, timeouts or meaningful retry/route/draft assertions changed.

A controlled abort after actual logout arrival reproduced one deliberate failure plus five setup timeouts before the cleanup repair. With the same abort after repair, only the deliberate failure remained and the other five tests passed. The temporary abort is absent from the final source. The intact six cases and scoped lint passed on Node 20.20.2. Local macOS could not reproduce the original intermittent Linux pending-lookup failure; it is not claimed as a founded production bug.

The original failed CI log, controlled probe source/logs, author report and hash receipt are preserved here. Their results describe their recorded tree; the root integration gate and exact-head CI must separately validate the final committed candidate. The existing eight AI draft screenshots came from an earlier compiled bundle whose product source remains unchanged by this fixture repair.

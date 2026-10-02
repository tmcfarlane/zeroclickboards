# Compiled sign-out verification

Six cases passed on the corrected immutable fixture build: Account failure and explicit retry, held Account pending/duplicate protection, and public account keyboard failure/retry, each on desktop and mobile. One worker, zero retries; 18.1 seconds. The four screenshots show actual Account failure and successful retry; root visually reviewed both failure captures.

The first compiled build used a different disposable Supabase hostname than the existing fixture storage key. All six initial cases failed before exercising sign-out. That log and configuration are preserved. A new separate build with the fixture hostname corrected this harness mismatch; no product or test was changed.

The receipt freezes source and all 41 compiled artifacts. These browser checks complement the phase-controlled unit proof; they do not reproduce the original uninstrumented full-suite chronology or sign out a production user.

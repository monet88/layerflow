# High Network/Payment Risk Fix Session

**Date**: 2026-05-28 23:36
**Severity**: High
**Component**: network client, provider auth flow, backend URL validation
**Status**: Resolved

## What Happened

A production-readiness review flagged High-risk issues in the network and payment path, and they were real: `request()` could retry a timed-out POST and duplicate a paid generation, token refresh/session registration did not always respect cancellation, and backend URL validation accepted arbitrary HTTPS origins that were not actually allowed by the UXP manifest. We also had a parsing bug where `responseType=arraybuffer` broke text/json handling in the same client path.

## The Brutal Truth

This was one of those fixes that feels stupid after the fact because the failure modes were obvious in hindsight. We had a network layer trying to be clever and ended up making paid requests unsafe, cancellation leaky, and config validation too permissive. That is exactly the kind of mess that turns into duplicate charges or dead-end support tickets, and it should not have survived review.

## Technical Details

- `responseType=arraybuffer` caused text/json responses to bypass normal parsing.
- `request()` could retry a POST after timeout, which is unacceptable for paid generation calls.
- Backend URL validation allowed arbitrary HTTPS instead of only loopback values compatible with the UXP manifest policy.
- Token refresh/session registration did not propagate `AbortSignal`, so cancellation was incomplete.
- Follow-up review also caught that fal.ai/Replicate POSTs would otherwise fall back to a 30s fetch timeout; we fixed those paths with explicit 180s timeouts.

## What We Tried

- Fixed the parsing path so binary and text responses are handled separately.
- Removed unsafe POST retry behavior for paid requests.
- Tightened backend URL validation to loopback-only policy.
- Threaded `AbortSignal` through token/session flows.
- Re-ran typecheck/build after the follow-up timeout fix.

## Root Cause Analysis

The root cause was a network abstraction that treated all requests like they were safe to retry and all responses like they were one format. That abstraction leaked into paid and authenticated flows where the assumptions were wrong.

## Lessons Learned

If a request can cost money, it must be treated as non-idempotent unless proven otherwise. Also, config validation has to match the deployment surface, not just the shape of the string.

## Next Steps

No further code changes are planned for this fix. Keep the loopback-only backend rule documented in plans/docs and watch for any future network client change that reintroduces POST retries or timeout shortcuts.

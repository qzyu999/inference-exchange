# 0010: Live mode and test mode

- Status: Accepted
- Date: 2026-11-26
- Principles: P6, P7, P9

## Context

Customers and IE need to test payments and inference without real money or real vendor cost. The test path must run the same code as the live path, or it does not test the live path.

## Decision

Every money and request record has `mode IN ('live', 'test')`.

- Foreign keys include the mode, so a test record cannot refer to a live record.
- An API key has the prefix `ie_live_` or `ie_test_`. The key sets the mode of each request. One user can have both kinds.
- Live mode uses the live payment rail keys and approved vendors.
- Test mode uses the payment rail sandbox (Stripe test mode) and mock adapters only: a mock vendor, the mock provider agent and a fake rail. Test mode never calls a real vendor.
- The mode selects adapters through configuration. Services do not branch on the mode.
- Staging is a separate deployment with its own database. It is used for drills, restores, load tests and capped contract runs against real vendors.

## Consequences

- Test traffic costs IE nothing and cannot be used for free inference.
- Test mode returns mock output. Real vendor behavior is checked by the vendor contract suite on staging, under the vendor spend cap.
- Reports and caps are separate for each mode.

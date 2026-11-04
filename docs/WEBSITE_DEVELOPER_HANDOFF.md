# Website developer handoff

Use the current [developer guide](DEVELOPER_GUIDE.md) for exact payloads, endpoints, retry behavior and payment recovery. New orders use fixed-price payment and driver acceptance; they do not use bids.

1. Obtain an approved merchant account at https://snapbudd.io/portal/?workspace=merchant, configure all pickup outlets and generate a backend-only API key.
2. Check `GET /health`, then authenticated `GET /v1/orders/connection`.
3. Offer SnapBudd delivery, collect/confirm the recipient address and contact details, and request optional location permission with a manual fallback.
4. Check stock/opening hours. Send a selected `outletId`, or `selectNearestOutlet: true` with confirmed delivery coordinates.
5. Create with `POST /v1/orders` and a saved `Idempotency-Key`. Persist `orderId`, `trackingId`, `trackingUrl`, outlet and price. Show **Payment pending**.
6. Fund delivery through `POST /v1/orders/{orderId}/checkout` or `/payment`. Combined website collection still requires the merchant to fund SnapBudd; your own payment processor's success is not proof of SnapBudd payment.
7. Call `/payment/verify`, then GET the order to confirm paid status without review/refund holds.
8. Poll the order for driver assignment and progress. Share only the returned public tracking link.

The main merchant account sees all its outlets' deliveries. In-app shop accounts manage their own purchases and outlets through the shop portal; their IDs and credentials cannot be substituted for merchant API credentials.

Before launch, validate the deployed API and payment/webhook functions together in staging. No production rollout or real payment is implied by these source changes.

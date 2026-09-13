# SnapBudd API Website Developer Handoff

Send this to any website developer who needs to add SnapBudd delivery to a shop checkout or order-management flow.

---

Hi,

SnapBudd delivery is available through the hosted Merchant API.

Base URL:

```text
https://snapbudd-api.onrender.com
```

Health check:

```bash
curl https://snapbudd-api.onrender.com/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "snapbudd-api",
  "version": "1.0.0"
}
```

Use the API from your backend only. Do not call it directly from browser JavaScript because the API key must stay secret.

Required headers for order endpoints:

```http
X-Merchant-Id: <merchant_id_from_snapbudd>
X-Api-Key: <merchant_api_key_from_snapbudd>
Content-Type: application/json
```

Integration flow:

1. Create a delivery order after the shop order is placed:

```http
POST https://snapbudd-api.onrender.com/v1/orders
```

2. Store the returned `orderId` and `trackingUrl` against the shop order.

3. Poll for driver bids:

```http
GET https://snapbudd-api.onrender.com/v1/orders/{orderId}/bids
```

4. When the customer or merchant selects a bid, create a Stripe Checkout session:

```http
POST https://snapbudd-api.onrender.com/v1/orders/{orderId}/bids/{bidId}/checkout
```

Request body:

```json
{
  "returnUrl": "https://your-shop.com/orders/complete"
}
```

5. Redirect the customer to the returned `checkoutUrl`.

6. After Stripe redirects back with `session_id`, finalize the accepted bid:

```http
POST https://snapbudd-api.onrender.com/v1/orders/{orderId}/bids/{bidId}/finalize
```

Request body:

```json
{
  "sessionId": "cs_test_or_live_session_id"
}
```

7. Track the delivery:

```http
GET https://snapbudd-api.onrender.com/v1/orders/{orderId}
```

The create-order and track-order responses include a public `trackingUrl` that can be shown to the customer.

Minimum create-order payload:

```json
{
  "pickup": {
    "formatted": "Karl Johans gate 1, 0154 Oslo",
    "city": "Oslo",
    "countryCode": "NO",
    "lat": 59.9139,
    "lng": 10.7522
  },
  "dropoff": {
    "formatted": "Aker Brygge 10, 0250 Oslo",
    "city": "Oslo",
    "countryCode": "NO"
  },
  "pickupContact": {
    "name": "Shop Desk",
    "phone": "+4712345678"
  },
  "dropoffContact": {
    "name": "Customer Name",
    "phone": "+4798765432"
  },
  "itemDescription": "Blue winter jacket size M",
  "receiptUrl": "https://your-shop.com/receipts/order-123.pdf"
}
```

Developer notes:

- The merchant account must be approved in SnapBudd before credentials work.
- Store `X-Api-Key` in backend environment variables or a secrets manager.
- `receiptUrl` must be a public HTTPS URL.
- Use HTTPS return URLs for checkout.
- Render free tier may cold start after inactivity, so the first request can take longer.

Full API schemas and response examples are in `docs/DEVELOPER_GUIDE.md`.

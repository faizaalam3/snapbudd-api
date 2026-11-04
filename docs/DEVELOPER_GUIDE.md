# Merchant website delivery integration

New deliveries use a fixed server-calculated price. Payment is verified before publication; an eligible driver accepts without bidding. This document describes the updated source contract. Deploy the API and payment function before enabling it on a live website.

## Account and connection

Register at https://snapbudd.io/portal/?workspace=merchant, complete onboarding and obtain admin approval. Create outlets in **Outlets** and generate an API key in **API integration**. Store `X-Merchant-Id` and `X-Api-Key` on your backend. Authenticate your website's users and check their website-order ownership before forwarding requests.

A merchant account owns all its outlets and delivery orders. In-app shops use their separate shop workspace for products, purchases and outlets; a shop ID is not a merchant API ID. Do not share credentials across businesses.

Base URL: `https://snapbudd-api.onrender.com` (use your staging URL for testing).

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/health` | Public service availability; does not test credentials |
| GET | `/v1/orders/connection` | Authenticated merchant ID and capabilities |
| GET | `/v1/orders/outlets` | Owned outlets; filter `active === true` |
| GET | `/v1/orders?after=<nextCursor>` | All owned orders across outlets, 100 per page; stop when `nextCursor` is null |
| POST | `/v1/orders` | Create unpaid delivery and immediate tracking reference |
| POST | `/v1/orders/{orderId}/checkout` | Hosted Stripe checkout: `{returnUrl}` → `{url, sessionId, totalOre}` |
| POST | `/v1/orders/{orderId}/payment` | Embedded Stripe payment: no body → `{clientSecret, paymentIntentId, totalOre}` or `{paid: true}` on a reconciled retry |
| POST | `/v1/orders/{orderId}/payment/verify` | Verify the saved Stripe payment; no caller-supplied payment ID or amount |
| GET | `/v1/orders/{orderId}` | Private order, payment, assignment and tracking details |

Except `/health`, these endpoints require both merchant headers. Bid endpoints remain for historical orders and reject new fixed-price payments.

## Customer checkout and pickup selection

Offer **SnapBudd delivery** at your website checkout. Collect recipient name, international-format phone, email if available, full delivery address, city, postal code, two-letter country code, and confirmed map coordinates. Keep billing and delivery addresses separate.

Request browser location permission only when the buyer clicks **Use my location**. Reverse-geocode the coordinates using your address provider and let the buyer confirm the address/pin. On denial, timeout or unsupported browsers, provide address search/manual entry. Do not silently replace an entered delivery address with device location.

Choose one pickup mode:

- `selectNearestOutlet: true` with numeric `dropoff.lat/lng`: the API chooses the nearest complete, active, owned outlet by straight-line distance to the confirmed delivery destination.
- `outletId`: your backend chooses an owned active outlet, considering stock/opening hours. The API resolves its saved address and coordinates; caller pickup coordinates cannot override them.
- Manual `pickup` and `pickupContact`: use a full address/contact instead of an outlet.

Automatic distance selection does not check inventory or opening hours. Your website must do that, selecting an explicit outlet when required. Driving distance determines price. Both stops must pass the configured service-area checks. The selected outlet is rechecked transactionally before the order is committed; edits do not change historical order attribution.

## Create once, retry safely

Save a unique key and the exact request on your backend before sending. Reuse `Idempotency-Key` and the same body after a timeout. The key must contain 8–128 letters, digits, underscores or hyphens. A changed request with the same key returns 409; concurrent duplicates return one saved order. Without a key, creation is not retry-safe. `externalOrderId` is a business reference, not an idempotency guarantee.

```http
POST /v1/orders
X-Merchant-Id: YOUR_MERCHANT_ID
X-Api-Key: YOUR_SECRET_KEY
Idempotency-Key: website-order-123-delivery-v1
Content-Type: application/json
```

```json
{
  "externalOrderId": "website-order-123",
  "selectNearestOutlet": true,
  "pickupAuthorizationGranted": true,
  "dropoff": {
    "formatted": "Aker Brygge 10, 0250 Oslo",
    "city": "Oslo",
    "postalCode": "0250",
    "countryCode": "NO",
    "lat": 59.9106,
    "lng": 10.7281
  },
  "dropoffContact": {
    "name": "Recipient name",
    "phone": "+4798765432",
    "email": "recipient@example.com"
  },
  "itemDescription": "Blue winter jacket, size M",
  "receiptUrl": "https://your-shop.com/receipts/order-123.pdf",
  "packageType": "General",
  "packageSize": "Medium",
  "vehicleType": "Car"
}
```

Required: recipient address/city/countryCode, contact name/phone, item description (5–500 characters), receipt URL, explicit pickup authorization, and a pickup mode. Obtain consent/authority before setting `pickupAuthorizationGranted: true`; do not preselect it. Supply an accessible receipt without credentials embedded in the URL.

Optional: email, `customer` name/phone/email, `notes`, `fragile`, `requiresSignature`, `contactless`, `returnToShop`, `scheduledAt` (ISO timestamp), address street/state/postalCode/country/placeId. Package types: General/Documents/Food/Fragile; sizes: Small/Medium/Large; vehicles: Car/Van. Unknown fields are rejected. Omit `amount`: it is a legacy delivery-price assertion, not merchandise value.

The response contains `orderId`, `trackingId` (10 characters), `trackingUrl`, selected `outletId`, `status: payment_pending`, and `pricing` with currency, total in NOK, route distance and duration. Save these against the website order. Display the reference immediately, clearly marked **Payment pending**. An order/reference is not proof of payment or dispatch.

## Delivery funding

Show the returned fixed price before the payer confirms. Select one payment mode per order:

1. **Hosted checkout:** POST `/checkout` with `{"returnUrl":"https://your-shop.com/payment-return"}`. Save `sessionId`; redirect to returned `url`. The return includes `orderId`, `payment` and `session_id`.
2. **Embedded payment:** POST `/payment`; confirm `clientSecret` with Stripe's client SDK and SnapBudd's publishable key for the matching environment. This is a SnapBudd payment intent, not one created on the merchant's Stripe account. Do not log the client secret or expose the API key.

If the buyer pays delivery separately, they pay SnapBudd through this flow. If your website collects merchandise plus delivery in one buyer charge, fund the SnapBudd delivery from merchant funds through this flow and do not charge the buyer delivery twice. Your backend coordinates the two payments and handles failure/refund recovery. There is no atomic combined merchandise/delivery charge, automatic merchant-balance debit, or endpoint accepting an arbitrary claim of payment.

After client confirmation, call POST `/payment/verify` from your authenticated backend. It validates the saved Stripe payment, amount, currency, generation, refunds and disputes. Then read the order:

```js
const delivery = await snapbudd(`/v1/orders/${orderId}`);
const funded = delivery.payment.status === 'paid'
  && !delivery.payment.reviewRequired
  && !delivery.payment.refundedOre;
```

Only verified funding publishes API deliveries. The existing Stripe webhook reconciles if the browser closes. Never trust return URL parameters. Repeat verification or poll with backoff. Retrying payment recovers its saved attempt; do not switch checkout modes or create another order to bypass an expired/closed attempt. A 409 needs reconciliation/support, not another charge.

## Assignment and tracking

Poll GET `/v1/orders/{orderId}` from the backend every 15–30 seconds with backoff. `assignment.driverId` is null before acceptance. Afterwards, authorized staff/buyers can view `driverName`, `driverPhone`, `driver.photoUrl` and `vehicle`.

Share only the returned `trackingUrl` (or `trackingId`) publicly. Anyone with the reference can view general progress; public tracking excludes exact addresses, contacts, private driver coordinates, receipts and PINs. Never proxy the private order response anonymously. `tracking.enabled` must be respected. Older orders may lack a reference and use their returned legacy link.

Stop normal polling at completed/cancelled/refunded/failed. `delivered` may still await PIN confirmation; `completed` is final. External status updates currently use polling, not merchant webhook subscriptions.

## Deployment and acceptance

Deploy the updated Nest API and the `merchantDeliveryPayment` Cloud Function with the existing fixed-delivery Stripe webhook, tracking and marketplace triggers. The API defaults to the `us-central1` payment function in `FIREBASE_PROJECT_ID`; set `MERCHANT_PAYMENT_URL` for a different region/project. The function requires its existing `STRIPE_SECRET_KEY` binding. Both services must use the same Firebase project and Stripe environment. Embedded payments also require the matching public Stripe key on the website; hosted checkout does not.

Test in a separate staging project with Stripe test keys: connection approval/denial, all-outlet access, foreign-owner denial, nearest/manual pickup, location denial, duplicate/concurrent requests, price display, declined/paid checkout, closed browser, delayed webhook, driver acceptance, refunds, and public tracking privacy. Health alone does not prove payment or webhook deployment is working.

Error handling: 400 validation; 401 credentials; 403 approval/ownership; 404 unknown resource/version; 409 reconcile state; 503 service interruption. Retry reads and the same keyed create/payment attempt with backoff. Never log secrets or private request bodies.

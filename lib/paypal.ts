import { randomUUID } from "node:crypto";

const baseUrl = (process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com").replace(/\/$/, "");

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function getAccessToken(): Promise<string> {
  const clientId = requiredEnv("PAYPAL_CLIENT_ID");
  const clientSecret = requiredEnv("PAYPAL_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    // Do not include credentials or access tokens in the thrown message.
    const body = await tokenResponse.text();
    throw new Error(`PayPal OAuth failed (${tokenResponse.status}): ${body.slice(0, 300)}`);
  }

  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("PayPal OAuth response did not contain an access token.");
  return token.access_token;
}

async function paypalFetch<T>(path: string, init: RequestInit = {}, requestId: string = randomUUID()): Promise<T> {
  const accessToken = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("PayPal-Request-Id", requestId);

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const responseText = response.status === 204 ? "" : await response.text();
  if (!response.ok) {
    throw new Error(`PayPal API failed (${response.status}): ${responseText.slice(0, 500)}`);
  }
  if (!responseText.trim()) return undefined as T;
  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`PayPal API returned an unreadable response (${response.status}).`);
  }
}

export interface PayPalOrder {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string; method?: string }>;
}

export interface PayPalAuthorization {
  id: string;
  status: string;
  amount?: { currency_code?: string; value?: string };
  expiration_time?: string;
  create_time?: string;
  update_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } };
}

export interface PayPalOrderDetails {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    payments?: {
      authorizations?: PayPalAuthorization[];
      captures?: PayPalCapture[];
    };
  }>;
}

export interface PayPalAuthorizeResponse {
  id: string;
  status?: string;
  purchase_units?: Array<{
    reference_id?: string;
    payments?: { authorizations?: PayPalAuthorization[] };
  }>;
}

export interface AuthorizationOrderOptions {
  referenceId?: string;
  description?: string;
  /** Optional return-flow hint used by PactPay's UI only; never grants settlement authority. */
  flow?: "protected-demo";
}

export async function createAuthorizationOrder(
  amount: string,
  transactionId: string,
  requestId: string,
  options: AuthorizationOrderOptions = {},
): Promise<PayPalOrder> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000";
  const returnUrl = new URL("/paypal/success", appUrl);
  returnUrl.searchParams.set("transactionId", transactionId);
  if (options.flow) returnUrl.searchParams.set("flow", options.flow);
  const cancelUrl = new URL("/paypal/cancel", appUrl);
  cancelUrl.searchParams.set("transactionId", transactionId);

  return paypalFetch<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: options.referenceId ?? "pactpay-m0.1",
          custom_id: transactionId,
          description: options.description ?? "PactPay Sandbox authorization proof",
          amount: { currency_code: "USD", value: amount },
        },
      ],
      application_context: {
        brand_name: "PactPay",
        user_action: "PAY_NOW",
        return_url: returnUrl.toString(),
        cancel_url: cancelUrl.toString(),
      },
    }),
  }, requestId);
}

export async function authorizeOrder(orderId: string, requestId: string): Promise<PayPalAuthorizeResponse> {
  return paypalFetch<PayPalAuthorizeResponse>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    { method: "POST", body: "{}" },
    requestId,
  );
}


export interface PayPalCapture {
  id?: string;
  status?: string;
  amount?: { currency_code?: string; value?: string };
  final_capture?: boolean;
  create_time?: string;
  update_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
}

/** Explicitly permit only recognized PayPal Sandbox hostnames for the protected demo settlement routes. */
export function isPayPalSandboxConfigured(): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" &&
      (url.hostname === "api-m.sandbox.paypal.com" || url.hostname === "api.sandbox.paypal.com");
  } catch {
    return false;
  }
}

export async function getAuthorization(authorizationId: string): Promise<PayPalAuthorization> {
  return paypalFetch<PayPalAuthorization>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
    { method: "GET" },
  );
}

/** Read an existing order for reconciliation. This endpoint never mutates PayPal state. */
export async function getOrder(orderId: string): Promise<PayPalOrderDetails> {
  return paypalFetch<PayPalOrderDetails>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" },
  );
}

export async function captureAuthorizedPayment(
  authorizationId: string,
  amount: string,
  currency: string,
  requestId: string,
): Promise<PayPalCapture> {
  return paypalFetch<PayPalCapture>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        amount: { currency_code: currency, value: amount },
        final_capture: true,
      }),
    },
    requestId,
  );
}

/** Read a capture resource by ID when PayPal returns a minimal capture response. */
export async function getCapture(captureId: string): Promise<PayPalCapture> {
  return paypalFetch<PayPalCapture>(
    `/v2/payments/captures/${encodeURIComponent(captureId)}`,
    { method: "GET", headers: { Prefer: "return=representation" } },
  );
}

export async function voidAuthorization(authorizationId: string, requestId: string): Promise<void> {
  await paypalFetch<undefined>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    { method: "POST", body: "{}" },
    requestId,
  );
}

export async function verifyWebhookSignature(args: {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSignature: string;
  transmissionTime: string;
  webhookEvent: Record<string, unknown>;
}): Promise<boolean> {
  const webhookId = requiredEnv("PAYPAL_WEBHOOK_ID");
  const result = await paypalFetch<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        auth_algo: args.authAlgo,
        cert_url: args.certUrl,
        transmission_id: args.transmissionId,
        transmission_sig: args.transmissionSignature,
        transmission_time: args.transmissionTime,
        webhook_id: webhookId,
        webhook_event: args.webhookEvent,
      }),
    },
  );
  return result.verification_status === "SUCCESS";
}

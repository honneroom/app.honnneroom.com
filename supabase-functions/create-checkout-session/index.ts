// create-checkout-session Edge Function
// Deploy with: supabase functions deploy create-checkout-session
// Set secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_PRICE_STANDARD=price_xxx
//   （将来プラン追加例）supabase secrets set STRIPE_PRICE_PRO=price_yyy

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY       = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// プラン名 → Stripe Price ID（シークレットから取得）
// 新プランを追加する場合は secrets にキーを追加して下記に足すだけ
const PRICE_MAP: Record<string, string | undefined> = {
  standard: Deno.env.get("STRIPE_PRICE_STANDARD"),
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ["https://honneroom.com", "https://app.honneroom.com"];
  const allowedOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    const { user_id, plan, success_url, cancel_url } = await req.json();

    // プラン名からPrice IDを解決
    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `不明なプラン: ${plan}` }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 既存の stripe_customer_id を取得
    let customerId: string | undefined;
    let customerEmail: string | undefined;
    if (user_id) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user_id)
        .single();
      customerId = profile?.stripe_customer_id || undefined;

      // メールアドレスも取得（新規顧客の場合に使用）
      if (!customerId) {
        const { data: { user } } = await supabase.auth.admin.getUserById(user_id);
        customerEmail = user?.email || undefined;
      }
    }

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success_url || "https://app.honneroom.com/app.html?checkout=success",
      cancel_url:  cancel_url  || "https://app.honneroom.com/app.html",
      // 既存顧客はそのまま使用、新規は email で Stripe が自動作成
      ...(customerId
        ? { customer: customerId }
        : { customer_email: customerEmail }),
      ...(user_id ? { client_reference_id: user_id } : {}),
      subscription_data: {
        metadata: { supabase_user_id: user_id || "" },
      },
    };

    const session = await stripe.checkout.sessions.create(params);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "決済セッションの作成に失敗しました" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

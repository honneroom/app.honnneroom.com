// create-checkout-session Edge Function
// Deploy with: supabase functions deploy create-checkout-session
// Required secrets:
//   STRIPE_SECRET_KEY_LIVE=sk_live_...
//   STRIPE_SECRET_KEY_TEST=sk_test_...   （テスト時のみ）
//   STRIPE_PRICE_STANDARD=price_xxx
//   APP_ENV=production  （prod / production / live のいずれかで本番キーを使用）
//   （将来プラン追加例）supabase secrets set STRIPE_PRICE_PRO=price_yyy

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// シークレットはリクエストごとに読み込む（デプロイ時点での undefined 固定を防ぐため）
function getConfig() {
  const APP_ENV = (Deno.env.get("APP_ENV") || "test").toLowerCase();
  const isLive = APP_ENV === "production" || APP_ENV === "prod" || APP_ENV === "live";
  const stripeKey = isLive
    ? Deno.env.get("STRIPE_SECRET_KEY_LIVE")
    : Deno.env.get("STRIPE_SECRET_KEY_TEST");
  return {
    stripeKey,
    isLive,
    supabaseUrl:     Deno.env.get("SUPABASE_URL")!,
    supabaseService: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    // プラン名 → Stripe Price ID
    priceMap: {
      standard: Deno.env.get("STRIPE_PRICE_STANDARD"),
    } as Record<string, string | undefined>,
  };
}

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
    const cfg = getConfig();

    // Stripe キーが設定されていなければ即エラー
    if (!cfg.stripeKey) {
      const keyName = cfg.isLive ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY_TEST";
      console.error(`Missing secret: ${keyName} (APP_ENV=${Deno.env.get("APP_ENV")})`);
      return new Response(JSON.stringify({ error: `Stripe キーが未設定です: ${keyName}` }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { user_id, plan, success_url, cancel_url } = await req.json();

    // プラン名からPrice IDを解決
    const priceId = cfg.priceMap[plan];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `不明なプラン: ${plan}` }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(cfg.stripeKey, {
      apiVersion: "2024-06-20",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 既存の stripe_customer_id を取得
    let customerId: string | undefined;
    let customerEmail: string | undefined;
    if (user_id) {
      const supabase = createClient(cfg.supabaseUrl, cfg.supabaseService);
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

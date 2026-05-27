// analyze-entry Edge Function
// Deploy with: supabase functions deploy analyze-entry
// Required secrets:
//   ANTHROPIC_API_KEY=sk-ant-...
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (自動設定)
//
// 利用制限:
//   ゲスト（未ログイン）: 1日3回（IPアドレスハッシュベース）
//   無料アカウント:       月間20回（entriesテーブルカウント）
//   Standardプラン:       無制限

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FREE_MONTHLY_LIMIT = 20;
const GUEST_DAILY_LIMIT  = 3;

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

/** IPをSHA-256でハッシュ化（プライバシー保護） */
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "_honneroom_rl_2024");
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  // シークレットはリクエストごとに読み込む（デプロイ時 undefined 固定を防ぐ）
  const ANTHROPIC_API_KEY       = Deno.env.get("ANTHROPIC_API_KEY")!;
  const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const corsHeaders = getCorsHeaders(req);

  try {
    const { body, entry_id, user_id } = await req.json();

    if (!body || body.trim().length === 0) {
      return new Response(JSON.stringify({ error: "本文が空です" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ─── 利用制限チェック ───────────────────────────────────────

    if (user_id) {
      // ログイン済みユーザー: プランを確認
      const { data: profile } = await supabase
        .from("profiles")
        .select("tier, is_active")
        .eq("id", user_id)
        .single();

      const isStd = !!profile?.is_active &&
        String(profile?.tier || "free").toLowerCase() === "standard";

      if (!isStd) {
        // 無料ユーザー: 今月のエントリー数をチェック
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { count } = await supabase
          .from("entries")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user_id)
          .gte("created_at", monthStart);

        // count には今回挿入済みのエントリーが含まれる（> LIMIT で判定）
        if ((count ?? 0) > FREE_MONTHLY_LIMIT) {
          return new Response(
            JSON.stringify({
              error: `今月の分析回数（${FREE_MONTHLY_LIMIT}回）の上限に達しました`,
              limit_type: "monthly_free",
              limit: FREE_MONTHLY_LIMIT,
              used: count,
            }),
            {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
    } else {
      // ゲスト: IPアドレスベースのレート制限
      const ipRaw =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        req.headers.get("cf-connecting-ip") ||
        "unknown";

      const ipHash = await hashIp(ipRaw);
      const today  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      // アトミックインクリメント（RPC関数）
      const { data: newCount, error: rlError } = await supabase.rpc(
        "guest_rate_limit_increment",
        { p_ip_hash: ipHash, p_period: today }
      );

      if (rlError) {
        // RPC失敗時はフェイルオープン（リクエストを許可してログのみ）
        console.error("Rate limit RPC error:", rlError);
      } else if ((newCount ?? 0) > GUEST_DAILY_LIMIT) {
        return new Response(
          JSON.stringify({
            error: `1日の利用回数（${GUEST_DAILY_LIMIT}回）の上限に達しました`,
            limit_type: "daily_guest",
            limit: GUEST_DAILY_LIMIT,
            used: newCount,
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // ─── Anthropic API 呼び出し ────────────────────────────────

    const prompt = `
以下のテキストは、ユーザーが感じているモヤモヤや悩みを吐き出したものです。
以下の4点を分析し、必ずJSON形式のみで返してください。前置きや説明文は一切不要です。

【テキスト】
${body}

【出力形式】
{
  "core_emotion": "ユーザーが本当に感じている核心の感情を1〜2文で（例：悔しさ、寂しさ、怒り、不安など）",
  "emotion_wheel": [
    { "emotion": "感情名", "intensity": 1〜5の強度, "category": "プルチックの基本8感情のどれか（喜び/信頼/恐れ/驚き/悲しみ/嫌悪/怒り/期待）" }
  ],
  "cognitive_distortions": [
    { "type": "認知の歪みの種類", "description": "このテキストでの具体的な現れ方" }
  ],
  "summary": "このモヤモヤを客観的に30字以内で要約",
  "reframe": "同じ気持ちをパートナーや家族に穏やかに伝えるとしたら何と言うか、自然な日本語で1〜3文"
}

cognitive_distortionsが見当たらない場合は空配列[]にしてください。
`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`Anthropic API error: ${aiRes.status}`);
    }

    const aiData  = await aiRes.json();
    const rawText = aiData.content[0].text.trim();

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AIのレスポンスからJSONを抽出できませんでした");
    const analysis = JSON.parse(jsonMatch[0]);

    // ログイン済みかつ entry_id がある場合のみDBに保存
    if (entry_id && user_id) {
      const { error } = await supabase.from("analyses").insert({
        entry_id,
        core_emotion:         analysis.core_emotion,
        emotion_wheel:        analysis.emotion_wheel,
        cognitive_distortions: analysis.cognitive_distortions,
        summary:              analysis.summary,
        reframe:              analysis.reframe,
      });
      if (error) console.error("analyses insert error:", error);
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "分析に失敗しました" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

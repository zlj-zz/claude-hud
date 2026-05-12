// Fetch DeepSeek balance and write external usage snapshot for claude-hud.
// Reads DEEPSEEK_API_KEY from environment.
// Reads DEEPSEEK_MONTHLY_BUDGET_CNY from environment (default 100).
// Usage: node fetch-deepseek-usage.js

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY environment variable is not set");
  process.exit(1);
}

const MONTHLY_BUDGET = parseFloat(process.env.DEEPSEEK_MONTHLY_BUDGET_CNY || "100");
const OUTPUT_PATH = process.env.DEEPSEEK_USAGE_OUTPUT
  || path.join(__dirname, "external-usage.json");

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function getNextMonthReset() {
  const now = new Date();
  // First day of next month at 00:00 UTC+8
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next;
}

async function main() {
  const balance = await httpsGet("https://api.deepseek.com/user/balance", {
    "Accept": "application/json",
    "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
  });

  const info = balance.balance_infos?.[0];
  if (!info) {
    console.error("Unexpected balance response:", JSON.stringify(balance));
    process.exit(1);
  }

  const total = parseFloat(info.total_balance);
  const granted = parseFloat(info.granted_balance);
  const toppedUp = parseFloat(info.topped_up_balance);

  // Calculate "used" percentage based on budget.
  // If user topped up 100 CNY and budget is 100 CNY, 0% means full remaining.
  // If budget is 200 and they have 50 left, that's 75% used.
  const remaining = total;
  const used = Math.max(0, MONTHLY_BUDGET - remaining);
  const usedPercentage = Math.round(Math.min(100, (used / MONTHLY_BUDGET) * 100));

  const snapshot = {
    balance_label: `¥${total.toFixed(2)}`,
    five_hour: {
      used_percentage: usedPercentage,
      resets_at: getNextMonthReset().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(
    `DeepSeek: ¥${total.toFixed(2)} remaining (${usedPercentage}% of ¥${MONTHLY_BUDGET} budget used) → ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error("Fetch failed:", err.message);
  process.exit(1);
});

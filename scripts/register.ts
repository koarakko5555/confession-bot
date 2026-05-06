// Discord にスラッシュコマンドを登録するスクリプト
// 実行: npm run register
// 事前に .dev.vars を作成するか、環境変数をセットしておくこと

import { readFileSync } from "fs";
import { resolve } from "path";

function loadDevVars(): Record<string, string> {
  try {
    const content = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf-8");
    return Object.fromEntries(
      content
        .split("\n")
        .filter((line) => line.includes("=") && !line.startsWith("#"))
        .map((line) => {
          const [key, ...rest] = line.split("=");
          return [key.trim(), rest.join("=").trim()];
        })
    );
  } catch {
    return {};
  }
}

const vars = loadDevVars();
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID ?? vars["DISCORD_APPLICATION_ID"];
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? vars["DISCORD_BOT_TOKEN"];

if (!APPLICATION_ID || !BOT_TOKEN) {
  console.error("DISCORD_APPLICATION_ID と DISCORD_BOT_TOKEN が必要です。");
  console.error(".dev.vars を作成するか環境変数をセットしてください。");
  process.exit(1);
}

const commands = [
  {
    name: "zange",
    description: "懺悔を投稿する",
    options: [
      {
        name: "image",
        description: "証拠画像（任意）",
        name_localizations: { ja: "画像" },
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: "hansei",
        description: "反省の内容",
        name_localizations: { ja: "反省文" },
        type: 3, // STRING
        required: false,
      },
    ],
  },
];

(async () => {
  const res = await fetch(
    `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    }
  );

  if (res.ok) {
    const data = await res.json();
    console.log("コマンド登録成功:", JSON.stringify(data, null, 2));
  } else {
    const err = await res.text();
    console.error("コマンド登録失敗:", res.status, err);
    process.exit(1);
  }
})();

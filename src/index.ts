export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  CONFESSION_CHANNEL_ID: string;
}

function hexToUint8Array(hex: string): Uint8Array {
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid hex string");
  return new Uint8Array(pairs.map((byte) => parseInt(byte, 16)));
}

async function verifyRequest(
  request: Request,
  publicKey: string
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return { valid: false, body };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    hexToUint8Array(publicKey),
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    hexToUint8Array(signature),
    new TextEncoder().encode(timestamp + body)
  );

  return { valid, body };
}

async function postToChannel(
  channelId: string,
  botToken: string,
  content: string,
  imageUrl?: string
): Promise<void> {
  const body: Record<string, unknown> = { content };

  if (imageUrl) {
    body.embeds = [{ image: { url: imageUrl } }];
  }

  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord API error: ${res.status} ${err}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { valid, body } = await verifyRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const interaction = JSON.parse(body);

    // PING
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // /zange コマンド
    if (interaction.type === 2 && interaction.data?.name === "zange") {
      const options: Array<{ name: string; value: string }> =
        interaction.data.options ?? [];

      const content = options.find((o) => o.name === "hansei")?.value;
      if (!content) {
        return Response.json({
          type: 4,
          data: { content: "反省文を入力してください。", flags: 64 },
        });
      }
      const attachmentId = options.find((o) => o.name === "image")?.value;
      const attachment =
        attachmentId != null
          ? interaction.data.resolved?.attachments?.[attachmentId]
          : undefined;

      const message = `**迷える鹿さんの懺悔**\n${content as string}`;

      try {
        await postToChannel(
          env.CONFESSION_CHANNEL_ID,
          env.DISCORD_BOT_TOKEN,
          message,
          attachment?.url
        );
      } catch (e) {
        console.error(e);
        return Response.json({
          type: 4,
          data: {
            content: "投稿に失敗しました。しばらくしてから再試行してください。",
            flags: 64,
          },
        });
      }

      return Response.json({
        type: 4,
        data: { content: "懺悔を投稿しました！", flags: 64 },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

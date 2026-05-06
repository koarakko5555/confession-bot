export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  CONFESSION_CHANNEL_ID: string;
  ZANGE_TEMP: KVNamespace;
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

    // /zange コマンド → モーダルを表示
    if (interaction.type === 2 && interaction.data?.name === "zange") {
      const options: Array<{ name: string; value: string }> =
        interaction.data.options ?? [];

      const attachmentId = options.find((o) => o.name === "image")?.value;
      const attachment =
        attachmentId != null
          ? interaction.data.resolved?.attachments?.[attachmentId]
          : undefined;

      const userId: string =
        interaction.member?.user?.id ?? interaction.user?.id;

      if (attachment) {
        await env.ZANGE_TEMP.put(
          `pending_${userId}`,
          attachment.proxy_url ?? attachment.url,
          { expirationTtl: 600 }
        );
      } else {
        await env.ZANGE_TEMP.delete(`pending_${userId}`);
      }

      return Response.json({
        type: 9, // MODAL
        data: {
          custom_id: "zange_modal",
          title: "懺悔",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4, // TEXT_INPUT
                  custom_id: "content",
                  label: "反省の内容",
                  style: 2, // PARAGRAPH（複数行）
                  placeholder: "懺悔の内容を入力してください...",
                  required: true,
                  min_length: 1,
                  max_length: 1000,
                },
              ],
            },
          ],
        },
      });
    }

    // モーダル送信
    if (interaction.type === 5 && interaction.data?.custom_id === "zange_modal") {
      const userId: string =
        interaction.member?.user?.id ?? interaction.user?.id;

      const content: string =
        interaction.data.components[0].components[0].value;

      const imageUrl = await env.ZANGE_TEMP.get(`pending_${userId}`);
      if (imageUrl) {
        await env.ZANGE_TEMP.delete(`pending_${userId}`);
      }

      const message = `**迷える鹿さんの懺悔**\n${content}`;

      try {
        await postToChannel(
          env.CONFESSION_CHANNEL_ID,
          env.DISCORD_BOT_TOKEN,
          message,
          imageUrl ?? undefined
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

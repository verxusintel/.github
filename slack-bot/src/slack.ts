/**
 * Verify Slack request signature using HMAC-SHA256 via crypto.subtle.
 */
export async function verifySlackSignature(
  body: string,
  signature: string,
  timestamp: string,
  signingSecret: string
): Promise<boolean> {
  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return false;
  }

  const baseString = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(baseString)
  );

  const digest = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const computedSignature = `v0=${digest}`;

  // Constant-time comparison
  if (computedSignature.length !== signature.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < computedSignature.length; i++) {
    mismatch |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Post a message to a Slack channel.
 */
export async function postSlackMessage(
  channel: string,
  text: string,
  blocks: unknown[],
  token: string
): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text, blocks }),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    console.error("Slack postMessage failed:", data.error);
  }
}

// Slack 署名検証（X-Slack-Signature / X-Slack-Request-Timestamp）
// https://api.slack.com/authentication/verifying-requests-from-slack

import crypto from 'node:crypto';

export function verifySlackSignature(rawBody, timestamp, signature, signingSecret) {
  if (!signingSecret) return false;
  if (!timestamp || !signature) return false;

  // 5分以上前のリクエストは弾く（リプレイ防止）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

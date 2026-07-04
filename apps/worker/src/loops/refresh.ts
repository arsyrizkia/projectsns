import {
  decryptSecret,
  encryptSecret,
  getConnector,
  type Db,
  type Platform,
} from "@projectsns/core";

/**
 * Refresh any channel token expiring within 7 days. Failures flip the
 * channel to needs_reauth — reconnect prompts are a normal UX path
 * (LinkedIn's limited refresh tokens make this unavoidable).
 */
export async function tokenRefreshTick(db: Db): Promise<void> {
  const channels = await db<
    {
      id: string;
      platform: Platform;
      access_token_ciphertext: string;
      refresh_token_ciphertext: string | null;
      token_expires_at: string | null;
    }[]
  >`
    select c.id, c.platform, cs.access_token_ciphertext, cs.refresh_token_ciphertext,
           c.token_expires_at
    from channels c
    join channel_secrets cs on cs.channel_id = c.id
    where c.status = 'active'
      and c.token_expires_at is not null
      and c.token_expires_at < now() + interval '7 days'
  `;

  for (const ch of channels) {
    try {
      const connector = getConnector(ch.platform);
      const result = await connector.refreshToken({
        accessToken: decryptSecret(ch.access_token_ciphertext),
        refreshToken: ch.refresh_token_ciphertext
          ? decryptSecret(ch.refresh_token_ciphertext)
          : undefined,
      });

      if ("reauthRequired" in result) {
        await db`
          update channels set status = 'needs_reauth', last_refresh_error = 'reauth required', updated_at = now()
          where id = ${ch.id}
        `;
        continue;
      }

      await db.begin(async (tx) => {
        await tx`
          update channel_secrets
          set access_token_ciphertext = ${encryptSecret(result.accessToken)},
              refresh_token_ciphertext = ${
                result.refreshToken ? encryptSecret(result.refreshToken) : null
              }
          where channel_id = ${ch.id}
        `;
        await tx`
          update channels
          set token_expires_at = ${result.expiresAt ? new Date(result.expiresAt) : null},
              last_refresh_at = now(), last_refresh_error = null, updated_at = now()
          where id = ${ch.id}
        `;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[refresh] channel ${ch.id} failed:`, msg);
      await db`
        update channels set status = 'needs_reauth', last_refresh_error = ${msg}, updated_at = now()
        where id = ${ch.id}
      `;
    }
  }
}

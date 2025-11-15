export const safe = (v: any): string => (v === undefined || v === null || v === '') ? 'N/A' : String(v);

export const safeAvatar = (url: any, headers: Record<string, string | undefined> = {}): string => {
  try {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
    if (typeof url === 'string' && url.startsWith('/')) {
      const proto = (headers['x-forwarded-proto'] as string) || (headers['cf-visitor'] && (() => {
        try { return JSON.parse(String(headers['cf-visitor'])).scheme; } catch(e) { return null; }
      })()) || 'https';
      const host = (headers['x-forwarded-host'] as string) || (headers['host'] as string) || '';
      if (host) return `${proto}://${host}${url}`;
    }
  } catch (e) {
    // fall through to default
  }
  return 'https://i.imgur.com/AfFp7pu.png';
};

export interface EmbedField { name: string; value: string; inline?: boolean }

export interface BuildPayloadOptions {
  title: string;
  description?: string;
  fields?: EmbedField[];
  color?: number;
  timestamp?: string;
  actorAvatar?: string;
  footerText?: string;
  headers?: Record<string, string | undefined>;
}

export const buildPayload = ({ title, description, fields = [], color = 0x2f3136, timestamp, actorAvatar, footerText, headers = {} }: BuildPayloadOptions) => {
  return {
    username: 'Monotone Development',
    avatar_url: safeAvatar(actorAvatar, headers),
    content: `${title} — ${description ? description.replace(/\*\*/g, '') : ''}`.trim(),
    embeds: [{
      title: title,
      description: description || undefined,
      color: color,
      fields: fields,
      timestamp: timestamp || new Date().toISOString(),
      thumbnail: { url: safeAvatar(actorAvatar, headers) },
      footer: { text: footerText || 'Plane2Discord' }
    }]
  };
};

export const convertColor = (hex?: string | number): number => {
  if (!hex) return 0x2f3136;
  try {
    const cleaned = String(hex).replace('#', '');
    const parsed = parseInt(cleaned, 16);
    return Number.isNaN(parsed) ? 0x2f3136 : parsed;
  } catch (e) {
    return 0x2f3136;
  }
};

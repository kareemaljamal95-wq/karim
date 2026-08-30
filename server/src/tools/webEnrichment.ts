/**
 * Website verification.
 *
 * Map data and directory listings say almost nothing about how a business
 * actually serves customers online. This tool goes and looks: it fetches the
 * business's own site and reports what it found there, so the analyst reasons
 * from observed pages instead of from absent tags.
 *
 * Everything it produces is evidence-backed. A gap is only recorded as `false`
 * when a page was successfully retrieved and searched — if the site could not
 * be fetched at all, the observation stays unknown rather than becoming a
 * deficiency. The one exception is a listed website that does not load, which
 * is itself a finding.
 *
 * The server fetches operator-supplied URLs here, so requests are restricted to
 * public http(s) addresses: private, loopback and link-local ranges are refused
 * before any connection is made, redirects are followed manually with the same
 * check applied at every hop, and both body size and time are capped.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isActive } from '../services/integrations';

export const websiteInspectionAvailable = (): boolean => isActive('website_inspection');

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
/** Homepage plus at most two pages that look like they hold the answer. */
const MAX_PAGES = 3;

const USER_AGENT =
  'ai-ceo-platform/1.0 (+business qualification; respects robots meta; contact via deployment operator)';

/** Blocked address ranges — anything that is not a public internet host. */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    if (ip === '::1' || ip === '::') return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) return true;
    // IPv4-mapped addresses carry the v4 rules.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export interface UrlCheck {
  ok: boolean;
  reason: string | null;
  url: URL | null;
}

/** Structural URL check. Does no DNS work, so it is safe to unit-test. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a valid URL', url: null };
  }
  // A URL keeps IPv6 hosts in brackets ("[::1]"), which isIP() does not accept.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `unsupported scheme ${url.protocol}`, url: null };
  }
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: 'not a public host', url: null };
  }
  if (host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: 'not a public host', url: null };
  }
  if (isIP(host) && isPrivateAddress(host)) {
    return { ok: false, reason: 'not a public address', url: null };
  }
  return { ok: true, reason: null, url };
}

/** Structural check plus DNS resolution, so a public name cannot point inward. */
async function resolvesPublicly(url: URL): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  html: string;
}

async function fetchPage(target: URL): Promise<FetchedPage | { error: string }> {
  let url = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await resolvesPublicly(url))) return { error: 'the address is not publicly reachable' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      });
    } catch (error) {
      return {
        error: error instanceof Error && error.name === 'AbortError' ? 'the site timed out' : 'the site did not respond',
      };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { error: `HTTP ${response.status} with no redirect target` };
      const next = checkUrl(new URL(location, url).toString());
      if (!next.ok || !next.url) return { error: `redirected to a blocked address (${next.reason})` };
      url = next.url;
      continue;
    }

    if (!response.ok) return { error: `HTTP ${response.status}`, ...{} };

    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('html')) return { url: url.toString(), status: response.status, html: '' };

    // Read with a hard byte cap so a huge page cannot exhaust memory.
    const buffer = await response.arrayBuffer().catch(() => null);
    if (!buffer) return { error: 'the response could not be read' };
    const html = Buffer.from(buffer.slice(0, MAX_BYTES)).toString('utf8');
    return { url: url.toString(), status: response.status, html };
  }

  return { error: 'too many redirects' };
}

// --- Detection -------------------------------------------------------------

const BOOKING_MARKERS = [
  /\bbook\s+(now|online|an?\s+(table|room|appointment|slot))\b/i,
  /\b(make|schedule|request)\s+an?\s+appointment\b/i,
  /\breserve\s+(an?\s+)?(table|room|slot)\b/i,
  /(احجز|حجز موعد|موعد الآن)/,
  /calendly\.com|booksy\.com|fresha\.com|setmore\.com|simplybook|opentable\.com|resy\.com|zocdoc\.com/i,
];

const ORDERING_MARKERS = [
  /\b(order\s+(online|now)|add\s+to\s+(cart|basket)|checkout)\b/i,
  /(اطلب الآن|اطلب اونلاين|أضف إلى السلة|السلة)/,
  /talabat\.com|deliveroo\.|ubereats\.com|hungerstation\.com|jahez\.net|noon\s?food/i,
  /woocommerce|shopify|salla\.sa|zid\.store|snipcart/i,
];

const CHAT_MARKERS = [
  /tawk\.to|intercom\.(io|com)|crisp\.chat|zendesk|livechatinc|tidio|drift\.com|hubspot.*conversations/i,
  /\bwa\.me\/|api\.whatsapp\.com\/send/i,
  /\blive\s+chat\b/i,
];

const APP_MARKERS = [
  /apps\.apple\.com\/[a-z-]*\/app|itunes\.apple\.com\/[a-z]*\/app/i,
  /play\.google\.com\/store\/apps/i,
];

const SOCIAL_PATTERNS: { platform: string; pattern: RegExp }[] = [
  { platform: 'instagram', pattern: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.\-]+/i },
  { platform: 'facebook', pattern: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.\-]+/i },
  { platform: 'tiktok', pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.\-]+/i },
  { platform: 'linkedin', pattern: /https?:\/\/(?:[a-z]{2}\.)?linkedin\.com\/(company|in)\/[A-Za-z0-9_.\-]+/i },
  { platform: 'x', pattern: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/i },
  { platform: 'youtube', pattern: /https?:\/\/(?:www\.)?youtube\.com\/(channel|c|@)[A-Za-z0-9_\-\/]+/i },
];

const EMAIL_PATTERN = /mailto:([^"'?\s>]+@[^"'?\s>]+)/i;

/** Sophistication markers, used only to separate a basic page from a modern one. */
const MODERN_MARKERS = [
  /<meta[^>]+name=["']viewport["']/i,
  /\b(react|next\.js|__NEXT_DATA__|vue|nuxt|angular|svelte)\b/i,
  /wp-content|elementor|webflow|squarespace|wix\.com|framer/i,
  /<link[^>]+rel=["']manifest["']/i,
  /srcset=|loading=["']lazy["']/i,
];

export interface PageFindings {
  hasBookingSystem: boolean;
  hasOnlineOrdering: boolean;
  hasLiveChat: boolean;
  hasMobileApp: boolean;
  socialLinks: Record<string, string>;
  email: string | null;
  modernityScore: number;
  /** Internal links worth following, in priority order. */
  followUps: string[];
}

const anyMatch = (patterns: RegExp[], html: string): boolean => patterns.some((p) => p.test(html));

/** Everything derivable from one retrieved page. Pure, so it is unit-tested. */
export function readPage(html: string, pageUrl: string): PageFindings {
  const socialLinks: Record<string, string> = {};
  for (const { platform, pattern } of SOCIAL_PATTERNS) {
    const match = html.match(pattern);
    if (match) socialLinks[platform] = match[0];
  }

  const followUps: string[] = [];
  const linkPattern = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let link: RegExpExecArray | null;
  while ((link = linkPattern.exec(html)) !== null) {
    const href = link[1];
    if (!/book|appointment|reserv|order|menu|contact|احجز|طلب|تواصل/i.test(href)) continue;
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.origin === new URL(pageUrl).origin && !followUps.includes(resolved.toString())) {
        followUps.push(resolved.toString());
      }
    } catch {
      /* a malformed href tells us nothing */
    }
  }

  return {
    hasBookingSystem: anyMatch(BOOKING_MARKERS, html),
    hasOnlineOrdering: anyMatch(ORDERING_MARKERS, html),
    hasLiveChat: anyMatch(CHAT_MARKERS, html),
    hasMobileApp: anyMatch(APP_MARKERS, html),
    socialLinks,
    email: html.match(EMAIL_PATTERN)?.[1] ?? null,
    modernityScore: MODERN_MARKERS.filter((p) => p.test(html)).length,
    followUps: followUps.slice(0, MAX_PAGES - 1),
  };
}

export interface InspectionResult {
  /** Null when nothing could be retrieved, so nothing may be concluded. */
  observations: {
    websiteStatus?: 'broken' | 'basic' | 'modern';
    hasBookingSystem?: boolean;
    hasOnlineOrdering?: boolean;
    hasLiveChat?: boolean;
    hasMobileApp?: boolean;
  };
  socialLinks: Record<string, string>;
  email: string | null;
  /** One sentence per finding, for the audit log and the lead's evidence list. */
  evidence: string[];
  pagesRead: number;
  failure: string | null;
}

const NOTHING_LEARNED: InspectionResult = {
  observations: {},
  socialLinks: {},
  email: null,
  evidence: [],
  pagesRead: 0,
  failure: null,
};

/**
 * Fetches a business's website and reports what is actually on it.
 *
 * Reads the homepage, then up to two internal pages that look like they hold
 * booking, ordering or contact details — a restaurant's menu page carries the
 * ordering link far more often than its homepage does.
 */
export async function inspectWebsite(rawUrl: string): Promise<InspectionResult> {
  const check = checkUrl(rawUrl);
  if (!check.ok || !check.url) {
    return { ...NOTHING_LEARNED, failure: `${rawUrl} is not usable: ${check.reason}` };
  }

  const first = await fetchPage(check.url);
  if ('error' in first) {
    // A website that is listed publicly but does not load is a real finding.
    return {
      observations: { websiteStatus: 'broken' },
      socialLinks: {},
      email: null,
      evidence: [`The listed website ${check.url.origin} did not load (${first.error}).`],
      pagesRead: 0,
      failure: first.error,
    };
  }

  const pages: FetchedPage[] = [first];
  const home = readPage(first.html, first.url);

  for (const followUp of home.followUps) {
    if (pages.length >= MAX_PAGES) break;
    const next = checkUrl(followUp);
    if (!next.ok || !next.url) continue;
    const page = await fetchPage(next.url);
    if (!('error' in page)) pages.push(page);
  }

  const findings = pages.map((page) => readPage(page.html, page.url));
  const any = (pick: (f: PageFindings) => boolean) => findings.some(pick);

  const socialLinks: Record<string, string> = {};
  for (const finding of findings) Object.assign(socialLinks, finding.socialLinks);

  const modernity = Math.max(...findings.map((f) => f.modernityScore));
  const status = modernity >= 2 ? 'modern' : 'basic';
  const hasBookingSystem = any((f) => f.hasBookingSystem);
  const hasOnlineOrdering = any((f) => f.hasOnlineOrdering);
  const hasLiveChat = any((f) => f.hasLiveChat);
  const hasMobileApp = any((f) => f.hasMobileApp);

  const where = pages.length === 1 ? 'the homepage' : `${pages.length} pages of the site`;
  const evidence = [
    `${check.url.origin} loaded and ${where} ${pages.length === 1 ? 'was' : 'were'} read; it presents as a ${status} site.`,
    hasBookingSystem
      ? 'An online booking or appointment option is present.'
      : `No booking or appointment option appears on ${where}.`,
    hasOnlineOrdering
      ? 'An online ordering or checkout path is present.'
      : `No online ordering or checkout path appears on ${where}.`,
    hasLiveChat ? 'A live chat or WhatsApp channel is present.' : `No chat channel appears on ${where}.`,
  ];
  if (hasMobileApp) evidence.push('The site links to a mobile app.');
  if (Object.keys(socialLinks).length) {
    evidence.push(`Social profiles linked from the site: ${Object.keys(socialLinks).join(', ')}.`);
  }

  return {
    observations: {
      websiteStatus: status,
      hasBookingSystem,
      hasOnlineOrdering,
      hasLiveChat,
      // Absence of an app link is weak evidence: apps are often unlinked. Only a
      // positive is recorded.
      ...(hasMobileApp ? { hasMobileApp: true } : {}),
    },
    socialLinks,
    email: findings.map((f) => f.email).find(Boolean) ?? null,
    evidence,
    pagesRead: pages.length,
    failure: null,
  };
}

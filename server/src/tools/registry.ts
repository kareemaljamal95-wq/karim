import { generateDemoBusinesses, DEMO_NOTICE } from './demoData';
import { googlePlacesAvailable, searchGooglePlaces } from './googlePlaces';
import { isActive } from '../services/integrations';
import { log } from '../services/logger';
import type { DiscoveredBusiness } from '../domain/business';

export interface ToolDescriptor {
  key: string;
  name: string;
  description: string;
  /** Integration that must be connected for the tool to run live. */
  requires: string | null;
  available: boolean;
  /** Whether the tool falls back to demo output when unavailable. */
  hasDemoFallback: boolean;
}

/**
 * The tool layer agents are allowed to reach for. Keeping this list explicit
 * means an agent's `tools` configuration can be validated against reality, and
 * the Agent Control Center can show exactly which capabilities are live.
 */
export function listTools(): ToolDescriptor[] {
  return [
    {
      key: 'business_discovery',
      name: 'Business discovery',
      description: 'Finds businesses by country, city, area and category.',
      requires: 'google_places',
      available: googlePlacesAvailable(),
      hasDemoFallback: true,
    },
    {
      key: 'llm_reasoning',
      name: 'LLM reasoning',
      description: 'Claude-powered analysis and copywriting.',
      requires: 'anthropic',
      available: isActive('anthropic'),
      hasDemoFallback: true,
    },
    {
      key: 'email_send',
      name: 'Email delivery',
      description: 'Sends an approved message over email.',
      requires: 'gmail',
      available: isActive('gmail'),
      hasDemoFallback: false,
    },
    {
      key: 'whatsapp_send',
      name: 'WhatsApp delivery',
      description: 'Sends an approved message over WhatsApp Business.',
      requires: 'whatsapp_business',
      available: isActive('whatsapp_business'),
      hasDemoFallback: false,
    },
    {
      key: 'crm_sync',
      name: 'CRM sync',
      description: 'Pushes leads and stage changes to an external CRM.',
      requires: 'crm',
      available: isActive('crm'),
      hasDemoFallback: false,
    },
    {
      key: 'webhook_notify',
      name: 'Webhook notification',
      description: 'Notifies an external endpoint about platform events.',
      requires: 'webhooks',
      available: isActive('webhooks'),
      hasDemoFallback: false,
    },
  ];
}

export interface DiscoveryResult {
  businesses: DiscoveredBusiness[];
  source: 'google_places' | 'demo';
  demo: boolean;
  query: string;
  notice: string | null;
  /** Set when a live search was attempted and failed. */
  degradedReason: string | null;
}

/**
 * Discovery entry point used by the Market Scout.
 *
 * Live Places data is preferred whenever the integration is connected. If it is
 * not connected — or a live call fails — the platform returns clearly-labelled
 * demo data instead of failing the run, and records why.
 */
export async function discoverBusinesses(params: {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
  runId?: string | null;
}): Promise<DiscoveryResult> {
  const locationParts = [params.area, params.city, params.country].filter(Boolean).join(', ');
  const query = `${params.category} in ${locationParts}`;

  if (googlePlacesAvailable()) {
    try {
      const live = await searchGooglePlaces(params);
      return {
        businesses: live.businesses,
        source: 'google_places',
        demo: false,
        query: live.query,
        notice: null,
        degradedReason: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown discovery error';
      log({
        level: 'warn',
        actorType: 'agent',
        actor: 'market_scout',
        action: 'discovery.fallback',
        runId: params.runId ?? null,
        message: `Live discovery failed, using demo data instead: ${message}`,
        meta: { query },
      });
      return {
        businesses: generateDemoBusinesses(params),
        source: 'demo',
        demo: true,
        query,
        notice: DEMO_NOTICE,
        degradedReason: message,
      };
    }
  }

  return {
    businesses: generateDemoBusinesses(params),
    source: 'demo',
    demo: true,
    query,
    notice: DEMO_NOTICE,
    degradedReason: null,
  };
}

import type { ServiceDefinition, ServiceKey, Signal, SignalKey } from '../types';
import { categoryFamily, ORDERING_FAMILIES, BOOKING_FAMILIES, type DiscoveredBusiness } from './business';
import { hasSignal } from './signals';

/**
 * The catalogue of services the platform can recommend. A service is only ever
 * recommendable when at least one of its `requiredSignals` was actually
 * observed — the system must never suggest a service just because it exists.
 */
export const SERVICE_CATALOG: ServiceDefinition[] = [
  {
    key: 'website',
    label: 'Website',
    requiredSignals: ['no_website', 'poor_website'],
    valueBand: { low: 1500, high: 6000 },
    summary: 'A fast, mobile-first site with the information customers ask for most.',
  },
  {
    key: 'ordering_system',
    label: 'Ordering system',
    requiredSignals: ['no_online_ordering', 'poor_online_ordering'],
    valueBand: { low: 3500, high: 12000 },
    summary: 'Online ordering with menu management, payments and order tracking.',
  },
  {
    key: 'booking_system',
    label: 'Booking system',
    requiredSignals: ['no_booking_system'],
    valueBand: { low: 2500, high: 9000 },
    summary: 'Self-service appointment booking with reminders that cut no-shows.',
  },
  {
    key: 'ai_customer_service_agent',
    label: 'AI customer service agent',
    requiredSignals: ['repetitive_service_load', 'weak_customer_communication', 'no_automation'],
    valueBand: { low: 2500, high: 10000 },
    summary: 'An assistant that answers repeat questions instantly, 24/7, in the customer’s language.',
  },
  {
    key: 'whatsapp_website_ai_assistant',
    label: 'WhatsApp / website AI assistant',
    requiredSignals: ['repetitive_service_load', 'no_automation', 'high_customer_activity'],
    valueBand: { low: 2000, high: 8000 },
    summary: 'A WhatsApp and website assistant that captures enquiries even after hours.',
  },
  {
    key: 'mobile_application',
    label: 'Mobile application',
    requiredSignals: ['no_mobile_app', 'large_review_volume'],
    valueBand: { low: 8000, high: 40000 },
    summary: 'A customer app for repeat ordering, loyalty and push re-engagement.',
  },
  {
    key: 'crm',
    label: 'CRM',
    requiredSignals: ['weak_customer_communication', 'no_automation'],
    valueBand: { low: 3000, high: 12000 },
    summary: 'A single place to track enquiries, follow-ups and repeat customers.',
  },
  {
    key: 'lead_generation_system',
    label: 'Lead-generation system',
    requiredSignals: ['poor_social_presence', 'no_website'],
    valueBand: { low: 2500, high: 10000 },
    summary: 'Landing pages plus tracked capture so demand stops leaking.',
  },
  {
    key: 'ai_marketing_automation',
    label: 'AI marketing automation',
    requiredSignals: ['poor_social_presence', 'high_customer_activity'],
    valueBand: { low: 2000, high: 9000 },
    summary: 'Automated campaigns that bring existing customers back.',
  },
  {
    key: 'social_media_automation',
    label: 'Social media automation',
    requiredSignals: ['poor_social_presence'],
    valueBand: { low: 1200, high: 5000 },
    summary: 'Consistent, scheduled social presence without daily manual effort.',
  },
  {
    key: 'internal_business_automation',
    label: 'Internal business automation',
    requiredSignals: ['no_automation', 'repetitive_service_load'],
    valueBand: { low: 3000, high: 15000 },
    summary: 'Removes repetitive back-office work so staff time goes to customers.',
  },
  {
    key: 'custom_ai_agent',
    label: 'Custom AI agent',
    requiredSignals: ['repetitive_service_load', 'large_review_volume'],
    valueBand: { low: 5000, high: 25000 },
    summary: 'A bespoke agent built around this business’s specific workflow.',
  },
];

export const serviceByKey = (key: string): ServiceDefinition | undefined =>
  SERVICE_CATALOG.find((s) => s.key === key);

export interface ServiceMatch {
  service: ServiceDefinition;
  score: number;
  matchedSignals: Signal[];
  rationale: string;
}

/** Category-family affinity — a booking system matters more to a clinic than a shop. */
function familyBoost(serviceKey: ServiceKey, business: DiscoveredBusiness): number {
  const family = categoryFamily(business.category);
  if (serviceKey === 'ordering_system' && ORDERING_FAMILIES.includes(family)) return 12;
  if (serviceKey === 'booking_system' && BOOKING_FAMILIES.includes(family)) return 12;
  if (serviceKey === 'mobile_application' && family === 'food') return 6;
  if (serviceKey === 'crm' && family === 'property') return 10;
  if (serviceKey === 'lead_generation_system' && family === 'property') return 8;
  return 0;
}

/**
 * Ranks services by how much observed evidence supports them.
 * Returns only services with at least one matched signal.
 */
export function rankServices(
  business: DiscoveredBusiness,
  signals: Signal[],
  allowedServices: ServiceKey[] = [],
): ServiceMatch[] {
  const allowed = allowedServices.length
    ? SERVICE_CATALOG.filter((s) => allowedServices.includes(s.key))
    : SERVICE_CATALOG;

  const matches: ServiceMatch[] = [];
  for (const service of allowed) {
    const matched = signals.filter((s) => service.requiredSignals.includes(s.key as SignalKey));
    if (matched.length === 0) continue;

    const evidenceScore = matched.reduce((sum, s) => sum + s.weight * s.confidence, 0);
    const score = Math.round(evidenceScore + familyBoost(service.key, business));

    matches.push({
      service,
      score,
      matchedSignals: matched,
      rationale: `${service.label} is supported by ${matched.length} observed signal${
        matched.length === 1 ? '' : 's'
      }: ${matched.map((m) => m.label.toLowerCase()).join(', ')}.`,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Estimated project value. Anchored to the service's published band and scaled
 * by observable business size — never a number invented per lead.
 */
export function estimateValue(service: ServiceDefinition, business: DiscoveredBusiness): number {
  const reviews = business.reviewCount ?? 0;
  const priceLevel = business.observations?.priceLevel ?? 2;

  // Size factor 0..1 from review volume (a proxy for customer throughput).
  const sizeFactor = Math.min(1, Math.log10(Math.max(reviews, 1) + 1) / Math.log10(1001));
  // Price level nudges the band by up to ±15%.
  const priceFactor = 0.85 + (Math.min(Math.max(priceLevel, 1), 4) - 1) * 0.1;

  const span = service.valueBand.high - service.valueBand.low;
  const raw = (service.valueBand.low + span * sizeFactor) * priceFactor;
  // Round to a defensible increment so estimates never look falsely precise.
  return Math.round(raw / 250) * 250;
}

export function summariseProblem(matches: ServiceMatch[], signals: Signal[]): string {
  if (!matches.length) {
    return 'No clear digital gap was observed from the available public information.';
  }
  const top = matches[0];
  const drivers = top.matchedSignals.slice(0, 3).map((s) => s.evidence);
  const demand = hasSignal(signals, 'high_customer_activity')
    ? ' The business already has steady customer volume, so the gap costs them real revenue.'
    : '';
  return `${drivers.join(' ')}${demand}`;
}

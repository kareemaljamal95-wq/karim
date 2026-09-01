/**
 * The demo dataset.
 *
 * Exported as a function so it can be run two ways: from the CLI (`npm run
 * seed`) and once on first boot when `SEED_DEMO_DATA=true` — a deployed
 * container has no shell to run the CLI from.
 *
 * Safe to re-run: `runDiscoveryWorkflow` deduplicates leads, so a second run
 * refreshes the analysis instead of creating copies. Everything it creates is
 * flagged as demo data end to end.
 */
import { runDiscoveryWorkflow } from '../orchestrator/engine';
import { handleInboundReply } from '../orchestrator/replies';
import { listLeads } from '../services/leads';
import { log } from '../services/logger';

const SCENARIOS = [
  { country: 'United Arab Emirates', city: 'Dubai', area: 'Al Barsha', category: 'Restaurants', limit: 8 },
  { country: 'United Arab Emirates', city: 'Dubai', area: 'Jumeirah', category: 'Beauty salons', limit: 6 },
  { country: 'United Arab Emirates', city: 'Abu Dhabi', area: '', category: 'Dental clinics', limit: 6 },
  { country: 'Saudi Arabia', city: 'Riyadh', area: 'Al Olaya', category: 'Car workshops', limit: 6 },
  { country: 'Qatar', city: 'Doha', area: 'West Bay', category: 'Real estate offices', limit: 5 },
];

const SAMPLE_REPLIES = [
  {
    match: 'Restaurants',
    body: 'Hi, thanks for reaching out. We have been thinking about this. I need an application for my restaurant with online ordering and delivery. Can you tell me what it would cost and how long it takes?',
  },
  {
    match: 'Beauty salons',
    body: 'Interested — we lose a lot of bookings on WhatsApp because nobody answers in the evening. Could we have a quick call next week?',
  },
  {
    match: 'Dental clinics',
    body: 'We already work with an agency, so not right now. Thanks anyway.',
  },
];

export async function seedDemoData(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Seeding demo data...\n');

  for (const scenario of SCENARIOS) {
    const summary = await runDiscoveryWorkflow({ ...scenario, actor: 'seed@ai-ceo.local' });
    // eslint-disable-next-line no-console
    console.log(
      `  ${scenario.category} in ${scenario.city}: ${summary.imported} new, ${summary.duplicates} duplicates, ` +
        `${summary.qualified} qualified, ${summary.messagesDrafted} drafts, ${summary.approvalsCreated} approvals` +
        `${summary.demo ? ' [DEMO DATA]' : ''}`,
    );
  }

  // A couple of inbound replies so the Conversation and Projects surfaces are
  // populated with something real to look at.
  for (const reply of SAMPLE_REPLIES) {
    const candidates = listLeads({ category: reply.match, limit: 5 }).items.filter(
      (lead) => lead.email || lead.phone,
    );
    const lead = candidates[0];
    if (!lead) continue;
    const result = await handleInboundReply({
      leadId: lead.id,
      channel: 'email',
      body: reply.body,
      actor: 'seed@ai-ceo.local',
    });
    // eslint-disable-next-line no-console
    console.log(
      `  Reply from ${lead.businessName}: intent="${result.analysis.intent}", ` +
        `human review ${result.requiresHuman ? 'required' : 'not required'}` +
        `${result.project ? `, project "${result.project.title}" created` : ''}`,
    );
  }

  log({
    actorType: 'system',
    action: 'system.seeded',
    message: 'Demo dataset seeded. All generated leads are flagged as demo data.',
  });

  // eslint-disable-next-line no-console
  console.log('\nDone. Everything created by the seed is labelled as demo data.');
}

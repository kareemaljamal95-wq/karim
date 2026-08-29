/**
 * Seeds the platform with a realistic, clearly-labelled demo dataset.
 *
 * Run with `npm run seed`. Safe to re-run: leads are deduplicated, so a second
 * run refreshes analysis instead of creating copies. The dataset itself lives
 * in `seed-demo.ts` so the server can also run it on first boot.
 */
import { bootstrap } from '../index';
import { seedDemoData } from './seed-demo';

async function main(): Promise<void> {
  bootstrap();
  await seedDemoData();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Seeding failed:', error);
  process.exit(1);
});

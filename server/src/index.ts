import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { assertProductionSecrets, env } from './config/env';
import { db } from './db';
import { apiRouter } from './routes';
import { attachUser } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { seedAgents } from './agents/registry';
import { getSettings } from './services/settings';
import { seedWorkflows } from './services/workflows';
import { ensureIntegrationRows } from './services/integrations';
import { applyAdminPasswordReset, ensureBootstrapAdmin } from './services/users';
import { listLeads } from './services/leads';
import { seedDemoData } from './db/seed-demo';
import { log } from './services/logger';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      // The dashboard is served from the same origin in production.
      contentSecurityPolicy: env.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',') }));
  app.use(express.json({ limit: '2mb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(attachUser);

  app.use('/api', apiRouter);

  // The public site, served on the marketing domain and at /landing for a
  // preview. It shares this process because it is one static file: a second
  // service to host it would cost more to run than it does to serve.
  const landingPage = path.join(__dirname, 'site', 'landing.html');
  if (fs.existsSync(landingPage)) {
    app.get('/landing', (_req, res) => res.sendFile(landingPage));
    app.get('/', (req, res, next) => {
      // Read per request, so pointing a domain at the platform takes effect as
      // soon as it is saved in Settings rather than on the next deploy.
      const domain = getSettings().marketingDomain;
      const hosts = domain ? [domain, `www.${domain}`] : [];
      if (hosts.includes(req.hostname.toLowerCase())) return res.sendFile(landingPage);
      return next();
    });
  }

  // Serve the built dashboard when it exists (production single-process mode).
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export function bootstrap(): void {
  db(); // applies the schema
  seedAgents();
  seedWorkflows();
  ensureIntegrationRows();

  const admin = ensureBootstrapAdmin();
  if (admin) {
    // eslint-disable-next-line no-console
    console.log(
      `\n  Bootstrap admin created: ${admin.email}` +
        `\n  Password: ${env.bootstrapAdminPassword}` +
        '\n  Change it from Settings → Team after signing in.\n',
    );
    log({
      actorType: 'system',
      action: 'system.bootstrap',
      message: `Bootstrap admin account created for ${admin.email}`,
    });
  }

  const recovered = applyAdminPasswordReset();
  if (recovered) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n  [recovery] Admin password reset for ${recovered.email}.` +
        '\n  Sign in, change it from Settings → Team, then REMOVE the' +
        ' ADMIN_PASSWORD_RESET variable.\n',
    );
    log({
      actorType: 'system',
      action: 'user.password_recovered',
      message: `Admin password reset on boot for ${recovered.email} via ADMIN_PASSWORD_RESET`,
    });
  }

  for (const warning of assertProductionSecrets()) {
    // eslint-disable-next-line no-console
    console.warn(`[security] ${warning}`);
  }
}

/**
 * Runs the demo dataset once, in the background, when `SEED_DEMO_DATA` is on
 * and no leads exist yet. It runs after the server is listening so health
 * checks answer immediately, and a failure is logged rather than fatal — an
 * empty dashboard is a much smaller problem than a server that will not boot.
 */
function seedDemoDataIfRequested(): void {
  if (!env.seedDemoData) return;
  if (listLeads({ limit: 1 }).total > 0) return;

  seedDemoData().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Demo seeding failed:', error);
    log({
      actorType: 'system',
      action: 'system.seed_failed',
      message: `Demo seeding failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
}

if (require.main === module) {
  bootstrap();
  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `AI CEO platform API listening on http://localhost:${env.port}` +
        `\n  Demo mode: ${env.demoMode ? 'on' : 'off'} | Outbound sending: ${
          getSettings().outboundSendingEnabled ? 'ENABLED' : 'disabled'
        }`,
    );
    seedDemoDataIfRequested();
  });
}

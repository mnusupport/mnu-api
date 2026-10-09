import { config } from 'dotenv';
config(); // Load .env file so Cloudinary credentials are available

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { RequestSafetyPipe } from './common/pipes/request-safety.pipe';
import { HttpErrorFilter } from './common/filters/http-error.filter';

// Menu item image uploads (Day 18) depend entirely on these three vars
// being real, not just present in .env.example. Missing them doesn't
// crash the app — every other feature works fine without images — but
// it previously meant the first sign of trouble was a customer-facing
// upload failure discovered one form submission at a time. This makes
// the gap visible the moment the API starts instead.
function validateProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;

  const required = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS'];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Production configuration is incomplete. Missing: ${missing.join(', ')}`);
  }

  if ((process.env.JWT_SECRET ?? '').length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }

  if (/(^|@|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/i.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL must not point to a local MongoDB in production.');
  }

  // Menu-image uploads are required for the pilot. Customer ordering no
  // longer depends on an SMS provider.
  const requiredServices = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ].filter((key) => !process.env[key]?.trim());
  if (requiredServices.length > 0) {
    throw new Error(`Production external-service configuration is incomplete. Missing: ${requiredServices.join(', ')}`);
  }

  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:') {
        throw new Error(`CORS_ORIGINS must use HTTPS in production: ${origin}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CORS_ORIGINS')) throw error;
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  }
}

function warnIfCloudinaryUnconfigured() {
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠️  Menu item image uploads are DISABLED: missing ${missing.join(', ')} in backend/.env. ` +
        'Get these three values from your Cloudinary dashboard (Settings → API Keys) and add them to .env — see .env.example.',
    );
  }
}

async function bootstrap() {
  validateProductionConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Let SIGTERM/SIGINT (sent by the host on every redeploy) close the HTTP
  // server and the MongoDB connection cleanly instead of dropping requests.
  app.enableShutdownHooks();
  // Behind a hosting proxy/load balancer, req.ip is the proxy unless Express
  // is told how many proxy hops to trust. Without this the per-IP rate limits
  // (login and public ordering) would treat ALL users as one client. Set
  // TRUST_PROXY=1 on hosts that put exactly one proxy in front of the API.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');
  }
  const httpLogger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', () => {
      // Method, path (query string dropped), status, duration only — never
      // headers, bodies, tokens, OTP codes or phone numbers.
      const path = req.originalUrl.split('?')[0];
      const line = `${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`;
      if (res.statusCode >= 500) httpLogger.error(line);
      else if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) httpLogger.warn(line);
      else if (process.env.NODE_ENV !== 'production') httpLogger.log(line);
    });
    next();
  });
  // Keep JSON/urlencoded requests bounded. Multipart uploads have their own
  // 8MB Multer ceiling in MenuController.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.useGlobalPipes(new RequestSafetyPipe());
  app.useGlobalFilters(new HttpErrorFilter());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const developmentCorsOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  const allowedCorsOrigins =
    process.env.NODE_ENV === 'production'
      ? [...new Set(configuredCorsOrigins)]
      : [...new Set([...developmentCorsOrigins, ...configuredCorsOrigins])];

  const isAllowedDevelopmentOrigin = (origin: string) => {
    if (process.env.NODE_ENV === 'production') return false;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

      // Local development may run the frontend from another device/container
      // on the same LAN (for example http://172.20.10.3:3000). Keep this
      // convenience limited to port 3000 and private/local IPv4 ranges;
      // production continues to use only CORS_ORIGINS.
      const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (isLocalHost) return true;

      const ipv4 = url.hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!ipv4 || url.port !== '3000') return false;
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((octet) => octet < 0 || octet > 255)) return false;
      const [a, b] = octets;
      return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    } catch {
      return false;
    }
  };

  app.enableCors({
    origin: (origin, callback) => {
      // Same-origin requests and non-browser clients do not send Origin.
      if (!origin) return callback(null, true);
      if (allowedCorsOrigins.includes(origin) || isAllowedDevelopmentOrigin(origin)) {
        return callback(null, true);
      }

      // Do not throw here. Express CORS treats callback(null, false) as a
      // normal rejected CORS request, whereas throwing an Error is picked up
      // by the global exception filter and turns browser preflight requests
      // into misleading HTTP 500 responses. Production remains allowlisted.
      return callback(null, false);
    },
  });
  warnIfCloudinaryUnconfigured();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`MnU API listening on port ${port} (${process.env.NODE_ENV ?? 'development'})`);
}
bootstrap().catch((error) => {
  // Startup failure (bad config, unreachable MongoDB, ...) must be visible in
  // host logs and must exit non-zero so the platform does not mark it healthy.
  // Only the error name/message is logged; connection strings are not part of
  // the config errors thrown above.
  // eslint-disable-next-line no-console
  console.error('MnU API failed to start:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
  process.exit(1);
});
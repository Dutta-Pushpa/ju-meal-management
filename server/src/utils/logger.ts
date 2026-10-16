import pino from 'pino';
import type { AppConfig } from '../config/env.js';

/**
 * Structured logging.
 *
 * Development gets readable pretty output. Every other environment gets
 * newline-delimited JSON so a log collector can index the fields rather than
 * scrape them out of a formatted string.
 */
export function createLogger(config: AppConfig) {
  const pretty = config.NODE_ENV === 'development' && config.LOG_PRETTY;

  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: 'ju-meal-server',
      env: config.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      // Never let a credential reach the log sink, even by accident.
      paths: [
        'password',
        '*.password',
        'passwordHash',
        '*.passwordHash',
        'password_hash',
        'token',
        '*.token',
        'accessToken',
        '*.accessToken',
        'authorization',
        '*.authorization',
        'headers.cookie',
        'headers.authorization',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname,service,env',
            },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;

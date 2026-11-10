import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../shared/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** In-memory outbox used by the console provider; tests read it to obtain links. */
export const devOutbox: EmailMessage[] = [];

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    devOutbox.push(message);
    if (devOutbox.length > 200) devOutbox.shift();
    // Development only: the body may contain one-time links, so it is printed only outside deployed envs
    // (env validation forbids the console provider in staging/production).
    logger.info({ to: message.to, subject: message.subject }, 'email (console provider)');
    if (env.NODE_ENV === 'development') console.log(`\n--- EMAIL to ${message.to}: ${message.subject}\n${message.text}\n---\n`);
  }
}

class SmtpEmailProvider implements EmailProvider {
  private transport = nodemailer.createTransport(env.SMTP_URL);
  async send(message: EmailMessage) {
    await this.transport.sendMail({ from: env.EMAIL_FROM, ...message });
  }
}

export const emailProvider: EmailProvider = env.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider() : new ConsoleEmailProvider();

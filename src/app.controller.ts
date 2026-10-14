import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller()
export class AppController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private readonly logger = new Logger(AppController.name);

  // Liveness + database readiness. Returns 200 when MongoDB answers a ping,
  // 503 otherwise, so a host health check / uptime monitor can act on it.
  // The body never contains connection strings, hostnames or error details.
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    try {
      if (!this.connection.db) throw new Error('not ready');
      await this.connection.db.admin().ping();
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      this.logger.error(`Health check failed: database unreachable (${error instanceof Error ? error.name : 'unknown'})`);
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', database: 'disconnected' };
    }
  }
}

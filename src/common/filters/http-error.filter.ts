import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message = typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'message' in raw
          ? (raw as { message: unknown }).message
          : 'Request failed.';
      const error = raw && typeof raw === 'object' && 'error' in raw
        ? (raw as { error: unknown }).error
        : undefined;

      response.status(status).json({
        statusCode: status,
        message,
        ...(typeof error === 'string' ? { error } : {}),
      });
      return;
    }

    // Never serialize an arbitrary exception: Mongoose/database errors can
    // contain stack traces, query internals, collection names or connection
    // details. Log only a safe production diagnostic and return a generic 500.
    // The stack FRAMES (not the message, which may echo user data or driver
    // details) go to server logs only, so production 500s are diagnosable.
    const frames = exception instanceof Error ? (exception.stack ?? '').split('\n').slice(1, 6).join('\n') : '';
    this.logger.error(`${request.method} ${request.originalUrl.split('?')[0]} -> 500 (${exception instanceof Error ? exception.name : 'UnknownError'})\n${frames}`);
    response.status(500).json({
      statusCode: 500,
      message: 'Internal server error.',
      error: 'Internal Server Error',
    });
  }
}

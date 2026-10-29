import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiErrorResponse, ApiErrorDetail } from '@bidstream/contracts';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: ApiErrorDetail[] | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj['message'] as string) || exception.message;

        // Check if nestjs-zod or class-validator formatted errors exist
        if (Array.isArray(resObj['errors'])) {
          errors = (resObj['errors'] as unknown[]).map((err) => {
            if (typeof err === 'object' && err !== null) {
              const e = err as Record<string, unknown>;
              return {
                field:
                  typeof e['path'] === 'string'
                    ? e['path']
                    : Array.isArray(e['path'])
                      ? e['path'].join('.')
                      : undefined,
                message: typeof e['message'] === 'string' ? e['message'] : String(err),
              };
            }
            return { message: String(err) };
          });
        }
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation failed';
      errors = exception.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const requestId = request.headers['x-request-id'] as string | undefined;

    const errorPayload: ApiErrorResponse = {
      success: false,
      statusCode: status,
      message,
      ...(errors && errors.length > 0 ? { errors } : {}),
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(errorPayload);
  }
}

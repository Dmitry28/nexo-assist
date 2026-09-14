import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { sentryCapture } from '@/__tests__/helpers/sentry';

import { AllExceptionsFilter } from '../all-exceptions.filter';

/** Minimal HTTP ArgumentsHost double; captures the JSON body the filter writes. */
const makeHost = (url = '/api/v1/x') => {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const request = { method: 'GET', url };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  const body = () => response.json.mock.calls[0][0] as Record<string, unknown>;
  return { host, response, body };
};

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter(makeAppConfig());
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('shapes an HttpException with its status and message', () => {
    const { host, response, body } = makeHost();

    filter.catch(new NotFoundException('No such thing'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(body()).toMatchObject({ statusCode: 404, message: 'No such thing', path: '/api/v1/x' });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('passes a ValidationPipe message array through', () => {
    const { host, body } = makeHost();

    filter.catch(new BadRequestException(['a must be a string', 'b must be a number']), host);

    expect(body().message).toEqual(['a must be a string', 'b must be a number']);
  });

  it('returns a generic 500 for an unknown error — internals never leak to the client', () => {
    const { host, response, body } = makeHost();

    filter.catch(new Error('db password is hunter2'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(body())).not.toContain('hunter2');
    expect(body().message).toBe('Internal server error');
    // ...but the real error is logged with its stack for operators.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('500'),
      expect.stringContaining('hunter2'),
    );
    // A 5xx on a real route is a bug, and logs alone are not read.
    expect(sentryCapture()).toHaveBeenCalled();
  });

  // The orchestrator re-asks every few seconds, so a database blip would otherwise become
  // hundreds of Sentry events for a condition the probe already reports by failing.
  it('does not report a failing readiness probe, but still logs which check failed', () => {
    const { host } = makeHost('/api/v1/health/ready');

    filter.catch(new ServiceUnavailableException({ error: { database: 'down' } }), host);

    expect(sentryCapture()).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('503'), expect.anything());
  });
});

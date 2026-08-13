export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m = 'You do not have permission to perform this action') =>
  new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Resource not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');
export const failedDependency = (m: string) => new HttpError(424, m, 'integration_not_configured');

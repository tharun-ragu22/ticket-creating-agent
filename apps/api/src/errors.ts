/**
 * Errors the HTTP layer raises directly.
 *
 * Domain errors — UnauthenticatedError, CallerNotFoundError — deliberately
 * live with the code that raises them and carry no status code; app.ts is the
 * single place that translates either kind into a response.
 */
export class BadRequestError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'BadRequestError';
  }
}

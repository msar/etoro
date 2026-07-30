export class EtoroApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'EtoroApiError';
  }
}

export class EtoroRateLimitError extends EtoroApiError {
  constructor(msg = 'eToro rate limit exceeded') {
    super(msg, 429);
    this.name = 'EtoroRateLimitError';
  }
}

export class EtoroPayloadTooLargeError extends EtoroApiError {
  constructor(statusCode: 413 | 414, msg = 'Payload or URI too large') {
    super(msg, statusCode);
    this.name = 'EtoroPayloadTooLargeError';
  }
}

export class EtoroForbiddenError extends EtoroApiError {
  constructor(msg = 'Forbidden') {
    super(msg, 403);
    this.name = 'EtoroForbiddenError';
  }
}

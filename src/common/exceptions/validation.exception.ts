export interface ValidationError {
  field: string;
  message: string;
}

export class ValidationException extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
  ) {
    super(message);
    this.name = 'ValidationException';
  }
}

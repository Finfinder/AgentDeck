// ?? Error classification ??????????????????????????????????????????????????

/**
 * Classifies a raw error into a normalized error code for SendMessageResult.
 * Used by adapters to yield consistent { type: 'error' } events.
 */
export function classifyError(err: unknown): 'NETWORK_ERROR' | 'MODEL_ERROR' | 'PROVIDER_ERROR' {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network-level errors: DNS, connection refused, socket hang up, timeout
    if (
      msg.includes('fetch failed') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('dns') ||
      msg.includes('getaddrinfo') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('abort')
    ) {
      return 'NETWORK_ERROR';
    }
    // Model-level errors: model not found, context length exceeded, invalid model
    if (
      msg.includes('context length') ||
      msg.includes('context_length') ||
      msg.includes('max tokens') ||
      (msg.includes('model') &&
        (msg.includes('not found') ||
          msg.includes('does not exist') ||
          msg.includes('invalid model')))
    ) {
      return 'MODEL_ERROR';
    }
  }
  return 'PROVIDER_ERROR';
}

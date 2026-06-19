import { describe, it, expect } from 'vitest';
import { redactSecrets } from '@agentdeck/memory-service';

const shortOpenAiKey = 'sk-' + 'c'.repeat(32);
const bearerJwt = 'eyJ' + 'm'.repeat(30);

describe('redactSecrets more patterns', () => {
  it('should redact multiple secrets in one string', () => {
    const input = `OPENAI_API_KEY=${shortOpenAiKey} PASSWORD=secret123`;
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(shortOpenAiKey);
    expect(result).not.toContain('secret123');
  });

  it('should handle mixed case patterns', () => {
    expect(redactSecrets('api_key=abc123')).toContain('[REDACTED]');
    expect(redactSecrets('API_KEY=abc123')).toContain('[REDACTED]');
    expect(redactSecrets('Api_Key=abc123')).toContain('[REDACTED]');
  });

  it('should handle secrets with colons', () => {
    expect(redactSecrets(`OPENAI_API_KEY: ${shortOpenAiKey}`)).toContain('[REDACTED]');
  });

  it('should handle Bearer with various tokens', () => {
    expect(redactSecrets('Bearer abc123def456')).toBe('Bearer [REDACTED]');
    expect(redactSecrets(`Bearer ${bearerJwt}`)).toBe('Bearer [REDACTED]');
  });

  it('should handle Basic auth with various encodings', () => {
    expect(redactSecrets('Basic bbbbbbbbbbbb')).toBe('Basic [REDACTED]');
    expect(redactSecrets('Basic YWRtaW46cGFzc3dvcmQ=')).toBe('Basic [REDACTED]');
  });

  it('should not redact normal URLs', () => {
    expect(redactSecrets('https://example.com/api')).toBe('https://example.com/api');
  });

  it('should not redact normal code', () => {
    expect(redactSecrets('const myKey = "placeholder"')).toBe('const myKey = "placeholder"');
    expect(redactSecrets('function foo() { return 1; }')).toBe('function foo() { return 1; }');
  });

  it('should handle multiline content', () => {
    const input = `line1\nOPENAI_API_KEY=${shortOpenAiKey}\nline3`;
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('line1');
    expect(result).toContain('line3');
  });

  it('should handle AWS secret access key pattern', () => {
    const result = redactSecrets('AWS_SECRET_ACCESS_KEY=YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY');
    expect(result).toContain('[REDACTED]');
  });

  it('should handle GH token pattern', () => {
    const result = redactSecrets('ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(result).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('should handle OpenAI key pattern', () => {
    const result = redactSecrets(shortOpenAiKey);
    expect(result).toContain('[REDACTED_API_KEY]');
  });
});

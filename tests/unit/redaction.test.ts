import { describe, it, expect } from 'vitest';
import { redactSecrets } from '@agentdeck/memory-service';

describe('redactSecrets', () => {
  it('should redact API keys with prefixes and suffixes', () => {
    expect(redactSecrets('MY_OPENAI_API_KEY_123=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('MY_OPENAI_API_KEY_123=[REDACTED]');
    expect(redactSecrets('FEATURE_AZURE_OPENAI_API_KEY_STAGING=mykey123')).toBe('FEATURE_AZURE_OPENAI_API_KEY_STAGING=[REDACTED]');
  });

  it('should redact API keys', () => {
    expect(redactSecrets('OPENAI_API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('OPENAI_API_KEY=[REDACTED]');
    expect(redactSecrets('ANTHROPIC_API_KEY=sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBe('ANTHROPIC_API_KEY=[REDACTED]');
    expect(redactSecrets('AZURE_OPENAI_API_KEY=mykey123')).toBe('AZURE_OPENAI_API_KEY=[REDACTED]');
  });

  it('should redact AWS access keys', () => {
    expect(redactSecrets('AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX')).toBe('AWS_ACCESS_KEY_ID=[REDACTED]');
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY')).toBe('AWS_SECRET_ACCESS_KEY=[REDACTED]');
  });

  it('should redact AWS key pattern', () => {
    expect(redactSecrets('key: AKIAXXXXXXXXXXXXXXXX')).toContain('[REDACTED_AWS_ACCESS_KEY]');
  });

  it('should redact GitHub tokens', () => {
    const result = redactSecrets('ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(result).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('should redact OpenAI-like API keys', () => {
    expect(redactSecrets('sk-cccccccccccccccccccccccccccccccc')).toContain('[REDACTED_API_KEY]');
  });

  it('should redact Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer eyJmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm')).toBe('Authorization: Bearer [REDACTED]');
  });

  it('should redact Basic auth', () => {
    expect(redactSecrets('Authorization: Basic bbbbbbbbbbbb')).toBe('Authorization: Basic [REDACTED]');
  });

  it('should redact passwords', () => {
    expect(redactSecrets('PASSWORD=value123')).toBe('PASSWORD=[REDACTED]');
    expect(redactSecrets('PASSWD=value123')).toBe('PASSWD=[REDACTED]');
    expect(redactSecrets('SECRET=value123')).toBe('SECRET=[REDACTED]');
    expect(redactSecrets('TOKEN=value123')).toBe('TOKEN=[REDACTED]');
  });

  it('should redact NPM tokens', () => {
    expect(redactSecrets('NPM_TOKEN=npm_1234567890abcdef')).toBe('NPM_TOKEN=[REDACTED]');
  });

  it('should redact SEQ API keys', () => {
    expect(redactSecrets('SEQ_API_KEY=abc123def456')).toBe('SEQ_API_KEY=[REDACTED]');
  });

  it('should not redact normal text', () => {
    expect(redactSecrets('Hello world')).toBe('Hello world');
    expect(redactSecrets('const x = 1;')).toBe('const x = 1;');
    expect(redactSecrets('function foo() {}')).toBe('function foo() {}');
  });

  it('should handle multiple secrets in one string', () => {
    const input = 'OPENAI_API_KEY=sk-dddddddddddddddddddddddddddddddd PASSWORD=value123';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
  });

  it('should handle empty string', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('should handle case insensitivity', () => {
    expect(redactSecrets('openai_api_key=sk-dddddddddddddddddddddddddddddddd')).toBe('openai_api_key=[REDACTED]');
    expect(redactSecrets('OpenAI_API_KEY=sk-dddddddddddddddddddddddddddddddd')).toBe('OpenAI_API_KEY=[REDACTED]');
  });
});

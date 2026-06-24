export function redactSecrets(value: string): string {
  let sanitized = value;

  const patterns: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\b(Bearer|Basic)\s+\S+/gi, replacement: '$1 [REDACTED]' },
    { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_ACCESS_KEY]' },
    { pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
    { pattern: /sk-[A-Za-z0-9]{32,}/g, replacement: '[REDACTED_API_KEY]' }
  ];

  sanitized = sanitized.replace(/(^|[\s,;])([A-Z0-9_.-]+)\s*[:=]\s*[^\s,;]+/gi, (match, delimiter, key) => {
    if (!isSecretKeyName(key)) return match;
    return `${delimiter}${key}=[REDACTED]`;
  });

  for (const { pattern, replacement } of patterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

function isSecretKeyName(key: string): boolean {
  const normalized = key.toUpperCase();
  return (
    normalized.includes('ACCESS_KEY') ||
    normalized.includes('SECRET') ||
    normalized.includes('TOKEN') ||
    normalized.includes('PASSWORD') ||
    normalized.includes('PASSWD') ||
    normalized.includes('API_KEY')
  );
}

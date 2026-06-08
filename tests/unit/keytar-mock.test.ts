import { describe, expect, it } from 'vitest';
import { getPassword, setPassword, deletePassword } from 'keytar';

describe('keytar-mock', () => {
  it('getPassword returns null', async () => {
    const result = await getPassword('service', 'account');
    expect(result).toBeNull();
  });

  it('setPassword resolves without error', async () => {
    await expect(setPassword('service', 'account', 'secret')).resolves.toBeUndefined();
  });

  it('deletePassword returns false', async () => {
    const result = await deletePassword('service', 'account');
    expect(result).toBe(false);
  });

  it('getPassword returns null for any service/account combination', async () => {
    const result = await getPassword('agentdeck', 'github');
    expect(result).toBeNull();
  });

  it('setPassword does not throw for empty strings', async () => {
    await expect(setPassword('', '', '')).resolves.toBeUndefined();
  });

  it('deletePassword returns false even for non-existent entries', async () => {
    const result = await deletePassword('nonexistent', 'nobody');
    expect(result).toBe(false);
  });
});

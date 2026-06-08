// Renderer-safe mock for keytar (native module, unavailable in browser context)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getPassword = async (_service: string, _account: string): Promise<string | null> => null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setPassword = async (_service: string, _account: string, _password: string): Promise<void> => {};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const deletePassword = async (_service: string, _account: string): Promise<boolean> => false;

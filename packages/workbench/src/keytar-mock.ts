// Renderer-safe mock for keytar (native module, unavailable in browser context)
export const getPassword = async (_service: string, _account: string): Promise<string | null> => null;
export const setPassword = async (_service: string, _account: string, _password: string): Promise<void> => {};
export const deletePassword = async (_service: string, _account: string): Promise<boolean> => false;

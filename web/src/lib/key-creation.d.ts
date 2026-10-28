export function createUserKey(
  request: (name: string) => Promise<{ api_key: string }>,
  name: string,
): Promise<string>

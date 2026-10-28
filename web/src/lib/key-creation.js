// API keys must be minted by IE and shown only after a confirmed response.
// No localStorage fallback: an error is not a successful key creation.
export async function createUserKey(request, name) {
  const result = await request(name)
  if (!result || typeof result.api_key !== 'string' || !/^sk-ie-[a-zA-Z0-9_-]+$/.test(result.api_key)) {
    throw new Error('Server did not return a valid IE API key')
  }
  return result.api_key
}

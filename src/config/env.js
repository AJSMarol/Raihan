const read = (key) => String(import.meta.env[key] ?? '').trim();

export const env = Object.freeze({
  GOOGLE_CLIENT_ID: read('VITE_GOOGLE_CLIENT_ID'),
  API_URL: read('VITE_API_URL'),
});

/** Names of required variables that are empty. The login page shows these instead of a broken button. */
export const missingEnv = Object.entries({
  VITE_GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  VITE_API_URL: env.API_URL,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

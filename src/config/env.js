import { publicConfig } from './publicConfig';

export const env = Object.freeze({
  GOOGLE_CLIENT_ID: publicConfig.googleClientId,
  API_URL: publicConfig.apiUrl,
});

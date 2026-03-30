export function getApiBase() {
  return import.meta.env.VITE_API_BASE_URL || 'https://civiclens-production-07ed.up.railway.app'
}

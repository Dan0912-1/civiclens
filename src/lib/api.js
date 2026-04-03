export function getApiBase() {
  // In dev, VITE_API_BASE_URL is empty so the Vite proxy handles /api/* → localhost:3001
  return import.meta.env.VITE_API_BASE_URL || ''
}

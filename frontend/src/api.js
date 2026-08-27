const API = '/api';

export const TOKENS = { citizen: 'local-citizen', operator: 'local-operator' };

async function request(path, { method='GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `HTTP_${response.status}`); error.status = response.status; throw error; }
  return data;
}

export const api = {
  health: service => request(`/_health/${service}`),
  createEmergency: (token, payload) => request('/v1/emergencias', { method:'POST', token, body: payload }),
  myEmergencies: token => request('/v1/emergencias/mias', { token }),
  zone: (token, city) => request(`/v1/emergencias/zona/${city}`, { token }),
  dispatch: (token, emergency_id) => request('/v1/despachos', { method:'POST', token, body:{ emergency_id } }),
  updateDispatch: (token, id, status) => request(`/v1/despachos/${id}`, { method:'PATCH', token, body:{ status } }),
  notifications: token => request('/v1/notificaciones', { token }),
};

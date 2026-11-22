import axios from 'axios';
import { unauthorizedRedirect } from '../features/auth/unauthorizedRedirect';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && !config.headers.has('Authorization')) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Auth flows handle their own 401 responses. Other 401s invalidate
      // the stored human session. Device Auth preserves its validated return target.
      const redirect = unauthorizedRedirect(
        error.config?.url,
        window.location.pathname,
        window.location.search,
      );
      if (redirect) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = redirect;
      }
    }
    return Promise.reject(error);
  }
);

export default api;

import { useEffect, useState } from 'react';
import api from '../../api/client';

interface UniHubStatus {
  enabled: boolean;
  bound?: boolean;
}

const unavailable: UniHubStatus = { enabled: false };

export function useUniHubStatus(token: string | null, active = true): UniHubStatus | null {
  const [result, setResult] = useState<{ token: string | null; status: UniHubStatus } | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    async function load() {
      let status = unavailable;
      try {
        const response = await api.get<UniHubStatus>('/auth/unihub/status', { signal: controller.signal, timeout: 5000 });
        if (response?.data?.enabled === true) status = response.data;
      } catch {
        // A missing or unavailable optional endpoint leaves native auth usable.
      }
      if (!controller.signal.aborted) setResult({ token, status });
    }
    void load();
    return () => controller.abort();
  }, [active, token]);

  return active && result?.token === token ? result.status : null;
}

import { createContext, useContext, useMemo, type ReactNode } from 'react';
/** Tiny eager shell: all transport, history and editor code lives in lazy consumers. */
const Registry = createContext<{ userId: string; spaces: Map<string, unknown> } | null>(null);
export function AgentSessionRegistryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const value = useMemo(() => ({ userId, spaces: new Map<string, unknown>() }), [userId]);
  return <Registry.Provider value={value}>{children}</Registry.Provider>;
}
export const useAgentSessionRegistry = () => useContext(Registry);

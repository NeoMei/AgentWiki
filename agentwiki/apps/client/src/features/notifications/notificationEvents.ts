const CHANGE_EVENT = 'agentwiki:notifications-changed';
const STORAGE_KEY = 'agentwiki.notifications.changed.v1';

// Only an invalidation marker crosses tabs. Notification content stays in the
// authenticated API response, and each consumer reloads with its own identity.
export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
  try {
    window.localStorage.setItem(STORAGE_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // Same-tab updates still work when browser storage is unavailable.
  }
}

export function subscribeNotificationsChanged(refresh: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && event.newValue !== null) refresh();
  };
  window.addEventListener(CHANGE_EVENT, refresh);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh);
    window.removeEventListener('storage', onStorage);
  };
}

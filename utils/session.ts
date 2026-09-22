// Only Firebase manages credentials. This storage contains optional UI hints.
export const sessionHints = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* restricted Safari storage */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* optional hint */ }
  }
};

export function requiresSignOut(error: any): boolean {
  return ['USER_ARCHIVED', 'USER_PROFILE_NOT_FOUND', 'PROFILE_UID_MISMATCH', 'DUPLICATE_USER_PROFILE'].includes(error?.message)
    || ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes(error?.code);
}

// Bound UI waits without allowing a late result to restore an obsolete session.
export function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PROFILE_LOAD_TIMEOUT')), ms);
    task.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

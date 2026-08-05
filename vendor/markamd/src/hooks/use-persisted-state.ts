import { useCallback, useEffect, useState } from "react";

type SetValue<T> = T | ((prev: T) => T);

export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (next: SetValue<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota / serialization errors
    }
  }, [key, value]);

  // accepts both value and functional-updater forms (matches React's setState API)
  const update = useCallback((next: SetValue<T>) => setValue(next), []);
  return [value, update];
}

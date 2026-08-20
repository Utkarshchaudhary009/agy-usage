import { useEffect, useState } from "react";

// Returns `false` during the server render and the first client render, then
// `true` after the component has mounted. Use it to gate any render output that
// depends on the current time, locale, or other client-only values so the
// server and client initial renders match and React never warns about a
// hydration mismatch.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

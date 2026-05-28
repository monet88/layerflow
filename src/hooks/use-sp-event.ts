import { useEffect, useRef } from 'react';

export function useSpEvent<T extends EventTarget>(
  eventName: string,
  handler: (e: Event) => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stable = (e: Event) => handlerRef.current(e);
    el.addEventListener(eventName, stable);
    return () => el.removeEventListener(eventName, stable);
  }, [eventName]);

  return ref;
}

import { useEffect } from 'react';

/** The screen the person is on, so feedback can say where it was given. Pages call `useScreen` with a short English label. */
export const screen = { name: '' };

export function useScreen(name: string) {
  useEffect(() => { screen.name = name; }, [name]);
}

'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type ThemeName = 'dark' | 'deckai';

interface ThemeContextType {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: () => {},
  isLoading: true,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>('dark');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fetch the active theme from the API
    fetch('/api/theme')
      .then((r) => r.json())
      .then((d) => {
        const t = d.theme === 'deckai' ? 'deckai' : 'dark';
        setThemeState(t);
        document.documentElement.setAttribute('data-theme', t);
      })
      .catch(() => {
        // Default to dark on any error
        document.documentElement.setAttribute('data-theme', 'dark');
      })
      .finally(() => setIsLoading(false));
  }, []);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

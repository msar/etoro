import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'portfolio-privacy-mask';

type PrivacyContextValue = {
  masked: boolean;
  setMasked: (next: boolean) => void;
  toggle: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

/** Module flag so fmtMoney can mask without every call site passing a flag. */
let maskedFlag = false;

export function isPrivacyMasked(): boolean {
  return maskedFlag;
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [masked, setMaskedState] = useState(readStored);

  useEffect(() => {
    maskedFlag = masked;
  }, [masked]);

  // Sync flag on first mount before paint of children that format numbers.
  maskedFlag = masked;

  const setMasked = useCallback((next: boolean) => {
    maskedFlag = next;
    setMaskedState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore quota / private mode
    }
  }, []);

  const toggle = useCallback(() => {
    setMasked(!maskedFlag);
  }, [setMasked]);

  const value = useMemo(
    () => ({ masked, setMasked, toggle }),
    [masked, setMasked, toggle],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

/** Subscribe so the component re-renders when the mask toggles. */
export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    return {
      masked: false,
      setMasked: () => undefined,
      toggle: () => undefined,
    };
  }
  return ctx;
}

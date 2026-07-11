import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react';
import { EventData } from '../types/Chat.ts';
import { logger } from '../lib/logger';

interface AppContextType {
  sendEvent: (event: string, params?: EventData) => void;
  event: { event: string; params?: EventData } | null;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [event, setEvent] = useState<{
    event: string;
    params?: EventData;
  } | null>(null);

  const sendEvent = useCallback((eventName: string, params?: EventData) => {
    logger.debug(`[AppContext] event: ${eventName}`);
    setEvent({ event: eventName, params: params });
  }, []);

  return (
    <AppContext.Provider
      value={{
        sendEvent,
        event,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    logger.error('[AppContext] useAppContext called outside AppProvider');
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

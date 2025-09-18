import { createContext, useContext, useState, ReactNode } from 'react';

export interface RecentClient {
  id: number;
  fullName: string;
  stage: string;
  viewedAt: Date;
}

export interface RecentSession {
  id: number;
  clientId: number;
  clientName: string;
  sessionDate: string;
  status: string;
  serviceCode?: string;
  viewedAt: Date;
}

export interface RecentTask {
  id: number;
  title: string;
  clientId?: number;  // Made optional to handle tasks without client context
  clientName?: string; // Made optional to handle tasks without client context
  priority: string;
  status: string;
  dueDate?: string;
  viewedAt: Date;
}

interface RecentItems {
  clients: RecentClient[];
  sessions: RecentSession[];
  tasks: RecentTask[];
}

interface RecentItemsContextType {
  recentItems: RecentItems;
  addRecentClient: (client: Omit<RecentClient, 'viewedAt'>) => void;
  addRecentSession: (session: Omit<RecentSession, 'viewedAt'>) => void;
  addRecentTask: (task: Omit<RecentTask, 'viewedAt'>) => void;
  clearRecentItems: () => void;
}

const RecentItemsContext = createContext<RecentItemsContextType | undefined>(undefined);

const MAX_ITEMS = 10;

export function RecentItemsProvider({ children }: { children: ReactNode }) {
  const [recentItems, setRecentItems] = useState<RecentItems>({
    clients: [],
    sessions: [],
    tasks: []
  });

  const addRecentClient = (client: Omit<RecentClient, 'viewedAt'>) => {
    setRecentItems(prev => {
      const filtered = prev.clients.filter(item => item.id !== client.id);
      const newItem = { ...client, viewedAt: new Date() };
      return {
        ...prev,
        clients: [newItem, ...filtered].slice(0, MAX_ITEMS)
      };
    });
  };

  const addRecentSession = (session: Omit<RecentSession, 'viewedAt'>) => {
    setRecentItems(prev => {
      const filtered = prev.sessions.filter(item => item.id !== session.id);
      const newItem = { ...session, viewedAt: new Date() };
      return {
        ...prev,
        sessions: [newItem, ...filtered].slice(0, MAX_ITEMS)
      };
    });
  };

  const addRecentTask = (task: Omit<RecentTask, 'viewedAt'>) => {
    setRecentItems(prev => {
      const filtered = prev.tasks.filter(item => item.id !== task.id);
      const newItem = { ...task, viewedAt: new Date() };
      return {
        ...prev,
        tasks: [newItem, ...filtered].slice(0, MAX_ITEMS)
      };
    });
  };

  const clearRecentItems = () => {
    setRecentItems({ clients: [], sessions: [], tasks: [] });
  };

  return (
    <RecentItemsContext.Provider value={{
      recentItems,
      addRecentClient,
      addRecentSession,
      addRecentTask,
      clearRecentItems
    }}>
      {children}
    </RecentItemsContext.Provider>
  );
}

export function useRecentItemsContext(): RecentItemsContextType {
  const context = useContext(RecentItemsContext);
  if (context === undefined) {
    throw new Error('useRecentItemsContext must be used within a RecentItemsProvider');
  }
  return context;
}
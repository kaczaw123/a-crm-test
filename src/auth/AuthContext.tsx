import { createContext } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { UserProfile, CompanyMember } from '../data/types';

export interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  membership: CompanyMember | null;
  loading: boolean;
  systemError: 'offline' | null;
  logout: () => Promise<void>;
  updateSessionProfile: (updates: Partial<UserProfile>) => void;
  forceRefreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  membership: null,
  loading: true,
  systemError: null,
  logout: async () => {},
  updateSessionProfile: () => {},
  forceRefreshSession: async () => {},
});

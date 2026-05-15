import type { UserProfile } from '../data/types';

export function getUserDisplayName(profile: UserProfile | null | undefined): string {
  if (!profile) return 'Nieznany użytkownik';
  if (profile.displayName && profile.displayName.trim() !== '') return profile.displayName;
  if (profile.firstName || profile.lastName) {
    return `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  }
  return profile.email;
}

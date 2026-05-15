export const safeFormatDate = (
  date: any, 
  locale: string = 'pl-PL',
  options?: Intl.DateTimeFormatOptions
): string => {
  if (!date) return '-';
  
  try {
    // Obsługa Firestore Timestamp
    if (date?.toDate && typeof date.toDate === 'function') {
      date = date.toDate();
    }
    
    // Obsługa obiektu Timestamp po zrzuceniu do POJO (np. z functions)
    if (date?.seconds !== undefined && typeof date.seconds === 'number') {
      date = new Date(date.seconds * 1000);
    }
    
    // Obsługa string ISO
    if (typeof date === 'string') {
      date = new Date(date);
    }
    
    // Obsługa timestamp w ms lub sekundach
    if (typeof date === 'number') {
      if (date < 10000000000) {
        date = new Date(date * 1000); // konwersja sekund na ms
      } else {
        date = new Date(date);
      }
    }
    
    // Sprawdź czy data jest prawidłowa
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      console.warn('Invalid date value:', date);
      return '-';
    }
    
    return new Intl.DateTimeFormat(locale, options || {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
    
  } catch (error) {
    console.warn('Date formatting error:', error, date);
    return '-';
  }
};

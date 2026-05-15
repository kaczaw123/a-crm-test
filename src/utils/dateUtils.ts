/**
 * Bezpieczne formatowanie daty z różnych źródeł
 * Obsługuje: Firestore Timestamp, Date, ISO string, null
 */
export const formatDate = (
  dateValue: any, 
  language: string = 'pl',
  options?: Intl.DateTimeFormatOptions
): string => {
  if (!dateValue) return '-';
  
  try {
    let date: Date;
    
    // Firestore Timestamp (ma metodę toDate)
    if (dateValue?.toDate && typeof dateValue.toDate === 'function') {
      date = dateValue.toDate();
    }
    // Firestore Timestamp z _seconds (po serializacji)
    else if (dateValue?._seconds !== undefined) {
      date = new Date(dateValue._seconds * 1000);
    }
    // Firestore Timestamp z seconds (inna wersja)
    else if (dateValue?.seconds !== undefined) {
      date = new Date(dateValue.seconds * 1000);
    }
    // Already a Date object
    else if (dateValue instanceof Date) {
      date = dateValue;
    }
    // ISO string or timestamp number
    else if (typeof dateValue === 'string' || typeof dateValue === 'number') {
      date = new Date(dateValue);
    }
    else {
      console.warn('Unknown date format:', dateValue);
      return '-';
    }
    
    // Validate date
    if (isNaN(date.getTime())) {
      console.warn('Invalid date value:', dateValue);
      return '-';
    }
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    };
    
    return new Intl.DateTimeFormat(language, options || defaultOptions).format(date);
  } catch (error) {
    console.error('Date formatting error:', error, dateValue);
    return '-';
  }
};

/**
 * Formatowanie tylko daty (bez czasu)
 */
export const formatDateOnly = (dateValue: any, language: string = 'pl'): string => {
  return formatDate(dateValue, language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

/**
 * Formatowanie daty i czasu
 */
export const formatDateTime = (dateValue: any, language: string = 'pl'): string => {
  return formatDate(dateValue, language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

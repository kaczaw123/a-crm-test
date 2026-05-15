export interface ShippingMethodSLA {
  cutoffHour: number;
  cutoffMinute: number;
  daysToDeliver: number;
}

export const CARRIER_SLA_MAPPING: Record<string, ShippingMethodSLA> = {
  'DHL': { cutoffHour: 15, cutoffMinute: 0, daysToDeliver: 1 },
  'DPD': { cutoffHour: 14, cutoffMinute: 30, daysToDeliver: 1 },
  'INPOST': { cutoffHour: 16, cutoffMinute: 0, daysToDeliver: 1 },
  'DEFAULT': { cutoffHour: 12, cutoffMinute: 0, daysToDeliver: 2 }
};

export function calculateCutOffDeadline(shippingMethodName: string = ''): number {
  const methodUpper = shippingMethodName.toUpperCase();
  let sla = CARRIER_SLA_MAPPING['DEFAULT'];
  
  if (methodUpper.includes('DHL')) sla = CARRIER_SLA_MAPPING['DHL'];
  else if (methodUpper.includes('DPD')) sla = CARRIER_SLA_MAPPING['DPD'];
  else if (methodUpper.includes('INPOST') || methodUpper.includes('PACZKOMAT')) sla = CARRIER_SLA_MAPPING['INPOST'];

  const now = new Date();
  const deadline = new Date(now);
  
  deadline.setHours(sla.cutoffHour, sla.cutoffMinute, 0, 0);

  // Jeśli już jest po godzinie cut-off, termin spada na następny dzień roboczy
  if (now.getTime() > deadline.getTime()) {
    deadline.setDate(deadline.getDate() + 1);
  }

  // Jeśli następny dzień to sobota/niedziela (zakładamy że kurier nie jezdzi)
  if (deadline.getDay() === 6) { // sobota
    deadline.setDate(deadline.getDate() + 2); // poniedziałek
  } else if (deadline.getDay() === 0) { // niedziela
    deadline.setDate(deadline.getDate() + 1); // poniedziałek
  }

  return deadline.getTime();
}

export function determinePriority(deadlineTime: number): 'urgent' | 'high' | 'normal' {
  const hoursLeft = (deadlineTime - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft <= 2) return 'urgent';
  if (hoursLeft <= 6) return 'high';
  return 'normal';
}

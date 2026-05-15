import { useState, useEffect, useCallback, useMemo } from 'react';
import { db, functions } from '../firebase/config';
import { collectionGroup, query, where, onSnapshot, doc, updateDoc, getDocs, limit, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { FulfillmentTask, FulfillmentTaskItem } from '../types/fulfillment';
import { toast } from 'react-hot-toast';

export type PackingState = 'IDLE' | 'SCANNING_ITEMS' | 'SCANNING_LABEL' | 'COMPLETED';

export function useFulfillmentPacking(companyId: string | undefined, stationId: string) {
  const [tasks, setTasks] = useState<FulfillmentTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [packingState, setPackingState] = useState<PackingState>('IDLE');
  const [loading, setLoading] = useState(false);
  const [cartonSuggestion, setCartonSuggestion] = useState<any>(null);

  // Dźwięki (opcjonalne, ale dodajemy bezpieczne wywołania)
  const playSound = useCallback((type: 'success' | 'warning' | 'error' | 'complete') => {
    // Można rozszerzyć o rzeczywiste ładowanie plików audio
    // Można użyć np.: new Audio('/sounds/' + type + '.mp3').play().catch(() => {});
  }, []);

  // Pobieranie zleceń do spakowania – docelowo na podstawie fali lub wózka.
  // Tymczasowo pobieramy pierwsze aktywne zadania z kolejki dla statusów packing/awaiting
  useEffect(() => {
    // W modelu 3PL stacja pakowania ZAWSZE korzysta z danych globalnych 
    const baseQuery = collectionGroup(db, 'fulfillmentQueue');

    // TODO: Zoptymalizować pod konkretne stacje/pickerów (np. podpięte pod stationId lub active pick wave).
    const q = query(
      baseQuery,
      where('status', 'in', ['awaiting', 'packing']),
      orderBy('cutOffDeadline', 'asc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTasks = snapshot.docs.map(doc => {
         const data = doc.data() as FulfillmentTask;
         // Upewnijmy się, że dla starszych doków albo collectionGroup companyId jest zachowane
         // collectionGroup nie zwraca `ref.parent.parent.id` w data(), ale task.companyId już istnieje w dokumencie
         return { ...data, id: doc.id };
      });
      setTasks(fetchedTasks);
    });

    return () => unsubscribe();
  }, [companyId]);

  const activeTask = useMemo(() => tasks.find(t => t.id === activeTaskId), [tasks, activeTaskId]);

  const selectTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Próba zablokowania w backendzie 
    setLoading(true);
    try {
      // Lockowanie zadań via Cloud Function pozostaje, aby zablokować edycję innym workerom
      const lockTask = httpsCallable(functions, 'lockFulfillmentTask');
      await lockTask({ companyId: task.companyId, taskId: task.id, stationId });

      // Wszystkie informacje (items, locationNames, suggestedBox, companyName) znajdują się od teraz bezpośrednio w task (dzięki Triggerowi w backendzie)
      setCartonSuggestion(task.suggestedBox || null);
      setActiveTaskId(task.id);
      
      const currentTaskItems = task.items || [];

      // Sprawdź czy to zadanie ma w ogóle przedmioty do zeskanowania
      const hasUnscanned = currentTaskItems?.some(i => i.scannedQuantity < i.quantity);
      if (currentTaskItems && !hasUnscanned && currentTaskItems.length > 0) {
        setPackingState('SCANNING_LABEL');
      } else {
        setPackingState('SCANNING_ITEMS');
      }

      // Karton ładujemy z zapisanego obiektu w hooku (wyżej)

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Nie udało się przypisać zadania.');
      playSound('error');
    } finally {
      setLoading(false);
    }
  }, [tasks, stationId, playSound]);

  const allItemsComplete = useCallback((items: FulfillmentTaskItem[]) => {
    if (!items || items.length === 0) return true;
    return items.every(i => i.scannedQuantity >= i.quantity);
  }, []);

  const handleScanEan = useCallback(async (scannedEAN: string) => {
    if (!activeTask) return;
    
    if (packingState === 'SCANNING_LABEL') {
      if (scannedEAN.length > 5) {
        setLoading(true);
        try {
          const completeTask = httpsCallable(functions, 'completeFulfillmentTask');
          await completeTask({ companyId: activeTask.companyId, taskId: activeTask.id });
          playSound('complete');
          toast.success('Paczka spakowana pomyślnie!');
          setPackingState('COMPLETED');
          setTimeout(() => {
             setActiveTaskId(null);
             setPackingState('IDLE');
          }, 1500);
        } catch (err: any) {
          playSound('error');
          toast.error(err.message || 'Błąd akceptacji etykiety (API).');
        } finally {
            setLoading(false);
        }
      } else {
         playSound('error');
         toast.error('Błędny kod etykiety');
      }
      return;
    }

    if (!activeTask.items) {
      toast.error('Brak produktów w zamówieniu');
      return;
    }

    const itemsCopy = [...activeTask.items];
    const itemIndex = itemsCopy.findIndex(i => i.ean === scannedEAN || i.sku === scannedEAN);
    
    if (itemIndex === -1) {
      playSound('error');
      toast.error(`Nieznany kod: ${scannedEAN}`);
      return;
    }

    const item = itemsCopy[itemIndex];
    if (item.scannedQuantity >= item.quantity) {
      playSound('warning');
      toast.error('Produkt już w pełni zeskanowany', { icon: '⚠️' });
      return;
    }

    // Optymistyczna lokalna aktualizacja dla szybkosci interfejsu (lub zapisać do Firebase)
    item.scannedQuantity += 1;
    playSound('success');

    // Aktualizacja Firestore - tutaj robimy bezposrednio update na dokumencie 
    // dla zachowania prostoty; w prod uzyc httpsCallable jesli security rules zabraniaja.
    try {
      // Lokalnie wymusmy refresh (React onSnapshot sam nadpisze the rest, ale lokalna kopia przyspieszy)
      setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, items: itemsCopy } : t));
    } catch(e) {}

    if (allItemsComplete(itemsCopy)) {
      setPackingState('SCANNING_LABEL');
      toast.success('Wszystkie produkty zeskanowane! Zeskanuj etykietę.', { duration: 4000 });
      playSound('complete');
    }

  }, [activeTask, packingState, companyId, allItemsComplete, playSound]);

  const reportException = useCallback(async (reason: string) => {
    if (!activeTask) return;
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'reportFulfillmentException');
      await fn({ companyId: activeTask.companyId, taskId: activeTask.id, reason: 'short_pick', details: reason });
      toast.success('Zgłoszono problem');
      setActiveTaskId(null);
      setPackingState('IDLE');
    } catch(err: any) {
      toast.error(err.message || 'Błąd przy zgłaszaniu problemu');
    } finally {
      setLoading(false);
    }
  }, [activeTaskId, companyId]);

  return {
    tasks,
    activeTask,
    packingState,
    loading,
    cartonSuggestion,
    selectTask,
    handleScanEan,
    reportException,
    clearActiveTask: () => {
      setActiveTaskId(null);
      setPackingState('IDLE');
    }
  };
}

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collectionGroup, query, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../auth/useAuth';
import type { FulfillmentTask } from '../../../types/fulfillment';

function getSlaDetails(deadlineMs: number | null | undefined) {
  if (!deadlineMs) return { text: '-', color: 'bg-gray-100 text-gray-800' };
  
  const now = Date.now();
  const diffMs = deadlineMs - now;
  
  if (diffMs < 0) {
    return { text: 'OPÓŹNIONE', color: 'bg-red-100 text-red-800 border-red-200 font-bold' };
  }
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let color = 'bg-green-50 text-green-700 border-transparent';
  if (hours < 2) color = 'bg-red-50 text-red-700 border-red-200 animate-pulse font-bold';
  else if (hours < 6) color = 'bg-orange-50 text-orange-700 border-orange-200';
  
  return { text: `Pozostało: ${hours}h ${mins}m`, color };
}

export default function FulfillmentQueuePage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  
  const [tasks, setTasks] = useState<FulfillmentTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadQueue = async () => {
      try {
        setLoading(true);
        const q = query(
          collectionGroup(db, 'fulfillmentQueue'),
          orderBy('cutOffDeadline', 'asc'),
          limit(50)
        );

        const snapshot = await getDocs(q);
        const fetchedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FulfillmentTask));
        setTasks(fetchedTasks);
      } catch (err) {
        console.error('Error fetching queue:', err);
      } finally {
        setLoading(false);
      }
    };

    loadQueue();
  }, [(profile as any)?.activeCompanyId, (profile as any)?.companyId]);

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('fulfillment.queue.title', 'Kolejka Zbiórki')}
          </h1>
          <p className="text-sm text-gray-500 mt-1 uppercase tracking-wider">
            {t('fulfillment.queue.subtitle', 'PICK & PACK')}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col p-4">
        {loading ? (
          <div className="text-gray-500">{t('common.loading', 'Ładowanie...')}</div>
        ) : (
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-gray-50">
                <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Nr zlecenia</th>
                <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Priorytet</th>
                <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Deadline (SLA)</th>
                <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => {
                const sla = getSlaDetails(task.cutOffDeadline);
                return (
                  <tr key={task.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">{task.referenceNumber}</td>
                    <td className="py-3 px-4">
                      <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                        {task.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {task.priority === 'urgent' && <span className="text-xs font-bold text-red-600 uppercase">Pilne</span>}
                      {task.priority === 'high' && <span className="text-xs font-bold text-orange-500 uppercase">Wysoki</span>}
                      {task.priority === 'normal' && <span className="text-xs font-semibold text-gray-500 uppercase">Normalny</span>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-gray-500 font-medium">
                          {task.cutOffDeadline ? new Date(task.cutOffDeadline).toLocaleString() : '-'}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded border ${sla.color}`}>
                          {sla.text}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <a href={`/admin/fulfillment/pack/station-1?scan=${task.id}`} className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors inline-block">
                        Pakuj
                      </a>
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-gray-500">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">all_done</span>
                    <p>Kolejka jest pusta. Wszystkie zamówienia zrealizowane!</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

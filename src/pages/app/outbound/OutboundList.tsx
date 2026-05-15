import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../auth/useAuth';
import { useTranslation } from 'react-i18next';
import { PackageMinus, Plus, Clock, CheckCircle2, XCircle } from 'lucide-react';
import type { OutboundShipment } from '../../../data/outbound';
import { OutboundForm } from './OutboundForm';

export const OutboundList: React.FC = () => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [outbounds, setOutbounds] = useState<OutboundShipment[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedOutbound, setSelectedOutbound] = useState<OutboundShipment | null>(null);

  useEffect(() => {
    if (!profile?.activeCompanyId) return;

    const coll = collection(db, `companies/${profile.activeCompanyId}/outboundShipments`);
    const q = query(coll, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: OutboundShipment[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as OutboundShipment);
      });
      setOutbounds(data);
    });

    return () => unsubscribe();
  }, [profile?.activeCompanyId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft': return <Clock className="w-4 h-4 text-orange-500" />;
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'canceled': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft': return t('outbound.status.draft', 'W przygotowaniu');
      case 'completed': return t('outbound.status.completed', 'Wydano');
      case 'canceled': return t('outbound.status.canceled', 'Anulowano');
      default: return status;
    }
  };

  const activeOutbounds = outbounds.filter(o => o.status !== 'completed' && o.status !== 'canceled');
  const pastOutbounds = outbounds.filter(o => o.status === 'completed' || o.status === 'canceled');

  const renderTable = (items: OutboundShipment[]) => (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-sm">
              <th className="py-3 px-4 font-semibold text-slate-700">{t('outbound.list.documentNumber', 'Numer dokumentu')}</th>
              <th className="py-3 px-4 font-semibold text-slate-700">{t('outbound.list.date', 'Data')}</th>
              <th className="py-3 px-4 font-semibold text-slate-700">{t('outbound.list.issuedTo', 'Odbiorca')}</th>
              <th className="py-3 px-4 font-semibold text-slate-700">{t('outbound.list.itemsCount', 'Ilość SKU')}</th>
              <th className="py-3 px-4 font-semibold text-slate-700">{t('outbound.list.totalQty', 'Suma sztuk')}</th>
              <th className="py-3 px-4 font-semibold text-slate-700">{t('outbound.list.status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(shipment => (
              <tr 
                key={shipment.id} 
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => {
                  setSelectedOutbound(shipment);
                  setIsFormOpen(true);
                }}
              >
                <td className="py-3 px-4">
                  <div className="font-medium text-slate-900">{shipment.documentNumber}</div>
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {shipment.createdAt?.toDate().toLocaleDateString()}
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {shipment.issuedTo || '-'}
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {shipment.itemsCount}
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {shipment.totalIssuedQty}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(shipment.status)}
                    <span className="text-sm font-medium capitalize text-slate-700">
                      {getStatusLabel(shipment.status)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  {t('outbound.list.noRecords', 'Brak dokumentów WZ w tej sekcji.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <PackageMinus className="w-6 h-6 text-indigo-600" />
            {t('outbound.title', 'Wydania Zewnętrzne (WZ)')}
          </h1>
          <p className="text-slate-500 mt-1">
            {t('outbound.subtitle', 'Ręczne modyfikacje stanów i wydawanie asortymentu klienta spoza E-Commerce.')}
          </p>
        </div>
        
        <button
          onClick={() => {
            setSelectedOutbound(null);
            setIsFormOpen(true);
          }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition duration-200 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {t('outbound.action.new', 'Nowe Wydanie (WZ)')}
        </button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">{t('outbound.sections.active', 'W przygotowaniu')}</h2>
        {renderTable(activeOutbounds)}
      </div>

      <div className="space-y-4 mt-8">
        <h2 className="text-lg font-semibold text-slate-800">{t('outbound.sections.history', 'Historia Wydań')}</h2>
        {renderTable(pastOutbounds)}
      </div>

      {isFormOpen && (
        <OutboundForm 
          onClose={() => setIsFormOpen(false)} 
          existingOutbound={selectedOutbound}
        />
      )}
    </div>
  );
};

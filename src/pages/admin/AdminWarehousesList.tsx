import { useEffect, useState } from 'react';
import type { GlobalWarehouse } from '../../data/warehouses';
import { getGlobalWarehouses, addWarehouseCallable, updateWarehouseCallable, toggleWarehouseStatusCallable } from '../../data/warehouses';
import { WarehouseFormModal } from './components/WarehouseFormModal';
import { AssignWarehouseModal } from './components/AssignWarehouseModal';

export default function AdminWarehousesList() {
  const [warehouses, setWarehouses] = useState<GlobalWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<GlobalWarehouse | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');

  const loadWarehouses = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getGlobalWarehouses();
      setWarehouses(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Błąd ładowania listy magazynów.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  const handleSaveWarehouse = async (data: Partial<GlobalWarehouse>) => {
    if (editingWarehouse) {
      await updateWarehouseCallable({ id: editingWarehouse.id, ...data });
    } else {
      await addWarehouseCallable(data);
    }
    await loadWarehouses();
  };

  const handleToggleStatus = async (w: GlobalWarehouse) => {
    try {
      await toggleWarehouseStatusCallable({ id: w.id, isActive: !w.isActive });
      setWarehouses(prev => prev.map(item => item.id === w.id ? { ...item, isActive: !item.isActive } : item));
    } catch (err: any) {
       alert(err.message || 'Błąd modyfikacji statusu');
    }
  };

  const filtered = warehouses.filter(w => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return w.name.toLowerCase().includes(term) || w.code.toLowerCase().includes(term) || w.address.city.toLowerCase().includes(term);
  });

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]">
      <div className="w-full h-full max-w-[1600px] mx-auto flex flex-col px-4 py-6 md:px-8">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-black text-[#0F172A] flex items-center gap-3">
              <span className="material-symbols-outlined text-[#4338CA] text-[32px]">domain_verification</span>
              Globalne Magazyny (Fulfillment)
            </h1>
            <p className="text-[#64748B] text-sm font-medium mt-1">Zarządzanie fizycznymi Centrami Logistycznymi i dostępem Najemców</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsAssignOpen(true)}
              className="bg-white border text-[#4338CA] border-[#C7D2FE] hover:bg-[#EEF2FF] shadow-sm font-bold text-[13px] px-5 py-2.5 rounded-xl transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">rule</span>
              Zarządzaj Uprawnieniami Klientów
            </button>

            <button 
              onClick={() => { setEditingWarehouse(null); setIsFormOpen(true); }}
              className="bg-[#4338CA] text-white hover:bg-[#3730A3] shadow-md hover:shadow-lg hover:-translate-y-0.5 font-bold text-[13px] px-5 py-2.5 rounded-xl transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Dodaj Nowy Magazyn
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-[#FEF2F2] border border-[#FCA5A5] p-4 rounded-xl mb-6 text-[#991B1B] font-bold text-[13px] flex items-center gap-2">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="relative w-full md:w-96">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]">search</span>
              <input 
                type="text" 
                placeholder="Szukaj po nazwie, kodzie lub mieście..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 h-[44px] border border-[#CBD5E1] rounded-xl text-sm focus:ring-[#4338CA] focus:border-[#4338CA] bg-white transition-colors"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="overflow-x-auto flex-1 h-[500px]">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-sm text-left">
              <thead className="bg-[#F8FAFC] sticky top-0 z-10 shadow-[0_1px_0_0_#E2E8F0]">
                <tr>
                  <th className="px-6 py-4 font-bold text-[#64748B] text-[12px] uppercase tracking-wider">Kod / Nazwa</th>
                  <th className="px-6 py-4 font-bold text-[#64748B] text-[12px] uppercase tracking-wider">Adres / Kraj</th>
                  <th className="px-6 py-4 font-bold text-[#64748B] text-[12px] uppercase tracking-wider">Firma Operująca</th>
                  <th className="px-6 py-4 font-bold text-[#64748B] text-[12px] uppercase tracking-wider">Kontakt Awizacyjny</th>
                  <th className="px-6 py-4 font-bold text-[#64748B] text-[12px] uppercase tracking-wider text-center">Status</th>
                  <th className="px-6 py-4 font-bold text-[#64748B] text-[12px] uppercase tracking-wider text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-[#64748B]">
                      <span className="material-symbols-outlined animate-spin text-[32px] text-[#4338CA]">sync</span>
                      <p className="mt-2 text-sm font-semibold">Wczytywanie architektury magazynowej...</p>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-[#94A3B8]">
                      <span className="material-symbols-outlined text-[48px] mb-2 text-[#CBD5E1]">warehouse</span>
                      <p className="text-[15px] font-medium">Brak magazynów spełniających kryteria.</p>
                    </td>
                  </tr>
                ) : (
                  filtered.map(w => (
                    <tr key={w.id} className="hover:bg-[#F8FAFC] transition-colors group">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                           <span className="font-bold text-[#0F172A]">{w.name} {w.isDefault && <span className="ml-1 text-[10px] bg-[#EEF2FF] text-[#4338CA] px-2 py-0.5 rounded uppercase">Domyślny Sys.</span>}</span>
                           <span className="text-[11px] font-mono font-semibold text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded w-max">{w.code} • {w.warehouseType.toUpperCase()}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5 text-[13px] text-[#334155]">
                          <span>{w.address.street} {w.address.buildingNumber}{w.address.unitNumber ? `/${w.address.unitNumber}` : ''}</span>
                          <span className="text-[#64748B] font-medium">{w.address.postalCode} {w.address.city}, {w.address.country}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[#334155] font-semibold text-[13px]">
                        {w.companyName || '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[12px] text-[#64748B]">
                        <div className="flex flex-col gap-0.5">
                          {w.contact.contactPerson && <span className="text-[#0F172A] font-semibold flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">person</span> {w.contact.contactPerson}</span>}
                          {w.contact.contactPhone && <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">call</span> {w.contact.contactPhone}</span>}
                          {!w.contact.contactPerson && !w.contact.contactPhone && '—'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border tracking-wide uppercase ${w.isActive ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]' : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'}`}>
                          {w.isActive ? 'Aktywny' : 'Zablokowany'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                         <div className="flex justify-end gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setEditingWarehouse(w); setIsFormOpen(true); }}
                              className="p-1.5 text-[#64748B] hover:text-[#4338CA] hover:bg-[#EEF2FF] rounded-lg transition-colors"
                              title="Edytuj"
                            >
                              <span className="material-symbols-outlined text-[20px]">edit</span>
                            </button>
                            <button 
                              onClick={() => handleToggleStatus(w)}
                              className={`p-1.5 rounded-lg transition-colors ${!w.isActive ? 'text-[#166534] hover:bg-[#DCFCE7]' : 'text-[#991B1B] hover:bg-[#FEE2E2]'}`}
                              title={w.isActive ? 'Dezaktywuj' : 'Aktywuj'}
                            >
                              <span className="material-symbols-outlined text-[20px]">{w.isActive ? 'block' : 'check_circle'}</span>
                            </button>
                         </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="px-6 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] flex justify-between items-center text-[#64748B] text-[12px] font-medium shrink-0">
             <span>Suma: {filtered.length} centrów logistycznych</span>
             <span>W systemie wdrożono ochronę Zero-Trust</span>
          </div>
        </div>
      </div>

      <WarehouseFormModal 
        isOpen={isFormOpen} 
        onClose={() => setIsFormOpen(false)} 
        existingWarehouse={editingWarehouse} 
        onSave={handleSaveWarehouse} 
      />

      <AssignWarehouseModal 
        isOpen={isAssignOpen}
        onClose={() => setIsAssignOpen(false)}
        warehouses={warehouses}
      />
    </div>
  );
}

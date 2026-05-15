import { useState, useEffect } from 'react';
import type { GlobalWarehouse, CompanyWarehouseAccess } from '../../../data/warehouses';
import { getCompanyWarehouseAccess, assignWarehouseToCompanyCallable, revokeWarehouseAccessCallable } from '../../../data/warehouses';
import { getAllCompanies } from '../../../data/company';
import type { Company } from '../../../data/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  warehouses: GlobalWarehouse[];
}

export function AssignWarehouseModal({ isOpen, onClose, warehouses }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  
  const [accessList, setAccessList] = useState<CompanyWarehouseAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      getAllCompanies().then(setCompanies).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedCompanyId) {
      setLoading(true);
      getCompanyWarehouseAccess(selectedCompanyId)
        .then(setAccessList)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setAccessList([]);
    }
  }, [selectedCompanyId]);

  if (!isOpen) return null;

  const handleToggleAccess = async (warehouseId: string, currentAccess: CompanyWarehouseAccess | undefined) => {
    if (!selectedCompanyId) return;
    setSavingId(warehouseId);
    
    try {
      if (currentAccess) {
        // Obodpięcie
        await revokeWarehouseAccessCallable({ warehouseId, companyId: selectedCompanyId });
        setAccessList(prev => prev.filter(a => a.warehouseId !== warehouseId));
      } else {
        // Przypięcie
        await assignWarehouseToCompanyCallable({ 
          warehouseId, 
          companyId: selectedCompanyId,
          isActive: true,
          isDefaultForCompany: accessList.length === 0 // default for first one
        });
        
        // Odśwież lokalnie
        const updated = await getCompanyWarehouseAccess(selectedCompanyId);
        setAccessList(updated);
      }
    } catch (err: any) {
      alert("Błąd: " + err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleDefault = async (warehouseId: string) => {
    if (!selectedCompanyId) return;
    setSavingId(warehouseId);
    try {
      await assignWarehouseToCompanyCallable({ 
        warehouseId, 
        companyId: selectedCompanyId,
        isActive: true,
        isDefaultForCompany: true
      });
      const updated = await getCompanyWarehouseAccess(selectedCompanyId);
      setAccessList(updated);
    } catch (err: any) {
      alert("Błąd: " + err.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-scale-in">
        <div className="flex justify-between items-center p-6 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h2 className="text-xl font-bold text-[#0F172A]">Dostęp Klientów (Najemców)</h2>
            <p className="text-[#64748B] text-sm mt-1">Zarządzaj dostępem firm do globalnych magazynów</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#64748B] hover:bg-[#F1F5F9] rounded-full transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-[#F8FAFC]">
          
          <div className="mb-6">
            <label className="block text-[13px] font-bold text-[#0F172A] mb-2 uppercase tracking-wide">
              Wybierz Firmę Klienta:
            </label>
            <select 
              value={selectedCompanyId} 
              onChange={e => setSelectedCompanyId(e.target.value)}
              className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-xl text-sm focus:ring-[#4338CA] focus:border-[#4338CA] bg-white font-medium text-[#334155]"
            >
              <option value="">-- Wybierz firmę z listy --</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.taxId ? `(NIP: ${c.taxId})` : ''}</option>
              ))}
            </select>
          </div>

          {selectedCompanyId && (
            <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-xl overflow-hidden">
               {loading ? (
                 <div className="p-8 text-center text-[#64748B]">Wczytuję uprawnienia...</div>
               ) : (
                 <table className="min-w-full divide-y divide-[#E2E8F0] text-sm">
                   <thead className="bg-[#F1F5F9]">
                     <tr>
                       <th className="px-4 py-3 text-left font-bold text-[#64748B]">Magazyn</th>
                       <th className="px-4 py-3 text-center font-bold text-[#64748B]">Przypisany</th>
                       <th className="px-4 py-3 text-center font-bold text-[#64748B]">Domyślny dla firmy</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-[#F1F5F9]">
                     {warehouses.map(w => {
                       const access = accessList.find(a => a.warehouseId === w.id);
                       const hasAccess = !!access;
                       return (
                         <tr key={w.id} className="hover:bg-[#F8FAFC]">
                           <td className="px-4 py-3">
                             <div className="font-semibold text-[#0F172A]">{w.name}</div>
                             <div className="text-[12px] text-[#64748B]">{w.code} • {w.address.city}</div>
                           </td>
                           <td className="px-4 py-3 text-center">
                             <button
                               onClick={() => handleToggleAccess(w.id, access)}
                               disabled={savingId === w.id}
                               className={`w-12 h-6 rounded-full relative transition-colors ${hasAccess ? 'bg-[#10B981]' : 'bg-[#CBD5E1]'} ${savingId === w.id ? 'opacity-50' : ''}`}
                             >
                               <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${hasAccess ? 'translate-x-6' : ''}`}></span>
                             </button>
                           </td>
                           <td className="px-4 py-3 text-center">
                             {hasAccess ? (
                               <label className="cursor-pointer">
                                 <input 
                                   type="radio" 
                                   name="defaultWarehouse" 
                                   checked={access.isDefaultForCompany}
                                   onChange={() => handleToggleDefault(w.id)}
                                   disabled={savingId === w.id}
                                   className="w-4 h-4 text-[#4338CA] focus:ring-[#4338CA] border-gray-300"
                                 />
                               </label>
                             ) : (
                               <span className="text-[#94A3B8]">—</span>
                             )}
                           </td>
                         </tr>
                       );
                     })}
                   </tbody>
                 </table>
               )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

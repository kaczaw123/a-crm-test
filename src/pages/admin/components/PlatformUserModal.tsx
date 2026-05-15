import React, { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import type { PlatformUser, PlatformRole, PlatformDepartment, Permissions, ClientScope } from '../../../data/platformUsers';
import { ROLE_PRESETS, createInternalUserCallable } from '../../../data/platformUsers';
import { getAllCompanies } from '../../../data/company';
import type { Company } from '../../../data/types';

interface PlatformUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingUser: PlatformUser | null;
  onSuccess: (generatedPassword?: string) => void;
}

const ROLES: PlatformRole[] = ["SUPER_ADMIN", "ADMIN_OPERACYJNY", "SALES", "BILLING", "WAREHOUSE", "CUSTOMER_CARE", "INTEGRATION"];
const DEPARTMENTS: PlatformDepartment[] = ["sales", "billing", "warehouse", "operations", "admin", "integration"];

const DEFAULT_PERMS: Permissions = {
  modules: { dashboard: 'none', crm: 'none', clients: 'none', billing: 'none', carriers: 'none', warehouse: 'none', reports: 'none', users: 'none', settings: 'none' },
  financeAccess: { canSeeCosts: false, canSeeMargins: false, canEditPricing: false }
};

export default function PlatformUserModal({ isOpen, onClose, existingUser, onSuccess }: PlatformUserModalProps) {
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    department: 'operations' as PlatformDepartment,
    role: 'CUSTOMER_CARE' as PlatformRole,
    status: 'active' as 'active' | 'invited' | 'blocked',
    assignedPackingStationId: ''
  });
  
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMS);
  const [clientScope, setClientScope] = useState<ClientScope>({ type: 'all', clientIds: [] });

  useEffect(() => {
    if (isOpen) {
      getAllCompanies().then(setCompanies).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (existingUser) {
      setFormData({
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        email: existingUser.email,
        phone: existingUser.phone || '',
        department: existingUser.department,
        role: existingUser.role,
        status: existingUser.status as 'active' | 'invited' | 'blocked',
        assignedPackingStationId: existingUser.assignedPackingStationId || ''
      });
      setPermissions(existingUser.permissions || DEFAULT_PERMS);
      setClientScope(existingUser.clientScope || { type: 'all', clientIds: [] });
    } else {
      handleRoleChange('ADMIN_OPERACYJNY');
    }
  }, [existingUser, isOpen]);

  const handleRoleChange = (newRole: PlatformRole) => {
    const preset = ROLE_PRESETS[newRole];
    setFormData(prev => ({ ...prev, role: newRole, department: preset.department }));
    setPermissions(preset.permissions);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (existingUser) {
        // Update
        const ref = doc(db, 'platformUsers', existingUser.uid);
        await updateDoc(ref, {
          ...formData,
          permissions,
          clientScope
        });
        onSuccess();
      } else {
        // Create
        const result: any = await createInternalUserCallable({
          ...formData,
          permissions,
          clientScope
        });
        onSuccess(result?.data?.generatedPassword);
      }
      onClose();
    } catch (error: any) {
      console.error(error);
      alert('Błąd: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        
        <div className="px-6 py-4 border-b border-[#F1F5F9] flex justify-between items-center bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A] tracking-tight">
              {existingUser ? 'Edytuj Pracownika' : 'Dodaj Pracownika (Internal)'}
            </h2>
            <p className="text-[12px] text-[#64748B]">
              Profil zyska dostęp do paneli administracyjnych Gepard SaaS.
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-xl transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
          <form id="internal-user-form" onSubmit={handleSubmit} className="space-y-8">
            
            {/* SEKCJA 1: DANE */}
            <section>
              <h3 className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider mb-4 border-b border-[#F1F5F9] pb-2">1. Dane Podstawowe</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-semibold text-[#334155] mb-1">Imię</label>
                  <input required type="text" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#334155] mb-1">Nazwisko</label>
                  <input required type="text" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[12px] font-semibold text-[#334155] mb-1">E-mail (Login)</label>
                  <input required type="email" disabled={!!existingUser} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-gray-50" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#334155] mb-1">Telefon służbowy</label>
                  <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#334155] mb-1">Dział</label>
                  <select value={formData.department} onChange={e => setFormData({...formData, department: e.target.value as PlatformDepartment})} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA]">
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* SEKCJA 2 & 6: ROLA & STATUS */}
            <section className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider mb-4 border-b border-[#F1F5F9] pb-2">2. Rola Operacyjna</h3>
                <select value={formData.role} onChange={e => handleRoleChange(e.target.value as PlatformRole)} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA] bg-[#F8FAFC] font-semibold text-[#0F172A]">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <p className="text-[10px] text-[#64748B] mt-1">Zmiana roli resetuje uprawnienia poniżej do wartości domyślnych.</p>

                {formData.role === 'WAREHOUSE' && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                    <label className="block text-[12px] font-semibold text-blue-900 mb-1">Przypisz stację pakowania (Opcjonalnie)</label>
                    <select 
                      value={formData.assignedPackingStationId || ''} 
                      onChange={e => setFormData({...formData, assignedPackingStationId: e.target.value})} 
                      className="w-full border border-blue-200 rounded-lg h-[36px] px-3 text-[13px] focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">Brak przypisania (Dostęp ogólny)</option>
                      <option value="station-1">PackStation 1</option>
                      <option value="station-2">PackStation 2</option>
                      <option value="station-3">PackStation 3</option>
                      <option value="station-4">PackStation 4</option>
                    </select>
                    <p className="text-[10px] text-blue-700 mt-1 leading-tight">
                      Jeśli wybrane, po zalogowaniu pracownik zostanie zablokowany wyłącznie na wybranej stacji pakowania bez dostępu do reszty panelu.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider mb-4 border-b border-[#F1F5F9] pb-2">6. Status Początkowy</h3>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as 'active'|'invited'|'blocked'})} className="w-full border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA]">
                  <option value="active">ACTIVE (Pełny dostęp)</option>
                  <option value="invited">INVITED (Oczekujący)</option>
                  <option value="blocked">BLOCKED (Zablokowany)</option>
                </select>
              </div>
            </section>

            {/* SEKCJA 3: UPRAWNIENIA MODUŁÓW */}
            <section>
              <h3 className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider mb-4 border-b border-[#F1F5F9] pb-2">3. Uprawnienia Modułów (Permissions)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.keys(permissions.modules).map((mod) => (
                  <div key={mod} className="bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                    <label className="block text-[11px] font-bold text-[#475569] uppercase tracking-wider mb-2">{mod}</label>
                    <select 
                      value={permissions.modules[mod as keyof typeof permissions.modules]}
                      onChange={(e) => setPermissions({
                        ...permissions, 
                        modules: { ...permissions.modules, [mod]: e.target.value as any }
                      })}
                      className="w-full text-[12px] bg-white border border-[#CBD5E1] rounded-md h-[28px] focus:ring-[#4338CA] focus:border-[#4338CA]"
                    >
                      <option value="none">Brak dostępu</option>
                      <option value="read">Tylko odczyt</option>
                      <option value="write">Pełna edycja</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>

            {/* SEKCJA 4: FINANSE */}
            <section>
              <h3 className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider mb-4 border-b border-[#F1F5F9] pb-2">4. Moduł Finansowy</h3>
              <div className="flex gap-6 p-4 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] shadow-inner font-semibold text-[13px] text-[#334155]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={permissions.financeAccess.canSeeCosts} onChange={e => setPermissions({...permissions, financeAccess: {...permissions.financeAccess, canSeeCosts: e.target.checked}})} className="rounded text-[#4338CA]" />
                  Widzi Koszty
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={permissions.financeAccess.canSeeMargins} onChange={e => setPermissions({...permissions, financeAccess: {...permissions.financeAccess, canSeeMargins: e.target.checked}})} className="rounded text-[#4338CA]" />
                  Widzi Marże
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={permissions.financeAccess.canEditPricing} onChange={e => setPermissions({...permissions, financeAccess: {...permissions.financeAccess, canEditPricing: e.target.checked}})} className="rounded text-[#4338CA]" />
                  Edytuje Cenniki
                </label>
              </div>
            </section>

            {/* SEKCJA 5: ZAKRES KLIENTÓW */}
            <section>
              <h3 className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider mb-4 border-b border-[#F1F5F9] pb-2">5. Zakres Klientów (Scope)</h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-[#0F172A]">
                    <input type="radio" name="scopeType" value="all" checked={clientScope.type === 'all'} onChange={() => setClientScope({ type: 'all', clientIds: [] })} className="text-[#4338CA]" />
                    Wszyscy (Global)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-[#0F172A]">
                    <input type="radio" name="scopeType" value="assigned" checked={clientScope.type === 'assigned'} onChange={() => setClientScope({ type: 'assigned', clientIds: [] })} className="text-[#4338CA]" />
                    Przypisani
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-[#0F172A]">
                    <input type="radio" name="scopeType" value="selected" checked={clientScope.type === 'selected'} onChange={() => setClientScope({ type: 'selected', clientIds: [] })} className="text-[#4338CA]" />
                    Wybrane Firmy
                  </label>
                </div>
                
                {clientScope.type === 'selected' && (
                   <div className="p-4 border border-[#CBD5E1] rounded-xl bg-[#F8FAFC]">
                      <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-3">Wybierz dozwolone podmioty:</p>
                      <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto custom-scrollbar">
                        {companies.map(c => (
                          <label key={c.id} className="flex items-center gap-2 text-[12px] bg-white border border-[#E2E8F0] p-2 rounded-lg cursor-pointer hover:border-[#4338CA]">
                            <input 
                              type="checkbox" 
                              checked={clientScope.clientIds.includes(c.id)}
                              onChange={(e) => {
                                const newIds = e.target.checked 
                                  ? [...clientScope.clientIds, c.id]
                                  : clientScope.clientIds.filter(id => id !== c.id);
                                setClientScope({ ...clientScope, clientIds: newIds });
                              }}
                              className="rounded text-[#4338CA]"
                            />
                            <span className="truncate">{c.name}</span>
                          </label>
                        ))}
                      </div>
                   </div>
                )}
              </div>
            </section>

          </form>
        </div>

        <div className="px-6 py-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex justify-end gap-3 shrink-0">
          <button onClick={onClose} disabled={loading} className="px-5 py-2 text-[13px] font-semibold text-[#64748B] bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] rounded-xl transition-colors disabled:opacity-50">
            Anuluj
          </button>
          <button form="internal-user-form" type="submit" disabled={loading} className="px-5 py-2 text-[13px] font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-xl shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50">
            {loading ? <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">save</span>}
            {existingUser ? 'Zapisz Zmiany' : 'Utwórz Pracownika (Konto)'}
          </button>
        </div>

      </div>
    </div>
  );
}

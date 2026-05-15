import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Company, CompanyMemberWithProfile } from '../../data/types';
import { getCompanyMembers } from '../../data/company';

interface CompanyDetailsPanelProps {
  companyId: string;
  onClose: () => void;
}

export default function CompanyDetailsPanel({ companyId, onClose }: CompanyDetailsPanelProps) {
  const [company, setCompany] = useState<Company | null>(null);
  const [members, setMembers] = useState<CompanyMemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDetails() {
      setLoading(true);
      setError('');
      try {
        // 1. Fetch Company Data
        const compRef = doc(db, 'companies', companyId);
        const compSnap = await getDoc(compRef);
        
        if (!compSnap.exists()) {
          setError('Nie znaleziono firmy.');
          setLoading(false);
          return;
        }
        
        const companyData = { id: compSnap.id, ...compSnap.data() } as Company;
        setCompany(companyData);

        // 2. Fetch Members (CompanyMemberWithProfile logic)
        try {
           const membersData = await getCompanyMembers(companyId);
           setMembers(membersData);
        } catch (memErr: any) {
           console.error("Panel: Błąd ładowania members", memErr);
           setError('Firma załadowana, ale odczyt listy członków się nie powiódł: ' + memErr.message);
        }

      } catch (err: any) {
        console.error("Panel: Błąd", err);
        setError('Błąd pobierania danych z bazy: ' + err.message);
      } finally {
        setLoading(false);
      }
    }

    if (companyId) {
      loadDetails();
    }
  }, [companyId]);

  if (loading) {
    return (
      <div className="flex-1 bg-white border-l border-[#E2E8F0] overflow-y-auto">
        <div className="p-6 h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
             <div className="w-8 h-8 rounded-full border-2 border-[#E2E8F0] border-t-[#4338CA] animate-spin"></div>
             <p className="text-[13px] font-medium text-[#64748B]">Ładowanie profilu firmy...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !company) {
    return (
      <div className="flex-1 bg-white border-l border-[#E2E8F0] overflow-y-auto">
        <div className="p-6 h-full flex flex-col items-center justify-center text-center">
           <span className="material-symbols-outlined text-[48px] text-[#EF4444] mb-4">error</span>
           <h2 className="text-[16px] font-bold text-[#0F172A] mb-2">Błąd odczytu</h2>
           <p className="text-[14px] text-[#64748B] mb-6">{error}</p>
           <button onClick={onClose} className="px-4 py-2 bg-[#F1F5F9] text-[#64748B] rounded-xl text-[14px] font-bold hover:bg-[#E2E8F0] transition-colors">Zamknij panel</button>
        </div>
      </div>
    );
  }

  if (!company) return null;

  return (
    <div className="flex-1 bg-white border-l border-[#E2E8F0] overflow-y-auto relative h-[calc(100vh-64px)] sm:h-auto flex flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 border-b border-[#E2E8F0] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[#4338CA] text-[20px]">domain</span>
          <h2 className="text-[16px] font-bold text-[#0F172A]">Karta Firmy</h2>
        </div>
        <button 
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div className="p-4 sm:p-5 flex-1 space-y-5 overflow-y-auto">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-sm">
          <div className="flex flex-col items-center text-center mb-5">
            <div className="w-[60px] h-[60px] rounded-2xl bg-gradient-to-br from-[#EEF2FF] to-[#E0E7FF] text-[#4338CA] flex items-center justify-center text-[24px] font-bold mb-3 shadow-[inset_0_2px_4px_rgba(255,255,255,0.5)] border border-[#C7D2FE]">
              {company.name.charAt(0).toUpperCase()}
            </div>
            <h3 className="text-[18px] font-bold text-[#0F172A] leading-tight mb-1">{company.name}</h3>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 text-[11px] font-bold rounded-md uppercase tracking-wider ${company.status === 'active' ? 'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]' : 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'}`}>
                {company.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-[13px] border-t border-[#F1F5F9] pt-4">
            <div>
               <span className="block text-[#94A3B8] text-[11px] font-bold uppercase mb-0.5">NIP (Tax ID)</span>
               <span className="font-semibold text-[#334155]">{company.taxId}</span>
            </div>
            <div>
               <span className="block text-[#94A3B8] text-[11px] font-bold uppercase mb-0.5">GEP-Code</span>
               <span className="font-mono font-semibold text-[#4338CA] bg-[#EEF2FF] px-1.5 py-0.5 rounded border border-[#C7D2FE]">{company.companyCode || '-'}</span>
            </div>
            <div className="col-span-2">
               <span className="block text-[#94A3B8] text-[11px] font-bold uppercase mb-0.5">E-mail firmowy</span>
               <span className="font-medium text-[#334155]">{company.email}</span>
            </div>
            <div className="col-span-2">
               <span className="block text-[#94A3B8] text-[11px] font-bold uppercase mb-0.5">Adres</span>
               <span className="font-medium text-[#334155] block">{company.address?.street}</span>
               <span className="font-medium text-[#334155] block">{company.address?.postalCode} {company.address?.city}, {company.address?.country}</span>
            </div>
          </div>
        </div>

        {error && (
            <div className="bg-[#FEF2F2] border border-[#FCA5A5] text-[#991B1B] p-3 rounded-xl text-[12px] font-medium">
               {error}
            </div>
        )}

        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
           <div className="bg-[#F8FAFC] border-b border-[#E2E8F0] px-4 py-3 flex items-center justify-between">
              <h4 className="text-[12px] font-bold text-[#475569] uppercase tracking-wider">Członkowie / Zespół</h4>
              <span className="bg-[#E2E8F0] text-[#475569] text-[11px] font-bold px-2 py-0.5 rounded-full">{members.length}</span>
           </div>
           
           <div className="p-4">
             {members.length === 0 ? (
                <div className="text-center py-6">
                   <span className="material-symbols-outlined text-[#CBD5E1] text-[32px] mb-2">group_off</span>
                   <p className="text-[13px] font-medium text-[#64748B]">Firma nie posiada jeszcze przypisanych pracowników.</p>
                </div>
             ) : (
                <ul className="space-y-4">
                  {members.map(m => (
                    <li key={m.uid} className="flex flex-col gap-1 border-b border-[#F1F5F9] pb-4 last:border-0 last:pb-0">
                       <div className="flex justify-between items-center">
                          <span className="font-bold text-[14px] text-[#0F172A]">{m.profile?.displayName || m.profile?.email || 'Brak danych'}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${m.status === 'active' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEE2E2] text-[#991B1B]'}`}>
                            {m.status}
                          </span>
                       </div>
                       <div className="flex justify-between items-end mt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-[#4338CA] bg-[#EEF2FF] px-1.5 py-0.5 rounded border border-[#C7D2FE] uppercase tracking-wider">{m.role}</span>
                            <span className="text-[11px] font-mono text-[#94A3B8]" title={m.uid}>..{m.uid.substring(m.uid.length - 6)}</span>
                          </div>
                          <span className="text-[11px] text-[#94A3B8]">Dodał(a): {new Date(m.joinedAt).toLocaleDateString()}</span>
                       </div>
                    </li>
                  ))}
                </ul>
             )}
           </div>
        </div>

      </div>
    </div>
  );
}

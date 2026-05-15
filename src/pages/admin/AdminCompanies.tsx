import { useEffect, useState } from 'react';
import { getAllCompanies } from '../../data/company';
import type { Company } from '../../data/types';
import CompanyDetailsPanel from './CompanyDetailsPanel';

export default function AdminCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  // Przyszłe filtry
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    async function load() {
      try {
        const data = await getAllCompanies();
        setCompanies(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = companies.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return c.name.toLowerCase().includes(term) || 
             c.companyCode?.toLowerCase().includes(term) || 
             c.taxId.includes(term);
    }
    return true;
  });

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-64px)] relative">
      <div className={`transition-all duration-300 ${selectedCompanyId ? 'w-full lg:w-[calc(100%-400px)] hidden lg:block' : 'w-full'}`}>
        <div className="w-full px-4 py-4">
          <div className="flex justify-between items-center mb-5">
            <h1 className="text-xl font-semibold text-[#0F172A] tracking-tight">Lista Firm (Global)</h1>
          </div>

      {/* MD3 High Density Toolbar */}
      <div className="bg-white p-3 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#E2E8F0] mb-5 flex flex-col sm:flex-row gap-3 justify-between items-center">
        <div className="relative w-full sm:w-[400px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-[20px]">search</span>
          <input 
            type="text" 
            placeholder="Szukaj po nazwie, NIP lub GEP-ID..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 h-[40px] text-[13px] border border-[#CBD5E1] rounded-xl focus:ring-[#4338CA] focus:border-[#4338CA] transition-colors"
          />
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#64748B] text-[20px]">filter_alt</span>
            <select 
              value={statusFilter} 
              onChange={e => setStatusFilter(e.target.value)}
              className="border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA] bg-white text-[#334155] cursor-pointer"
            >
              <option value="all">Wszystkie statusy</option>
              <option value="active">Aktywne</option>
              <option value="blocked">Zablokowane</option>
              <option value="archived">Zarchiwizowane</option>
            </select>
          </div>
        </div>
      </div>

      {/* MD3 High Density Table */}
      <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-x-auto rounded-2xl border border-[#E2E8F0]">
        <table className="min-w-full divide-y divide-[#E2E8F0] text-[13px]">
          <thead className="bg-[#F8FAFC]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                <div className="flex items-center gap-1 cursor-pointer hover:text-[#0F172A] transition-colors">
                  Code <span className="material-symbols-outlined text-[16px]">swap_vert</span>
                </div>
              </th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Firma</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">NIP (TaxID)</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Kraj</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Kontakt</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Status</th>
              <th className="px-4 py-3 text-center font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Memb.</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Rejestracja</th>
              <th className="px-4 py-3 text-right font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Akcje</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-[#F1F5F9]">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[#64748B]">Ładowanie bazy firm...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[#64748B]">Brak wyników.</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono font-semibold text-[#0F172A]">{c.companyCode || '-'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="font-semibold text-[#0F172A]">{c.name}</div>
                    <div className="text-[11px] text-[#94A3B8] font-mono mt-0.5" title={c.id}>ID: {c.id.substring(0,8)}...</div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-[#475569]">{c.taxId}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-[#475569]">{c.address.country}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="text-[#0F172A] font-medium">{c.email}</div>
                    <div className="text-[11.5px] text-[#64748B] mt-0.5">{c.phone}</div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md ${c.status === 'active' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEE2E2] text-[#991B1B]'}`}>
                      {c.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] text-center font-semibold">{c.membersCount || 1}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-[#64748B]">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-right">
                    <button 
                      onClick={() => setSelectedCompanyId(c.id)}
                      className="px-3 py-1.5 bg-white border border-[#CBD5E1] text-[#475569] text-[12px] font-semibold rounded-lg hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors shadow-sm"
                    >
                      Podgląd
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        
        {/* Paginator Placeholder */}
        <div className="bg-[#F8FAFC] px-4 py-2.5 border-t border-[#E2E8F0] flex items-center justify-between">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-[12px] text-[#64748B]">
                Pokazano <span className="font-semibold text-[#0F172A]">{filtered.length > 0 ? 1 : 0}</span> do <span className="font-semibold text-[#0F172A]">{filtered.length}</span> z <span className="font-semibold text-[#0F172A]">{filtered.length}</span> wyników
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-lg shadow-sm -space-x-px gap-1" aria-label="Pagination">
                <button className="relative inline-flex items-center px-1 py-1 rounded-md border border-transparent bg-transparent hover:bg-[#E2E8F0] text-[#64748B] transition-colors">
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                <button className="relative inline-flex items-center px-3 py-1 rounded-md border border-transparent bg-[#E0E7FF] text-[13px] font-bold text-[#4338CA]">1</button>
                <button className="relative inline-flex items-center px-1 py-1 rounded-md border border-transparent bg-transparent hover:bg-[#E2E8F0] text-[#64748B] transition-colors">
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>
      </div>
      </div>

      {selectedCompanyId && (
        <div className="w-full lg:w-[400px] bg-white lg:border-l border-[#E2E8F0] shadow-2xl lg:shadow-none flex flex-col fixed lg:sticky top-[64px] lg:top-0 h-[calc(100vh-64px)] right-0 z-40 transform transition-transform duration-300 translate-x-0">
          <CompanyDetailsPanel 
            companyId={selectedCompanyId} 
            onClose={() => setSelectedCompanyId(null)} 
          />
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { PlatformUser } from '../../data/platformUsers';
import { getPlatformUsers, updatePlatformUserStatus } from '../../data/platformUsers';
import PlatformUserModal from './components/PlatformUserModal';
import { useAuth } from '../../auth/useAuth';
import { Navigate } from 'react-router-dom';

export default function AdminInternalTeam() {
  const { profile } = useAuth();

  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PlatformUser | null>(null);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await getPlatformUsers();
      setUsers(data);
    } catch (err: any) {
      console.error(err);
      alert("Błąd ładowania tabeli: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = (pwd?: string) => {
    loadUsers();
    if (pwd) {
      setGeneratedPassword(pwd);
      setShowPasswordModal(true);
      setCopied(false);
    }
  };

  useEffect(() => {
    if (profile?.globalRole === 'superadmin') {
      loadUsers();
    }
  }, [profile]);

  if (profile?.globalRole !== 'superadmin') {
    return <Navigate to="/unauthorized" replace />;
  }

  const handleStatusToggle = async (uid: string, currentStatus: "active" | "invited" | "blocked") => {
    const newStatus = currentStatus === 'blocked' ? 'active' : 'blocked';
    if (!window.confirm(`Czy na pewno chcesz zmienić status na ${newStatus}?`)) return;
    try {
      await updatePlatformUserStatus(uid, newStatus);
      await loadUsers();
    } catch (error) {
      console.error(error);
      alert('Błąd podczas aktualizacji statusu.');
    }
  };

  const filtered = users.filter(u => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return u.firstName.toLowerCase().includes(term) || 
             u.lastName.toLowerCase().includes(term) || 
             u.email.toLowerCase().includes(term) ||
             u.role.toLowerCase().includes(term);
    }
    return true;
  });

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] relative">
      <div className="w-full px-4 py-4">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-xl font-semibold text-[#0F172A] tracking-tight">Zespół / Pracownicy (Gepard)</h1>
          <button 
            onClick={() => { setEditingUser(null); setIsModalOpen(true); }}
            className="flex items-center gap-2 bg-[#4338CA] hover:bg-[#3730A3] text-white px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Dodaj Pracownika
          </button>
        </div>

        {/* MD3 High Density Toolbar */}
        <div className="bg-white p-3 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#E2E8F0] mb-5 flex flex-col sm:flex-row gap-3 justify-between items-center">
          <div className="relative w-full sm:w-[400px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-[20px]">search</span>
            <input 
              type="text" 
              placeholder="Szukaj po nazwisku, emailu lub roli..." 
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
                <option value="active">Aktywni</option>
                <option value="invited">Zaproszeni</option>
                <option value="blocked">Zablokowani</option>
              </select>
            </div>
          </div>
        </div>

        {/* MD3 High Density Table */}
        <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-x-auto rounded-2xl border border-[#E2E8F0]">
          <table className="min-w-full divide-y divide-[#E2E8F0] text-[13px]">
            <thead className="bg-[#F8FAFC]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Pracownik</th>
                <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Kontakt</th>
                <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Rola i Dział</th>
                <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Logowanie</th>
                <th className="px-4 py-3 text-right font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Akcje</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[#64748B]">Ładowanie zespołu wewnętrznego...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[#64748B]">Brak pasujących pracowników</td></tr>
              ) : (
                filtered.map(u => (
                  <tr key={u.uid} className="hover:bg-[#F8FAFC] transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-[#0F172A]">{u.firstName} {u.lastName}</span>
                        <span className="text-[#64748B] text-[11px] font-mono mt-0.5" title={u.uid}>ID: {u.uid.substring(0,8)}...</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[#334155]">{u.email}</span>
                        {u.phone && <span className="text-[#64748B] text-[12px]">{u.phone}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                       <div className="flex flex-col gap-1 items-start">
                         <span className="bg-[#EEF2FF] text-[#4338CA] px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
                            {u.role}
                         </span>
                         <span className="text-[#64748B] text-[12px] uppercase tracking-wider font-semibold">
                            {u.department}
                         </span>
                       </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border
                        ${u.status === 'active' ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]' : 
                          u.status === 'invited' ? 'bg-[#FEF9C3] text-[#854D0E] border-[#FEF08A]' :
                          'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#64748B]">
                      <div className="flex flex-col">
                        <span>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Nigdy'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingUser(u); setIsModalOpen(true); }}
                          className="p-1.5 text-[#64748B] hover:text-[#4338CA] hover:bg-[#EEF2FF] rounded-lg transition-colors"
                          title="Podgląd / Edycja"
                        >
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button 
                          onClick={() => handleStatusToggle(u.uid, u.status)}
                          className={`p-1.5 rounded-lg transition-colors ${u.status === 'blocked' ? 'text-[#166534] hover:bg-[#DCFCE7]' : 'text-[#991B1B] hover:bg-[#FEE2E2]'}`}
                          title={u.status === 'blocked' ? 'Odblokuj' : 'Zablokuj'}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {u.status === 'blocked' ? 'lock_open' : 'block'}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          
          <div className="bg-[#F8FAFC] border-t border-[#E2E8F0] px-4 py-3 flex items-center justify-between text-[12px] text-[#64748B]">
            <span>Pokazano 1 do {filtered.length} z {filtered.length} wyników</span>
            <div className="flex gap-1">
               <button className="p-1 hover:bg-[#E2E8F0] rounded disabled:opacity-50" disabled><span className="material-symbols-outlined text-[18px]">chevron_left</span></button>
               <button className="p-1 hover:bg-[#E2E8F0] rounded disabled:opacity-50" disabled><span className="material-symbols-outlined text-[18px]">chevron_right</span></button>
            </div>
          </div>
        </div>
      </div>
      
      {isModalOpen && (
        <PlatformUserModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          existingUser={editingUser}
          onSuccess={handleSuccess}
        />
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="bg-[#4338CA] p-6 text-white text-center">
              <span className="material-symbols-outlined text-[48px] mb-2 opacity-90">key</span>
              <h2 className="text-xl font-bold">Konto Utworzone!</h2>
              <p className="text-indigo-100 text-sm mt-1">Oto jednorazowe hasło startowe dla pracownika</p>
            </div>
            
            <div className="p-6">
              <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] mb-6">
                <div className="flex items-center justify-between gap-3">
                  <input 
                    type="text" 
                    readOnly 
                    value={generatedPassword} 
                    className="w-full bg-transparent text-center text-lg font-mono font-bold text-[#0F172A] outline-none"
                  />
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(generatedPassword);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className={`shrink-0 p-2 rounded-lg transition-colors flex items-center gap-1 ${copied ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#EEF2FF] text-[#4338CA] hover:bg-[#E0E7FF]'}`}
                    title="Skopiuj hasło"
                  >
                    <span className="material-symbols-outlined text-[20px]">{copied ? 'check' : 'content_copy'}</span>
                  </button>
                </div>
              </div>
              
              <div className="p-3 bg-[#FFFBEB] rounded-lg border border-[#FEF3C7] mb-6 flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#92400E]">warning</span>
                <p className="text-[#92400E] text-[12px] font-medium leading-relaxed">
                  Skopiuj hasło teraz! Ze względów bezpieczeństwa nie zostanie ono nigdzie zapisane w postaci jawnej.
                </p>
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={() => setShowPasswordModal(false)}
                  className="bg-[#0F172A] text-white px-6 py-2.5 rounded-xl text-[13px] font-semibold hover:bg-[#1E293B] transition-colors w-full"
                >
                  Zamknij i kontynuuj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

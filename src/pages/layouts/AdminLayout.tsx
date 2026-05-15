import React, { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';
import { getUserDisplayName } from '../../utils/user';
import { LanguageSelector } from '../../components/common/LanguageSelector';

export const AdminLayout: React.FC = () => {
  const { profile, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isSuperadmin = profile?.globalRole === 'superadmin';

  const navItems = [
    { icon: 'dashboard', label: t('layout.dashboard'), path: '/admin/dashboard' },
    ...(isSuperadmin ? [{ icon: 'admin_panel_settings', label: t('layout.internalTeam'), path: '/admin/team' }] : []),
    { icon: 'domain', label: t('layout.companies'), path: '/admin/companies' },
    ...(isSuperadmin ? [{ icon: 'group', label: t('layout.users'), path: '/admin/users' }] : []),
    ...(isSuperadmin ? [{ icon: 'extension', label: t('layout.integrations'), path: '/admin/integrations' }] : []),
    ...(isSuperadmin ? [{ icon: 'local_shipping', label: 'Przesyłki (Global)', path: '/admin/shipments' }] : []),
    ...(isSuperadmin ? [{ icon: 'move_to_inbox', label: 'Awizacje (Global)', path: '/admin/inbounds' }] : []),
    ...(isSuperadmin ? [{ icon: 'output', label: 'Wydania (WZ)', path: '/admin/outbounds' }] : []),
    ...(isSuperadmin ? [{ icon: 'receipt_long', label: 'Kontrakty Kurierów', path: '/admin/carrier-contracts' }] : []),
    ...(isSuperadmin ? [{ icon: 'price_change', label: 'Cenniki Klientów', path: '/admin/client-pricing' }] : []),
    ...(isSuperadmin ? [{ icon: 'warehouse', label: 'Lokalizacje (Stare)', path: '/admin/warehouse' }] : []),
    ...(isSuperadmin ? [{ icon: 'domain_verification', label: 'Fulfillment (Magazyny)', path: '/admin/fulfillment/warehouses' }] : []),
    ...(isSuperadmin || profile?.platformRole === 'WAREHOUSE' ? [{ icon: 'low_priority', label: 'Fulfillment Kolejka', path: '/admin/fulfillment' }] : []),
    ...(isSuperadmin || profile?.platformRole === 'WAREHOUSE' ? [{ icon: 'conveyor_belt', label: 'Fulfillment Pack', path: '/admin/fulfillment/pack' }] : []),
    ...(isSuperadmin ? [{ icon: 'history', label: t('layout.auditLogs'), path: '/admin/logs' }] : []),
    { icon: 'settings', label: t('layout.settings'), path: '/admin/settings' },
    { icon: 'new_releases', label: t('layout.changelog', 'Nowości'), path: '/admin/changelog' },
  ];

  const displayName = getUserDisplayName(profile);
  const initial = displayName.substring(0, 2).toUpperCase();

  const assignedPackingStationId = (profile as any)?.assignedPackingStationId;
  const isWarehousePackerLocked = profile?.platformRole === 'WAREHOUSE' && !!assignedPackingStationId;

  useEffect(() => {
    if (isWarehousePackerLocked && assignedPackingStationId) {
      const targetPath = `/admin/fulfillment/pack/${assignedPackingStationId}`;
      if (!location.pathname.startsWith(targetPath)) {
        navigate(`${targetPath}?scan=`, { replace: true });
      }
    }
  }, [profile, location.pathname, isWarehousePackerLocked, navigate, assignedPackingStationId]);

  if (isWarehousePackerLocked) {
    return (
      <div className="h-screen w-full bg-[#1e1e1e] flex flex-col font-sans text-sm overflow-hidden text-white">
        {/* Minimal locked header for packer */}
        <header className="bg-[#111111] border-b border-[#333333] h-[52px] flex items-center justify-between px-6 shrink-0 z-50">
           <div className="flex flex-col">
             <div className="font-bold text-white text-[14px]">Stacja: {assignedPackingStationId}</div>
             <div className="text-[10px] text-gray-500 uppercase tracking-widest leading-none mt-0.5">Zablokowany tryb wydawania</div>
           </div>
           
           <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
               <div className="w-[30px] h-[30px] rounded-full bg-[#2a2a2a] text-[#a0a0a0] flex items-center justify-center font-bold text-[12px]">
                 {initial}
               </div>
               <div className="hidden sm:block">
                 <span className="text-[12px] font-semibold text-white leading-none block">{displayName}</span>
                 <span className="text-[10px] text-[#DC2626] font-bold leading-none block mt-0.5">MAGAZYN (LOCK)</span>
               </div>
             </div>
             <button
               onClick={handleLogout}
               className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#2a2a2a] text-red-400 hover:bg-[#333] transition-colors border border-[#444]"
             >
               <span className="material-symbols-outlined text-[16px]">logout</span>
               Przeloguj
             </button>
           </div>
        </header>

        <main className="flex-1 overflow-hidden bg-[#1e1e1e] relative">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#F8FAFC] flex overflow-hidden font-sans text-sm">
      {/* Sidebar - MD3 Dark variant for superadmin */}
      <aside 
        className={`${isSidebarOpen ? 'w-[256px]' : 'w-[80px]'} 
          bg-[#0F172A] border-r border-[#1E293B] flex flex-col transition-all duration-200 left-0 z-20 relative h-full shrink-0`}
      >
        <div className="h-[64px] flex items-center justify-between px-4 border-b border-[#1E293B]">
          {isSidebarOpen && <span className="font-bold text-lg text-white pl-2 tracking-tight">ADMIN</span>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-2 rounded-full hover:bg-[#1E293B] text-[#94A3B8] transition-colors ${!isSidebarOpen && 'mx-auto'}`}>
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>
        </div>

                <div className="flex-1 overflow-y-auto py-3 scrollbar-hide flex flex-col gap-1 px-3">
          {navItems.map(item => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link 
                key={item.path} 
                to={item.path} 
                className={`flex items-center gap-[18px] px-3 h-[44px] rounded-full transition-colors ${
                  isActive ? 'bg-[#334155] text-white' : 'text-[#94A3B8] hover:bg-[#1E293B] hover:text-[#F8FAFC]'
                } ${!isSidebarOpen && 'justify-center border-none'}`}
                title={item.label}
              >
                <span className={`material-symbols-outlined text-[20px] ${isActive ? 't-[FILL=1]' : ''}`} style={{ fontVariationSettings: isActive ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300" }}>
                  {item.icon}
                </span>
                {isSidebarOpen && <span className={`text-[13px] leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>}
              </Link>
            )
          })}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col w-full h-screen overflow-hidden">
        {/* Header - MD3 */}
        <header className="bg-white border-b border-[#E2E8F0] h-[64px] flex items-center justify-between px-6 shrink-0">
          <div className="font-medium text-[#0F172A] text-[15px] flex items-center gap-2">
            {t('layout.globalAdmin')} <span className="text-[10px] font-bold text-[#DC2626] bg-[#FEF2F2] px-1.5 py-0.5 rounded uppercase">Superadmin</span>
          </div>
          
          <div className="flex items-center gap-5">
            <Link 
              to="/admin/changelog" 
              className="relative flex items-center justify-center p-2 rounded-full text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
              title={t('layout.changelog', 'Nowości')}
            >
              <span className="material-symbols-outlined text-[22px]">notifications</span>
              <span className="absolute top-1.5 right-2 w-2 h-2 bg-[#EF4444] rounded-full border-2 border-white"></span>
              <span className="absolute top-1.5 right-2 w-2 h-2 bg-[#EF4444] rounded-full animate-ping opacity-75"></span>
            </Link>

            <LanguageSelector variant="topbar" />
            
            <div className="h-5 w-px border-l border-[#E2E8F0]"></div>
            
            <div className="relative" ref={profileMenuRef}>
              <div 
                className="flex items-center gap-2.5 cursor-pointer hover:bg-[#F8FAFC] p-1 pr-2 rounded-full transition-colors border border-transparent hover:border-[#E2E8F0]"
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              >
                <div className="w-[32px] h-[32px] rounded-full bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center font-bold text-[13px]">
                  {initial}
                </div>
                <div className="flex flex-col hidden sm:flex justify-center h-[32px]">
                  <span className="text-[13px] font-semibold text-[#0F172A] leading-none mb-1">{displayName}</span>
                  <span className="text-[11px] text-[#DC2626] font-medium leading-none">{profile?.platformRole || profile?.globalRole}</span>
                </div>
                <span className={`material-symbols-outlined text-[#94A3B8] text-[18px] transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`}>expand_more</span>
              </div>

              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-2 w-[240px] bg-white rounded-xl shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] border border-[#E2E8F0] py-2 z-50">
                  <div className="px-4 py-3 border-b border-[#F1F5F9] mb-1">
                    <p className="text-[13px] font-medium text-[#0F172A] truncate">{profile?.email}</p>
                    <p className="text-[11px] text-[#DC2626] mt-0.5">Role: {profile?.platformRole || profile?.globalRole}</p>
                  </div>
                  
                  <Link
                    to="/admin/settings"
                    onClick={() => setIsProfileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px] text-[#64748B]">person</span>
                    {t('layout.myProfile')}
                  </Link>
                  
                  <div className="border-t border-[#F1F5F9] mt-1 pt-1">
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#DC2626] hover:bg-[#FEF2F2] w-full text-left transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      {t('layout.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto bg-[#F8FAFC] p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

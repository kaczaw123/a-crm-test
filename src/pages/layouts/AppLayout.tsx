import React, { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';
import { getUserDisplayName } from '../../utils/user';
import { LanguageSelector } from '../../components/common/LanguageSelector';

export const AppLayout: React.FC = () => {
  const { profile, membership, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [warehouseOpen, setWarehouseOpen] = useState(
    location.pathname.includes('/warehouse') || 
    location.pathname.includes('/inbound') || 
    location.pathname.includes('/outbound')
  );
  const [shipmentsOpen, setShipmentsOpen] = useState(
    location.pathname.includes('/shipments')
  );

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

  const navItems = [
    { icon: 'dashboard', label: t('layout.dashboard', 'Dashboard'), path: '/app/dashboard' },
    { icon: 'assignment_turned_in', label: t('layout.orders', 'Zamówienia'), path: '/app/orders' },
    { 
      id: 'shipments',
      icon: 'local_shipping', 
      label: t('layout.shipments', 'Przesyłki'), 
      isSubmenu: true,
      subItems: [
        { icon: 'list_alt', label: t('layout.shipmentList', 'Lista przesyłek'), path: '/app/shipments' },
        { icon: 'request_quote', label: t('layout.pricing', 'Cennik'), path: '/app/shipments/pricing' }
      ]
    },
    { 
      id: 'warehouse',
      icon: 'warehouse', 
      label: t('layout.fulfillment', 'Fulfillment'), 
      isSubmenu: true,
      subItems: [
        { icon: 'inventory_2', label: t('layout.warehouse', 'Magazyn'), path: '/app/warehouse' },
        { icon: 'input', label: t('layout.inbound', 'Awizacje (IN)'), path: '/app/inbound' },
        { icon: 'output', label: t('outbound.title', 'Wydania (WZ)'), path: '/app/outbound' }
      ]
    },
    { icon: 'inventory_2', label: t('layout.products', 'Produkty'), path: '/app/products' },
    { icon: 'extension', label: t('layout.integrations', 'Integracje'), path: '/app/settings/integrations' },
    { icon: 'new_releases', label: t('layout.changelog', 'Nowości'), path: '/app/changelog' },
  ];

  const adminItems = [
    { icon: 'settings', label: t('layout.settings'), path: '/app/company' },
    { icon: 'admin_panel_settings', label: t('layout.team'), path: '/app/team' }
  ];

  const displayName = getUserDisplayName(profile);
  const initial = displayName.substring(0, 2).toUpperCase();

  return (
    <div className="h-screen w-full bg-[#F8FAFC] flex overflow-hidden font-sans text-sm"> {/* MD3 High Density base text-sm */}
      {/* Sidebar - MD3 Surface */}
      <aside 
        className={`${isSidebarOpen ? 'w-[256px]' : 'w-[80px]'} 
          bg-white border-r border-[#E2E8F0] flex flex-col transition-all duration-200 ease-in-out left-0 z-20 relative h-full shrink-0`}
      >
        <div className="h-[64px] flex items-center justify-between px-4 border-b border-[#E2E8F0]">
          {isSidebarOpen && <span className="font-bold text-lg text-[#0F172A] pl-2 tracking-tight">GEPARD</span>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-2 rounded-full hover:bg-[#F1F5F9] text-[#475569] transition-colors ${!isSidebarOpen && 'mx-auto'}`}>
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>
        </div>

                <div className="flex-1 overflow-y-auto py-3 scrollbar-hide flex flex-col gap-1 px-3">
          {navItems.map(item => {
            if (item.isSubmenu) {
              const isAnyChildActive = item.subItems?.some(sub => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'));
              const isOpen = item.id === 'warehouse' ? warehouseOpen : shipmentsOpen;
              const toggleOpen = () => item.id === 'warehouse' ? setWarehouseOpen(!warehouseOpen) : setShipmentsOpen(!shipmentsOpen);
              const setOpen = (val: boolean) => item.id === 'warehouse' ? setWarehouseOpen(val) : setShipmentsOpen(val);

              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <button
                    onClick={() => {
                      if (!isSidebarOpen) {
                        setIsSidebarOpen(true);
                        setOpen(true);
                      } else {
                        toggleOpen();
                      }
                    }}
                    className={`flex items-center justify-between px-3 h-[44px] rounded-full transition-colors w-full ${
                      isAnyChildActive && !isOpen ? 'bg-[#E0E7FF] text-[#4338CA]' : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                    } ${!isSidebarOpen && 'justify-center border-none'}`}
                    title={item.label}
                  >
                    <div className={`flex items-center gap-[18px] ${!isSidebarOpen && 'justify-center w-full'}`}>
                      <span className={`material-symbols-outlined text-[20px] ${isAnyChildActive && !isOpen ? 't-[FILL=1]' : ''}`} style={{ fontVariationSettings: isAnyChildActive && !isOpen ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300" }}>
                        {item.icon}
                      </span>
                      {isSidebarOpen && <span className={`text-[13px] leading-tight ${isAnyChildActive && !isOpen ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>}
                    </div>
                    {isSidebarOpen && (
                      <span className="material-symbols-outlined text-[18px] ml-2 text-[#94A3B8] transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        expand_more
                      </span>
                    )}
                  </button>
                  {isSidebarOpen && isOpen && item.subItems && (
                    <div className="flex flex-col gap-1 pl-[42px] pr-2 py-1">
                      {item.subItems.map(subItem => {
                        const isSubActive = location.pathname === subItem.path || location.pathname.startsWith(subItem.path + '/');
                        return (
                          <Link
                            key={subItem.path}
                            to={subItem.path}
                            className={`flex items-center gap-3 px-3 h-[36px] rounded-full transition-colors ${
                              isSubActive ? 'bg-[#E0E7FF] text-[#4338CA]' : 'text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                            }`}
                            title={subItem.label}
                          >
                            <span className={`material-symbols-outlined text-[18px] ${isSubActive ? 't-[FILL=1]' : ''}`} style={{ fontVariationSettings: isSubActive ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300" }}>
                              {subItem.icon}
                            </span>
                            <span className={`text-[12px] leading-tight ${isSubActive ? 'font-semibold' : 'font-medium'}`}>{subItem.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = item.path ? location.pathname.startsWith(item.path) : false;
            return (
              <Link 
                key={item.path || item.id} 
                to={item.path || '#'} 
                className={`flex items-center gap-[18px] px-3 h-[44px] rounded-full transition-colors ${
                  isActive ? 'bg-[#E0E7FF] text-[#4338CA]' : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
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
        {/* Header - MD3 Top App Bar */}
        <header className="bg-white border-b border-[#E2E8F0] h-[64px] flex items-center justify-between px-6 shrink-0">
          <div className="font-medium text-[#0F172A] text-[15px]">
            {(() => {
              if (profile?.globalRole === 'superadmin' && location.pathname.startsWith('/admin')) return t('layout.superadminPanel', 'Superadmin Panel');
              if (location.pathname === '/app/orders') return t('layout.orders', 'Zamówienia') + ' - FULFILLMENT ENGINE';
              for (const item of [...navItems, ...adminItems] as any[]) {
                if (item.path && location.pathname.startsWith(item.path)) return item.label;
                if (item.subItems) {
                  for (const sub of item.subItems) {
                    if (location.pathname.startsWith(sub.path)) return sub.label;
                  }
                }
              }
              return t('layout.dashboard', 'Dashboard');
            })()}
          </div>
          
          <div className="flex items-center gap-5">
            <Link 
              to="/app/changelog" 
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
                className="flex items-center gap-2.5 cursor-pointer hover:bg-[#F8FAFC] p-1.5 pr-2.5 rounded-full transition-colors border border-transparent hover:border-[#E2E8F0]"
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              >
                <div className="w-[32px] h-[32px] rounded-full bg-[#E0E7FF] text-[#4338CA] flex items-center justify-center font-bold text-[13px]">
                  {initial}
                </div>
                <div className="flex flex-col hidden sm:flex justify-center h-[32px]">
                  <span className="text-[13px] font-semibold text-[#0F172A] leading-none mb-1">{displayName}</span>
                  <span className="text-[11px] text-[#64748B] font-medium leading-none">{membership?.role || profile?.globalRole}</span>
                </div>
                <span className={`material-symbols-outlined text-[#94A3B8] text-[18px] transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`}>expand_more</span>
              </div>

              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-2 w-[240px] bg-white rounded-xl shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] border border-[#E2E8F0] py-2 z-50">
                  <div className="px-4 py-3 border-b border-[#F1F5F9] mb-1">
                    <p className="text-[13px] font-medium text-[#0F172A] truncate">{profile?.email}</p>
                    <p className="text-[11px] text-[#64748B] mt-0.5">{t('layout.role', 'Rola:')} {membership?.role || profile?.globalRole}</p>
                  </div>
                  
                  <Link
                    to="/app/profile"
                    onClick={() => setIsProfileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px] text-[#64748B]">person</span>
                    {t('layout.myProfile')}
                  </Link>
                  
                  {adminItems.map(item => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsProfileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px] text-[#64748B]">{item.icon}</span>
                      {item.label}
                    </Link>
                  ))}
                  
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

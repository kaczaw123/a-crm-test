import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../auth/useAuth';
import { useFulfillmentPacking } from '../../../hooks/useFulfillmentPacking';
import { OrdersSidebar } from '../../../components/fulfillment/OrdersSidebar';
import { OrderDetails } from '../../../components/fulfillment/OrderDetails';
import { Toaster } from 'react-hot-toast';

export default function PackingStationPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  
  const companyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
  const stationId = id || (profile as any)?.assignedStation || 'station-1';

  const {
    tasks,
    activeTask,
    packingState,
    loading,
    cartonSuggestion,
    selectTask,
    handleScanEan,
    reportException
  } = useFulfillmentPacking(companyId, stationId);

  // Zablokuj skrolowanie body kiedy overlay jest włączony i zdejmij przy zamknięciu
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-[#181A20] font-sans text-gray-200 flex flex-col w-full h-full"> 
      {/* Toast provider wpięty w tym drzewie z ciemnym theme */}
      <Toaster 
        position="top-center" 
        toastOptions={{ 
            style: { background: '#2A2E37', color: '#fff', borderRadius: '12px' },
            success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } }
        }} 
      />

      {/* Górny cienki Header tylko z X i logo/nazwą */}
      <header className="h-[40px] bg-[#14171C] border-b border-[#2A2E37] flex items-center justify-between px-4 shrink-0">
         <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-500 text-[18px]">conveyor_belt</span>
            <span className="font-bold text-[13px] tracking-widest text-gray-400">PACKING STATION</span>
         </div>
         
         {/* Przywracanie widoku standardowego - Exit */}
         {/* Dla Adminów wraca do /admin/fulfillment, dla workerów do /worker/dashboard */}
         <button 
           onClick={() => navigate(-1)} 
           className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-500/20 hover:text-red-400 transition text-gray-400"
           title="Zamknij Station"
         >
           <span className="material-symbols-outlined text-[20px]">close</span>
         </button>
      </header>

      {/* Main Split View */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Lewa kolumna: Lista */}
        <OrdersSidebar 
           tasks={tasks}
           activeTaskId={activeTask?.id || null}
           onSelectTask={selectTask}
           stationName={stationId.startsWith('station-') ? `Stanowisko ${stationId.split('-')[1]}` : stationId}
        />

        {/* Prawa kolumna: Szczegóły aktywnego zamówienia */}
        <div className="flex-1 relative">
           {loading && (
             <div className="absolute inset-0 z-50 bg-[#181A20]/80 flex flex-col items-center justify-center backdrop-blur-sm">
               <span className="material-symbols-outlined text-5xl text-blue-500 animate-spin mb-4">settings</span>
               <p className="text-lg font-bold text-gray-300">Ładowanie danych...</p>
             </div>
           )}

           <OrderDetails 
             task={activeTask || null}
             packingState={packingState}
             cartonSuggestion={cartonSuggestion}
             onScanEan={handleScanEan}
             onReportException={reportException}
           />
        </div>

      </div>
    </div>
  );
}

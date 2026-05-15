import React from 'react';
import type { FulfillmentTask } from '../../types/fulfillment';

interface OrdersSidebarProps {
  tasks: FulfillmentTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  stationName: string;
}

export const OrdersSidebar: React.FC<OrdersSidebarProps> = ({ 
  tasks, 
  activeTaskId, 
  onSelectTask,
  stationName
}) => {
  const completedCount = tasks.filter(t => t.status === 'packed' || t.status === 'exception').length;
  
  return (
    <div className="w-[280px] bg-[#1E222A] border-r border-[#2A2E37] flex flex-col h-full text-gray-200 shrink-0">
      
      {/* Header */}
      <div className="p-4 border-b border-[#2A2E37] shrink-0">
        <h2 className="text-[17px] font-bold text-white tracking-wide">Pakowanie ({completedCount}/{tasks.length})</h2>
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 gap-2 flex flex-col scrollbar-hide">
        {tasks.map((task) => {
          const isActive = task.id === activeTaskId;
          const isCompleted = task.status === 'packed';
          const itemsCount = task.items ? task.items.reduce((acc, i) => acc + i.quantity, 0) : 0;
          const scannedCount = task.items ? task.items.reduce((acc, i) => acc + i.scannedQuantity, 0) : 0;

          return (
            <button
              key={task.id}
              onClick={() => !isCompleted && onSelectTask(task.id)}
              disabled={isCompleted}
              className={`w-full flex items-start justify-between p-3 rounded-lg text-left transition relative
                ${isActive ? 'bg-[#1D4ED8] bg-opacity-40 border border-[#2563EB]' : 'bg-[#262A33] hover:bg-[#2A2E37] border border-transparent'}
                ${isCompleted ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-lg" />}
              
              <div className="flex flex-col ml-1 w-full overflow-hidden">
                <div className="flex justify-between items-center mb-1">
                  <span className={`font-bold text-[14px] truncate ${isCompleted ? 'line-through text-gray-400' : 'text-white'}`}>
                    {isCompleted && <span className="material-symbols-outlined text-green-500 text-[14px] align-middle mr-1">check_circle</span>}
                    {task.referenceNumber || task.orderId.substring(0, 8)}
                  </span>
                  
                  {/* Close icon for manual removal if needed */}
                  <span className="material-symbols-outlined text-gray-500 hover:text-gray-300 text-[16px] p-0.5" 
                        onClick={(e) => { e.stopPropagation(); /* close log / hide locally */ }}>
                    close
                  </span>
                </div>
                
                <span className="text-gray-400 text-[12px] truncate">
                  {task.companyName ? `🏢 ${task.companyName}` : '🏢 Brak danych o firmie'}
                </span>
                <span className="text-gray-400 text-[12px] truncate mt-0.5">
                  👤 {task.customerName || 'Brak odbiorcy'}
                </span>
                
                <div className="mt-2 text-right">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-blue-600 text-white' : 'bg-[#333842] text-gray-300'}`}>
                    {scannedCount}/{itemsCount}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 bg-[#181A20] border-t border-[#2A2E37] flex items-center justify-between text-gray-400 shrink-0">
        <div className="flex items-center gap-2">
           <span className="material-symbols-outlined text-[18px]">desktop_windows</span>
           <span className="text-[13px] font-medium">{stationName}</span>
        </div>
        <div className="flex gap-2">
          <button className="p-1.5 hover:bg-white hover:bg-opacity-10 rounded-full transition" title="Odśwież">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
          <button className="p-1.5 hover:bg-white hover:bg-opacity-10 rounded-full transition" title="Wyczyść kolejkę">
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
};

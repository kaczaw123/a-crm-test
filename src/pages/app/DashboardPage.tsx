import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/useAuth";
import { 
  Package, 
  ShoppingCart, 
  Warehouse, 
  TrendingUp, 
  AlertTriangle,
  Truck,
  FileCheck,
  Tag,
  ArrowDownToLine,
  ArrowUpFromLine
} from "lucide-react";

interface DashboardStats {
  // Zamówienia
  orders: {
    total: number;
    new: number;
    shippedThisMonth: number;
    bySource: {
      allegro: { total: number; new: number; shippedThisMonth: number };
      amazon: { total: number; new: number; shippedThisMonth: number };
      ebay: { total: number; new: number; shippedThisMonth: number };
      kaufland: { total: number; new: number; shippedThisMonth: number };
      olx: { total: number; new: number; shippedThisMonth: number };
      baselinker: { total: number; new: number; shippedThisMonth: number };
      manual: { total: number; new: number; shippedThisMonth: number };
    };
  };
  // Magazyn
  inventory: {
    totalProducts: number;
    totalStock: number;
    lowStock: number;
    outOfStock: number;
  };
  // Operacje
  operations: {
    pendingInbound: number;
    processingOutbound: number;
    labelsToShip: number;
    shipmentsInTransit: number;
  };
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const companyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    
    const fetchStats = async () => {
      setLoading(true);
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // === ZAMÓWIENIA ===
        const ordersRef = collection(db, "companies", companyId, "orders");
        const ordersSnap = await getDocs(ordersRef);
        
        const orderStats = {
          total: 0,
          new: 0,
          shippedThisMonth: 0,
          bySource: {
            allegro: { total: 0, new: 0, shippedThisMonth: 0 },
            amazon: { total: 0, new: 0, shippedThisMonth: 0 },
            ebay: { total: 0, new: 0, shippedThisMonth: 0 },
            kaufland: { total: 0, new: 0, shippedThisMonth: 0 },
            olx: { total: 0, new: 0, shippedThisMonth: 0 },
            baselinker: { total: 0, new: 0, shippedThisMonth: 0 },
            manual: { total: 0, new: 0, shippedThisMonth: 0 },
          },
        };
        
        ordersSnap.forEach((doc) => {
          const order = doc.data();
          const source = (order.source || "manual").toLowerCase();
          const status = (order.status || "").toLowerCase();
          const updatedAt = order.updatedAt?.toDate?.() || new Date(0);
          
          orderStats.total++;
          
          // Nowe do realizacji
          if (status === "new" || status === "nowe") {
            orderStats.new++;
          }
          
          // Zrealizowane w tym miesiącu
          if ((status === "shipped" || status === "wysłane") && updatedAt >= startOfMonth) {
            orderStats.shippedThisMonth++;
          }
          
          // Per source
          const sourceKey = source as keyof typeof orderStats.bySource;
          if (orderStats.bySource[sourceKey]) {
            orderStats.bySource[sourceKey].total++;
            if (status === "new" || status === "nowe") {
              orderStats.bySource[sourceKey].new++;
            }
            if ((status === "shipped" || status === "wysłane") && updatedAt >= startOfMonth) {
              orderStats.bySource[sourceKey].shippedThisMonth++;
            }
          } else {
            orderStats.bySource.manual.total++;
          }
        });
        
        // === MAGAZYN ===
        const productsRef = collection(db, "companies", companyId, "products");
        const productsSnap = await getDocs(productsRef);
        
        const stockRef = collection(db, "companies", companyId, "inventoryStock");
        const stockSnap = await getDocs(stockRef);
        
        let totalStock = 0;
        let lowStock = 0;
        let outOfStock = 0;
        
        stockSnap.forEach((doc) => {
          const stock = doc.data();
          const qty = stock.quantity || 0;
          totalStock += qty;
          if (qty === 0) outOfStock++;
          else if (qty < 10) lowStock++;
        });
        
        // === OPERACJE ===
        const inboundRef = collection(db, "companies", companyId, "inboundShipments");
        const inboundSnap = await getDocs(query(inboundRef, where("status", "==", "pending")));
        
        const outboundRef = collection(db, "companies", companyId, "outboundShipments");
        const outboundSnap = await getDocs(query(outboundRef, where("status", "==", "processing")));
        
        const shipmentsRef = collection(db, "companies", companyId, "shipments");
        const labelsSnap = await getDocs(query(shipmentsRef, where("status", "==", "label_created")));
        const inTransitSnap = await getDocs(query(shipmentsRef, where("status", "==", "shipped")));
        
        setStats({
          orders: orderStats,
          inventory: {
            totalProducts: productsSnap.size,
            totalStock,
            lowStock,
            outOfStock,
          },
          operations: {
            pendingInbound: inboundSnap.size,
            processingOutbound: outboundSnap.size,
            labelsToShip: labelsSnap.size,
            shipmentsInTransit: inTransitSnap.size,
          },
        });
        
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStats();
  }, [companyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!stats) {
    return <div className="text-center text-gray-500">Brak danych</div>;
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title', 'Dashboard')}</h1>
      
      {/* === SEKCJA: ZAMÓWIENIA === */}
      <section>
        <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" />
          {t('dashboard.orders', 'Zamówienia')}
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {/* Wszystkie */}
          <StatCard
            title={t('dashboard.allOrders', 'Wszystkie')}
            icon={<Package className="w-6 h-6 text-blue-600" />}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane (mies.)'), value: stats.orders.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-blue-50"
          />
          
          {/* Allegro */}
          <StatCard
            title="Allegro"
            icon={<span className="text-xl font-bold text-orange-500">A</span>}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.bySource.allegro.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane'), value: stats.orders.bySource.allegro.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.bySource.allegro.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-orange-50"
          />
          
          {/* Amazon */}
          <StatCard
            title="Amazon"
            icon={<span className="text-xl font-bold text-yellow-600">a</span>}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.bySource.amazon.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane'), value: stats.orders.bySource.amazon.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.bySource.amazon.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-yellow-50"
          />
          
          {/* eBay */}
          <StatCard
            title="eBay"
            icon={<span className="text-xl font-bold text-red-500">e</span>}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.bySource.ebay.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane'), value: stats.orders.bySource.ebay.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.bySource.ebay.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-red-50"
          />
          
          {/* Kaufland */}
          <StatCard
            title="Kaufland"
            icon={<span className="text-xl font-bold text-red-600">K</span>}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.bySource.kaufland.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane'), value: stats.orders.bySource.kaufland.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.bySource.kaufland.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-red-50"
          />
          
          {/* OLX */}
          <StatCard
            title="OLX"
            icon={<span className="text-xl font-bold text-teal-600">OLX</span>}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.bySource.olx.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane'), value: stats.orders.bySource.olx.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.bySource.olx.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-teal-50"
          />
          
          {/* BaseLinker */}
          <StatCard
            title="BaseLinker"
            icon={<span className="text-xl font-bold text-purple-600">B</span>}
            stats={[
              { label: t('dashboard.new', 'Nowe'), value: stats.orders.bySource.baselinker.new, color: 'text-orange-600' },
              { label: t('dashboard.shippedMonth', 'Wysłane'), value: stats.orders.bySource.baselinker.shippedThisMonth, color: 'text-green-600' },
              { label: t('dashboard.total', 'Łącznie'), value: stats.orders.bySource.baselinker.total, color: 'text-gray-600' },
            ]}
            bgColor="bg-purple-50"
          />
        </div>
      </section>
      
      {/* === SEKCJA: MAGAZYN === */}
      <section>
        <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Warehouse className="w-5 h-5" />
          {t('dashboard.inventory', 'Magazyn')}
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SimpleStatCard
            title={t('dashboard.products', 'Produkty')}
            value={stats.inventory.totalProducts}
            icon={<Package className="w-6 h-6 text-blue-600" />}
            bgColor="bg-blue-50"
          />
          <SimpleStatCard
            title={t('dashboard.totalStock', 'Stan magazynowy')}
            value={stats.inventory.totalStock}
            subtitle="szt."
            icon={<TrendingUp className="w-6 h-6 text-green-600" />}
            bgColor="bg-green-50"
          />
          <SimpleStatCard
            title={t('dashboard.lowStock', 'Niski stan (<10)')}
            value={stats.inventory.lowStock}
            icon={<AlertTriangle className="w-6 h-6 text-yellow-600" />}
            bgColor="bg-yellow-50"
            alert={stats.inventory.lowStock > 0}
          />
          <SimpleStatCard
            title={t('dashboard.outOfStock', 'Brak w magazynie')}
            value={stats.inventory.outOfStock}
            icon={<AlertTriangle className="w-6 h-6 text-red-600" />}
            bgColor="bg-red-50"
            alert={stats.inventory.outOfStock > 0}
          />
        </div>
      </section>
      
      {/* === SEKCJA: OPERACJE === */}
      <section>
        <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Truck className="w-5 h-5" />
          {t('dashboard.operations', 'Operacje')}
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SimpleStatCard
            title={t('dashboard.pendingInbound', 'Awizacje do zatwierdzenia')}
            value={stats.operations.pendingInbound}
            icon={<ArrowDownToLine className="w-6 h-6 text-blue-600" />}
            bgColor="bg-blue-50"
            alert={stats.operations.pendingInbound > 0}
          />
          <SimpleStatCard
            title={t('dashboard.processingOutbound', 'Wydania w trakcie')}
            value={stats.operations.processingOutbound}
            icon={<ArrowUpFromLine className="w-6 h-6 text-purple-600" />}
            bgColor="bg-purple-50"
          />
          <SimpleStatCard
            title={t('dashboard.labelsToShip', 'Etykiety do nadania')}
            value={stats.operations.labelsToShip}
            icon={<Tag className="w-6 h-6 text-orange-600" />}
            bgColor="bg-orange-50"
            alert={stats.operations.labelsToShip > 0}
          />
          <SimpleStatCard
            title={t('dashboard.shipmentsInTransit', 'Przesyłki w drodze')}
            value={stats.operations.shipmentsInTransit}
            icon={<Truck className="w-6 h-6 text-green-600" />}
            bgColor="bg-green-50"
          />
        </div>
      </section>
    </div>
  );
}

// === KOMPONENTY KAFELKÓW ===

interface StatCardProps {
  title: string;
  icon: React.ReactNode;
  stats: { label: string; value: number; color: string }[];
  bgColor: string;
}

function StatCard({ title, icon, stats, bgColor }: StatCardProps) {
  return (
    <div className={`${bgColor} rounded-xl p-4 border border-gray-100 shadow-sm`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-white shadow-sm">
          {icon}
        </div>
        <span className="font-semibold text-gray-800 text-sm">{title}</span>
      </div>
      <div className="space-y-1">
        {stats.map((stat, idx) => (
          <div key={idx} className="flex justify-between text-sm">
            <span className="text-gray-500">{stat.label}</span>
            <span className={`font-bold ${stat.color}`}>{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SimpleStatCardProps {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ReactNode;
  bgColor: string;
  alert?: boolean;
}

function SimpleStatCard({ title, value, subtitle, icon, bgColor, alert }: SimpleStatCardProps) {
  return (
    <div className={`${bgColor} rounded-xl p-4 border ${alert ? 'border-red-300' : 'border-gray-100'} shadow-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">
            {value}
            {subtitle && <span className="text-sm font-normal text-gray-500 ml-1">{subtitle}</span>}
          </p>
        </div>
        <div className={`w-12 h-12 flex items-center justify-center rounded-xl bg-white shadow-sm ${alert ? 'animate-pulse' : ''}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

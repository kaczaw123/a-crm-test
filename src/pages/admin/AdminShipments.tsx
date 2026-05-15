import React, { useEffect, useState } from 'react';
import { collectionGroup, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { ShipmentDetailsModal } from '../../components/shipments/ShipmentDetailsModal';

interface ShipmentRow {
    companyId: string;
    companyName: string;
    brokerCount: number;
    ownCount: number;
    totalCount: number;
    totalCost: number;
    currency: string;
    lastShipmentAt: any;
    shipments: any[];
}

const AdminShipments: React.FC = () => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(true);
    const [clientsData, setClientsData] = useState<ShipmentRow[]>([]);
    const [expandedClient, setExpandedClient] = useState<string | null>(null);
    const [detailsShipment, setDetailsShipment] = useState<any>(null);

    // Filters
    const [startDate, setStartDate] = useState(
        new Date(new Date().setDate(1)).toISOString().split('T')[0] // 1st of current month
    );
    const [endDate, setEndDate] = useState(
        new Date().toISOString().split('T')[0]
    );

    useEffect(() => {
        fetchData();
    }, [startDate, endDate]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const startTimestamp = new Date(startDate);
            startTimestamp.setHours(0, 0, 0, 0);

            const endTimestamp = new Date(endDate);
            endTimestamp.setHours(23, 59, 59, 999);

            const q = query(
                collectionGroup(db, 'shipments'),
                where('createdAt', '>=', startTimestamp),
                where('createdAt', '<=', endTimestamp),
                orderBy('createdAt', 'desc')
            );

            const snap = await getDocs(q);

            const map = new Map<string, ShipmentRow>();

            snap.docs.forEach(doc => {
                const data = doc.data();
                const cid = data.companyId || doc.ref.parent.parent?.id || 'unknown';
                const cname = data.sender?.company || data.sender?.name || 'Unknown Company';

                if (!map.has(cid)) {
                    map.set(cid, {
                        companyId: cid,
                        companyName: cname,
                        brokerCount: 0,
                        ownCount: 0,
                        totalCount: 0,
                        totalCost: 0,
                        currency: 'EUR',
                        lastShipmentAt: data.createdAt,
                        shipments: []
                    });
                }

                const row = map.get(cid)!;
                if (data.integrationMode === 'gkp' || data.integrationMode === 'broker') {
                    row.brokerCount++;
                } else {
                    row.ownCount++;
                }
                row.totalCount++;
                if (data.billing?.totalClientCost) {
                    row.totalCost += data.billing.totalClientCost;
                    row.currency = data.billing.currency || 'EUR';
                }
                row.shipments.push({ id: doc.id, ...data });

                if (data.createdAt?.toMillis && row.lastShipmentAt?.toMillis) {
                    if (data.createdAt.toMillis() > row.lastShipmentAt.toMillis()) {
                        row.lastShipmentAt = data.createdAt;
                    }
                }
            });

            setClientsData(Array.from(map.values()));
        } catch (error) {
            console.error('Error fetching shipments:', error);
        }
        setLoading(false);
    };

    const handleExportCsv = () => {
        const rows = ['CompanyId,CompanyName,TrackingNumber,CreatedAt,Carrier,IntegrationMode,Weight,Ref1'];

        clientsData.forEach(client => {
            client.shipments.forEach(s => {
                const date = s.createdAt?.toDate ? format(s.createdAt.toDate(), 'yyyy-MM-dd HH:mm:ss') : '';
                const weight = s.parcel?.weight || 0;
                rows.push(`"${client.companyId}","${client.companyName}","${s.trackingNumber || ''}","${date}","${s.carrier || ''}","${s.integrationMode || ''}",${weight},"${s.ref1 || ''}"`);
            });
        });

        const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `shipments_global_${startDate}_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{t('admin.shipments.title', 'Przesyłki (Global)')}</h1>
                    <p className="text-sm text-gray-500 mt-1">Rejestr wygenerowanych listów przewozowych per klient.</p>
                </div>
                <button
                    onClick={handleExportCsv}
                    className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-100 transition-colors"
                >
                    <span className="material-symbols-outlined text-[20px]">download</span>
                    {t('admin.shipments.exportCsv', 'Export CSV')}
                </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex gap-4">
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-gray-500 uppercase">Od:</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-gray-500 uppercase">Do:</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-gray-500">Ładowanie...</div>
                ) : clientsData.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">Brak danych dla wybranego okresu.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-gray-600">
                            <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
                                <tr>
                                    <th className="px-6 py-4">Klient</th>
                                    <th className="px-6 py-4">Broker</th>
                                    <th className="px-6 py-4">Własna</th>
                                    <th className="px-6 py-4">Razem</th>
                                    <th className="px-6 py-4">Koszt Razem</th>
                                    <th className="px-6 py-4">Ostatnia</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {clientsData.map(client => (
                                    <React.Fragment key={client.companyId}>
                                        <tr
                                            onClick={() => setExpandedClient(expandedClient === client.companyId ? null : client.companyId)}
                                            className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                                        >
                                            <td className="px-6 py-4 font-semibold text-gray-900 flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[18px] text-gray-400">
                                                    {expandedClient === client.companyId ? 'expand_more' : 'chevron_right'}
                                                </span>
                                                {client.companyName}
                                            </td>
                                            <td className="px-6 py-4 text-orange-600 font-bold">{client.brokerCount}</td>
                                            <td className="px-6 py-4 text-gray-500">{client.ownCount}</td>
                                            <td className="px-6 py-4 font-bold">{client.totalCount}</td>
                                            <td className="px-6 py-4 font-bold text-green-700">
                                                {client.totalCost > 0 ? `${client.totalCost.toFixed(2)} ${client.currency}` : '-'}
                                            </td>
                                            <td className="px-6 py-4 text-xs">
                                                {client.lastShipmentAt?.toDate ? format(client.lastShipmentAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: pl }) : '-'}
                                            </td>
                                        </tr>
                                        {expandedClient === client.companyId && (
                                            <tr className="bg-gray-50">
                                                <td colSpan={5} className="p-0 border-b border-gray-200">
                                                    <div className="max-h-[300px] overflow-y-auto p-4 pl-14">
                                                        <table className="w-full text-xs text-left">
                                                            <thead className="text-gray-400 uppercase font-semibold border-b border-gray-200">
                                                                <tr>
                                                                    <th className="pb-2">Tracking</th>
                                                                    <th className="pb-2">Data</th>
                                                                    <th className="pb-2">Kurier</th>
                                                                    <th className="pb-2">Typ Konta</th>
                                                                    <th className="pb-2">Koszt</th>
                                                                    <th className="pb-2">Status</th>
                                                                    <th className="pb-2 text-right">Akcje</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-gray-100">
                                                                {client.shipments.map(s => (
                                                                    <tr key={s.id} className="hover:bg-gray-100">
                                                                        <td className="py-2 font-mono text-gray-900">{s.trackingNumber || '-'}</td>
                                                                        <td className="py-2 text-gray-500">{s.createdAt?.toDate ? format(s.createdAt.toDate(), 'dd.MM HH:mm') : '-'}</td>
                                                                        <td className="py-2 font-bold text-[11px] text-gray-600 uppercase tracking-wider">
                                                                            {s.carrier === 'gls_de' ? 'GLS DE' : (s.carrier === 'dhl_de' ? 'DHL DE' : (s.carrier || '-'))}
                                                                        </td>
                                                                        <td className="py-2">
                                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${(s.integrationMode === 'gkp' || s.integrationMode === 'broker') ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-600'}`}>
                                                                                {(s.integrationMode === 'gkp' || s.integrationMode === 'broker') ? 'Broker' : 'Własna'}
                                                                            </span>
                                                                        </td>
                                                                        <td className="py-2 font-semibold text-green-700">
                                                                            {s.billing?.totalClientCost ? `${s.billing.totalClientCost.toFixed(2)} ${s.billing.currency}` : '-'}
                                                                        </td>
                                                                        <td className="py-2">{s.status}</td>
                                                                        <td className="py-2 text-right">
                                                                            <button onClick={() => setDetailsShipment(s)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Szczegóły">
                                                                                <span className="material-symbols-outlined text-[16px]">info</span>
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <ShipmentDetailsModal shipment={detailsShipment} onClose={() => setDetailsShipment(null)} />
        </div>
    );
};

export default AdminShipments;

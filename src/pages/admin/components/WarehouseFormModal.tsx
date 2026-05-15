import { useState, useEffect } from 'react';
import type { GlobalWarehouse, WarehouseAddress, WarehouseContact, WarehouseType } from '../../../data/warehouses';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingWarehouse: GlobalWarehouse | null;
  onSave: (data: Partial<GlobalWarehouse>) => Promise<void>;
}

export function WarehouseFormModal({ isOpen, onClose, existingWarehouse, onSave }: Props) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<GlobalWarehouse>>({
    name: '',
    code: '',
    warehouseType: 'fulfillment',
    companyName: '',
    openingHours: '08:00 - 16:00',
    deliveryInstructions: '',
    isActive: true,
    isDefault: false,
  });

  const [address, setAddress] = useState<WarehouseAddress>({
    street: '',
    buildingNumber: '',
    unitNumber: '',
    postalCode: '',
    city: '',
    region: '',
    country: 'Polska'
  });

  const [contact, setContact] = useState<WarehouseContact>({
    contactPerson: '',
    contactPhone: '',
    contactEmail: ''
  });

  useEffect(() => {
    if (existingWarehouse) {
      setFormData({
        name: existingWarehouse.name,
        code: existingWarehouse.code,
        warehouseType: existingWarehouse.warehouseType,
        companyName: existingWarehouse.companyName,
        openingHours: existingWarehouse.openingHours || '',
        deliveryInstructions: existingWarehouse.deliveryInstructions || '',
        isActive: existingWarehouse.isActive,
        isDefault: existingWarehouse.isDefault,
      });
      setAddress(existingWarehouse.address || address);
      setContact(existingWarehouse.contact || contact);
    }
  }, [existingWarehouse]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSave({
        ...formData,
        address,
        contact
      });
      onClose();
    } catch (err: any) {
      alert(err.message || 'Błąd zapisu magazynu');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">
        <div className="flex justify-between items-center p-6 border-b border-[#E2E8F0] shrink-0">
          <h2 className="text-xl font-bold text-[#0F172A]">
            {existingWarehouse ? 'Edycja Magazynu' : 'Nowy Magazyn Fulfillment'}
          </h2>
          <button onClick={onClose} className="p-2 text-[#64748B] hover:bg-[#F1F5F9] rounded-full transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-[#F8FAFC]">
          <form id="warehouse-form" onSubmit={handleSubmit} className="space-y-8">
            {/* Sekcja Główna */}
            <div className="bg-white p-5 rounded-xl border border-[#E2E8F0] shadow-sm">
              <h3 className="text-sm font-bold text-[#0F172A] mb-4 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-[#4338CA]">warehouse</span>
                Informacje główne
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Nazwa magazynu *</label>
                  <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder="np. Główny Fulfillment" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Unikalny Kod *</label>
                  <input type="text" required disabled={!!existingWarehouse} value={formData.code} onChange={e => setFormData({...formData, code: e.target.value.toUpperCase()})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA] bg-white disabled:bg-[#F1F5F9]" placeholder="LUBAN-01" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Typ obiektu</label>
                  <select value={formData.warehouseType} onChange={e => setFormData({...formData, warehouseType: e.target.value as WarehouseType})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA] bg-white">
                    <option value="fulfillment">Fulfillment / Wysyłka</option>
                    <option value="returns">Zwroty (Returns)</option>
                    <option value="crossdock">Cross-Dock</option>
                    <option value="other">Inny</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Operator / Firma logistyczna</label>
                  <input type="text" value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder="Gepard Logistics Sp. z o.o." />
                </div>
              </div>
            </div>

            {/* Adres */}
            <div className="bg-white p-5 rounded-xl border border-[#E2E8F0] shadow-sm">
              <h3 className="text-sm font-bold text-[#0F172A] mb-4 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-[#4338CA]">location_on</span>
                Adres budynku
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Ulica</label>
                  <input type="text" value={address.street} onChange={e => setAddress({...address, street: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[12px] font-bold text-[#64748B] mb-1">Nr</label>
                    <input type="text" value={address.buildingNumber} onChange={e => setAddress({...address, buildingNumber: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-[#64748B] mb-1">Lok.</label>
                    <input type="text" value={address.unitNumber} onChange={e => setAddress({...address, unitNumber: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Kod pocztowy</label>
                  <input type="text" value={address.postalCode} onChange={e => setAddress({...address, postalCode: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Miasto *</label>
                  <input type="text" required value={address.city} onChange={e => setAddress({...address, city: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Kraj *</label>
                  <select required value={address.country} onChange={e => setAddress({...address, country: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA] bg-white">
                    <option value="Polska">Polska</option>
                    <option value="Niemcy">Niemcy</option>
                    <option value="Czechy">Czechy</option>
                    <option value="Inny">Inny</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Kontakt & Instrukcje */}
            <div className="bg-white p-5 rounded-xl border border-[#E2E8F0] shadow-sm">
              <h3 className="text-sm font-bold text-[#0F172A] mb-4 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-[#4338CA]">local_shipping</span>
                Instrukcje dla dostawców
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Osoba kontaktowa</label>
                  <input type="text" value={contact.contactPerson} onChange={e => setContact({...contact, contactPerson: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Telefon kontaktowy</label>
                  <input type="text" value={contact.contactPhone} onChange={e => setContact({...contact, contactPhone: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#64748B] mb-1">Godziny przyjęć</label>
                  <input type="text" value={formData.openingHours} onChange={e => setFormData({...formData, openingHours: e.target.value})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder="Pn-Pt 08:00 - 16:00" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-[#64748B] mb-1">Specjalne instrukcje podjazdu/awizacji</label>
                <textarea rows={2} value={formData.deliveryInstructions} onChange={e => setFormData({...formData, deliveryInstructions: e.target.value})} className="w-full px-3 py-2 border border-[#CBD5E1] rounded-lg text-sm focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder="np. Rampy od nr 5 do 8. Przy wjeździe wymagany twardy dowód tożsamości." />
              </div>
            </div>

            {/* Status */}
            <div className="bg-white p-5 rounded-xl border border-[#E2E8F0] shadow-sm flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="w-4 h-4 text-[#4338CA] rounded border-gray-300 focus:ring-[#4338CA]" />
                <span className="text-sm font-semibold text-[#0F172A]">Magazyn Aktywny</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formData.isDefault} onChange={e => setFormData({...formData, isDefault: e.target.checked})} className="w-4 h-4 text-[#4338CA] rounded border-gray-300 focus:ring-[#4338CA]" />
                <span className="text-sm font-semibold text-[#0F172A]">Oznacz jako Systemowo Domyślny</span>
              </label>
            </div>
          </form>
        </div>

        <div className="p-6 border-t border-[#E2E8F0] flex justify-end gap-3 shrink-0 bg-white">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-[#64748B] font-bold text-[13px] hover:bg-[#F1F5F9] rounded-xl transition-colors">
            Anuluj
          </button>
          <button type="submit" form="warehouse-form" disabled={loading} className="px-5 py-2.5 bg-[#4338CA] text-white font-bold text-[13px] rounded-xl hover:bg-[#3730A3] transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2">
            {loading && <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>}
            Zapisz Magazyn
          </button>
        </div>
      </div>
    </div>
  );
}

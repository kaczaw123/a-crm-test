import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { getCompanyProfile, updateCompanyProfile } from '../../data/company';
import type { Company } from '../../data/types';
import { useTranslation } from 'react-i18next';

export default function CompanyProfile() {
  const { t } = useTranslation();
  const { profile, membership } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const canView = profile?.globalRole === 'superadmin' || membership?.role === 'admin' || membership?.role === 'company_owner' || membership?.role === 'company_admin' || membership?.permissions?.includes('company.view');
  const canEdit = profile?.globalRole === 'superadmin' || membership?.role === 'company_owner' || membership?.role === 'company_admin' || membership?.permissions?.includes('company.manage');

  useEffect(() => {
    async function loadCompany() {
      if (profile?.activeCompanyId && canView) {
        try {
          const comp = await getCompanyProfile(profile.activeCompanyId);
          setCompany(comp);
        } catch (e) {
          console.error("Error loading company", e);
        }
      }
      setLoading(false);
    }
    loadCompany();
  }, [profile?.activeCompanyId, canView]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!company) return;
    const { name, value } = e.target;
    
    if (['street', 'city', 'postalCode', 'country'].includes(name)) {
      setCompany({
        ...company,
        address: { ...company.address, [name]: value }
      });
    } else if (name === 'inventoryDeductionMode') {
      setCompany({
        ...company,
        settings: {
          ...company.settings,
          inventoryDeductionMode: value as any
        }
      });
    } else {
      setCompany({ ...company, [name]: value });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !profile?.activeCompanyId || !profile.uid) return;
    
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      await updateCompanyProfile(profile.activeCompanyId, {
        name: company.name,
        taxId: company.taxId,
        phone: company.phone,
        email: company.email,
        address: company.address,
        settings: company.settings
      }, profile.uid);
      setMessage({ type: 'success', text: t('companyProfile.messages.successUpdated') });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || t('companyProfile.messages.errorSave') });
    } finally {
      setSaving(false);
    }
  };

  if (!canView) return <div className="p-8 text-[#DC2626] bg-[#FEF2F2] rounded-2xl">{t('companyProfile.messages.noViewAccess')}</div>;
  if (loading) return <div className="p-8 text-[#64748B]">{t('companyProfile.messages.loading')}</div>;
  if (!company) return <div className="p-8 text-[#DC2626] bg-[#FEF2F2] rounded-2xl">{t('companyProfile.messages.loadError')}</div>;

  return (
    <div className="max-w-4xl mx-auto py-6">
      <h1 className="text-xl font-semibold text-[#0F172A] mb-5 tracking-tight flex items-center gap-2">
        <span className="material-symbols-outlined text-[#4338CA]">business</span>
        {t('companyProfile.title')}
      </h1>
      
      {message.text && (
        <div className={`p-4 mb-5 rounded-2xl flex items-center gap-3 text-[13px] font-medium ${message.type === 'success' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF2F2] text-[#991B1B]'}`}>
          <span className="material-symbols-outlined">{message.type === 'success' ? 'check_circle' : 'error'}</span>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] rounded-2xl p-6 border border-[#E2E8F0]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.name')}</label>
            <input required disabled={!canEdit} type="text" name="name" value={company.name} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.taxId')}</label>
            <input required disabled={!canEdit} type="text" name="taxId" value={company.taxId} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.phone')}</label>
            <input required disabled={!canEdit} type="text" name="phone" value={company.phone} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.email')}</label>
            <input required disabled={!canEdit} type="email" name="email" value={company.email} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] transition-colors" />
          </div>
        </div>

        <h3 className="text-[15px] font-semibold text-[#0F172A] pt-6 pb-2 mt-6 border-t border-[#E2E8F0] flex items-center gap-2">
           <span className="material-symbols-outlined text-[#64748B] text-[20px]">location_on</span>
           {t('companyProfile.fields.addressTitle')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.street')}</label>
            <input required disabled={!canEdit} type="text" name="street" value={company.address.street} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.city')}</label>
            <input required disabled={!canEdit} type="text" name="city" value={company.address.city} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.postalCode')}</label>
            <input required disabled={!canEdit} type="text" name="postalCode" value={company.address.postalCode} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] transition-colors" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('companyProfile.fields.country')}</label>
            <input required disabled={!canEdit} type="text" name="country" value={company.address.country} onChange={handleChange} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] disabled:bg-[#F1F5F9] transition-colors" />
          </div>
        </div>

        
        <h3 className="text-[15px] font-semibold text-[#0F172A] pt-6 pb-2 mt-6 border-t border-[#E2E8F0] flex items-center gap-2">
           <span className="material-symbols-outlined text-[#64748B] text-[20px]">warehouse</span>
           {t('companyProfile.settings.title', 'Ustawienia Magazynowe')}
        </h3>
        <div className="bg-gray-50/50 p-5 rounded-2xl border border-gray-200">
           <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-2 uppercase tracking-wider">{t('companyProfile.settings.inventoryDeductionMode', 'Moment zdjęcia stanu magazynowego (WZ)')}</label>
              <select 
                name="inventoryDeductionMode" 
                value={company.settings?.inventoryDeductionMode || 'on_label'} 
                onChange={handleChange}
                disabled={!canEdit}
                className="w-full text-sm border border-gray-300 px-3 py-2 rounded-xl bg-white focus:ring-[#4338CA] focus:border-[#4338CA] outline-none disabled:bg-[#F1F5F9] transition-colors h-[40px]"
              >
                  <option value="on_label">{t('companyProfile.settings.onLabel', 'Podczas generowania etykiety kurierskiej (Rekomendowane dla E-Commerce)')}</option>
                  <option value="on_pack">{t('companyProfile.settings.onPack', 'Po zebraniu towaru ze stoku - Stacja Pakowania WMS (Rekomendowane dla 3PL)')}</option>
              </select>
              <p className="mt-2 text-[12px] text-gray-500">
                 {company.settings?.inventoryDeductionMode === 'on_pack' 
                    ? t('companyProfile.settings.onPackHint', 'Zaznaczenie tej funkcji pomija rezerwacje podczas generowania etykiety, przenosząc odpowiedzialność za zdjęcie stocka na fizyczny zeskan towarów.')
                    : t('companyProfile.settings.onLabelHint', 'Wybór skutkuje natychmiastowym wylotem WZ podczas kliknięcia w generację etykiety DHL/InPost.')}
              </p>
           </div>
        </div>

        {canEdit && (
          <div className="flex justify-end pt-6 border-t border-[#E2E8F0] mt-6">
            <button
              type="submit"
              disabled={saving}
              className="px-6 h-[40px] rounded-full shadow-sm text-[13px] font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#4338CA] disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">{saving ? 'sync' : 'save'}</span>
              {saving ? t('companyProfile.buttons.saving') : t('companyProfile.buttons.save')}
            </button>
          </div>
        )}
        {!canEdit && (
          <div className="pt-6 border-t border-[#E2E8F0] text-[13px] text-[#64748B] font-medium text-center">
            {t('companyProfile.messages.noEditAccess')}
          </div>
        )}
      </form>
    </div>
  );
}

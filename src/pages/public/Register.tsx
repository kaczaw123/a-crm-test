import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { createCompanyAndUser } from '../../data/company';
import { LanguageSelector } from '../../components/common/LanguageSelector';

export default function Register() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    companyName: '',
    taxId: '',
    country: 'Polska',
    postalCode: '',
    city: '',
    street: '',
    phone: '',
    email: '',
    contactPerson: '',
    password: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Authenticate / Create Firebase User
      const userCred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      
      // 2. Create Company and associate User
      await createCompanyAndUser(userCred.user.uid, formData.email, {
        name: formData.companyName,
        taxId: formData.taxId,
        phone: formData.phone,
        email: formData.email,
        address: {
          country: formData.country,
          postalCode: formData.postalCode,
          city: formData.city,
          street: formData.street
        }
      }, i18n.language);
      
      // Wymuś pełne przeładowanie by context Firebase Auth pobrał świeże Role i Membership po zapisie w Bazie
      window.location.href = '/';
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Błąd rejestracji');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="absolute top-6 right-8">
        <LanguageSelector variant="auth" />
      </div>
      <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 max-w-2xl mx-auto w-full mb-10 mt-12">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">{t('register.title')}</h2>
      
      {error && <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">{error}</div>}
      
      <form onSubmit={handleRegister} className="space-y-6">
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">{t('register.companyName')}</label>
            <input required type="text" name="companyName" value={formData.companyName} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.taxId')}</label>
            <input required type="text" name="taxId" value={formData.taxId} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.phone')}</label>
            <input required type="text" name="phone" value={formData.phone} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.country')}</label>
            <input required type="text" name="country" value={formData.country} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.postalCode')}</label>
            <input required type="text" name="postalCode" value={formData.postalCode} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.city')}</label>
            <input required type="text" name="city" value={formData.city} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.street')}</label>
            <input required type="text" name="street" value={formData.street} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div className="sm:col-span-2 pt-4 border-t border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4">{t('register.ownerLoginData')}</h3>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.contactPerson')}</label>
            <input required type="text" name="contactPerson" value={formData.contactPerson} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div></div> {/* Spacer */}

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.email')}</label>
            <input required type="email" name="email" value={formData.email} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('register.password')}</label>
            <div className="relative mt-1">
              <input required type={showPassword ? "text" : "password"} name="password" minLength={6} value={formData.password} onChange={handleChange} className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500 sm:text-sm pr-10" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-500">
                <span className="material-symbols-outlined text-[20px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 mt-8"
        >
          {loading ? t('register.submitting') : t('register.submit')}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link to="/login" className="text-primary-600 hover:text-primary-500 font-medium">
          {t('register.alreadyHaveAccount')}
        </Link>
      </div>
    </div>
    </>
  );
}

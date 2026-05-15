import React, { useState } from 'react';
import { db } from '../../firebase/config';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../../auth/useAuth';
import { useTranslation } from 'react-i18next';

interface AddProductModalProps {
  companyId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddProductModal({ companyId, onClose, onSuccess }: AddProductModalProps) {
  const { profile } = useAuth();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [ean, setEan] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const [weight, setWeight] = useState<number | string>('');
  const [length, setLength] = useState<number | string>('');
  const [width, setWidth] = useState<number | string>('');
  const [height, setHeight] = useState<number | string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const validate = (): boolean => {
    if (!name.trim()) {
      setErrorMsg('Nazwa produktu jest wymagana.');
      return false;
    }
    if (!sku.trim()) {
      setErrorMsg('SKU nie może być puste.');
      return false;
    }
    if (ean.trim() && !/^\d+$/.test(ean.trim())) {
      setErrorMsg('EAN może składać się wyłącznie z cyfr (lub pozostać pusty).');
      return false;
    }
    if (imageUrl.trim()) {
      try {
        new URL(imageUrl.trim());
      } catch {
        setErrorMsg('Podany URL zdjęcia jest nieprawidłowy.');
        return false;
      }
    }

    const w = Number(weight);
    const l = Number(length);
    const wid = Number(width);
    const h = Number(height);

    if (!weight || !length || !width || !height) {
      setErrorMsg('Wszystkie parametry logistyczne muszą być uzupełnione.');
      return false;
    }

    if (isNaN(w) || isNaN(l) || isNaN(wid) || isNaN(h)) {
      setErrorMsg('Wszystkie parametry logistyczne muszą być prawidłowymi liczbami.');
      return false;
    }
    
    if (w <= 0 || l <= 0 || wid <= 0 || h <= 0) {
      setErrorMsg('Wszystkie wymiary oraz waga muszą być większe od 0. Nie dopuszczamy wartości zerowych i pustych w logistyce.');
      return false;
    }

    return true;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!validate()) return;
    if (!profile?.uid) return;

    setIsSubmitting(true);

    try {
      const safeSku = sku.trim();
      
      // Check for SKU uniqueness
      const productsRef = collection(db, `companies/${companyId}/products`);
      const q = query(productsRef, where('skuExact', '==', safeSku));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        setErrorMsg(t('products.skuExists'));
        setIsSubmitting(false);
        return;
      }

      const w = Number(weight);
      const l = Number(length);
      const wid = Number(width);
      const h = Number(height);

      const volume = (l * wid * h) / 1000000;

      const safeName = name.trim();
      const safeEan = ean.trim() || '';
      const safeDesc = description.trim() || '';
      const safeImg = imageUrl.trim() || '';

      const newProduct = {
        name: safeName,
        nameNormalized: safeName.toLowerCase(),
        sku: safeSku,
        skuExact: safeSku,
        ean: safeEan,
        eanExact: safeEan,
        description: safeDesc,
        imageMainUrl: safeImg,
        imageThumbUrl: safeImg,
        imageUrl: safeImg,
        logistics: {
          weight: w,
          length: l,
          width: wid,
          height: h,
          volume: volume
        },
        weight: w,
        dimensions: {
          length: l,
          width: wid,
          height: h
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: profile.uid
      };

      await addDoc(collection(db, `companies/${companyId}/products`), newProduct);

      onSuccess();
    } catch (err: any) {
      console.error('Błąd zapisu produktu', err);
      setErrorMsg(err.message || 'Wystąpił nieznany błąd powiązany z tworzeniem w bazie.');
      setIsSubmitting(false);
    }
  };

  let previewUrl = null;
  if (imageUrl.trim()) {
    try {
      new URL(imageUrl.trim());
      previewUrl = imageUrl.trim();
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" 
        onClick={() => !isSubmitting && onClose()}
      />

      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">{t('products.addProductTitle')}</h3>
            <p className="text-xs text-gray-500 font-medium">{t('products.addProductSubtitle')}</p>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span className="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto min-h-0">
          <div className="p-6 space-y-8">

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-start gap-2">
                <span className="material-symbols-outlined text-[20px] shrink-0">error</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Base Data Section */}
            <div className="space-y-4 relative">
               <h4 className="text-sm font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-gray-400 text-[18px]">inventory_2</span>
                 {t('products.productData')}
               </h4>

               <div className="flex gap-6 items-start">
                  {/* Left Column: Pick */}
                  <div className="shrink-0 space-y-3 w-[140px]">
                    <div className="w-full aspect-square rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shadow-sm relative group">
                      {previewUrl ? (
                         <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                         <div className="text-center p-4 text-gray-400">
                           <span className="material-symbols-outlined text-[32px] mb-1 opacity-50">image</span>
                           <p className="text-[10px] font-medium tracking-wide">Brak zdjęcia</p>
                         </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Text Fields */}
                  <div className="flex-1 space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">
                           {t('products.name')} <span className="text-red-500">*</span>
                        </label>
                        <input
                           type="text"
                           required
                           value={name}
                           onChange={e => setName(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-gray-900 font-medium border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder=""
                        />
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-700 mb-1">
                              {t('products.sku')} <span className="text-red-500">*</span>
                           </label>
                           <input
                              type="text"
                              required
                              value={sku}
                              onChange={e => setSku(e.target.value)}
                              className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                              placeholder=""
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-700 mb-1">
                              {t('products.ean')}
                           </label>
                           <input
                              type="text"
                              value={ean}
                              onChange={e => setEan(e.target.value)}
                              className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                              placeholder=""
                           />
                        </div>
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
                           <span>{t('products.imageUrl')}</span>
                        </label>
                        <input
                           type="url"
                           value={imageUrl}
                           onChange={e => setImageUrl(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder="https://..."
                        />
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">{t('products.description')}</label>
                        <textarea
                           rows={3}
                           value={description}
                           onChange={e => setDescription(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none resize-none"
                           placeholder=""
                        />
                     </div>
                  </div>
               </div>
            </div>

            {/* Logistics Section */}
            <div className="space-y-4">
               <h4 className="text-sm font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-gray-400 text-[18px]">local_shipping</span>
                 {t('products.logisticsParams')}
               </h4>

               <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-100 space-y-4">
                  <div>
                     <label className="block text-sm font-bold text-gray-700 mb-1">
                        {t('products.weight')} <span className="text-red-500">*</span>
                     </label>
                     <div className="relative max-w-[200px]">
                       <input
                         type="number"
                         step="any"
                         min="0.001"
                         required
                         value={weight}
                         onChange={e => setWeight(e.target.value)}
                         className="w-full px-4 py-2.5 text-gray-900 font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91] outline-none transition-all pr-12"
                         placeholder=""
                       />
                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-bold text-gray-400 select-none">kg</span>
                     </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                     <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">{t('products.length')} *</label>
                       <div className="relative">
                         <input
                           type="number"
                           step="any"
                           min="0.1"
                           required
                           value={length}
                           onChange={e => setLength(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-center font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder=""
                         />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">{t('products.width')} *</label>
                       <div className="relative">
                         <input
                           type="number"
                           step="any"
                           min="0.1"
                           required
                           value={width}
                           onChange={e => setWidth(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-center font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder=""
                         />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">{t('products.height')} *</label>
                       <div className="relative">
                         <input
                           type="number"
                           step="any"
                           min="0.1"
                           required
                           value={height}
                           onChange={e => setHeight(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-center font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder=""
                         />
                       </div>
                     </div>
                  </div>
               </div>
            </div>

          </div>

          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
            >
              {t('products.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center px-6 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin mr-2">refresh</span>
                  Zapis...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px] mr-2">save</span>
                  {t('products.save')}
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}

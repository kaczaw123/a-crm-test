import React, { useState } from 'react';
import { db } from '../../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import type { ProductV2 } from '../../../data/products';

interface EditProductLogisticsModalProps {
  companyId: string;
  product: ProductV2;
  onClose: () => void;
  onSuccess: (updatedProduct: ProductV2) => void;
}

export default function EditProductLogisticsModal({ companyId, product, onClose, onSuccess }: EditProductLogisticsModalProps) {
  // Parsing existing logistics
  const parseVal = (val?: number | string | null) => (val && Number(val) > 0 ? Number(val) : '');

  // Base Data State
  const [name, setName] = useState(product.name || '');
  const [sku, setSku] = useState(product.sku || product.externalId || '');
  const [ean, setEan] = useState(product.ean || '');
  const [description, setDescription] = useState(product.description || '');
  const [imageUrl, setImageUrl] = useState(product.imageMainUrl || product.imageThumbUrl || '');

  // Logistics State
  const [weight, setWeight] = useState<number | string>(parseVal(product.logistics?.weight));
  const [length, setLength] = useState<number | string>(parseVal(product.logistics?.length));
  const [width, setWidth] = useState<number | string>(parseVal(product.logistics?.width));
  const [height, setHeight] = useState<number | string>(parseVal(product.logistics?.height));

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

    setIsSubmitting(true);

    try {
      const w = Number(weight);
      const l = Number(length);
      const wid = Number(width);
      const h = Number(height);

      // Volume derived from cm to cubic meters [1m³ = 1,000,000cm³]
      const volume = (l * wid * h) / 1000000;

      const safeName = name.trim();
      const safeSku = sku.trim();
      const safeEan = ean.trim() || null;
      const safeDesc = description.trim() || null;
      const safeImg = imageUrl.trim() || null;

      const updatePayload: Record<string, any> = {
        name: safeName,
        nameNormalized: safeName.toLowerCase(),
        sku: safeSku,
        skuExact: safeSku,
        ean: safeEan,
        eanExact: safeEan,
        description: safeDesc,
        imageMainUrl: safeImg,
        imageThumbUrl: safeImg,
        
        'logistics.weight': w,
        'logistics.length': l,
        'logistics.width': wid,
        'logistics.height': h,
        'logistics.volume': volume,
        
        updatedAt: new Date()
      };

      const productRef = doc(db, 'companies', companyId, 'products', product.id!);
      await updateDoc(productRef, updatePayload);

      // Successfully updated, fire local DOM refresh payload
      const mutatedProduct: ProductV2 = {
        ...product,
        name: safeName,
        nameNormalized: safeName.toLowerCase(),
        sku: safeSku,
        skuExact: safeSku,
        ean: safeEan || undefined,
        eanExact: safeEan || undefined,
        description: safeDesc || undefined,
        imageMainUrl: safeImg || undefined,
        imageThumbUrl: safeImg || undefined,
        logistics: {
          ...product.logistics,
          weight: w,
          length: l,
          width: wid,
          height: h,
          volume: volume
        }
      };

      onSuccess(mutatedProduct);

    } catch (err: any) {
      console.error('Błąd zapisu produktu', err);
      setErrorMsg(err.message || 'Wystąpił nieznany błąd zapisu.');
      setIsSubmitting(false);
    }
  };

  // Extract a helpful valid URL for the preview or default to null
  let previewUrl = null;
  if (imageUrl.trim()) {
    try {
      new URL(imageUrl.trim());
      previewUrl = imageUrl.trim();
    } catch {
      // ignore invalid URLs while typing
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
            <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">Edycja Produktu</h3>
            <p className="text-xs text-gray-500 font-medium">Uzupełnij dane katalogowe oraz wymiary logistyczne</p>
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
                 Dane produktu
               </h4>

               <div className="flex gap-6 items-start">
                  
                  {/* Left Column: Image Pick / Preview */}
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
                           Nazwa <span className="text-red-500">*</span>
                        </label>
                        <input
                           type="text"
                           required
                           value={name}
                           onChange={e => setName(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-gray-900 font-medium border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder="Wprowadź nazwę produktu"
                        />
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-700 mb-1">
                              SKU <span className="text-red-500">*</span>
                           </label>
                           <input
                              type="text"
                              required
                              value={sku}
                              onChange={e => setSku(e.target.value)}
                              className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                              placeholder="Unikalny kod magazynowy"
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-700 mb-1">
                              EAN
                           </label>
                           <input
                              type="text"
                              value={ean}
                              onChange={e => setEan(e.target.value)}
                              className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                              placeholder="Kod kreskowy (opcjonalnie)"
                           />
                        </div>
                     </div>

                     <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 flex gap-2">
                        <span className="material-symbols-outlined text-amber-500 text-[18px] shrink-0">warning</span>
                        <p className="text-xs text-amber-800 leading-relaxed font-medium">
                           Zmiana SKU/EAN może wpłynąć na automatyczne mapowanie produktów i napływających zamówień w integracjach.
                        </p>
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
                           <span>URL Zdjęcia (Miniatury)</span>
                           <span className="text-[10px] font-normal text-gray-400">Gotowe pod przyszły upload plików</span>
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
                        <label className="block text-xs font-bold text-gray-700 mb-1">Opis produktu</label>
                        <textarea
                           rows={3}
                           value={description}
                           onChange={e => setDescription(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none resize-none"
                           placeholder="Opcjonalny krótki opis ułatwiający identyfikację..."
                        />
                     </div>
                  </div>
               </div>
            </div>

            {/* Logistics Section */}
            <div className="space-y-4">
               <h4 className="text-sm font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-gray-400 text-[18px]">local_shipping</span>
                 Parametry Logistyczne
               </h4>

               <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-100 space-y-4">
                  <div>
                     <label className="block text-sm font-bold text-gray-700 mb-1">
                        Waga Brutto (KG) <span className="text-red-500">*</span>
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
                         placeholder="e.g. 1.5"
                       />
                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-bold text-gray-400 select-none">kg</span>
                     </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                     <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">Długość (cm) *</label>
                       <div className="relative">
                         <input
                           type="number"
                           step="any"
                           min="0.1"
                           required
                           value={length}
                           onChange={e => setLength(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-center font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder="0.0"
                         />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">Szerokość (cm) *</label>
                       <div className="relative">
                         <input
                           type="number"
                           step="any"
                           min="0.1"
                           required
                           value={width}
                           onChange={e => setWidth(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-center font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder="0.0"
                         />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">Wysokość (cm) *</label>
                       <div className="relative">
                         <input
                           type="number"
                           step="any"
                           min="0.1"
                           required
                           value={height}
                           onChange={e => setHeight(e.target.value)}
                           className="w-full px-3 py-2 text-sm text-center font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0A3D91] outline-none"
                           placeholder="0.0"
                         />
                       </div>
                     </div>
                  </div>
               </div>
            </div>

          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
            >
              Anuluj
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
                  Zapisz
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}

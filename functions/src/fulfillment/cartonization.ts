import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export interface CartonType {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  maxWeightKg: number;
  emptyWeightKg: number;
}

export interface DimensionProduct {
  id: string;
  length: number;
  width: number;
  height: number;
  weightKg: number;
  quantity: number;
}

// Standardowe kartony firmy Gepard Logistics
export const STANDARD_CARTONS: CartonType[] = [
  { id: 'S', name: 'Zwykły Mały (S) [Gabaryt A]', length: 300, width: 200, height: 80, maxWeightKg: 5, emptyWeightKg: 0.1 },
  { id: 'M', name: 'Zwykły Średni (M) [Gabaryt B]', length: 400, width: 300, height: 180, maxWeightKg: 15, emptyWeightKg: 0.3 },
  { id: 'L', name: 'Zwykły Duży (L) [Gabaryt C]', length: 600, width: 400, height: 350, maxWeightKg: 30, emptyWeightKg: 0.6 },
  { id: 'F', name: 'Foliopak', length: 300, width: 250, height: 20, maxWeightKg: 3, emptyWeightKg: 0.05 }
];

export function suggestCarton(products: DimensionProduct[]): CartonType {
  // Oblicz całkowitą wymaganą objętość i wagę
  let totalVolume = 0;
  let totalWeight = 0;
  let maxProductLength = 0;
  let maxProductWidth = 0;
  let maxProductHeight = 0;

  for (const p of products) {
    const l = p.length || 0;
    const w = p.width || 0;
    const h = p.height || 0;
    const dimensions = [l, w, h].sort((a, b) => b - a); // od największego do najmniejszego
    
    maxProductLength = Math.max(maxProductLength, dimensions[0]);
    maxProductWidth = Math.max(maxProductWidth, dimensions[1]);
    maxProductHeight = Math.max(maxProductHeight, dimensions[2]);
    
    totalVolume += (l * w * h) * p.quantity;
    totalWeight += (p.weightKg || 0) * p.quantity;
  }

  // Wyszukaj najmniejszy pasujący karton
  for (const carton of STANDARD_CARTONS) {
    const minVol = carton.length * carton.width * carton.height;
    // Sprawdzamy czy zmieści się wagowo oraz pojemnościowo (+ 10% zapasu)
    if (carton.maxWeightKg >= totalWeight && minVol * 0.9 >= totalVolume) {
      // Oraz czy największy wymiar produktu nie przekracza odpowiednich krawędzi kartonu
      const cartonDims = [carton.length, carton.width, carton.height].sort((a, b) => b - a);
      if (maxProductLength <= cartonDims[0] && maxProductWidth <= cartonDims[1] && maxProductHeight <= cartonDims[2]) {
        return carton;
      }
    }
  }

  return STANDARD_CARTONS[2]; // Fallback do Dużego (L)
}

export const getCartonSuggestion = onCall(async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  const { companyId, taskId } = data;
  if (!companyId || !taskId) throw new HttpsError('invalid-argument', 'Brak parametrów.');

  const db = admin.firestore();
  
  // 1. Zlokalizuj Order (skrótowo poprzez task)
  const taskDoc = await db.doc(`companies/${companyId}/fulfillmentQueue/${taskId}`).get();
  if (!taskDoc.exists) throw new HttpsError('not-found', 'Zadanie nie istnieje.');
  
  const orderId = taskDoc.data()?.orderId;
  const orderDoc = await db.doc(`companies/${companyId}/orders/${orderId}`).get();
  if (!orderDoc.exists) throw new HttpsError('not-found', 'Zamówienie nie istnieje.');
  
  const items = orderDoc.data()?.items || [];
  
  // 2. Musimy teraz pobrać wymiary produktów z inwentarza w oparciu o ich referencje
  // W uproszczeniu - wyciągamy listę productId z przedmiotów zamówienia
  const productsToPack: DimensionProduct[] = [];
  
  for (const item of items) {
    if (item.productId) {
      const prodDoc = await db.doc(`companies/${companyId}/products/${item.productId}`).get();
      const pData = prodDoc.data();
      if (pData) {
        productsToPack.push({
          id: pData.sku || pData.id,
          length: pData.logistics?.length || 0,
          width: pData.logistics?.width || 0,
          height: pData.logistics?.height || 0,
          weightKg: pData.logistics?.weight || 0,
          quantity: item.quantity || 1
        });
      }
    }
  }

  // 3. Po zsumowaniu puszczamy przez algorytm (jeśli nie ma wymiarów - default F)
  if (productsToPack.length === 0) {
     return { suggestion: STANDARD_CARTONS[3] }; // Foliopak jako default dla bezwymiarowych
  }

  const suggestion = suggestCarton(productsToPack);
  return { suggestion };
});

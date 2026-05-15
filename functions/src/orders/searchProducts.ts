import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const searchProducts = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, query, limitCount = 50 } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

  // Autoryzacja dostępu do firmy
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'User is not a member of this company.');
  }

  const q = String(query || '').trim().toLowerCase();
  if (!q) return { results: [] };

  try {
    const productsRef = db.collection(`companies/${companyId}/products`);
    
    // Prosty silnik wyszukiwania na backendzie. 
    // Ponieważ Firestore natywnie nie wspiera Full-Text Search(LIKE '%..%'), 
    // robimy sztuczkę z `>=` i `<=` dla prefixów po polu skuNormalized, eanNormalized, nameNormalized.
    // Dla w pełni elastycznego algorytmu w przyszłości używa się ElasticSearch/Algolia, 
    // jednak ten kompromis gwarantuje Zero-RAM na kliecie i super szybkie wyniki dla prefixów.
    
    const searches = [
      productsRef.where('skuNormalized', '>=', q).where('skuNormalized', '<=', q + '\uf8ff').limit(limitCount).get(),
      productsRef.where('eanNormalized', '>=', q).where('eanNormalized', '<=', q + '\uf8ff').limit(limitCount).get(),
      // nameNormalized jest trudniejsze dla prefixu multi-word, ale spróbujmy:
      productsRef.where('nameNormalized', '>=', q).where('nameNormalized', '<=', q + '\uf8ff').limit(limitCount).get()
    ];

    const resultsSnaps = await Promise.all(searches);
    const uniqueProducts = new Map<string, any>();

    resultsSnaps.forEach(snap => {
      snap.docs.forEach(doc => {
        if (!uniqueProducts.has(doc.id)) {
          uniqueProducts.set(doc.id, { id: doc.id, ...doc.data() });
        }
      });
    });

    // Pobierzmy też stany (qtyAvailable), by front od razu dostał aktualny stan 
    // bez drugiego ładowania, zgodnie z życzeniem usera ("pokazuj: onHand, reserved, available").
    // Hybrid filter: stare dokumenty bez pola isArchived są traktowane jako aktywne (!undefined = true).
    const resultsArray = Array.from(uniqueProducts.values()).filter(p => !p.isArchived);
    if (resultsArray.length === 0) return { results: [] };

    const batchStockMatches = await Promise.all(
      resultsArray.map(async (prod) => {
        // Ponieważ inventoryStock ma klucze {productId}_{locationId}, zrobimy proste SUM po query
        const stockQuery = await db.collection(`companies/${companyId}/inventoryStock`)
          .where('productId', '==', prod.productId || prod.id)
          .get();
          
        let onHand = 0, reserved = 0, available = 0;
        
        stockQuery.docs.forEach(sDoc => {
          const s = sDoc.data();
          onHand += (s.qtyOnHand || 0);
          reserved += (s.qtyReserved || 0);
          available += (s.qtyAvailable || 0);
        });

        return {
          ...prod,
          inventoryStatus: {
            onHand,
            reserved,
            available
          }
        };
      })
    );

    return { results: batchStockMatches };

  } catch (err: any) {
    console.error('[searchProducts] ERROR:', err);
    throw new HttpsError('internal', err.message);
  }
});

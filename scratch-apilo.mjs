import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'gep-a-crm' });
const db = getFirestore();

async function run() {
  const integrationSnap = await db.collectionGroup('integrations').where('type', '==', 'apilo').limit(1).get();
  if (integrationSnap.empty) {
    console.log('No apilo integration found.');
    return;
  }
  const integration = integrationSnap.docs[0].data();
  console.log('Found integration for company:', integration.orgId);

  const { apiUrl, clientId, clientSecret, refreshToken } = integration;
  
  const tokenUrl = `${apiUrl.replace(/\/$/, '')}/rest/auth/token/`;
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      grantType: "refresh_token",
      token: refreshToken
    })
  });

  if (!response.ok) {
      console.log('Failed to refresh token:', await response.text());
      return;
  }
  const tokenData = await response.json();
  const accessToken = tokenData.accessToken;

  const ordersUrl = `${apiUrl.replace(/\/$/, '')}/rest/api/orders/?limit=1`;
  const ordersResponse = await fetch(ordersUrl, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json"
    }
  });

  if (!ordersResponse.ok) {
    console.log('Failed to fetch orders:', await ordersResponse.text());
    return;
  }

  const apiloData = await ordersResponse.json();
  console.log(JSON.stringify(apiloData.orders[0], null, 2));
}

run().catch(console.error);

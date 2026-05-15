// ping-baselinker.js
import https from 'https';

// Pobranie tokenu API jako argument z wiersza poleceń lub ze zmiennej środowiskowej
const rawToken = process.argv[2] || process.env.BASELINKER_TOKEN;

if (!rawToken) {
    console.error('\n❌ Błąd: Nie podano tokenu API.');
    console.error('Użycie: node ping-baselinker.js <twój_prawdziwy_token>');
    console.error('Przykład: node ping-baselinker.js 1004245-12345-ABCDEF12345\n');
    process.exit(1);
}

// Konfigurujemy żądanie dokładnie tak, jak robi to nasz backend: 
// celujemy w metodę getInventories, która jest bardzo szybka statystyczna metoda nie modyfikująca danych.
const data = new URLSearchParams();
data.append('method', 'getInventories');

const options = {
    hostname: 'api.baselinker.com',
    path: '/connector.php',
    method: 'POST',
    headers: {
        'X-BLToken': rawToken.trim(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data.toString())
    }
};

console.log(`[Diagnostic] Wysyłanie testowego zapytania do BaseLinker API...`);
console.log(`[Diagnostic] URL: POST https://api.baselinker.com/connector.php`);
console.log(`[Diagnostic] Payloads: method=getInventories`);
console.log(`[Diagnostic] Auth Header: X-BLToken: ***${rawToken.slice(-4)}\n`);

const req = https.request(options, (res) => {
    console.log(`[API Response] HTTP Status: ${res.statusCode} ${res.statusMessage}`);
    
    let responseData = '';

    res.on('data', (chunk) => {
        responseData += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(responseData);
            console.log(`[API Response] Parsed JSON Status: ${json.status}`);
            
            if (json.status === 'SUCCESS') {
                console.log('\n✅ SUKCES! API odpowiada pozytywnie.');
                console.log(`Odpowiedź: Znaleziono katalogów magazynowych (inventories): ${json.inventories ? json.inventories.length : 0}`);
            } else {
                console.log(`\n❌ BŁĄD API: BaseLinker zwrócił status ERROR.`);
                console.log(`Szczegóły: ${json.error_code} - ${json.error_message}`);
            }
        } catch (e) {
            console.error('\n❌ Błąd parsowania odpowiedzi serwera BaseLinker:', e.message);
            console.error('Surowa odpowiedź:', responseData);
        }
    });
});

req.on('error', (e) => {
    console.error(`\n❌ Błąd sieci nawiązywania połączenia z API: ${e.message}`);
});

req.write(data.toString());
req.end();

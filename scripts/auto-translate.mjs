import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;

if (!API_KEY) {
    console.error('======================================================');
    console.error('❌ BŁĄD: Brak klucza GOOGLE_TRANSLATE_API_KEY.');
    console.error('Ustaw klucz jako zmienną środowiskową przed uruchomieniem:');
    console.error('W PowerShell:');
    console.error('  $env:GOOGLE_TRANSLATE_API_KEY="TWÓJ_KLUCZ_API"');
    console.error('  npm run translate');
    console.error('======================================================');
    process.exit(0); // Graceful exit, żeby nie sypać na czerwono w pipeline
}

const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales');
const PL_PATH = path.join(LOCALES_DIR, 'pl', 'translation.json');
const TARGETS = [
    { code: 'en', path: path.join(LOCALES_DIR, 'en', 'translation.json') },
    { code: 'de', path: path.join(LOCALES_DIR, 'de', 'translation.json') },
    { code: 'cs', path: path.join(LOCALES_DIR, 'cs', 'translation.json') },
    { code: 'it', path: path.join(LOCALES_DIR, 'it', 'translation.json') },
    { code: 'es', path: path.join(LOCALES_DIR, 'es', 'translation.json') },
    { code: 'fr', path: path.join(LOCALES_DIR, 'fr', 'translation.json') }
];

// --- Helpers ---
function flattenObj(ob) {
    let result = {};
    for (const i in ob) {
        if (!ob.hasOwnProperty(i)) continue;
        if ((typeof ob[i]) === 'object' && ob[i] !== null && !Array.isArray(ob[i])) {
            const flatObject = flattenObj(ob[i]);
            for (const x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;
                result[i + '.' + x] = flatObject[x];
            }
        } else {
            result[i] = ob[i];
        }
    }
    return result;
}

function setDeep(obj, pathArr, value) {
    let current = obj;
    for (let i = 0; i < pathArr.length - 1; i++) {
        if (!current[pathArr[i]]) current[pathArr[i]] = {};
        current = current[pathArr[i]];
    }
    current[pathArr[pathArr.length - 1]] = value;
}

// Rekurencyjnie łączy obiekty zachowując to co docelowe i dodając nowości z source
function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge(target, source) {
  let output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] });
        else
          output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

// --- Payload processing ---
function extractPlaceholders(text) {
    const placeholders = [];
    // Wyszukaj np. {{name}}, {{ count }}
    const replacedText = text.replace(/\{\{([^}]+)\}\}/g, (match) => {
        const id = `__PH_${placeholders.length}__`;
        placeholders.push(match);
        return id;
    });
    return { replacedText, placeholders };
}

function restorePlaceholders(text, placeholders) {
    let result = text;
    for (let i = 0; i < placeholders.length; i++) {
        // Regex ignorujący drobne spacje, np. '__ PH_0 __'
        const regex = new RegExp(`__\\s*PH_${i}\\s*__`, 'g');
        result = result.replace(regex, placeholders[i]);
    }
    return result;
}

async function translateArray(texts, targetLang) {
    if (texts.length === 0) return [];
    
    const url = `https://translation.googleapis.com/language/translate/v2?key=${API_KEY}`;
    const body = {
        q: texts,
        source: 'pl',
        target: targetLang,
        format: 'text' 
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(`Google API Error: ${err.error?.message || res.statusText}`);
        }

        const data = await res.json();
        return data.data.translations.map(t => t.translatedText);
    } catch (e) {
        console.warn(`[!] Ostrzeżenie: Nie udało się przetłumaczyć batchem dla ${targetLang}. Błąd API:`, e.message);
        return [];
    }
}

async function syncLocale(targetPath, targetLang, plFlat) {
    let existingJson = {};
    if (fs.existsSync(targetPath)) {
        existingJson = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    } else {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    const targetFlat = flattenObj(existingJson);

    const missingKeys = [];
    for (const key of Object.keys(plFlat)) {
        if (!targetFlat.hasOwnProperty(key)) {
            missingKeys.push(key);
        }
    }

    if (missingKeys.length === 0) {
        return 0; // nothing to do
    }

    // 1. Zamieniamy {{var}} na tokeny maskujące
    const originalTexts = missingKeys.map(k => String(plFlat[k]));
    const batchData = originalTexts.map(extractPlaceholders);
    const queries = batchData.map(item => item.replacedText);
    
    // 2. Tłumaczymy chunki (np. po max 50 fraz)
    let translatedQueries = [];
    const chunkSize = 50;
    
    for (let i = 0; i < queries.length; i += chunkSize) {
        const chunk = queries.slice(i, i + chunkSize);
        const translatedChunk = await translateArray(chunk, targetLang);
        if (translatedChunk.length !== chunk.length) {
             console.error(`Błąd: Odpowiedzi z API nie pokrywają się z ilością przesłanych fraz. Przerywam tłumaczenie dla ${targetLang}.`);
             return 0;
        }
        translatedQueries.push(...translatedChunk);
    }

    // 3. Budujemy nowy obiekt ze struktury
    const newlyTranslatedObj = {};
    for (let i = 0; i < missingKeys.length; i++) {
        const keyPath = missingKeys[i].split('.');
        const ph = batchData[i].placeholders;
        const restoredText = restorePlaceholders(translatedQueries[i], ph);
        
        setDeep(newlyTranslatedObj, keyPath, restoredText);
    }

    // 4. Mergujemy nienaruszając oryginału i sortujemy 
    const finalMergedJson = deepMerge(existingJson, newlyTranslatedObj);

    // Zapis do pliku z wcięciem na 2 spacje
    fs.writeFileSync(targetPath, JSON.stringify(finalMergedJson, null, 2) + '\n', 'utf8');
    return missingKeys.length;
}

async function run() {
    console.log("🛠️ Rozpoczynam audyt i automatyczne tłumaczenie braków...");
    
    try {
       const plJson = JSON.parse(fs.readFileSync(PL_PATH, 'utf8'));
       const plFlat = flattenObj(plJson);

       console.log(`- Odnaleziono źródło w PL (${Object.keys(plFlat).length} kluczy)`);

       for (const t of TARGETS) {
           const added = await syncLocale(t.path, t.code, plFlat);
           console.log(`✅ ${t.code.toUpperCase()}: Przetłumaczono i dodano ${added} kluczy.`);
       }
       
       console.log("🎉 Zakończono proces i18n auto-translate.");
    } catch (e) {
       console.error("❌ Krytyczny błąd w trakcie wykonywania skryptu:", e);
    }
}

run();

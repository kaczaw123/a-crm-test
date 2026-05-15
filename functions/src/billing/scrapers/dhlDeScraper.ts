import * as cheerio from 'cheerio';

const MONTHS_DE: Record<string, string> = {
  Januar: '01', Jan: '01',
  Februar: '02', Feb: '02',
  März: '03', Mär: '03', Mar: '03',
  April: '04', Apr: '04',
  Mai: '05',
  Juni: '06', Jun: '06',
  Juli: '07', Jul: '07',
  August: '08', Aug: '08',
  September: '09', Sep: '09',
  Oktober: '10', Okt: '10', Oct: '10',
  November: '11', Nov: '11',
  Dezember: '12', Dez: '12', Dec: '12'
};

type ColumnRole = 'month' | 'energy' | 'fuel' | 'unknown';

function classifyHeader(text: string): ColumnRole {
  const t = text.toLowerCase();
  if (t.includes('monat') || t.includes('month') || t.includes('zeitraum')) return 'month';
  if (t.includes('energie') || t.includes('energy') || t.includes('zuschlagshöhe')) return 'energy';
  // Fuel markers (tylko poprawne, bez maut)
  if (t.includes('kraftstoff') || t.includes('diesel') || t.includes('treibstoff') || t.includes('fuel')) return 'fuel';
  return 'unknown';
}

function parsePercentValue(text: string): number | null {
  const match = text.match(/(\d+)[.,](\d+)/);
  if (!match) return null;
  const val = parseFloat(`${match[1]}.${match[2]}`);
  return isNaN(val) ? null : val;
}

function parseGermanMonth(dateStr: string): string | null {
  for (const [deName, mm] of Object.entries(MONTHS_DE)) {
    if (dateStr.includes(deName)) {
      const yearMatch = dateStr.match(/20\d{2}/);
      const yyyy = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
      return `${yyyy}-${mm}`;
    }
  }
  return null;
}

export async function scrapeDhlDeSurcharges(
  url: string
): Promise<Array<{ month: string; energyPercent: number | null; fuelPercent: number | null }>> {
  try {
    console.log(`[SCRAPER] Fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[SCRAPER] HTTP ${res.status} for ${url}`);
      return [];
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const resultsMap = new Map<
      string,
      { month: string; energyPercent: number | null; fuelPercent: number | null }
    >();

    $('table').each((tableIdx, table) => {
      // Krok 1: zmapuj indeksy kolumn na role na podstawie <th>
      const headers = $(table).find('thead th').toArray();
      const columnRoles: ColumnRole[] = headers.map((th) => classifyHeader($(th).text()));

      // Fallback: jeśli nie ma <thead>, weź pierwszy <tr>
      if (columnRoles.length === 0) {
        const firstRowCells = $(table).find('tr').first().find('th, td').toArray();
        firstRowCells.forEach((cell) => columnRoles.push(classifyHeader($(cell).text())));
      }

      // Krok 2: znajdź indeksy
      const monthIdx = columnRoles.indexOf('month');
      const energyIdx = columnRoles.indexOf('energy');
      const fuelIdx = columnRoles.indexOf('fuel');

      // Jeśli nie ma kolumny miesiąca + co najmniej jednej wartości — pomijamy tabelę
      if (monthIdx === -1 || (energyIdx === -1 && fuelIdx === -1)) {
        // Fallback heurystyczny: jeśli tabela ma 2 kolumny i pierwsza zawiera niemiecki miesiąc — załóż że druga to energy
        const sampleCell = $(table).find('tr').eq(1).find('td').first().text();
        if (parseGermanMonth(sampleCell)) {
          console.warn(
            `[SCRAPER] Table #${tableIdx}: no headers, fallback assuming [month, energy] columns`
          );
          // Wykonaj fallback parsing
          $(table)
            .find('tr')
            .each((_, tr) => {
              const cells = $(tr).find('td');
              if (cells.length < 2) return;
              const month = parseGermanMonth($(cells[0]).text().trim());
              const value = parsePercentValue($(cells[1]).text().trim());
              if (month && value !== null) {
                const cur = resultsMap.get(month) || { month, energyPercent: null, fuelPercent: null };
                cur.energyPercent = value;
                resultsMap.set(month, cur);
              }
            });
        } else {
          console.warn(`[SCRAPER] Table #${tableIdx} skipped — no recognizable structure`);
        }
        return; // continue to next table
      }

      // Krok 3: parsing wierszy z poprawnym indeksowaniem kolumn
      $(table)
        .find('tbody tr, tr')
        .each((_, tr) => {
          const cells = $(tr).find('td');
          if (cells.length === 0) return; // header row

          const monthCell = cells.eq(monthIdx).text().trim();
          const month = parseGermanMonth(monthCell);
          if (!month) return;

          const cur = resultsMap.get(month) || { month, energyPercent: null, fuelPercent: null };
          if (energyIdx !== -1 && cells.length > energyIdx) {
            const v = parsePercentValue(cells.eq(energyIdx).text().trim());
            if (v !== null) cur.energyPercent = v;
          }
          if (fuelIdx !== -1 && cells.length > fuelIdx) {
            const v = parsePercentValue(cells.eq(fuelIdx).text().trim());
            if (v !== null) cur.fuelPercent = v;
          }
          resultsMap.set(month, cur);
        });
    });

    const results = Array.from(resultsMap.values());
    console.log(`[SCRAPER] Parsed ${results.length} months from ${url}`);
    return results;
  } catch (err) {
    console.error('[SCRAPER] Fatal error in scrapeDhlDeSurcharges:', err);
    return [];
  }
}

const fs = require('fs');
const path = require('path');

const locales = {
  pl: {
    title: "Zamówienia",
    subtitle: "FULFILLMENT ENGINE",
    refresh: "Odśwież zamówienia",
    refreshing: "Odświeżanie sieci...",
    newButton: "Nowe Zamówienie",
    importSuccess: "Odświeżono udanie. Pobrane: {{fetched}}, Nowe: {{new}}, Zignorowane: {{skipped}}.",
    importError: "Błąd importu: {{message}}",
    table: {
      orderAndSource: "ZAMÓWIENIE & ŹRÓDŁO",
      recipient: "ODBIORCA",
      items: "PRZEDMIOTY",
      shippingAndStatus: "WYSYŁKA & STATUS",
      actions: "AKCJE"
    },
    noDate: "Brak daty",
    noCity: "Brak miasta",
    noPreview: "Bieżący podgląd niedostępny",
    noShippingMethod: "Brak metody",
    previewButton: "Podgląd",
    emptyState: {
      title: "Brak zamówień do obsługi.",
      subtitle: "Upewnij się czy synchronizacja jest aktywna."
    },
    loading: "Ładowanie...",
    loadMore: "Wczytaj kolejne"
  },
  en: {
    title: "Orders",
    subtitle: "FULFILLMENT ENGINE",
    refresh: "Refresh orders",
    refreshing: "Refreshing network...",
    newButton: "New Order",
    importSuccess: "Successfully refreshed. Fetched: {{fetched}}, New: {{new}}, Skipped: {{skipped}}.",
    importError: "Import error: {{message}}",
    table: {
      orderAndSource: "ORDER & SOURCE",
      recipient: "RECIPIENT",
      items: "ITEMS",
      shippingAndStatus: "SHIPPING & STATUS",
      actions: "ACTIONS"
    },
    noDate: "No Date",
    noCity: "No City",
    noPreview: "Preview unavailable",
    noShippingMethod: "No Method",
    previewButton: "View",
    emptyState: {
      title: "No orders to handle.",
      subtitle: "Make sure synchronization is active."
    },
    loading: "Loading...",
    loadMore: "Load more"
  },
  de: {
    title: "Bestellungen",
    subtitle: "FULFILLMENT ENGINE",
    refresh: "Bestellungen aktualisieren",
    refreshing: "Netzwerk aktualisieren...",
    newButton: "Neue Bestellung",
    importSuccess: "Erfolgreich aktualisiert. Abgerufen: {{fetched}}, Neu: {{new}}, Übersprungen: {{skipped}}.",
    importError: "Importfehler: {{message}}",
    table: {
      orderAndSource: "BESTELLUNG & QUELLE",
      recipient: "EMPFÄNGER",
      items: "ARTIKEL",
      shippingAndStatus: "VERSAND & STATUS",
      actions: "AKTIONEN"
    },
    noDate: "Kein Datum",
    noCity: "Keine Stadt",
    noPreview: "Vorschau nicht verfügbar",
    noShippingMethod: "Keine Methode",
    previewButton: "Ansehen",
    emptyState: {
      title: "Keine Bestellungen zur Bearbeitung.",
      subtitle: "Stellen Sie sicher, dass die Synchronisierung aktiv ist."
    },
    loading: "Laden...",
    loadMore: "Weitere laden"
  }
};

for (const lang of ['pl', 'en', 'de']) {
  const filePath = path.join(__dirname, 'src/i18n/locales', lang, 'translation.json');
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.orders = locales[lang];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Updated ${lang}/translation.json`);
  } else {
    console.log(`File not found: ${filePath}`);
  }
}

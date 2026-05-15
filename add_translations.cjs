const fs = require('fs');
const path = require('path');

const locales = {
  pl: {
    backToOrders: "Wróć do zamówień",
    source: "ŹRÓDŁO",
    ext: "EXT",
    int: "INT",
    buttons: {
      reserve: "Zarezerwuj Stany",
      cancelAll: "Anuluj Całość",
      releaseStock: "Zwolnij Stok",
      markReady: "Gotowe do Wysłania",
      confirmShipment: "Potwierdź Wysyłkę"
    },
    inventoryStatus: "Status Magazynowy",
    mapped: "Zmapowano",
    shipping: "Wysyłka",
    reservation: "Rezerwacja",
    fulfillmentReadiness: "Gotowość Fulfillment",
    readyToPack: "Gotowe do pakowania",
    waitingForConditions: "Oczekuje na warunki",
    orderItems: "Pozycje Zamówienia",
    table: {
      productAndSku: "Towar & SKU",
      mapping: "Mapowanie",
      qtyOrdered: "Zam.",
      qtyReserved: "Rez.",
      mapped: "Mapped",
      unmapped: "Unmapped",
      full: "Pełna",
      partial: "Część.",
      none: "Brak"
    },
    unknownProduct: "Nieznany produkt",
    noSku: "Brak SKU",
    crmProduct: "CRM",
    apiOriginal: "API",
    orderNotes: "Uwagi do Zamówienia",
    deliveryAddress: "Adres dostawy",
    billingDetails: "Dane do faktury",
    pickupPoint: "Odbiór w punkcie",
    address: {
      fullName: "Imię i nazwisko:",
      company: "Firma:",
      street: "Adres:",
      zipAndCity: "Kod i miasto:",
      province: "Województwo:",
      country: "Kraj:",
      vatNumber: "NIP:",
      client: "Klient:",
      name: "Nazwa:",
      id: "ID:"
    },
    history: {
      title: "Historia Zmian",
      empty: "Brak logów activity."
    },
    errors: {
      notFound: "Nie znaleziono zlecenia lub brak uprawnień.",
      operationError: "Błąd Operacji"
    },
    status: {
      new: "Nowe",
      processing: "W Realizacji",
      awaiting_stock: "Brak Towaru",
      ready_for_shipping: "Gotowe Do Wysyłki",
      shipped: "Wysłane",
      cancelled: "Anulowane"
    },
    paymentUnknown: "Metoda nieznana",
    changeNotes: "Zmień uwagi..."
  },
  en: {
    backToOrders: "Back to orders",
    source: "SOURCE",
    ext: "EXT",
    int: "INT",
    buttons: {
      reserve: "Reserve Stock",
      cancelAll: "Cancel All",
      releaseStock: "Release Stock",
      markReady: "Ready to Ship",
      confirmShipment: "Confirm Shipment"
    },
    inventoryStatus: "Inventory Status",
    mapped: "Mapped",
    shipping: "Shipping",
    reservation: "Reservation",
    fulfillmentReadiness: "Fulfillment Readiness",
    readyToPack: "Ready to pack",
    waitingForConditions: "Waiting for conditions",
    orderItems: "Order Items",
    table: {
      productAndSku: "Product & SKU",
      mapping: "Mapping",
      qtyOrdered: "Ord.",
      qtyReserved: "Res.",
      mapped: "Mapped",
      unmapped: "Unmapped",
      full: "Full",
      partial: "Part.",
      none: "None"
    },
    unknownProduct: "Unknown product",
    noSku: "No SKU",
    crmProduct: "CRM",
    apiOriginal: "API",
    orderNotes: "Order Notes",
    deliveryAddress: "Delivery Address",
    billingDetails: "Billing Details",
    pickupPoint: "Pickup Point",
    address: {
      fullName: "Full name:",
      company: "Company:",
      street: "Address:",
      zipAndCity: "ZIP and City:",
      province: "Province/State:",
      country: "Country:",
      vatNumber: "VAT Number:",
      client: "Client:",
      name: "Name:",
      id: "ID:"
    },
    history: {
      title: "Modification History",
      empty: "No activity logs."
    },
    errors: {
      notFound: "Order not found or access denied.",
      operationError: "Operation Error"
    },
    status: {
      new: "New",
      processing: "Processing",
      awaiting_stock: "Awaiting Stock",
      ready_for_shipping: "Ready for Shipping",
      shipped: "Shipped",
      cancelled: "Cancelled"
    },
    paymentUnknown: "Unknown method",
    changeNotes: "Change notes..."
  },
  de: {
    backToOrders: "Zurück zu Bestellungen",
    source: "QUELLE",
    ext: "EXT",
    int: "INT",
    buttons: {
      reserve: "Bestand reservieren",
      cancelAll: "Alles stornieren",
      releaseStock: "Bestand freigeben",
      markReady: "Versandbereit",
      confirmShipment: "Versand bestätigen"
    },
    inventoryStatus: "Lagerstatus",
    mapped: "Zugeordnet",
    shipping: "Versand",
    reservation: "Reservierung",
    fulfillmentReadiness: "Fulfillment Bereitschaft",
    readyToPack: "Packbereit",
    waitingForConditions: "Warten auf Bedingungen",
    orderItems: "Bestellpositionen",
    table: {
      productAndSku: "Artikel & SKU",
      mapping: "Zuordnung",
      qtyOrdered: "Best.",
      qtyReserved: "Res.",
      mapped: "Mapped",
      unmapped: "Unmapped",
      full: "Voll",
      partial: "Teilw.",
      none: "Keine"
    },
    unknownProduct: "Unbekanntes Produkt",
    noSku: "Keine SKU",
    crmProduct: "CRM",
    apiOriginal: "API",
    orderNotes: "Bestellhinweise",
    deliveryAddress: "Lieferadresse",
    billingDetails: "Rechnungsdetails",
    pickupPoint: "Abholstation",
    address: {
      fullName: "Vor- und Nachname:",
      company: "Firma:",
      street: "Adresse:",
      zipAndCity: "PLZ und Ort:",
      province: "Bundesland:",
      country: "Land:",
      vatNumber: "USt-IdNr.:",
      client: "Kunde:",
      name: "Name:",
      id: "ID:"
    },
    history: {
      title: "Änderungsverlauf",
      empty: "Keine Aktivitätsprotokolle."
    },
    errors: {
      notFound: "Bestellung nicht gefunden oder Zugriff verweigert.",
      operationError: "Vorgangsfehler"
    },
    status: {
      new: "Neu",
      processing: "In Bearbeitung",
      awaiting_stock: "Warten auf Bestand",
      ready_for_shipping: "Versandbereit",
      shipped: "Versendet",
      cancelled: "Storniert"
    },
    paymentUnknown: "Unbekannte Methode",
    changeNotes: "Hinweise ändern..."
  }
};

for (const lang of ['pl', 'en', 'de']) {
  const filePath = path.join(__dirname, 'src/i18n/locales', lang, 'translation.json');
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.orderDetails = locales[lang];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Updated ${lang}/translation.json`);
  } else {
    console.log(`File not found: ${filePath}`);
  }
}

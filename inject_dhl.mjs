import fs from 'fs';

const paths = [
  'src/i18n/locales/pl/translation.json',
  'src/i18n/locales/en/translation.json',
  'src/i18n/locales/de/translation.json'
];

const newShipmentsData = {
  pl: {
    loading: "Ładowanie konfiguracji DHL...",
    pageTitle: "Nowa Przesyłka DHL DE",
    pageSubtitle: "Stwórz nową etykietę paczkową przez interfejs API Brokera.",
    sandboxWarning: "TRYB TESTOWY (SANDBOX)",
    alerts: {
      addressOk: "Adres zweryfikowany pomyślnie (OK)",
      addressInvalid: "Adres nierozpoznany lub wymaga korekty.",
      addressError: "Błąd weryfikacji: ",
      selectIntegration: "Najpierw wybierz integrację.",
      diagSuccess: "Diagnostyka API DHL: ",
      diagFail: "Błąd diagnostyki: ",
      diagError: "Błąd: ",
      noIntegration: "Brak integracji DHL DE",
      labelSuccess: "Wygenerowano list: ",
      labelError: "Błąd generowania etykiety: "
    },
    sender: {
      title: "Dane Nadawcy",
      company: "Firma Nadawcy",
      name: "Imię Nazwisko (Opcj)",
      street: "Ulica",
      number: "Nr",
      zip: "Kod pocztowy",
      city: "Miejscowość",
      country_DE: "Niemcy (DE)",
      country_PL: "Polska (PL)"
    },
    recipient: {
      title: "Dane Odbiorcy",
      tabAddress: "Do adresu",
      tabPickup: "Do punktu",
      company: "Firma (Opcj)",
      name: "Imię Nazwisko *",
      phone: "Telefon",
      email: "Email",
      street: "Ulica *",
      number: "Nr *",
      zip: "Kod pocztowy *",
      city: "Miejscowość *",
      country_DE: "Niemcy (DE)",
      country_AT: "Austria (AT)",
      country_PL: "Polska (PL)",
      addressCheck: "ADDRESS CHECK DHL",
      pickupNotReady: "Moduł wyszukiwarki punktów odbioru (Packstation) w budowie po API..."
    },
    parcel: {
      title: "Parametry Paczki",
      weight: "WAGA (KG)",
      length: "DŁUGOŚĆ (CM)",
      width: "SZER (CM)",
      height: "WYS (CM)",
      optional: "Opcj"
    },
    contents: {
      title: "Zawartość i Referencje",
      reference: "Nr referencyjny (klienta) - np. ORDER-10294",
      description: "Opis zawartości paczki (niewidoczny na etykiecie dla V01PAK)..."
    },
    integration: {
      title: "Połączenie GKP",
      noActive: "Brak aktywnych integracji DHL DE!",
      sandboxAppended: "[SANDBOX]",
      gotoSettings: "Przejdź do Ustawień i skonfiguruj DHL DE.",
      diagnostics: "DIAGNOSTYKA"
    },
    footer: {
      statusLabel: "Status formularza",
      ready: "Gotowy do wysyłki",
      missingData: "Uzupełnij wymagane dane (*)",
      generating: "GENEROWANIE PDF...",
      generateBtn: "GENERUJ ETYKIETĘ Z DHL"
    }
  },
  en: {
    loading: "Loading DHL configuration...",
    pageTitle: "New DHL DE Shipment",
    pageSubtitle: "Create a new parcel label via the Broker API interface.",
    sandboxWarning: "TEST MODE (SANDBOX)",
    alerts: {
      addressOk: "Address verified successfully (OK)",
      addressInvalid: "Address not recognized or requires correction.",
      addressError: "Verification error: ",
      selectIntegration: "Select an integration first.",
      diagSuccess: "DHL API Diagnostics: ",
      diagFail: "Diagnostics error: ",
      diagError: "Error: ",
      noIntegration: "No DHL DE integration",
      labelSuccess: "Waybill generated: ",
      labelError: "Label generation error: "
    },
    sender: {
      title: "Sender Details",
      company: "Sender Company",
      name: "Full Name (Opt)",
      street: "Street",
      number: "No.",
      zip: "ZIP Code",
      city: "City",
      country_DE: "Germany (DE)",
      country_PL: "Poland (PL)"
    },
    recipient: {
      title: "Recipient Details",
      tabAddress: "To address",
      tabPickup: "To pickup point",
      company: "Company (Opt)",
      name: "Full Name *",
      phone: "Phone",
      email: "Email",
      street: "Street *",
      number: "No. *",
      zip: "ZIP Code *",
      city: "City *",
      country_DE: "Germany (DE)",
      country_AT: "Austria (AT)",
      country_PL: "Poland (PL)",
      addressCheck: "ADDRESS CHECK DHL",
      pickupNotReady: "Packstation pickup point search module under construction via API..."
    },
    parcel: {
      title: "Parcel Parameters",
      weight: "WEIGHT (KG)",
      length: "LENGTH (CM)",
      width: "WIDTH (CM)",
      height: "HEIGHT (CM)",
      optional: "Opt"
    },
    contents: {
      title: "Contents & References",
      reference: "Reference No (client) - e.g. ORDER-10294",
      description: "Parcel contents description (invisible on V01PAK label)..."
    },
    integration: {
      title: "GKP Connection",
      noActive: "No active DHL DE integrations!",
      sandboxAppended: "[SANDBOX]",
      gotoSettings: "Go to Settings and configure DHL DE.",
      diagnostics: "DIAGNOSTICS"
    },
    footer: {
      statusLabel: "Form status",
      ready: "Ready to ship",
      missingData: "Complete required details (*)",
      generating: "GENERATING PDF...",
      generateBtn: "GENERATE DHL LABEL"
    }
  },
  de: {
    loading: "Lade DHL-Konfiguration...",
    pageTitle: "Neue DHL DE Sendung",
    pageSubtitle: "Erstellen Sie ein neues Paketlabel über die Broker-API-Schnittstelle.",
    sandboxWarning: "TESTMODUS (SANDBOX)",
    alerts: {
      addressOk: "Adresse erfolgreich verifiziert (OK)",
      addressInvalid: "Adresse nicht erkannt oder bedarf der Korrektur.",
      addressError: "Verifizierungsfehler: ",
      selectIntegration: "Wählen Sie zuerst eine Integration aus.",
      diagSuccess: "DHL API Diagnose: ",
      diagFail: "Diagnosefehler: ",
      diagError: "Fehler: ",
      noIntegration: "Keine DHL DE Integration",
      labelSuccess: "Frachtbrief erstellt: ",
      labelError: "Fehler bei der Label-Generierung: "
    },
    sender: {
      title: "Absenderangaben",
      company: "Absenderfirma",
      name: "Vor- und Nachname (Opt)",
      street: "Straße",
      number: "Hausnr.",
      zip: "PLZ",
      city: "Stadt",
      country_DE: "Deutschland (DE)",
      country_PL: "Polen (PL)"
    },
    recipient: {
      title: "Empfängerangaben",
      tabAddress: "Zur Adresse",
      tabPickup: "Zur Abholstation",
      company: "Firma (Opt)",
      name: "Vor- und Nachname *",
      phone: "Telefon",
      email: "E-Mail",
      street: "Straße *",
      number: "Hausnr. *",
      zip: "PLZ *",
      city: "Stadt *",
      country_DE: "Deutschland (DE)",
      country_AT: "Österreich (AT)",
      country_PL: "Polen (PL)",
      addressCheck: "DHL-ADRESSPRÜFUNG",
      pickupNotReady: "Packstation-Suchmodul über API im Aufbau..."
    },
    parcel: {
      title: "Paketparameter",
      weight: "GEWICHT (KG)",
      length: "LÄNGE (CM)",
      width: "BREITE (CM)",
      height: "HÖHE (CM)",
      optional: "Opt"
    },
    contents: {
      title: "Inhalt & Referenzen",
      reference: "Referenznr. (Kunde) - z.B. ORDER-10294",
      description: "Paketinhalt (unsichtbar auf V01PAK-Label)..."
    },
    integration: {
      title: "GKP-Verbindung",
      noActive: "Keine aktiven DHL DE Integrationen!",
      sandboxAppended: "[SANDBOX]",
      gotoSettings: "Gehen Sie zu den Einstellungen und konfigurieren Sie DHL DE.",
      diagnostics: "DIAGNOSE"
    },
    footer: {
      statusLabel: "Formularstatus",
      ready: "Versandfertig",
      missingData: "Füllen Sie erforderliche Daten aus (*)",
      generating: "PDF WIRD ERSTELLT...",
      generateBtn: "DHL-LABEL ERSTELLEN"
    }
  }
};

const dhlIntegrationsData = {
  pl: {
     addDhlDe: "Dodaj DHL DE",
     badgeConnected: "POŁĄCZONO",
     badgeSandbox: "[SANDBOX]",
     badgeProduction: "[PRODUKCJA]",
     badgeDefault: "DOMYŚLNY",
     verifyBtn: "WERYFIKUJ",
     modalTitle: "Konfiguracja DHL DE",
     integrationName: "Nazwa integracji",
     namePlaceholder: "np. Moja Umowa DHL",
     gkpLogin: "GKP Login",
     gkpPassword: "GKP Hasło",
     ekpNumber: "Numer rozliczeniowy EKP",
     ekpPlaceholder: "14 cyfr np. 12345678900101",
     sandboxToggle: "Tryb Sandbox (Test)",
     setDefaultToggle: "Ustaw domyślnie",
     saveBtn: "ZAPISZ DHL DE",
     savingBtn: "ZAPISYWANIE",
     errors: {
       save: "Błąd zapisu integracji DHL.",
       loginSuccess: "Zalogowano w EKP!",
       apiError: "Błąd DHL API"
     }
  },
  en: {
     addDhlDe: "Add DHL DE",
     badgeConnected: "CONNECTED",
     badgeSandbox: "[SANDBOX]",
     badgeProduction: "[PRODUCTION]",
     badgeDefault: "DEFAULT",
     verifyBtn: "VERIFY",
     modalTitle: "DHL DE Configuration",
     integrationName: "Integration name",
     namePlaceholder: "e.g. My DHL Contract",
     gkpLogin: "GKP Login",
     gkpPassword: "GKP Password",
     ekpNumber: "EKP Billing Number",
     ekpPlaceholder: "14 digits e.g. 12345678900101",
     sandboxToggle: "Sandbox Mode (Test)",
     setDefaultToggle: "Set as default",
     saveBtn: "SAVE DHL DE",
     savingBtn: "SAVING",
     errors: {
       save: "DHL integration save error.",
       loginSuccess: "Logged in to EKP!",
       apiError: "DHL API Error"
     }
  },
  de: {
     addDhlDe: "DHL DE Hinzufügen",
     badgeConnected: "VERBUNDEN",
     badgeSandbox: "[SANDBOX]",
     badgeProduction: "[PRODUKTION]",
     badgeDefault: "STANDARD",
     verifyBtn: "ÜBERPRÜFEN",
     modalTitle: "DHL DE Konfiguration",
     integrationName: "Integrationsname",
     namePlaceholder: "z.B. Mein DHL-Vertrag",
     gkpLogin: "GKP-Login",
     gkpPassword: "GKP-Passwort",
     ekpNumber: "EKP-Abrechnungsnummer",
     ekpPlaceholder: "14 Ziffern z.B. 12345678900101",
     sandboxToggle: "Sandbox-Modus (Test)",
     setDefaultToggle: "Als Standard festlegen",
     saveBtn: "DHL DE SPEICHERN",
     savingBtn: "WIRD GESPEICHERT",
     errors: {
       save: "DHL-Integration Speicherfehler.",
       loginSuccess: "Erfolgreich im EKP angemeldet!",
       apiError: "DHL API-Fehler"
     }
  }
};

for (const p of paths) {
  let lang = 'en';
  if (p.includes('/pl/')) lang = 'pl';
  if (p.includes('/de/')) lang = 'de';
  
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    let data = JSON.parse(content);
    
    // Inject dhlNewShipment
    data.dhlNewShipment = newShipmentsData[lang];
    
    // Inject dhl inside integrations
    if (!data.integrations) {
        data.integrations = {};
    }
    data.integrations.dhl = dhlIntegrationsData[lang];
    
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    console.log('Updated ' + p);
  }
}

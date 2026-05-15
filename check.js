const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

// Używam dummy service account lub default credentials (zakładając że działa na roocie z tokenem)
// Ponieważ pracujemy lokalnie i gcloud nie działało, mogę połączyć się via emulator? Nie, produkcja.
// A gcloud jest niedostępny.
// A, we can do it via firebase-tools or run simple read using standard config if we had it.
// Ale nie możemy użyć serviceAccount bez bycia zalogowanym...

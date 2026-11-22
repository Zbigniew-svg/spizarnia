# Spiżarnia

Rodzinna aplikacja webowa (PWA): plan posiłków na tydzień, zapasy w domu i lista zakupów.
Adres: https://zbigniew-svg.github.io/spizarnia/

## Co robi

- **Plan** - śniadanie, obiad i kolacja na 7 dni. „Ułóż tydzień” wypełnia puste miejsca, najpierw daniami,
  które zużyją otwarte produkty i te z krótkim terminem. „Zrobione” odejmuje składniki ze spiżarni.
- **Zakupy** - składniki z planu minus to, co jest w domu, plus pozycje dopisane ręcznie.
  „Kupione: do spiżarni” przenosi odhaczone produkty do zapasów. „Wyślij listę” udostępnia ją jako tekst.
- **Spiżarnia** - produkty w domu z ilością, terminem i oznaczeniem „otwarte”, oraz propozycje dań na resztki.
- **Przepisy** - baza dań. Ilości składników są podane na 1 osobę i mnożone przez liczbę osób z ustawień.

## Pliki

- `index.html`, `styl.css`, `app.js` - aplikacja.
- `przepisy.json` - startowa baza przepisów (ładowana przy pierwszym uruchomieniu).
- `sw.js` - praca bez internetu. Przy każdej zmianie plików podbij `WERSJA`.
- `manifest.webmanifest`, `ikony/` - ikona na ekranie telefonu.

## Dane

Dane leżą w pamięci przeglądarki telefonu (localStorage, klucz `spizarnia-v1`).
Przenoszenie między telefonami: Ustawienia, „Zapisz kopię” i „Wczytaj kopię”.
Wspólna baza dla całej rodziny to kolejny etap.

Przepisy oznaczone źródłem diety.nfz.gov.pl pochodzą z portalu Diety NFZ i służą do użytku domowego.

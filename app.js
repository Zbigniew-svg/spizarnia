// Spiżarnia - plan posiłków na tydzień, zapasy w domu i lista zakupów.
// Dane leżą w pamięci telefonu (localStorage). Wspólna baza dla rodziny to kolejny etap.
// Ilości w przepisach są podane na jedną osobę i mnożone przez liczbę osób z ustawień.

'use strict';

const KLUCZ = 'spizarnia-v1';
const POSILKI = [['sniadanie', 'Śniadanie'], ['obiad', 'Obiad'], ['kolacja', 'Kolacja']];
const NAZWY_POSILKOW = Object.fromEntries(POSILKI);
const DNI = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const DNI_KROTKO = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const PILNE_DNI = 3;          // produkt z terminem w ciągu tylu dni trzeba wykorzystać
const TYTULY = { plan: 'Plan', zakupy: 'Zakupy', spizarnia: 'Spiżarnia', przepisy: 'Przepisy', wiecej: 'Ustawienia' };

let stan = null;
let widok = 'plan';
let filtrPrzepisow = '';
let edytowanyPrzepis = null;  // id przepisu w edycji, 'nowy' albo null

// ---------- narzędzia ----------

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

function norm(n) { return String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }

function dataISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function zISO(iso) { const [r, m, d] = iso.split('-').map(Number); return new Date(r, m - 1, d); }
function dzis() { return dataISO(new Date()); }
function dodajDni(iso, n) { const d = zISO(iso); d.setDate(d.getDate() + n); return dataISO(d); }
function roznicaDni(iso) { return Math.round((zISO(iso) - zISO(dzis())) / 86400000); }
function tydzien() { const s = dzis(); return Array.from({ length: 7 }, (_, i) => dodajDni(s, i)); }

function krotkaData(iso) {
  const d = zISO(iso);
  return `${DNI_KROTKO[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ladnaIlosc(x, j) {
  if (!j) return '';
  let v = j === 'szt' ? Math.round(x * 10) / 10 : Math.round(x);
  if (j === 'g' && v >= 1000) return String(Math.round(v / 100) / 10).replace('.', ',') + ' kg';
  if (j === 'ml' && v >= 1000) return String(Math.round(v / 100) / 10).replace('.', ',') + ' l';
  return String(v).replace('.', ',') + ' ' + j;
}

function zaokraglij(x, j) {
  if (j === 'szt') return Math.ceil(x - 0.001);
  if (x <= 50) return Math.ceil(x / 10) * 10;
  return Math.ceil(x / 50) * 50;
}

// "200 g makaron", "1,5 l mleko", "2 jajka", "szczypiorek"
function parsujSkladnik(linia) {
  const t = linia.trim();
  if (!t) return null;
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|szt\.?|sztuki|sztuk|sztuka)?\s+(.+)$/i);
  if (!m) return { n: norm(t), ilosc: 0, j: '' };
  let ilosc = parseFloat(m[1].replace(',', '.'));
  let j = (m[2] || 'szt').toLowerCase().replace('.', '');
  if (j === 'kg') { ilosc *= 1000; j = 'g'; }
  else if (j === 'l') { ilosc *= 1000; j = 'ml'; }
  else if (j.startsWith('szt')) j = 'szt';
  return { n: norm(m[3]), ilosc, j };
}

function skladnikJakoTekst(s) {
  if (!s.j) return s.n;
  return `${String(s.ilosc).replace('.', ',')} ${s.j} ${s.n}`;
}

// ---------- stan ----------

async function wczytaj() {
  const zapis = localStorage.getItem(KLUCZ);
  if (zapis) { try { stan = JSON.parse(zapis); } catch (e) { stan = null; } }
  if (!stan) {
    stan = { osoby: 4, przepisy: await przepisyStartowe(), zapasy: [], plan: {}, zakupy: [], odhaczone: {} };
  }
  stan.odhaczone = stan.odhaczone || {};
  stan.zakupy = stan.zakupy || [];
  // Plan starszy niż tydzień nie jest już potrzebny.
  const granica = dodajDni(dzis(), -7);
  for (const d of Object.keys(stan.plan)) if (d < granica) delete stan.plan[d];
  zapisz();
}

async function przepisyStartowe() {
  try {
    const lista = await (await fetch('przepisy.json', { cache: 'no-store' })).json();
    return lista.map(p => ({ ...p, id: p.id || uid() }));
  } catch (e) {
    return [];
  }
}

function zapisz() { localStorage.setItem(KLUCZ, JSON.stringify(stan)); }

function przepis(id) { return stan.przepisy.find(p => p.id === id); }

function zapas(n, j) {
  return stan.zapasy.filter(z => norm(z.n) === norm(n) && z.j === j).reduce((s, z) => s + (+z.ilosc || 0), 0);
}

function jestWDomu(n) { return stan.zapasy.some(z => norm(z.n) === norm(n)); }

function dodajZapas(n, ilosc, j, termin = '', otwarte = false) {
  const ist = stan.zapasy.find(z => norm(z.n) === norm(n) && z.j === j && !z.otwarte && (z.termin || '') === termin);
  if (ist && !otwarte) ist.ilosc = (+ist.ilosc || 0) + (+ilosc || 0);
  else stan.zapasy.push({ id: uid(), n: norm(n), ilosc: +ilosc || 0, j, termin, otwarte });
}

// Zużycie: najpierw otwarte opakowania, potem te z najkrótszym terminem.
function zuzyj(n, ilosc, j) {
  const pasujace = stan.zapasy
    .filter(z => norm(z.n) === norm(n) && z.j === j)
    .sort((a, b) => (b.otwarte - a.otwarte) || (a.termin || '9999').localeCompare(b.termin || '9999'));
  for (const z of pasujace) {
    if (ilosc <= 0) break;
    const ile = Math.min(z.ilosc, ilosc);
    z.ilosc -= ile;
    ilosc -= ile;
    if (z.ilosc > 0.001) z.otwarte = true;
  }
  stan.zapasy = stan.zapasy.filter(z => !(z.j && z.ilosc <= 0.001));
}

// ---------- logika ----------

function potrzeby() {
  const mapa = new Map();
  for (const d of tydzien()) {
    const dzien = stan.plan[d];
    if (!dzien) continue;
    for (const [k] of POSILKI) {
      const p = przepis(dzien[k]);
      if (!p || dzien.zrobione?.[k]) continue;
      for (const s of p.skladniki) {
        const klucz = norm(s.n) + '|' + (s.j || '');
        const w = mapa.get(klucz) || { n: norm(s.n), j: s.j || '', ilosc: 0, dania: new Set() };
        w.ilosc += (+s.ilosc || 0) * stan.osoby;
        w.dania.add(p.nazwa);
        mapa.set(klucz, w);
      }
    }
  }
  return [...mapa.values()];
}

function listaZakupow() {
  const lista = [];
  for (const w of potrzeby()) {
    if (!w.j) {
      if (!jestWDomu(w.n)) lista.push({ ...w, ilosc: 0, klucz: w.n + '|' });
      continue;
    }
    const brak = w.ilosc - zapas(w.n, w.j);
    if (brak > 0.001) lista.push({ ...w, ilosc: zaokraglij(brak, w.j), klucz: w.n + '|' + w.j });
  }
  for (const r of stan.zakupy) lista.push({ ...r, n: norm(r.n), reczne: true, klucz: 'r|' + r.id, dania: new Set() });
  return lista.sort((a, b) => a.n.localeCompare(b.n, 'pl'));
}

function pilne() {
  return stan.zapasy.filter(z => z.otwarte || (z.termin && roznicaDni(z.termin) <= PILNE_DNI));
}

function propozycje() {
  const nazwy = new Set(pilne().map(z => norm(z.n)));
  if (!nazwy.size) return [];
  // Pomijamy dania, które już czekają w planie na ten tydzień.
  const zaplanowane = new Set();
  for (const d of tydzien()) for (const [k] of POSILKI) {
    const dzien = stan.plan[d];
    if (dzien?.[k] && !dzien.zrobione?.[k]) zaplanowane.add(dzien[k]);
  }
  return stan.przepisy.filter(r => !zaplanowane.has(r.id)).map(r => {
    const uzyte = [...new Set(r.skladniki.filter(s => nazwy.has(norm(s.n))).map(s => norm(s.n)))];
    const braki = r.skladniki.filter(s => s.j && zapas(s.n, s.j) < s.ilosc * stan.osoby).length;
    return { r, uzyte, braki };
  })
    .filter(x => x.uzyte.length)
    .sort((a, b) => (b.uzyte.length - a.uzyte.length) || (a.braki - b.braki))
    .slice(0, 4);
}

function wstawDoPlanu(id) {
  const r = przepis(id);
  if (!r) return;
  for (const d of tydzien()) {
    stan.plan[d] = stan.plan[d] || {};
    if (!stan.plan[d][r.kategoria]) {
      stan.plan[d][r.kategoria] = r.id;
      zapisz();
      pokaz(`${r.nazwa}: dodano na ${krotkaData(d)}, ${NAZWY_POSILKOW[r.kategoria].toLowerCase()}.`);
      return;
    }
  }
  pokaz('W tym tygodniu nie ma wolnego miejsca na ten posiłek. Zmień danie ręcznie w planie.');
}

function ulozTydzien() {
  const dni = tydzien();
  const uzyte = new Set();
  for (const d of dni) for (const [k] of POSILKI) { const id = stan.plan[d]?.[k]; if (id) uzyte.add(id); }
  const pilneNazwy = new Set(pilne().map(z => norm(z.n)));
  let ile = 0;
  for (const d of dni) {
    stan.plan[d] = stan.plan[d] || {};
    for (const [k] of POSILKI) {
      if (stan.plan[d][k]) continue;
      const kandydaci = stan.przepisy.filter(r => r.kategoria === k);
      if (!kandydaci.length) continue;
      const ocena = r => {
        let o = Math.random();
        if (uzyte.has(r.id)) o -= 5;
        for (const s of r.skladniki) if (pilneNazwy.has(norm(s.n))) o += 3;
        return o;
      };
      const wybor = kandydaci.map(r => [ocena(r), r]).sort((a, b) => b[0] - a[0])[0][1];
      stan.plan[d][k] = wybor.id;
      uzyte.add(wybor.id);
      for (const s of wybor.skladniki) pilneNazwy.delete(norm(s.n));
      ile++;
    }
  }
  zapisz();
  pokaz(ile ? `Dodano ${ile} posiłków. Lista zakupów jest już policzona.` : 'Plan na ten tydzień jest już pełny.');
}

function ugotuj(d, k) {
  const dzien = stan.plan[d];
  const p = przepis(dzien?.[k]);
  if (!p) return;
  for (const s of p.skladniki) if (s.j) zuzyj(s.n, (+s.ilosc || 0) * stan.osoby, s.j);
  dzien.zrobione = { ...(dzien.zrobione || {}), [k]: true };
  zapisz();
}

function kupione() {
  const lista = listaZakupow().filter(w => stan.odhaczone[w.klucz]);
  for (const w of lista) {
    dodajZapas(w.n, w.ilosc || 0, w.j || '');
    if (w.reczne) stan.zakupy = stan.zakupy.filter(r => 'r|' + r.id !== w.klucz);
  }
  stan.odhaczone = {};
  zapisz();
  pokaz(lista.length ? `Przeniesiono do spiżarni: ${lista.length}.` : 'Najpierw odhacz kupione produkty.');
}

// ---------- komunikaty ----------

let komunikat = '';
function pokaz(t) { komunikat = t; rysuj(); }

// ---------- widoki ----------

function kartaPropozycji() {
  const p = pilne();
  if (!p.length) return '';
  const lista = propozycje();
  const nazwy = [...new Set(p.map(z => z.n))].join(', ');
  let h = `<section class="karta pilna"><h2>Do wykorzystania</h2><p class="podpowiedz" style="margin-top:0">Otwarte albo z krótkim terminem: <b>${esc(nazwy)}</b></p>`;
  if (!lista.length) h += '<p class="podpowiedz">Żaden przepis z bazy nie używa tych produktów.</p>';
  for (const x of lista) {
    h += `<div class="pozycja"><div class="opis">${esc(x.r.nazwa)}<small>${esc(NAZWY_POSILKOW[x.r.kategoria])}: zużyje ${esc(x.uzyte.join(', '))}</small></div>
      <button class="przycisk maly drugi" data-akcja="wstaw" data-id="${esc(x.r.id)}">Do planu</button></div>`;
  }
  return h + '</section>';
}

function widokPlan() {
  let h = `<div class="przyciski">
    <button class="przycisk" data-akcja="uloz">Ułóż tydzień</button>
    <button class="przycisk drugi" data-akcja="wyczysc-plan">Wyczyść</button></div>`;
  h += kartaPropozycji();
  for (const d of tydzien()) {
    const dzien = stan.plan[d] || {};
    const data = zISO(d);
    const naglowek = (d === dzis() ? 'Dziś, ' : '') + DNI[data.getDay()] + ' ' + krotkaData(d).slice(3);
    h += `<section class="karta ${d === dzis() ? 'dzien-dzis' : ''}"><h2>${esc(naglowek)}</h2>`;
    for (const [k, nazwa] of POSILKI) {
      const id = dzien[k] || '';
      const zrobione = dzien.zrobione?.[k];
      const opcje = stan.przepisy.filter(r => r.kategoria === k)
        .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))
        .map(r => `<option value="${esc(r.id)}" ${r.id === id ? 'selected' : ''}>${esc(r.nazwa)}</option>`).join('');
      const przycisk = !id ? '<span></span>'
        : zrobione ? '<span class="znacznik">zjedzone</span>'
        : `<button class="przycisk maly drugi" data-akcja="ugotuj" data-dzien="${d}" data-posilek="${k}" title="Odejmij składniki ze spiżarni">Zrobione</button>`;
      h += `<div class="posilek ${zrobione ? 'zrobiony' : ''}"><span class="nazwa-posilku">${nazwa}</span>
        <select data-akcja="zmien-posilek" data-dzien="${d}" data-posilek="${k}"><option value="">-</option>${opcje}</select>${przycisk}</div>`;
    }
    h += '</section>';
  }
  h += `<p class="podpowiedz">Przycisk „Zrobione” odejmuje składniki ze spiżarni. Ilości liczone są dla ${stan.osoby} os.</p>`;
  return h;
}

function widokZakupy() {
  const lista = listaZakupow();
  let h = '<section class="karta">';
  if (!lista.length) h += '<p class="pusto">Lista jest pusta. Ułóż plan na tydzień albo dopisz coś poniżej.</p>';
  for (const w of lista) {
    const odh = !!stan.odhaczone[w.klucz];
    const dania = [...w.dania].join(', ');
    h += `<label class="pozycja ${odh ? 'odhaczona' : ''}">
      <input type="checkbox" data-akcja="odhacz" data-klucz="${esc(w.klucz)}" ${odh ? 'checked' : ''}>
      <span class="opis">${esc(w.n)}<small>${w.reczne ? 'dopisane ręcznie' : esc(dania)}</small></span>
      <span class="ilosc">${esc(ladnaIlosc(w.ilosc, w.j))}</span>
      ${w.reczne ? `<button class="ikona" data-akcja="usun-zakup" data-id="${esc(w.id)}" aria-label="Usuń">✕</button>` : ''}</label>`;
  }
  h += '</section>';
  h += `<div class="przyciski">
    <button class="przycisk" data-akcja="kupione">Kupione: do spiżarni</button>
    <button class="przycisk drugi" data-akcja="udostepnij" ${lista.length ? '' : 'disabled'}>Wyślij listę</button></div>`;
  h += `<section class="karta"><h2>Dopisz do listy</h2>
    <div class="rzad"><input type="text" id="zakup-nazwa" placeholder="np. papier toaletowy" list="produkty">
    <input type="number" id="zakup-ilosc" class="waski" style="width:80px" placeholder="ile" min="0" step="any">
    <select id="zakup-j" class="waski" style="width:76px"><option value="szt">szt</option><option value="g">g</option><option value="ml">ml</option><option value="">-</option></select></div>
    <div class="przyciski" style="margin:10px 0 0"><button class="przycisk" data-akcja="dodaj-zakup">Dopisz</button></div></section>`;
  h += datalistaProduktow();
  h += '<p class="podpowiedz">Lista to składniki z planu na 7 dni minus to, co jest w spiżarni.</p>';
  return h;
}

function datalistaProduktow() {
  const nazwy = new Set();
  for (const r of stan.przepisy) for (const s of r.skladniki) nazwy.add(norm(s.n));
  for (const z of stan.zapasy) nazwy.add(norm(z.n));
  return `<datalist id="produkty">${[...nazwy].sort((a, b) => a.localeCompare(b, 'pl')).map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}

function znacznikTerminu(z) {
  let h = z.otwarte ? '<span class="znacznik pilny">otwarte</span>' : '';
  if (z.termin) {
    const r = roznicaDni(z.termin);
    const klasa = r < 0 ? 'po-terminie' : r <= PILNE_DNI ? 'pilny' : '';
    const tekst = r < 0 ? 'po terminie' : r === 0 ? 'termin dziś' : r === 1 ? 'termin jutro' : 'do ' + krotkaData(z.termin);
    h += `<span class="znacznik ${klasa}">${tekst}</span>`;
  }
  return h;
}

function widokSpizarnia() {
  let h = kartaPropozycji();
  h += `<section class="karta"><h2>Dodaj produkt</h2>
    <label class="pole"><span>Nazwa</span><input type="text" id="zapas-nazwa" placeholder="np. śmietana" list="produkty"></label>
    <div class="rzad"><label class="pole"><span>Ilość</span><input type="number" id="zapas-ilosc" min="0" step="any"></label>
    <label class="pole waski" style="width:84px"><span>Jednostka</span><select id="zapas-j"><option value="g">g</option><option value="ml">ml</option><option value="szt">szt</option><option value="">bez ilości</option></select></label></div>
    <div class="rzad"><label class="pole"><span>Termin (opcjonalnie)</span><input type="date" id="zapas-termin"></label>
    <label class="pole waski"><span>Otwarte</span><input type="checkbox" id="zapas-otwarte" style="width:24px;height:24px"></label></div>
    <button class="przycisk" data-akcja="dodaj-zapas">Dodaj</button></section>`;
  const lista = [...stan.zapasy].sort((a, b) => {
    const pa = a.otwarte || (a.termin && roznicaDni(a.termin) <= PILNE_DNI) ? 0 : 1;
    const pb = b.otwarte || (b.termin && roznicaDni(b.termin) <= PILNE_DNI) ? 0 : 1;
    return (pa - pb) || a.n.localeCompare(b.n, 'pl');
  });
  h += '<section class="karta"><h2>W domu</h2>';
  if (!lista.length) h += '<p class="pusto">Spiżarnia jest pusta. Dodaj produkty albo odhacz zakupy jako kupione.</p>';
  for (const z of lista) {
    h += `<div class="pozycja"><div class="opis">${esc(z.n)}<small>${znacznikTerminu(z)}</small></div>
      ${z.j ? `<input type="number" min="0" step="any" value="${Math.round(z.ilosc * 10) / 10}" data-akcja="ilosc-zapasu" data-id="${esc(z.id)}"><span>${z.j}</span>` : '<span class="podpowiedz" style="margin:0">jest</span>'}
      <button class="ikona" data-akcja="otworz-zapas" data-id="${esc(z.id)}" title="Oznacz jako otwarte" aria-label="Otwarte">${z.otwarte ? '📭' : '📦'}</button>
      <button class="ikona" data-akcja="usun-zapas" data-id="${esc(z.id)}" aria-label="Usuń">✕</button></div>`;
  }
  h += '</section>' + datalistaProduktow();
  return h;
}

function widokPrzepisy() {
  if (edytowanyPrzepis) return formularzPrzepisu();
  const filtry = [['', 'Wszystkie'], ...POSILKI];
  let h = `<div class="filtry">${filtry.map(([k, n]) => `<button class="${filtrPrzepisow === k ? 'aktywna' : ''}" data-akcja="filtr" data-k="${k}">${n}</button>`).join('')}</div>`;
  h += '<div class="przyciski"><button class="przycisk" data-akcja="nowy-przepis">Dodaj przepis</button></div>';
  const lista = stan.przepisy.filter(r => !filtrPrzepisow || r.kategoria === filtrPrzepisow)
    .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
  h += '<section class="karta">';
  if (!lista.length) h += '<p class="pusto">Brak przepisów.</p>';
  for (const r of lista) {
    h += `<div class="pozycja przepis-wiersz" data-akcja="edytuj-przepis" data-id="${esc(r.id)}"><div class="opis">${esc(r.nazwa)}
      <small>${esc(NAZWY_POSILKOW[r.kategoria])}, składników: ${r.skladniki.length}${r.zrodlo ? ', źródło: ' + esc(r.zrodlo) : ''}</small></div><span>›</span></div>`;
  }
  return h + '</section>';
}

function formularzPrzepisu() {
  const r = edytowanyPrzepis === 'nowy'
    ? { nazwa: '', kategoria: filtrPrzepisow || 'obiad', skladniki: [], opis: '', zrodlo: '' }
    : przepis(edytowanyPrzepis);
  if (!r) { edytowanyPrzepis = null; return widokPrzepisy(); }
  return `<section class="karta"><h2>${edytowanyPrzepis === 'nowy' ? 'Nowy przepis' : 'Edycja przepisu'}</h2>
    <label class="pole"><span>Nazwa</span><input type="text" id="p-nazwa" value="${esc(r.nazwa)}"></label>
    <label class="pole"><span>Posiłek</span><select id="p-kategoria">${POSILKI.map(([k, n]) => `<option value="${k}" ${r.kategoria === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="pole"><span>Składniki na 1 osobę, każdy w osobnej linii</span><textarea id="p-skladniki" placeholder="100 g makaron&#10;150 ml mleko&#10;2 szt jajka&#10;szczypiorek">${esc(r.skladniki.map(skladnikJakoTekst).join('\n'))}</textarea></label>
    <p class="podpowiedz" style="margin-top:-4px;margin-bottom:10px">Jednostki: g, kg, ml, l, szt. Linia bez liczby to dodatek bez ilości, np. przyprawa.</p>
    <label class="pole"><span>Przygotowanie</span><textarea id="p-opis" style="min-height:90px">${esc(r.opis || '')}</textarea></label>
    <label class="pole"><span>Źródło (np. diety.nfz.gov.pl)</span><input type="text" id="p-zrodlo" value="${esc(r.zrodlo || '')}"></label>
    <div class="przyciski"><button class="przycisk" data-akcja="zapisz-przepis">Zapisz</button>
    <button class="przycisk drugi" data-akcja="anuluj-przepis">Anuluj</button>
    ${edytowanyPrzepis !== 'nowy' ? '<button class="przycisk usun" data-akcja="usun-przepis">Usuń</button>' : ''}</div></section>`;
}

function widokWiecej() {
  return `<section class="karta"><h2>Rodzina</h2>
    <label class="pole"><span>Liczba osób, dla których gotujecie</span><input type="number" id="osoby" min="1" max="20" value="${stan.osoby}" data-akcja="osoby"></label></section>
    <section class="karta"><h2>Kopia danych</h2>
    <p class="podpowiedz" style="margin-top:0">Dane są zapisane w tym telefonie. Kopią możesz przenieść je na inny telefon albo zabezpieczyć.</p>
    <div class="przyciski" style="margin:10px 0 0"><button class="przycisk" data-akcja="eksport">Zapisz kopię</button>
    <button class="przycisk drugi" data-akcja="import">Wczytaj kopię</button></div>
    <input type="file" id="plik-importu" accept="application/json,.json" hidden></section>
    <section class="karta"><h2>Przepisy</h2>
    <p class="podpowiedz" style="margin-top:0">Przywraca startowe przepisy, których brakuje w bazie. Twoje przepisy zostają.</p>
    <div class="przyciski" style="margin:10px 0 0"><button class="przycisk drugi" data-akcja="przywroc-przepisy">Przywróć startowe</button></div></section>
    <p class="podpowiedz">Przepisy oznaczone źródłem diety.nfz.gov.pl pochodzą z portalu Diety NFZ i służą do użytku domowego.</p>`;
}

// ---------- rysowanie ----------

function rysuj() {
  document.getElementById('tytul').textContent = TYTULY[widok];
  document.querySelectorAll('#zakladki button').forEach(b => b.classList.toggle('aktywna', b.dataset.widok === widok));
  const widoki = { plan: widokPlan, zakupy: widokZakupy, spizarnia: widokSpizarnia, przepisy: widokPrzepisy, wiecej: widokWiecej };
  const info = komunikat ? `<section class="karta" style="background:var(--zielony-jasny)">${esc(komunikat)}</section>` : '';
  komunikat = '';
  document.getElementById('tresc').innerHTML = info + widoki[widok]();
  const ile = listaZakupow().filter(w => !stan.odhaczone[w.klucz]).length;
  const licznik = document.getElementById('licznik');
  licznik.hidden = !ile;
  licznik.textContent = ile;
}

// ---------- zdarzenia ----------

function wartosc(id) { return document.getElementById(id)?.value ?? ''; }

document.addEventListener('click', async zd => {
  const el = zd.target.closest('[data-akcja]');
  if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button')) return;
  const a = el.dataset.akcja;
  const id = el.dataset.id;

  if (a === 'widok') { widok = el.dataset.widok; edytowanyPrzepis = null; rysuj(); window.scrollTo(0, 0); return; }
  if (a === 'uloz') { ulozTydzien(); return; }
  if (a === 'wyczysc-plan') {
    if (confirm('Wyczyścić plan na najbliższe 7 dni?')) { for (const d of tydzien()) delete stan.plan[d]; zapisz(); rysuj(); }
    return;
  }
  if (a === 'ugotuj') { ugotuj(el.dataset.dzien, el.dataset.posilek); pokaz('Składniki odjęte ze spiżarni.'); return; }
  if (a === 'wstaw') { wstawDoPlanu(id); return; }
  if (a === 'kupione') { kupione(); return; }
  if (a === 'usun-zakup') { zd.preventDefault(); stan.zakupy = stan.zakupy.filter(r => r.id !== id); zapisz(); rysuj(); return; }
  if (a === 'dodaj-zakup') {
    const n = norm(wartosc('zakup-nazwa'));
    if (!n) return;
    const j = wartosc('zakup-j');
    stan.zakupy.push({ id: uid(), n, ilosc: j ? (+wartosc('zakup-ilosc') || 0) : 0, j: j && +wartosc('zakup-ilosc') ? j : '' });
    zapisz(); rysuj(); return;
  }
  if (a === 'udostepnij') {
    const tekst = 'Lista zakupów:\n' + listaZakupow().filter(w => !stan.odhaczone[w.klucz])
      .map(w => '- ' + w.n + (w.j ? ' ' + ladnaIlosc(w.ilosc, w.j) : '')).join('\n');
    if (navigator.share) { try { await navigator.share({ title: 'Lista zakupów', text: tekst }); } catch (e) { } }
    else { try { await navigator.clipboard.writeText(tekst); pokaz('Lista skopiowana do schowka.'); } catch (e) { alert(tekst); } }
    return;
  }
  if (a === 'dodaj-zapas') {
    const n = norm(wartosc('zapas-nazwa'));
    if (!n) return;
    const j = wartosc('zapas-j');
    const ilosc = +wartosc('zapas-ilosc') || 0;
    if (j && !ilosc) { alert('Podaj ilość albo wybierz „bez ilości”.'); return; }
    dodajZapas(n, j ? ilosc : 0, j, wartosc('zapas-termin'), document.getElementById('zapas-otwarte').checked);
    zapisz(); pokaz(`Dodano: ${n}.`); return;
  }
  if (a === 'otworz-zapas') { const z = stan.zapasy.find(x => x.id === id); if (z) { z.otwarte = !z.otwarte; zapisz(); rysuj(); } return; }
  if (a === 'usun-zapas') { stan.zapasy = stan.zapasy.filter(x => x.id !== id); zapisz(); rysuj(); return; }
  if (a === 'filtr') { filtrPrzepisow = el.dataset.k; rysuj(); return; }
  if (a === 'nowy-przepis') { edytowanyPrzepis = 'nowy'; rysuj(); window.scrollTo(0, 0); return; }
  if (a === 'edytuj-przepis') { edytowanyPrzepis = id; rysuj(); window.scrollTo(0, 0); return; }
  if (a === 'anuluj-przepis') { edytowanyPrzepis = null; rysuj(); return; }
  if (a === 'zapisz-przepis') {
    const nazwa = wartosc('p-nazwa').trim();
    if (!nazwa) { alert('Podaj nazwę przepisu.'); return; }
    const dane = {
      nazwa,
      kategoria: wartosc('p-kategoria'),
      skladniki: wartosc('p-skladniki').split('\n').map(parsujSkladnik).filter(Boolean),
      opis: wartosc('p-opis').trim(),
      zrodlo: wartosc('p-zrodlo').trim()
    };
    if (edytowanyPrzepis === 'nowy') stan.przepisy.push({ id: uid(), ...dane });
    else Object.assign(przepis(edytowanyPrzepis), dane);
    edytowanyPrzepis = null; zapisz(); pokaz(`Zapisano przepis: ${nazwa}.`); return;
  }
  if (a === 'usun-przepis') {
    if (!confirm('Usunąć ten przepis?')) return;
    stan.przepisy = stan.przepisy.filter(r => r.id !== edytowanyPrzepis);
    for (const d of Object.values(stan.plan)) for (const [k] of POSILKI) if (d[k] === edytowanyPrzepis) delete d[k];
    edytowanyPrzepis = null; zapisz(); rysuj(); return;
  }
  if (a === 'eksport') {
    const plik = new Blob([JSON.stringify(stan, null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(plik);
    link.download = `spizarnia-${dzis()}.json`;
    link.click();
    return;
  }
  if (a === 'import') { document.getElementById('plik-importu').click(); return; }
  if (a === 'przywroc-przepisy') {
    const startowe = await przepisyStartowe();
    const ist = new Set(stan.przepisy.map(r => r.id));
    const nowe = startowe.filter(r => !ist.has(r.id));
    stan.przepisy.push(...nowe); zapisz(); pokaz(`Przywrócono przepisów: ${nowe.length}.`); return;
  }
});

document.addEventListener('change', zd => {
  const el = zd.target;
  const a = el.dataset?.akcja;
  if (a === 'zmien-posilek') {
    const d = el.dataset.dzien, k = el.dataset.posilek;
    stan.plan[d] = stan.plan[d] || {};
    if (el.value) stan.plan[d][k] = el.value; else delete stan.plan[d][k];
    if (stan.plan[d].zrobione) delete stan.plan[d].zrobione[k];
    zapisz(); rysuj(); return;
  }
  if (a === 'odhacz') {
    if (el.checked) stan.odhaczone[el.dataset.klucz] = true; else delete stan.odhaczone[el.dataset.klucz];
    zapisz(); rysuj(); return;
  }
  if (a === 'ilosc-zapasu') {
    const z = stan.zapasy.find(x => x.id === el.dataset.id);
    if (!z) return;
    z.ilosc = Math.max(0, +el.value || 0);
    if (z.ilosc <= 0) stan.zapasy = stan.zapasy.filter(x => x !== z);
    zapisz(); rysuj(); return;
  }
  if (a === 'osoby') { stan.osoby = Math.max(1, Math.round(+el.value || 1)); zapisz(); pokaz(`Ilości liczone są teraz dla ${stan.osoby} os.`); return; }
  if (el.id === 'plik-importu' && el.files[0]) {
    const czytnik = new FileReader();
    czytnik.onload = () => {
      try {
        const dane = JSON.parse(czytnik.result);
        if (!Array.isArray(dane.przepisy) || !Array.isArray(dane.zapasy)) throw new Error('zły plik');
        stan = dane; zapisz(); pokaz('Kopia wczytana.');
      } catch (e) { alert('To nie jest kopia Spiżarni.'); }
    };
    czytnik.readAsText(el.files[0]);
  }
});

// ---------- start ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

wczytaj().then(rysuj);

// ---------- Importations des modules ----------
import { initFavorites } from './favorites.js';
import { initShare } from './share.js';
import { initSignalement } from './signalement.js';
import { initUrgences } from './urgences.js';
import { initVoiceSearch } from './voice-search.js';
import { showRoute } from './routing.js';

// ---------- Configuration des APIs ----------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MAX_RESULTS = 40;
const CACHE_DURATION = 30 * 60 * 1000; // Cache de 30 minutes

// ---------- État global de l'application ----------
export const state = {
  map: null,
  markersLayer: null,
  currentPos: null,
  activeCategory: null,
  results: [],
  favs: JSON.parse(localStorage.getItem('civ_favs') || '[]'),
  cache: JSON.parse(localStorage.getItem('civ_cache') || '{}'),
  isFetching: false
};

// ---------- Mappage catégories OpenStreetMap ----------
// FIX BUG#4 : La catégorie "public" utilisait une syntaxe Overpass QL invalide :
//   "(amenity=public_building or office=government)" ne peut pas être injecté directement
//   comme filtre de tag dans [tag](bbox). La solution est de stocker un tableau de filtres
//   et de construire plusieurs blocs node/way/relation dans le query-builder.
//
// Chaque entrée est un tableau de paires [key, value].
// Pour les regex Overpass, préfixer la valeur avec "~" : ["shop", "~.*"]
const CATEGORY_TAGS = {
  hospital: [['amenity', 'hospital']],
  pharmacy: [['amenity', 'pharmacy']],
  school:   [['amenity', 'school']],
  fuel:     [['amenity', 'fuel']],
  market:   [['shop', '~.*']],          // Tous les types de commerces (regex)
  public:   [['amenity', 'public_building'], ['office', 'government']] // Multi-filtres
};

const CATEGORY_NAMES = {
  hospital: 'Hôpital / Centre de santé',
  pharmacy: 'Pharmacie',
  school:   'Établissement scolaire',
  fuel:     'Station-service',
  market:   'Commerce / Marché',
  public:   'Administration publique'
};

// ---------- Utilitaires de l'interface utilisateur ----------
function showLoading(show) {
  const loader = document.getElementById('loader-container');
  if (loader) {
    if (show) loader.classList.remove('hidden');
    else loader.classList.add('hidden');
  }
}

// FIX WARN#9 : escapeHtml est maintenant exporté proprement depuis ce module
// pour être importé par favorites.js au lieu d'être exposé via window.*
export function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ---------- Construction de la requête Overpass QL (query-builder) ----------
// FIX BUG#4 : Génère proprement une requête valide pour 1 ou plusieurs filtres de tags
function buildOverpassQuery(tagFilters, bbox) {
  const lines = tagFilters.flatMap(([key, value]) => {
    // Si la valeur commence par "~", c'est un filtre regex Overpass
    const filter = value.startsWith('~')
      ? `["${key}"~"${value.slice(1)}"]`
      : `["${key}"="${value}"]`;
    return [
      `  node${filter}(${bbox});`,
      `  way${filter}(${bbox});`,
      `  relation${filter}(${bbox});`
    ];
  });
  return `[out:json][timeout:25];\n(\n${lines.join('\n')}\n);\nout center;`;
}

// ---------- Initialisation au chargement du DOM ----------
document.addEventListener('DOMContentLoaded', () => {
  // Coordonnées par défaut (Abidjan, Côte d'Ivoire)
  state.map = L.map('map', { zoomControl: false }).setView([5.359952, -4.008256], 13);

  // Rendre la carte globale pour les modules dépendants (ex: favorites.js)
  window.map = state.map;

  // FIX BUG#3 (RÈGLE D'OR) : invalidateSize() obligatoire après init Leaflet sur Android
  // La WebView Android ne stabilise pas la taille de l'écran immédiatement au chargement.
  // Sans ce délai, la carte s'affiche sous forme de bloc gris vide.
  setTimeout(() => {
    if (state.map) state.map.invalidateSize();
  }, 350);

  // Contrôle du zoom positionné en bas à gauche pour laisser la place aux boutons mobiles
  L.control.zoom({ position: 'bottomleft' }).addTo(state.map);

  // Couche standard (Mapnik OpenStreetMap)
  const standardLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(state.map);

  // Couche satellite (Esri World Imagery)
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri' }
  );

  // FIX BUG#1 : satellite-btn existe maintenant dans le HTML, cet addEventListener ne crashe plus
  let isSatellite = false;
  document.getElementById('satellite-btn').addEventListener('click', () => {
    if (isSatellite) {
      state.map.removeLayer(satelliteLayer);
      standardLayer.addTo(state.map);
    } else {
      state.map.removeLayer(standardLayer);
      satelliteLayer.addTo(state.map);
    }
    isSatellite = !isSatellite;
    document.getElementById('satellite-btn').classList.toggle('active', isSatellite);
  });

  // Groupe de marqueurs pour les résultats
  state.markersLayer = L.layerGroup().addTo(state.map);

  // Assignation des écouteurs d'événements principaux
  document.getElementById('locate-btn').addEventListener('click', locateUser);

  document.getElementById('search-btn').addEventListener('click', () => {
    const query = document.getElementById('search-input').value.trim();
    if (query) handleNaturalSearch(query);
  });

  document.getElementById('search-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('search-btn').click();
  });

  // Gestion active des boutons de catégories horizontales
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const alreadyActive = btn.classList.contains('active');
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));

      if (alreadyActive) {
        state.activeCategory = null;
        state.markersLayer.clearLayers();
        document.getElementById('results-panel').classList.remove('open');
      } else {
        btn.classList.add('active');
        const cat = btn.dataset.cat;
        state.activeCategory = cat;
        searchAroundMap(cat);
      }
    });
  });

  document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('results-panel').classList.remove('open');
  });

  // Initialisation synchronisée de tous les sous-modules
  initFavorites();
  initShare();
  initSignalement();
  initUrgences();
  initVoiceSearch();

  // Lance une localisation automatique de l'utilisateur au démarrage
  locateUser();
});

// ---------- Géolocalisation de l'utilisateur ----------
function locateUser() {
  if (!navigator.geolocation) {
    alert("La géolocalisation n'est pas supportée ou activée sur votre appareil.");
    return;
  }
  showLoading(true);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      showLoading(false);
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      state.currentPos = { lat, lng };

      // Marqueur stylisé pour la position de l'utilisateur
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'custom-user-marker',
          html: '<div style="background:#2ecc71; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 8px rgba(0,0,0,0.4);"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(state.map).bindPopup("Vous êtes ici").openPopup();

      state.map.setView([lat, lng], 15);

      // FIX BUG#3 (RÈGLE D'OR) : Forcer le recalcul après setView() déclenché par géoloc
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 350);

      if (state.activeCategory) {
        searchAroundMap(state.activeCategory);
      }
    },
    (error) => {
      showLoading(false);
      console.warn("Avis de géolocalisation non disponible : " + error.message);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ---------- Recherche de Catégorie (Overpass API) ----------
async function searchAroundMap(category) {
  if (state.isFetching) return;
  state.isFetching = true;
  showLoading(true);

  const bounds = state.map.getBounds();
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const tagFilters = CATEGORY_TAGS[category];

  if (!tagFilters) {
    state.isFetching = false;
    showLoading(false);
    return;
  }

  // FIX BUG#4 : Utilisation du query-builder pour générer une requête QL valide
  const query = buildOverpassQuery(tagFilters, bbox);

  // Clé de cache simplifiée sur la zone et la catégorie
  const cacheKey = `${category}_${bounds.getSouth().toFixed(3)}_${bounds.getWest().toFixed(3)}`;
  const now = Date.now();

  try {
    if (state.cache[cacheKey] && (now - state.cache[cacheKey].timestamp < CACHE_DURATION)) {
      renderResults(state.cache[cacheKey].data, category);
    } else {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`
      });
      const data = await response.json();

      const parsedResults = (data.elements || []).map(item => {
        const lat = item.lat || (item.center ? item.center.lat : null);
        const lon = item.lon || (item.center ? item.center.lon : null);
        return {
          id: item.id,
          lat,
          lon,
          name: item.tags.name || item.tags.brand || CATEGORY_NAMES[category] || 'Établissement',
          address: item.tags['addr:street']
            ? `${item.tags['addr:housenumber'] || ''} ${item.tags['addr:street']}`.trim()
            : 'Adresse non renseignée',
          phone: item.tags.phone || item.tags['contact:phone'] || null
        };
      }).filter(item => item.lat && item.lon);

      state.cache[cacheKey] = { timestamp: now, data: parsedResults };
      localStorage.setItem('civ_cache', JSON.stringify(state.cache));

      renderResults(parsedResults, category);
    }
  } catch (err) {
    console.error("Erreur serveur Overpass API :", err);
    alert("Impossible de charger les points d'intérêts sur la zone.");
  } finally {
    state.isFetching = false;
    showLoading(false);
  }
}

// ---------- Recherche Textuelle Contextuelle (Nominatim) ----------
async function handleNaturalSearch(queryText) {
  showLoading(true);
  try {
    // On force la recherche sur la Côte d'Ivoire pour de meilleurs résultats locaux
    const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(queryText + ", Côte d'Ivoire")}&limit=5`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.length > 0) {
      const match = data[0];
      const lat = parseFloat(match.lat);
      const lon = parseFloat(match.lon);

      state.map.setView([lat, lon], 14);
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 350);

      let detectedCat = null;
      for (const key in CATEGORY_NAMES) {
        if (
          queryText.toLowerCase().includes(key) ||
          queryText.toLowerCase().includes(CATEGORY_NAMES[key].toLowerCase())
        ) {
          detectedCat = key;
          break;
        }
      }

      if (detectedCat) {
        document.querySelectorAll('.cat-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.cat === detectedCat);
        });
        state.activeCategory = detectedCat;
        searchAroundMap(detectedCat);
      } else {
        state.markersLayer.clearLayers();
        L.marker([lat, lon]).addTo(state.markersLayer)
          .bindPopup(`<b>${escapeHtml(match.display_name)}</b>`)
          .openPopup();
      }
    } else {
      alert("Aucun lieu trouvé correspondant à votre saisie.");
    }
  } catch (err) {
    console.error("Erreur d'appel Nominatim :", err);
    alert("Erreur technique lors de la recherche textuelle.");
  } finally {
    showLoading(false);
  }
}

// ---------- Rendu Graphique des Marqueurs et Cartes ----------
function renderResults(places, category) {
  state.markersLayer.clearLayers();
  state.results = places;

  const listEl = document.getElementById('results-list');
  listEl.innerHTML = '';

  if (places.length === 0) {
    listEl.innerHTML = '<p style="padding:20px; text-align:center; color:#888;">Aucun résultat trouvé sur ce périmètre.</p>';
    document.getElementById('results-panel').classList.add('open');
    return;
  }

  // Calcul des distances via formule Haversine si position connue
  if (state.currentPos) {
    places.forEach(p => { p.distance = haversine(state.currentPos, p); });
    places.sort((a, b) => a.distance - b.distance);
  }

  places.slice(0, MAX_RESULTS).forEach(place => {
    const marker = L.marker([place.lat, place.lon]).addTo(state.markersLayer);

    const popupHTML = `
      <div style="font-family:sans-serif; min-width:150px; padding:2px;">
        <b style="color:#2c3e50; font-size:14px;">${escapeHtml(place.name)}</b><br>
        <span style="color:#777; font-size:11px;">${escapeHtml(place.address)}</span><br>
        ${place.distance ? `<strong style="color:#e67e22; font-size:12px;">📍 ${place.distance.toFixed(2)} km</strong><br>` : ''}
        <button onclick="window.startRouting(${place.lat}, ${place.lon})" style="margin-top:8px; width:100%; padding:6px; background:#2c3e50; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Itinéraire</button>
      </div>
    `;
    marker.bindPopup(popupHTML);

    const isFav = state.favs.some(f => f.id === place.id);
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <strong>${escapeHtml(place.name)}</strong>
      <p>
        <i class="fas fa-map-marker-alt" style="color:#e74c3c;"></i>
        ${escapeHtml(place.address)}
        ${place.distance ? `(${place.distance.toFixed(2)} km)` : ''}
      </p>
      <div class="result-actions">
        <button class="btn-go"><i class="fas fa-crosshairs"></i> Voir</button>
        ${place.phone ? `<a class="btn-call" href="tel:${place.phone}"><i class="fas fa-phone"></i> Appeler</a>` : ''}
        <button class="btn-fav" style="background: ${isFav ? '#d35400' : '#f1c40f'}">
          <i class="fas fa-star"></i> ${isFav ? 'Retirer' : 'Favori'}
        </button>
        <button class="btn-share"><i class="fas fa-share-alt"></i> Partager</button>
      </div>
    `;

    card.querySelector('.btn-go').addEventListener('click', () => {
      state.map.setView([place.lat, place.lon], 17);
      marker.openPopup();
    });

    card.querySelector('.btn-fav').addEventListener('click', (e) => {
      toggleFav(place.id, place.lat, place.lon, place.name);
      const currentlyFav = state.favs.some(f => f.id === place.id);
      e.currentTarget.style.background = currentlyFav ? '#d35400' : '#f1c40f';
      e.currentTarget.innerHTML = `<i class="fas fa-star"></i> ${currentlyFav ? 'Retirer' : 'Favori'}`;
    });

    card.querySelector('.btn-share').addEventListener('click', () => {
      if (window.sharePlace) window.sharePlace(place.name, place.lat, place.lon);
    });

    listEl.appendChild(card);
  });

  document.getElementById('results-panel').classList.add('open');
}

// ---------- Calcul d'Itinéraire OSRM Déporté ----------
window.startRouting = function(endLat, endLon) {
  if (!state.currentPos) {
    alert("Veuillez autoriser et activer votre géolocalisation pour générer un itinéraire.");
    return;
  }
  showRoute(state.map, state.currentPos.lat, state.currentPos.lng, endLat, endLon);
};

// ---------- Formule Mathématique de Haversine ----------
function haversine(coord1, place) {
  const R = 6371;
  const dLat = (place.lat - coord1.lat) * Math.PI / 180;
  const dLon = (place.lon - coord1.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(place.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Gestion des favoris synchronisés ----------
function toggleFav(id, lat, lon, name) {
  const idx = state.favs.findIndex(f => f.id === id);
  if (idx >= 0) {
    state.favs.splice(idx, 1);
  } else {
    state.favs.push({ id, lat, lon, name });
  }
  localStorage.setItem('civ_favs', JSON.stringify(state.favs));

  // FIX BUG#5 : On dispatch un CustomEvent nommé au lieu de new Event('storage').
  // new Event('storage') ne transporte pas de propriété "key", donc la vérification
  // if (e.key === 'civ_favs') dans favorites.js était toujours false → pas de rafraîchissement.
  window.dispatchEvent(new CustomEvent('favsUpdated'));
}

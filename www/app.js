// ---------- Configuration ----------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_DURATION = 30 * 60 * 1000;
const DEBOUNCE_DELAY = 500;
const MAX_BBOX_AREA = 0.5; // degrés² max pour éviter timeout (environ 50 km²)

// ---------- État global ----------
const state = {
  map: null,
  markersLayer: null,
  currentPos: null,
  activeCategory: null,
  results: [],
  favs: JSON.parse(localStorage.getItem('civ_favs') || '[]'),
  history: JSON.parse(localStorage.getItem('civ_history') || '[]'),
  cache: JSON.parse(localStorage.getItem('civ_cache') || '{}'),
  lastFetchKey: null,
  isFetching: false
};

// ---------- Mapping catégories ----------
const CATEGORY_TAGS = {
  hospital: 'amenity=hospital',
  pharmacy: 'amenity=pharmacy',
  school: 'amenity=school',
  fuel: 'amenity=fuel',
  market: 'shop~".*"',
  public: 'amenity=public_building'
};
const CATEGORY_NAMES = {
  hospital: 'Hôpital', pharmacy: 'Pharmacie', school: 'École',
  fuel: 'Station essence', market: 'Commerce', public: 'Service public'
};

// ---------- Utilitaires UI ----------
function showLoading(show) {
  const loader = document.getElementById('loader-container');
  if (show) loader.classList.remove('hidden');
  else loader.classList.add('hidden');
  state.isFetching = show;
}

function showError(msg, isWarning = false) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.style.backgroundColor = isWarning ? '#f0ad4e' : '#dc3545';
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
  console.error(msg);
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function haversine(coord1, place) {
  if (!coord1) return null;
  const R = 6371;
  const dLat = (place.lat - coord1.lat) * Math.PI / 180;
  const dLon = (place.lon - coord1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(coord1.lat * Math.PI/180) * Math.cos(place.lat * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ---------- Ajustement de la bbox pour éviter les timeouts ----------
function adjustBbox(bounds) {
  let south = bounds.getSouth();
  let west = bounds.getWest();
  let north = bounds.getNorth();
  let east = bounds.getEast();
  let area = (north - south) * (east - west);
  if (area > MAX_BBOX_AREA) {
    const factor = Math.sqrt(MAX_BBOX_AREA / area);
    const latCenter = (south + north) / 2;
    const lngCenter = (west + east) / 2;
    const latDelta = (north - south) * factor / 2;
    const lngDelta = (east - west) * factor / 2;
    south = latCenter - latDelta;
    north = latCenter + latDelta;
    west = lngCenter - lngDelta;
    east = lngCenter + lngDelta;
  }
  return [south, west, north, east];
}

// ---------- Requête Overpass robuste avec User-Agent ----------
async function fetchPlaces(category, bbox) {
  const tagQuery = CATEGORY_TAGS[category];
  if (!tagQuery) return [];
  const [south, west, north, east] = bbox;
  const bboxStr = `${south},${west},${north},${east}`;
  const cacheKey = `${category}_${bboxStr}`;
  const cached = state.cache[cacheKey];
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log('Cache hit');
    return cached.data;
  }

  // Requête simplifiée : uniquement des nodes (plus rapide, moins d'erreurs)
  const query = `[out:json][timeout:15];
(
  node[${tagQuery}](${bboxStr});
);
out body;`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'CIVServices/1.0 (https://civservices.ci; contact@civservices.ci)'
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    
    const places = json.elements.map(el => ({
      id: el.id,
      lat: el.lat,
      lon: el.lon,
      tags: el.tags || {},
      type: el.type
    })).filter(p => p.lat && p.lon).slice(0, 50);

    state.cache[cacheKey] = { data: places, timestamp: Date.now() };
    localStorage.setItem('civ_cache', JSON.stringify(state.cache));
    return places;
  } catch (err) {
    console.error('Overpass error:', err);
    if (err.name === 'AbortError') {
      showError('Le service met trop de temps à répondre. Réduisez la zone visible.');
    } else if (err.message.includes('HTTP 429')) {
      showError('Trop de requêtes, attendez quelques secondes.');
    } else {
      showError('Erreur de connexion au service Overpass. Vérifiez votre connexion internet.');
    }
    return [];
  }
}

// ---------- Marqueurs ----------
function updateMarkers(places) {
  state.markersLayer.clearLayers();
  places.forEach(place => {
    const name = place.tags.name || place.tags.amenity || place.tags.shop || 'Sans nom';
    const distance = state.currentPos ? haversine(state.currentPos, place) : null;
    const distHtml = distance ? `<br><small>📏 ${distance.toFixed(1)} km</small>` : '';
    const popupContent = `
      <b>${escapeHtml(name)}</b><br>
      <small>${CATEGORY_NAMES[state.activeCategory] || ''}</small>
      ${distHtml}<br>
      <button onclick="window.openDirections(${place.lat},${place.lon})" style="margin-top:6px; padding:4px 10px; background:#2c3e50; color:white; border:none; border-radius:20px; cursor:pointer;">🗺️ Itinéraire</button>
    `;
    const marker = L.marker([place.lat, place.lon]).bindPopup(popupContent);
    marker.addTo(state.markersLayer);
  });
}

window.openDirections = (lat, lon) => {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '_blank');
};

// ---------- Panneau résultats ----------
function displayResults(places) {
  const list = document.getElementById('results-list');
  list.innerHTML = '';
  if (!places.length) {
    list.innerHTML = '<p style="padding:16px; text-align:center;">Aucun résultat trouvé dans cette zone.</p>';
    document.getElementById('results-panel').classList.add('open');
    return;
  }
  state.results = places;
  places.forEach(place => {
    const name = place.tags.name || place.tags.amenity || place.tags.shop || 'Sans nom';
    const dist = state.currentPos ? haversine(state.currentPos, place) : null;
    const distStr = dist ? `${dist.toFixed(1)} km` : '';
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `
      <div style="flex:1">
        <strong>${escapeHtml(name)}</strong><br>
        <small>${CATEGORY_NAMES[state.activeCategory] || ''}</small>
        ${distStr ? `<span class="result-distance">${distStr}</span>` : ''}
      </div>
      <span class="fav-star" data-id="${place.id}" data-lat="${place.lat}" data-lon="${place.lon}" data-name="${escapeHtml(name)}">☆</span>
    `;
    const starSpan = div.querySelector('.fav-star');
    if (state.favs.some(f => f.id === String(place.id))) starSpan.innerText = '★';
    else starSpan.innerText = '☆';

    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-star')) return;
      state.map.setView([place.lat, place.lon], 17);
      state.markersLayer.eachLayer(m => {
        const latlng = m.getLatLng();
        if (Math.abs(latlng.lat - place.lat) < 0.0001 && Math.abs(latlng.lng - place.lon) < 0.0001)
          m.openPopup();
      });
    });

    starSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = String(place.id);
      const idx = state.favs.findIndex(f => f.id === id);
      if (idx !== -1) state.favs.splice(idx, 1);
      else state.favs.push({ id, lat: place.lat, lon: place.lon, name });
      localStorage.setItem('civ_favs', JSON.stringify(state.favs));
      starSpan.innerText = state.favs.some(f => f.id === id) ? '★' : '☆';
    });
    list.appendChild(div);
  });
  document.getElementById('results-panel').classList.add('open');
  addToHistory(state.activeCategory);
}

function addToHistory(category) {
  state.history.unshift({ category, timestamp: Date.now() });
  if (state.history.length > 20) state.history.pop();
  localStorage.setItem('civ_history', JSON.stringify(state.history));
}

// ---------- Recherche principale ----------
async function searchAroundMap(category, force = false) {
  if (!state.map || state.isFetching) return;
  const bounds = state.map.getBounds();
  const adjustedBbox = adjustBbox(bounds);
  const fetchKey = `${category}_${adjustedBbox.join(',')}`;
  if (!force && state.lastFetchKey === fetchKey) return;
  state.lastFetchKey = fetchKey;
  state.activeCategory = category;
  showLoading(true);
  const places = await fetchPlaces(category, adjustedBbox);
  showLoading(false);
  displayResults(places);
  updateMarkers(places);
  if (places.length === 0) {
    showError('Aucun service trouvé dans cette zone. Essayez de zoomer ou déplacer la carte.', true);
  }
}

const debouncedSearch = (() => {
  let timer;
  return (category) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => searchAroundMap(category), DEBOUNCE_DELAY);
  };
})();

// ---------- Géolocalisation ----------
function locateUser() {
  if (!navigator.geolocation) {
    showError("Géolocalisation non supportée par votre appareil");
    return;
  }
  showLoading(true);
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.map.setView([state.currentPos.lat, state.currentPos.lng], 15);
      if (!state.activeCategory) {
        state.activeCategory = 'hospital';
        document.querySelector('[data-cat="hospital"]').classList.add('active');
      }
      searchAroundMap(state.activeCategory, true);
      showLoading(false);
    },
    err => {
      showError("Impossible d'obtenir votre position. Activez la géolocalisation.");
      showLoading(false);
      // Fallback : centre sur Abidjan
      state.map.setView([5.359952, -4.008256], 13);
      if (!state.activeCategory) {
        state.activeCategory = 'hospital';
        document.querySelector('[data-cat="hospital"]').classList.add('active');
        searchAroundMap('hospital', true);
      }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------- Recherche naturelle ----------
async function handleNaturalSearch(query) {
  const q = query.toLowerCase().trim();
  let category = null;
  let locationStr = '';
  const catPatterns = [
    { regex: /pharmacie/i, cat: 'pharmacy' },
    { regex: /hôpital|hopital|centre de santé/i, cat: 'hospital' },
    { regex: /station essence|essence|fuel/i, cat: 'fuel' },
    { regex: /école|ecole|etablissement/i, cat: 'school' },
    { regex: /marché|marche|commerce|boutique|supermarché|magasin/i, cat: 'market' },
    { regex: /mairie|service public|administration|publics/i, cat: 'public' }
  ];
  for (const { regex, cat } of catPatterns) {
    if (regex.test(q)) {
      category = cat;
      locationStr = q.replace(regex, '').replace(/proche|près|de|des|à|au|aux|dans|sur/g, '').trim();
      break;
    }
  }
  if (!category) {
    showError("Indiquez une catégorie : pharmacie, hôpital, école, essence, commerce, public");
    return;
  }

  let center = state.currentPos;
  if (locationStr && !['proche','ici',''].includes(locationStr)) {
    try {
      const resp = await fetch(`${NOMINATIM_URL}?format=json&q=${encodeURIComponent(locationStr + ', Côte d\'Ivoire')}&limit=1`, {
        headers: { 'User-Agent': 'CIVServices/1.0' }
      });
      const data = await resp.json();
      if (data.length) center = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      else showError("Lieu non trouvé, recherche autour de vous", true);
    } catch(e) { showError("Erreur de géocodage"); }
  }
  if (!center) {
    if (!state.currentPos) await locateUser();
    center = state.currentPos;
    if (!center) return;
  }
  state.map.setView([center.lat, center.lng], 14);
  state.activeCategory = category;
  document.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.cat-btn[data-cat="${category}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  searchAroundMap(category, true);
}

// ---------- Initialisation ----------
document.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 CIV Services - Développé par Hino Coding Lab | Version 1.0 | https://hinolab.com");
  state.map = L.map('map', { zoomControl: false }).setView([5.359952, -4.008256], 13);
  L.control.zoom({ position: 'bottomleft' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(state.map);
  state.markersLayer = L.layerGroup().addTo(state.map);

  document.getElementById('locate-btn').addEventListener('click', locateUser);
  document.getElementById('search-btn').addEventListener('click', () => {
    const query = document.getElementById('search-input').value.trim();
    if (query) handleNaturalSearch(query);
  });
  document.getElementById('search-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('search-btn').click();
  });

  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      state.activeCategory = cat;
      searchAroundMap(cat, true);
    });
  });

  document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('results-panel').classList.remove('open');
  });

  state.map.on('moveend', () => {
    if (state.activeCategory) debouncedSearch(state.activeCategory);
  });

  // Lancer la localisation au démarrage
  locateUser();
});
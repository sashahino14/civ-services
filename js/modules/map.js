// js/modules/map.js

let currentMarkers = [];
let userLocationMarker = null;

/**
 * Initialise la carte Leaflet avec les vues Plan et Satellite
 * @returns {Object} - L'instance de la carte
 */
export function initMap() {
    // Initialisation de la carte centrée sur la Côte d'Ivoire
    const map = L.map('map-container').setView([6.8276, -5.2893], 7);

    // 1. Définition de la vue "Plan" (OpenStreetMap)
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    });

    // 2. Définition de la vue "Satellite" (Esri World Imagery)
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles © Esri'
    });

    // 3. Ajout de la vue "Plan" par défaut sur la carte
    osmLayer.addTo(map);

    // 4. Création du sélecteur de couches (en bas à gauche)
    const baseMaps = {
        "Plan": osmLayer,
        "Satellite": satelliteLayer
    };

    L.control.layers(baseMaps, null, { position: 'bottomleft' }).addTo(map);

    return map;
}

/**
 * Centre la carte sur une position donnée et ajoute un marqueur
 * @param {Object} map - L'instance Leaflet
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 */
export function centerOnUser(map, lat, lon) {
    // On supprime l'ancien marqueur de position s'il existe
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
    }

    // On crée un marqueur personnalisé pour l'utilisateur (point bleu)
    const userIcon = L.divIcon({
        className: 'user-location-marker',
        html: `<div style="
            background-color: #3498db;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    userLocationMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map);
    userLocationMarker.bindPopup("Vous êtes ici").openPopup();

    // On centre la carte avec un zoom de 14
    map.setView([lat, lon], 14);
}

/**
 * Affiche les marqueurs sur la carte
 * @param {Object} map - L'instance Leaflet
 * @param {Array} services - Liste des services à afficher
 * @param {Object} category - La catégorie (pour l'icône et la couleur)
 * @param {Function} onMarkerClick - Callback au clic sur un marqueur
 */
export function displayMarkers(map, services, category, onMarkerClick) {
    clearMarkers();

    const markersGroup = L.featureGroup().addTo(map);

    services.forEach(service => {
        const customIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="
                background-color: ${category.color};
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 14px;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            ">
                <i class="fas ${category.icon}"></i>
            </div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15]
        });

        const marker = L.marker([service.lat, service.lon], { icon: customIcon })
            .addTo(markersGroup);

        const popupContent = `
            <div style="text-align: center;">
                <strong>${service.name}</strong><br>
                <small>${service.tags['addr:city'] || 'Côte d\'Ivoire'}</small><br>
                <button onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${service.lat},${service.lon}', '_blank')" 
                        style="margin-top: 5px; padding: 5px 10px; background: ${category.color}; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Itinéraire
                </button>
            </div>
        `;

        marker.bindPopup(popupContent);
        
        if (onMarkerClick) {
            marker.on('click', () => onMarkerClick(service));
        }

        currentMarkers.push(marker);
    });

    if (services.length > 0) {
        map.fitBounds(markersGroup.getBounds(), { padding: [50, 50], maxZoom: 16 });
    }
}

/**
 * Supprime tous les marqueurs de service de la carte
 */
export function clearMarkers() {
    currentMarkers.forEach(marker => {
        if (marker._map) {
            marker.remove();
        }
    });
    currentMarkers = [];
}
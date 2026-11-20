// js/modules/categories/config.js

export const CATEGORIES = {
    pharmacy: {
        id: 'pharmacy',
        name: 'Pharmacies',
        icon: 'fa-prescription-bottle-medical',
        color: '#2ecc71', // Vert
        overpassQuery: (lat, lon, radius) => `
            [out:json][timeout:25];
            (
              node["amenity"="pharmacy"](around:${radius},${lat},${lon});
              way["amenity"="pharmacy"](around:${radius},${lat},${lon});
              relation["amenity"="pharmacy"](around:${radius},${lat},${lon});
            );
            out center;
        `
    },
    hospital: {
        id: 'hospital',
        name: 'Hôpitaux / Cliniques',
        icon: 'fa-hospital',
        color: '#e74c3c', // Rouge
        overpassQuery: (lat, lon, radius) => `
            [out:json][timeout:25];
            (
              node["amenity"~"hospital|clinic"](around:${radius},${lat},${lon});
              way["amenity"~"hospital|clinic"](around:${radius},${lat},${lon});
            );
            out center;
        `
    },
    fuel: {
        id: 'fuel',
        name: 'Stations-service',
        icon: 'fa-gas-pump',
        color: '#f39c12', // Orange
        overpassQuery: (lat, lon, radius) => `
            [out:json][timeout:25];
            (
              node["amenity"="fuel"](around:${radius},${lat},${lon});
              way["amenity"="fuel"](around:${radius},${lat},${lon});
            );
            out center;
        `
    },
    supermarket: {
        id: 'supermarket',
        name: 'Supermarchés',
        icon: 'fa-cart-shopping',
        color: '#3498db', // Bleu
        overpassQuery: (lat, lon, radius) => `
            [out:json][timeout:25];
            (
              node["shop"="supermarket"](around:${radius},${lat},${lon});
              way["shop"="supermarket"](around:${radius},${lat},${lon});
            );
            out center;
        `
    },
    police: {
        id: 'police',
        name: 'Police / Gendarmerie',
        icon: 'fa-shield-halved',
        color: '#34495e', // Bleu foncé
        overpassQuery: (lat, lon, radius) => `
            [out:json][timeout:25];
            (
              node["amenity"="police"](around:${radius},${lat},${lon});
              way["amenity"="police"](around:${radius},${lat},${lon});
            );
            out center;
        `
    },
    bank: {
        id: 'bank',
        name: 'Banques / ATM',
        icon: 'fa-building-columns',
        color: '#9b59b6', // Violet
        overpassQuery: (lat, lon, radius) => `
            [out:json][timeout:25];
            (
              node["amenity"~"bank|atm"](around:${radius},${lat},${lon});
              way["amenity"~"bank|atm"](around:${radius},${lat},${lon});
            );
            out center;
        `
    }
};

// Rayon de recherche par défaut (en mètres)
export const DEFAULT_RADIUS = 5000; // 5 km
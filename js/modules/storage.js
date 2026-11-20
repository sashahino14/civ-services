// js/modules/storage.js

const STORAGE_KEY = 'civ_services_lost_found';

/**
 * Récupère toutes les annonces depuis le localStorage
 * @returns {Array} Liste des annonces
 */
export function getAds() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
}

/**
 * Ajoute une nouvelle annonce
 * @param {Object} ad - L'annonce à ajouter
 */
export function addAd(ad) {
    const ads = getAds();
    // On ajoute un ID unique et la date de création
    ad.id = Date.now().toString();
    ad.date = new Date().toLocaleDateString('fr-FR');
    ads.unshift(ad); // On ajoute au début de la liste
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ads));
    return ad;
}

/**
 * Supprime une annonce par son ID
 * @param {string} id - L'ID de l'annonce
 */
export function deleteAd(id) {
    let ads = getAds();
    ads = ads.filter(ad => ad.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ads));
}